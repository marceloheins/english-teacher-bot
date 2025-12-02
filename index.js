const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, downloadMediaMessage, BufferJSON, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const express = require("express");
require('dotenv').config();

// --- 1. SERVIDOR WEB (Visualização do QR Code) ---
const app = express();
const PORT = process.env.PORT || 3000;
let ultimoQR = "";
let isConnected = false;
let statusMsg = "Iniciando...";

app.get('/', (req, res) => {
    // Cabeçalho para atualizar a página a cada 5 segundos
    const htmlHead = '<head><meta http-equiv="refresh" content="5"><meta name="viewport" content="width=device-width, initial-scale=1"></head>';
    const style = 'body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; text-align: center; } .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }';

    if (isConnected) {
        res.send(`<html>${htmlHead}<style>${style}</style><body><div class="card"><h1 style="color:green">✅ Bot Conectado!</h1><p>Status: Online e Operante.</p><p>Vá ao WhatsApp e mande <b>!ping</b>.</p></div></body></html>`);
    } else if (ultimoQR) {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(ultimoQR)}`;
        res.send(`<html>${htmlHead}<style>${style}</style><body><div class="card"><h1>Escaneie o QR Code</h1><img src="${url}" style="border: 5px solid #333; border-radius: 10px;"/><p>Status: ${statusMsg}</p><p style="color:red; font-size: 12px;">Página atualiza a cada 5s.</p></div></body></html>`);
    } else {
        res.send(`<html>${htmlHead}<style>${style}</style><body><div class="card"><h1>⏳ Carregando...</h1><p>${statusMsg}</p></div></body></html>`);
    }
});
app.listen(PORT, () => console.log(`🌐 Web rodando na porta ${PORT}`));

// --- 2. MONGO DB ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Conectado"))
    .catch(err => console.error('❌ Erro Mongo:', err));

// Schema do Aluno
const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    level: { type: String, default: 'Beginner' },
    xp: { type: Number, default: 0 },
    history: [{ role: String, content: String }]
});
const User = mongoose.model('User', userSchema);

// Schema da Sessão do WhatsApp (Auth)
// Usamos uma coleção separada para garantir integridade
const authSchema = new mongoose.Schema({ _id: String, data: Object }, { strict: false });
const AuthStore = mongoose.model('AuthStore', authSchema);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- 3. GESTÃO DE SESSÃO NO MONGO (COM FIX DE BUFFER) ---
const useMongoDBAuthState = async (collection) => {
    const writeData = (data, file) => {
        try {
            // BufferJSON é vital para não corromper as chaves de criptografia do Baileys
            return collection.updateOne(
                { _id: file }, 
                { $set: { data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) } }, 
                { upsert: true }
            );
        } catch(e) { console.error("Erro ao salvar sessão:", e); }
    };

    const readData = async (file) => {
        try {
            const doc = await collection.findOne({ _id: file });
            if (!doc?.data) return null;
            return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
        } catch(e) { return null; }
    };

    const removeData = async (file) => {
        try { await collection.deleteOne({ _id: file }); } catch(e) {}
    };

    const clearAll = async () => {
        try { 
            console.log("🧹 LIMPANDO BANCO DE DADOS DE SESSÃO...");
            await collection.deleteMany({}); 
        } catch(e) {}
    };

    let creds = await readData('creds');
    if (!creds) {
        creds = (await require('@whiskeysockets/baileys').initAuthCreds());
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = require('@whiskeysockets/baileys/lib/Utils/proto').proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        if (value) data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) tasks.push(writeData(value, `${category}-${id}`));
                            else tasks.push(removeData(`${category}-${id}`));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds'),
        clearAll // Exportamos essa função para usar no erro fatal
    };
};

// --- 4. LÓGICA DO BOT ---
async function startBot() {
    console.log("🚀 Iniciando Bot...");
    statusMsg = "Iniciando sistema...";

    const { state, saveCreds, clearAll } = await useMongoDBAuthState(AuthStore);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Não poluir log
        auth: state,
        browser: ["TeacherBot", "Chrome", "1.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        retryRequestDelayMs: 2000,
        markOnlineOnConnect: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📸 Novo QR Code Gerado!");
            ultimoQR = qr;
            statusMsg = "Aguardando leitura do QR Code...";
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const statusCode = (error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            const errorMsg = error?.message || "";

            console.log(`❌ Conexão Fechada. Code: ${statusCode}, Msg: ${errorMsg}`);
            statusMsg = `Desconectado (${errorMsg}). Tentando reconectar...`;

            // --- AUTO-CORREÇÃO DE ERRO FATAL ---
            // Se der erro de Stream, Bad MAC ou 401, significa que a sessão no banco estragou.
            // A solução é limpar tudo e reiniciar do zero.
            if (errorMsg.includes('Stream Errored') || errorMsg.includes('Bad MAC') || statusCode === 401) {
                console.log("⚠️ ERRO CRÍTICO DETECTADO! INICIANDO PROTOCOLO DE LIMPEZA...");
                await clearAll(); // Apaga a sessão do Mongo
                console.log("✅ Banco limpo. Reiniciando processo para gerar novo QR Code...");
                process.exit(0); // Mata o processo (o Render reinicia automaticamente limpo)
            }

            isConnected = false;
            if (shouldReconnect) {
                setTimeout(startBot, 2000);
            }
        } else if (connection === 'open') {
            console.log('✅✅✅ CONECTADO COM SUCESSO! ✅✅✅');
            isConnected = true;
            ultimoQR = "";
            statusMsg = "Online";
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- PROCESSAMENTO DE MENSAGENS ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;
        
        // Extrai texto de várias fontes possíveis
        const textBody = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // Ignora grupos
        if (msg.key.remoteJid.includes('@g.us')) return; 
        
        // Ignora mensagens do próprio bot (evita loop)
        if (isFromMe && (textBody.includes('Teacher') || textBody.startsWith('🌟'))) return;

        try {
            // Comando de teste simples
            if (textBody === '!ping') {
                console.log("🏓 Ping recebido!");
                await sock.sendMessage(from, { text: '🏓 Pong! Estou vivo.' });
                return;
            }

            // --- LÓGICA DO PROFESSOR (GPT + BANCO) ---
            
            // 1. Busca/Cria Aluno
            let usuario = await User.findOne({ phoneNumber: from });
            if (!usuario) {
                usuario = new User({ phoneNumber: from });
                await usuario.save();
            }

            // 2. Perfil
            if (textBody === '!perfil') {
                await sock.sendMessage(from, { text: `📊 Nível: ${usuario.level} | XP: ${usuario.xp}` });
                return;
            }

            let inputUsuario = textBody;
            const isAudio = msg.message.audioMessage;
            
            // 3. Áudio (Whisper)
            if (isAudio) {
                const stream = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                const caminho = path.join(__dirname, 'temp.ogg');
                fs.writeFileSync(caminho, stream);
                const trans = await openai.audio.transcriptions.create({ file: fs.createReadStream(caminho), model: "whisper-1" });
                inputUsuario = trans.text;
                await sock.sendMessage(from, { text: `👂 Ouvi: "${inputUsuario}"` });
            }

            // 4. Inteligência (GPT-4o)
            if (inputUsuario) {
                const systemPrompt = `Você é um professor de inglês. O aluno é Nível ${usuario.level}.
                Seja didático e paciente.
                Regras:
                1. Se o aluno errar: Use "❌ Erro -> ✅ Correção".
                2. Se acertar perfeitamente: Adicione tag [XP] no final.
                3. Termine sempre incentivando a conversa.`;

                const history = usuario.history.slice(-6).map(h => ({ role: h.role, content: h.content }));
                
                const gpt = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: inputUsuario }]
                });

                let resp = gpt.choices[0].message.content;
                
                // Lógica de XP
                if (resp.includes('[XP]')) {
                    usuario.xp += 10;
                    resp = resp.replace('[XP]', '🌟 (+10 XP)');
                } else { usuario.xp += 1; }

                // Salva histórico
                usuario.history.push({ role: "user", content: inputUsuario });
                usuario.history.push({ role: "assistant", content: resp });
                await usuario.save();

                // Envia Texto
                await sock.sendMessage(from, { text: resp });

                // Envia Áudio (TTS)
                // Remove formatação visual para o áudio ficar limpo
                const clean = resp.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, ''); 
                if (clean.length > 2) {
                    const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'alloy', input: clean });
                    const buffer = Buffer.from(await mp3.arrayBuffer());
                    await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                }
            }
        } catch (e) {
            console.error("Erro geral:", e);
        }
    });
}

startBot();