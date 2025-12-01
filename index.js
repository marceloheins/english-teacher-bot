const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const qrcodeTerminal = require("qrcode-terminal");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const express = require("express");
require('dotenv').config();

// --- 1. SERVIDOR WEB (Para manter o Render vivo e mostrar QR Code) ---
const app = express();
const PORT = process.env.PORT || 3000;
let ultimoQR = "";
let isClientReady = false;

app.get('/', (req, res) => {
    if (isClientReady) {
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px; background-color:#dcf8c6; height:100vh;">
                <h1 style="color:#075e54">✅ Teacher Bot está ONLINE!</h1>
                <p>O sistema está ativo.</p>
                <p>Vá para o WhatsApp e mande <b>!ping</b> para o chat <b>"Você"</b> (seu próprio número).</p>
            </div>
        `);
    } else if (ultimoQR) {
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(ultimoQR)}`;
        res.send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px; background-color:#f0f0f0; height:100vh;">
                <h1>Escaneie Agora:</h1>
                <img src="${url}" style="border:5px solid #333; border-radius:10px;" />
                <p>Se o código não funcionar, atualize a página (F5).</p>
            </div>
        `);
    } else {
        res.send('<div style="font-family:sans-serif; text-align:center; padding:50px;"> <h1>⏳ Iniciando...</h1> <p>Aguarde... o QR Code vai aparecer aqui em breve.</p> </div>');
    }
});

app.listen(PORT, () => console.log(`🌐 Web Server rodando na porta ${PORT}`));

// --- 2. CONEXÃO MONGODB ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log("✅ MongoDB Conectado");
        const store = new MongoStore({ mongoose: mongoose });
        iniciarBot(store);
    })
    .catch(err => console.error('❌ Erro Fatal no Mongo:', err));

// Modelo de Usuário
const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    level: { type: String, default: 'Beginner' },
    xp: { type: Number, default: 0 },
    history: [{ role: String, content: String }]
});
const User = mongoose.model('User', userSchema);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- 3. LÓGICA DO BOT ---
function iniciarBot(store) {
    console.log("🚀 Configurando WhatsApp Client...");

    const client = new Client({
        authStrategy: new RemoteAuth({ store: store, backupSyncIntervalMs: 300000 }),
        authTimeoutMs: 0, 
        qrMaxRetries: 10,
        // REMOVIDO: webVersionCache (Deixar a lib gerenciar a versão automática evita loops)
        puppeteer: {
            executablePath: '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Crítico para Docker/Render
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-extensions'
            ],
            headless: true,
            timeout: 60000
        }
    });

    // --- EVENTOS ---
    client.on('qr', (qr) => {
        console.log('📸 Novo QR Code gerado! (Acesse o site para ver)');
        ultimoQR = qr;
        try { qrcodeTerminal.generate(qr, { small: true }); } catch(e) {}
    });

    client.on('ready', () => {
        console.log('✅✅✅ BOT PRONTO E ONLINE ✅✅✅');
        isClientReady = true;
    });

    client.on('authenticated', () => console.log('🔐 Cliente Autenticado'));
    
    // Novo evento para debug de desconexão
    client.on('disconnected', (reason) => {
        console.log('❌ Cliente desconectado! Razão:', reason);
        // Reinicializa se cair
        client.initialize();
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Carregando WhatsApp: ${percent}% - ${message}`);
    });

    // --- PROCESSAMENTO DE MENSAGENS ---
    // Usamos 'message_create' para detectar mensagens enviadas por VOCÊ
    client.on('message_create', async (msg) => {
        
        // LOG DE DEBUG: Ver tudo que passa pelo bot
        console.log(`📨 MSG: ${msg.body.substring(0, 20)}... | De: ${msg.from} | Para: ${msg.to} | Eu?: ${msg.fromMe}`);

        // FILTRO MODO ESPELHO: 
        // Só aceita se (Fui eu que mandei) E (Mandei para mim mesmo)
        const isMirrorMode = msg.fromMe && msg.to === msg.from;

        if (!isMirrorMode) {
            // Ignora mensagens de grupos ou outras pessoas
            return;
        }

        console.log(`🟢 MODO ESPELHO: Processando mensagem...`);

        // FILTRO LOOP: Não responder a si mesmo (mensagens do próprio bot)
        if (msg.body.includes('Teacher AI') || msg.body.includes('🌟') || msg.body.startsWith('Correction:')) {
            console.log("   ⚠️ Ignorada: Resposta do bot detectada.");
            return;
        }

        try {
            const chat = await msg.getChat();

            // COMANDO DE TESTE DE VIDA
            if (msg.body === '!ping') {
                console.log("🏓 PONG!");
                await chat.sendMessage("🏓 Pong! Estou ouvindo.");
                return;
            }

            // --- INTELIGÊNCIA ARTIFICIAL ---
            
            // 1. Verificar/Criar Usuário
            let usuario = await User.findOne({ phoneNumber: msg.from });
            if (!usuario) { 
                console.log("🆕 Criando usuário no DB...");
                usuario = new User({ phoneNumber: msg.from }); 
                await usuario.save(); 
            }

            // 2. Comandos Especiais
            if (msg.body.toLowerCase() === '!perfil') {
                await chat.sendMessage(`📊 Level: ${usuario.level} | XP: ${usuario.xp}`);
                return;
            }

            // 3. Transcrição de Áudio (Whisper)
            let textoDoAluno = msg.body;
            if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
                console.log("🎤 Transcrevendo áudio...");
                const media = await msg.downloadMedia();
                const buffer = Buffer.from(media.data, 'base64');
                const caminho = path.join(__dirname, 'temp_audio.ogg');
                fs.writeFileSync(caminho, buffer);
                const trans = await openai.audio.transcriptions.create({ file: fs.createReadStream(caminho), model: "whisper-1" });
                textoDoAluno = trans.text;
                await chat.sendMessage(`👂 Heard: "${textoDoAluno}"`);
            }

            // 4. GPT-4o (O Professor)
            if (textoDoAluno) {
                console.log("🧠 Perguntando ao GPT...");
                
                const systemPrompt = `Você é um professor de inglês. O aluno é nível ${usuario.level}.
                Responda de forma didática.
                Regras:
                1. Correction: Use "❌ Erro -> ✅ Correção".
                2. Gamification: Se a frase for perfeita, termine com "[XP]".
                3. Conversa: Termine sempre com uma pergunta.`;
                
                // Pega histórico recente (últimas 6 mensagens)
                const history = usuario.history.slice(-6).map(h => ({ role: h.role, content: h.content }));

                const gptResponse = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: textoDoAluno }]
                });

                let respostaFinal = gptResponse.choices[0].message.content;
                
                // Sistema de XP
                if (respostaFinal.includes('[XP]')) {
                    usuario.xp += 10;
                    respostaFinal = respostaFinal.replace('[XP]', '🌟 (+10 XP)');
                } else { usuario.xp += 1; }

                // Salvar histórico
                usuario.history.push({ role: "user", content: textoDoAluno });
                usuario.history.push({ role: "assistant", content: respostaFinal });
                await usuario.save();

                console.log(`🤖 Resposta enviada.`);
                await chat.sendMessage(respostaFinal);
                
                // 5. TTS (Voz)
                await enviarAudioDoProfessor(respostaFinal, chat); 
            }

        } catch (e) {
            console.error("❌ ERRO NO PROCESSO:", e);
            try { await msg.reply("❌ Erro interno no bot. Cheque os logs do Render."); } catch(z){}
        }
    });

    client.initialize().catch(err => console.error('❌ Erro Fatal no Init:', err));
}

// Helper: Enviar Áudio
async function enviarAudioDoProfessor(texto, chat) {
    try {
        // Limpa formatação técnica antes de falar
        const textoLimpo = texto.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, '').replace(/Correction:.*?Tip:.*?\n/gs, ''); 
        if (textoLimpo.length < 2) return;
        
        const mp3 = await openai.audio.speech.create({ model: 'tts-1', voice: 'onyx', input: textoLimpo });
        const buffer = Buffer.from(await mp3.arrayBuffer());
        const caminho = path.join(__dirname, 'temp_audio.mp3');
        fs.writeFileSync(caminho, buffer);
        const media = MessageMedia.fromFilePath(caminho);
        await chat.sendMessage(media); 
    } catch (e) { console.error("Erro Audio:", e); }
}