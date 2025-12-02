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
        res.send(`
            <div style="display:flex; justify-content:center; align-items:center; height:100vh; background-color:#dcf8c6; font-family:sans-serif; flex-direction:column;">
                <h1 style="color:green;">✅ Teacher Bot (Baileys) ONLINE!</h1>
                <p>Status: Conectado e Pronto.</p>
                <p>Vá para o WhatsApp e mande <b>!ping</b></p>
            </div>
        `);
    } else if (ultimoQR) {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(ultimoQR)}`;
        res.send(`
            <html>
                <head>
                    <!-- ATUALIZA A PÁGINA A CADA 5 SEGUNDOS PARA O QR CODE NÃO EXPIRAR -->
                    <meta http-equiv="refresh" content="5">
                </head>
                <body>
                    <div style="display:flex; justify-content:center; align-items:center; height:100vh; background-color:#f0f0f0; font-family:sans-serif; flex-direction:column;">
                        <h1>Escaneie Agora:</h1>
                        <img src="${url}" style="border:5px solid #333; border-radius:10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
                        <p style="font-weight: bold; color: red;">A página atualiza sozinha a cada 5s para garantir que o código é válido.</p>
                        <p>Funciona com WhatsApp Pessoal e Business.</p>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <head><meta http-equiv="refresh" content="5"></head>
                <body>
                    <div style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
                        <h1>⏳ Iniciando... aguarde o QR Code.</h1>
                    </div>
                </body>
            </html>
        `);
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

const sessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('Session', sessionSchema);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- 3. FUNÇÃO DE AUTH PERSONALIZADA (MONGO) ---
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

    // Tenta ler do banco. Se não existir, cria novas credenciais.
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
        saveCreds: () => writeData(creds, 'creds')
    };
};

// --- 4. INICIAR BOT ---
async function startBot() {
    console.log("🚀 Iniciando Baileys...");
    
    const { state, saveCreds } = await useMongoDBAuthState(Session);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // REMOVIDO AVISO DEPRECATED
        auth: state,
        // Mudamos para navegador padrão para evitar suspeitas do WhatsApp
        browser: ["Teacher Bot", "Chrome", "1.0.0"], 
        connectTimeoutMs: 300000, // AUMENTADO PARA 5 MINUTOS
        defaultQueryTimeoutMs: 0, 
        keepAliveIntervalMs: 10000, 
        retryRequestDelayMs: 5000, // Tenta novamente se falhar
        syncFullHistory: false 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("📸 Novo QR Code gerado! (Acesse o site)");
            ultimoQR = qr;
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ Conexão fechada. Reconectando... ${shouldReconnect}`);
            isConnected = false;
            
            if (shouldReconnect) {
                // Aumentei o delay para 5s para evitar martelar o servidor
                setTimeout(startBot, 5000); 
            }
        } else if (connection === 'open') {
            console.log('✅✅✅ CONEXÃO ABERTA E PRONTA ✅✅✅');
            isConnected = true;
            ultimoQR = ""; 
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;
        const textBody = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (msg.key.remoteJid.includes('@g.us')) return; 
        if (isFromMe && (textBody.includes('Teacher AI') || textBody.startsWith('🌟'))) return;
        
        console.log(`📨 Msg de ${from}: ${textBody.substring(0, 20)}...`);

        try {
            if (textBody === '!ping') {
                await sock.sendMessage(from, { text: '🏓 Pong! Baileys está vivo.' });
                return;
            }

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

            const isAudio = msg.message.audioMessage;
            if (isAudio) {
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

                const clean = resp.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, ''); 
                if (clean.length > 2) {
                    const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'onyx', input: clean });
                    const buffer = Buffer.from(await mp3.arrayBuffer());
                    await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                }
            }
        } catch (e) {
            console.error("Erro processando msg:", e);
        }
    });
}

startBot();