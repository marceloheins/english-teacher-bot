const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const qrcodeTerminal = require("qrcode-terminal");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const express = require("express");
require('dotenv').config();

// --- SERVIDOR WEB ---
const app = express();
const PORT = process.env.PORT || 3000;
let ultimoQR = "";
let isClientReady = false;

app.get('/', (req, res) => {
    if (isClientReady) {
        res.send('<h1 style="color:green; text-align:center; font-family:sans-serif; margin-top:50px;">✅ Teacher Bot Conectado!</h1>');
    } else if (ultimoQR) {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(ultimoQR)}`;
        res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px;"><h1>Escaneie Agora:</h1><img src="${url}" style="border:5px solid #333; border-radius:10px;" /></div>`);
    } else {
        res.send('<h1 style="text-align:center; font-family:sans-serif; margin-top:50px;">⏳ Iniciando... aguarde.</h1>');
    }
});
app.listen(PORT, () => console.log(`Web rodando na porta ${PORT}`));

// --- MONGO ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log("✅ MongoDB Conectado");
        const store = new MongoStore({ mongoose: mongoose });
        iniciarBot(store);
    })
    .catch(err => console.error('❌ Erro Mongo:', err));

const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    level: { type: String, default: 'Beginner' },
    xp: { type: Number, default: 0 },
    history: [{ role: String, content: String }]
});
const User = mongoose.model('User', userSchema);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- BOT ---
function iniciarBot(store) {
    console.log("🚀 Iniciando WhatsApp...");

    const client = new Client({
        authStrategy: new RemoteAuth({ 
            store: store, 
            backupSyncIntervalMs: 60000 
        }),
        // Aumentamos os limites para evitar desconexão prematura
        authTimeoutMs: 0, 
        qrMaxRetries: 10,
        
        // --- A CORREÇÃO DO LOOP ---
        // Forçamos uma versão específica para o celular não rejeitar
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        
        puppeteer: {
            executablePath: '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-extensions',
                // --- FLAGS NOVAS DE ECONOMIA DE MEMÓRIA ---
                '--disable-software-rasterizer',
                '--disable-notifications',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-sync',
                '--mute-audio'
            ],
            headless: true,
            timeout: 60000
        }
    });

    client.on('qr', (qr) => {
        console.log('📸 Novo QR Code gerado!');
        ultimoQR = qr;
        try { qrcodeTerminal.generate(qr, { small: true }); } catch(e) {}
    });

    client.on('ready', () => {
        console.log('✅✅✅ BOT ONLINE ✅✅✅');
        isClientReady = true;
    });

    client.on('authenticated', () => console.log('🔐 Autenticado'));
    
    // Debug para ver se a sessão salvou
    client.on('remote_session_saved', () => {
        console.log('💾 Sessão salva no MongoDB! (Login persistido)');
    });

    client.on('message_create', async (msg) => {
        if (!msg.fromMe || msg.to !== msg.from) return; 
        if (msg.body.includes('Teacher AI') || msg.body.includes('🌟')) return;

        console.log(`📨 Mensagem: ${msg.body}`);

        try {
            const chat = await msg.getChat();
            
            if (msg.body === '!ping') {
                await chat.sendMessage("🏓 Pong!");
                return;
            }

            let usuario = await User.findOne({ phoneNumber: msg.from });
            if (!usuario) { 
                usuario = new User({ phoneNumber: msg.from }); 
                await usuario.save(); 
            }

            if (msg.body === '!perfil') {
                await chat.sendMessage(`XP: ${usuario.xp}`);
                return;
            }

            let texto = msg.body;
            if (msg.hasMedia) {
                // Lógica de áudio simplificada para debug
                await chat.sendMessage("👂 (Áudio recebido, processando...)");
                // ... (código de transcrição completo iria aqui)
            }

            if (texto && !msg.hasMedia) {
                // OpenAI Simplificado
                const prompt = `Professor de inglês. Nível ${usuario.level}. Responda curto.`;
                const gpt = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "system", content: prompt }, { role: "user", content: texto }]
                });

                let resp = gpt.choices[0].message.content;
                if (resp.includes('[XP]')) {
                    usuario.xp += 10;
                    resp = resp.replace('[XP]', '🌟 (+10 XP)');
                } else { usuario.xp += 1; }

                usuario.history.push({ role: "user", content: texto });
                usuario.history.push({ role: "assistant", content: resp });
                await usuario.save();

                await chat.sendMessage(resp);
                await enviarAudioDoProfessor(resp, chat);
            }
        } catch (e) { console.error("Erro:", e); }
    });

    client.initialize().catch(err => console.error('Erro Init:', err));
}

async function enviarAudioDoProfessor(texto, chat) {
    try {
        const clean = texto.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, ''); 
        if (clean.length < 2) return;
        const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'onyx', input: clean });
        const buffer = Buffer.from(await mp3.arrayBuffer());
        const caminho = path.join(__dirname, 'out.mp3');
        fs.writeFileSync(caminho, buffer);
        const media = MessageMedia.fromFilePath(caminho);
        await chat.sendMessage(media); 
    } catch (e) { console.error("Erro TTS:", e); }
}