const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeInMemoryStore, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const express = require("express");
require('dotenv').config();

// --- 1. SERVIDOR WEB ---
const app = express();
const PORT = process.env.PORT || 3000;
let ultimoQR = "";
let isConnected = false;

app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1 style="color:green; text-align:center; margin-top:50px; font-family:sans-serif;">✅ Teacher Bot (Baileys) ONLINE!</h1>');
    } else if (ultimoQR) {
        // Baileys retorna o QR Code puro, precisamos converter para imagem na API
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(ultimoQR)}`;
        res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px;"><h1>Escaneie Agora:</h1><img src="${url}" style="border:5px solid #333; border-radius:10px;" /><p>Se não funcionar, atualize a página.</p></div>`);
    } else {
        res.send('<h1 style="text-align:center; font-family:sans-serif; margin-top:50px;">⏳ Iniciando... aguarde o QR Code.</h1>');
    }
});
app.listen(PORT, () => console.log(`🌐 Web rodando na porta ${PORT}`));

// --- 2. MONGO DB & SCHEMAS ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB Conectado"))
    .catch(err => console.error('❌ Erro Mongo:', err));

const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    level: { type: String, default: 'Beginner' },
    xp: { type: Number, default: 0 },
    history: [{ role: String, content: String }]
});
const User = mongoose.model('User', userSchema);

// Schema para salvar a Sessão do Baileys no Banco
const sessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('Session', sessionSchema);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- 3. FUNÇÃO DE AUTH PERSONALIZADA (MONGO) ---
// Isso substitui o arquivo local pelo MongoDB para salvar o login
const useMongoDBAuthState = async (collection) => {
    const writeData = (data, file) => {
        return collection.updateOne({ _id: file }, { $set: { data: JSON.parse(JSON.stringify(data, (key, value) => (typeof value === 'bigint' ? value.toString() : value))) } }, { upsert: true });
    };
    const readData = async (file) => {
        const doc = await collection.findOne({ _id: file });
        return doc ? doc.data : null;
    };
    const removeData = async (file) => {
        await collection.deleteOne({ _id: file });
    };

    const creds = (await readData('creds')) || (await require('@whiskeysockets/baileys').initAuthCreds());

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
        saveCreds: () => writeData(creds, 'creds')
    };
};

// --- 4. INICIAR BOT ---
async function startBot() {
    console.log("🚀 Iniciando Baileys...");
    
    // Carrega a autenticação do Mongo
    const { state, saveCreds } = await useMongoDBAuthState(Session);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), // Log silencioso para não poluir
        printQRInTerminal: true, // Mostra no log também
        auth: state,
        browser: ["Teacher Bot", "Chrome", "1.0.0"], // Identificação
        connectTimeoutMs: 60000,
    });

    // Gerenciamento de Eventos de Conexão
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("📸 Novo QR Code gerado!");
            ultimoQR = qr;
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada. Reconectando...', shouldReconnect);
            isConnected = false;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅✅✅ CONEXÃO ABERTA E PRONTA ✅✅✅');
            isConnected = true;
            ultimoQR = ""; // Limpa QR
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Gerenciamento de Mensagens
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        // Simplifica o objeto da mensagem
        const from = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;
        const pushName = msg.pushName || "Student";
        
        // Pega o texto da mensagem (pode vir de conversation ou extendedTextMessage)
        const textBody = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        console.log(`📨 Msg de ${from}: ${textBody.substring(0, 20)}...`);

        // --- MODO ESPELHO (SEGURANÇA) ---
        // Baileys não tem "to", então verificamos se o remoteJid é o meu próprio número
        // Para falar consigo mesmo, o remoteJid geralmente é o seu numero@s.whatsapp.net e isFromMe é true
        const isMirror = isFromMe && from === sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Se quiser testar enviando de outro celular para o bot, remova o "&& isMirror"
        // Para o modo espelho funcionar no Baileys, é um pouco chato. 
        // SUGESTÃO: Vamos permitir que você fale com o bot enviando mensagem PARA ELE.
        // Se a mensagem veio de MIM (eu mandei do celular) e é no chat "Anotei" (meu numero), ok.
        
        // Simplificação: Responde a qualquer um (mas só você tem o número do bot se for novo) 
        // OU: Verifica se é o SEU número.
        // Vamos permitir responder a qualquer mensagem direta (DM) por enquanto para testar.
        if (msg.key.remoteJid.includes('@g.us')) return; // Ignora grupos

        // Evita loop do próprio bot
        if (isFromMe && (textBody.includes('Teacher AI') || textBody.startsWith('🌟'))) return;
        
        try {
            // Comandos
            if (textBody === '!ping') {
                await sock.sendMessage(from, { text: '🏓 Pong! Baileys está vivo.' });
                return;
            }

            // Banco de Dados do Aluno
            // O ID no Baileys vem como "551199999999@s.whatsapp.net", limpamos para salvar só numeros se quiser
            let usuario = await User.findOne({ phoneNumber: from });
            if (!usuario) {
                usuario = new User({ phoneNumber: from });
                await usuario.save();
            }

            if (textBody === '!perfil') {
                await sock.sendMessage(from, { text: `📊 XP: ${usuario.xp} | Level: ${usuario.level}` });
                return;
            }

            let inputUsuario = textBody;

            // Tratamento de Áudio
            // Verifica se tem audioMessage
            const isAudio = msg.message.audioMessage;
            if (isAudio) {
                // await sock.sendMessage(from, { text: "👂 Ouvindo áudio..." });
                const stream = await downloadMediaMessage(
                    msg,
                    'buffer',
                    { },
                    { 
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    }
                );
                
                const caminho = path.join(__dirname, 'temp_audio.ogg');
                fs.writeFileSync(caminho, stream);
                
                const trans = await openai.audio.transcriptions.create({ file: fs.createReadStream(caminho), model: "whisper-1" });
                inputUsuario = trans.text;
                await sock.sendMessage(from, { text: `👂 Heard: "${inputUsuario}"` });
            }

            // Inteligência (GPT)
            if (inputUsuario) {
                const systemPrompt = `Você é um professor de inglês. Nível ${usuario.level}. Responda curto.
                1. Correction: Use "❌ Erro -> ✅ Correção".
                2. Se perfeito: termine com [XP].
                3. Termine com uma pergunta.`;

                const history = usuario.history.slice(-6).map(h => ({ role: h.role, content: h.content }));

                const gpt = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: inputUsuario }]
                });

                let resp = gpt.choices[0].message.content;
                if (resp.includes('[XP]')) {
                    usuario.xp += 10;
                    resp = resp.replace('[XP]', '🌟 (+10 XP)');
                } else { usuario.xp += 1; }

                usuario.history.push({ role: "user", content: inputUsuario });
                usuario.history.push({ role: "assistant", content: resp });
                await usuario.save();

                await sock.sendMessage(from, { text: resp });

                // Áudio de Resposta
                const clean = resp.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, ''); 
                if (clean.length > 2) {
                    const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'onyx', input: clean });
                    const buffer = Buffer.from(await mp3.arrayBuffer());
                    // Baileys envia áudio direto do buffer, muito mais fácil!
                    await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                }
            }

        } catch (e) {
            console.error("Erro processando msg:", e);
        }
    });
}

startBot();