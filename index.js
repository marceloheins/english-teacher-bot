const { Client, RemoteAuth } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const qrcode = require("qrcode-terminal"); // <--- AQUI ESTAVA O ERRO (Agora está certo)
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const express = require("express");
const { MessageMedia } = require("whatsapp-web.js");
require('dotenv').config();

// Configura servidor web (Keep-Alive)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Professor BOT esta Ativo e Rodando!');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

// Conexao com o MONGO DB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log("Conectado ao MongoDB");
        const store = new MongoStore({ mongoose: mongoose });
        iniciarBot(store);
    })
    .catch(err => console.error('Erro MONGO', err));

// Schema do Aluno
const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    level: { type: String, default: 'Beginner' },
    xp: { type: Number, default: 0 },
    history: [{ role: String, content: String }]
});
const User = mongoose.model('User', userSchema);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Função principal do BOT
function iniciarBot(store) {
    console.log("Iniciando WhatsApp...");

    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        // Configurações de timeout para servidor lento (Render Free)
        authTimeoutMs: 0,
        qrMaxRetries: 10, // Corrigido erro de digitação (era Restries)
        puppeteer: {
            executablePath: '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-extensions'
            ],
            headless: true,
            timeout: 60000
        }
    });

    // --- EVENTOS ---

    // Mostra o progresso do carregamento (Debug)
    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Carregando WhatsApp: ${percent}% - ${message}`);
    });

    // Gera o QR Code visual no terminal
    client.on('qr', (qr) => {
        console.log('📸 QR Code gerado! Escaneie agora:');
        qrcode.generate(qr, { small: true }); // Agora vai funcionar porque usamos qrcode-terminal
    });

    client.on('authenticated', () => {
        console.log('🔐 Autenticado com sucesso!');
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Falha na autenticação:', msg);
    });
    
    client.on('remote_session_saved', () => {
        console.log('💾 Sessão salva no Banco de Dados!');
    });

    client.on('ready', () => console.log('✅ Teacher Bot 100% ONLINE!'));

    // Função de Prompt
    function gerarSystemPrompt(nivel) {
        let instrucao = "O aluno é INICIANTE. Use vocabulário simples.";
        if (nivel === 'Intermediate') instrucao = "O aluno é INTERMEDIARIO. Use vocabulário mais complexo.";
        if (nivel === 'Advanced') instrucao = "O aluno é AVANÇADO. Seja nativo.";

        return `Você é o Teacher AI. nível: ${nivel}. ${instrucao}.
             Regras: 1. Use '❌ Erro -> ✅ Correção'. 2. Termine com pergunta. 3. Se perfeito, use [XP].`;
    }

    // Função de Áudio TTS
    async function enviarAudioDoProfessor(texto, chat) {
        try {
            const textoLimpo = texto.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, '').replace(/Correction:.*?Tip:.*?\n/gs, '');
            if (textoLimpo.length < 2) return; // Corrigido erro de digitação (era _textoLimpo)
            
            const mp3 = await openai.audio.speech.create({
                model: 'tts-1',
                voice: 'onyx',
                input: textoLimpo
            });

            const buffer = Buffer.from(await mp3.arrayBuffer());
            const caminho = path.join(__dirname, 'temp_audio.mp3');
            fs.writeFileSync(caminho, buffer);
            const media = MessageMedia.fromFilePath(caminho);
            await chat.sendMessage(media);
        }
        catch (e) { console.error('Erro ao enviar audio', e); }
    }

    // Lógica de Mensagens
    client.on('message_create', async (msg) => {
        if (msg.fromMe && msg.to === msg.from) {
            if( msg.body.includes('Correction:') || msg.body.includes('🗣️') || msg.body.startsWith('🌟')){
                return;
            }

            const chat = await msg.getChat();
            const userId = msg.from;

            try {
                let usuario = await User.findOne({ phoneNumber: userId });
                if (!usuario) {
                    usuario = new User({ phoneNumber: userId });
                    await usuario.save();
                }

                if (msg.body.toLowerCase() === '!perfil') {
                    await chat.sendMessage(`Profile: ${usuario.level} | XP: ${usuario.xp}`)
                    return;
                }

                let textoDoAluno = msg.body;
                
                // Se for áudio, transcreve
                if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
        

                    console.log("Processando audio no modo esepelho...");

                    const media = await msg.downloadMedia();
                    const buffer = Buffer.from(media.data, 'base64');
                    const caminho = './temp_audio.ogg';
                    fs.writeFileSync(caminho, buffer);
                    const trans = await openai.audio.transcriptions.create({ file: fs.createReadStream(caminho), model: "whisper-1" });
                    textoDoAluno = trans.text;
                    await msg.reply(`Wait... I heard: "${textoDoAluno}"`);
                }

                if (textoDoAluno) {
                    //Logica do professor
                    const prompt = gerarSystemPrompt(usuario.level);
                    const history = usuario.history.slice(-6).map(h => ({ role: h.role, content: h.content }));

                    const gptResponse = await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [{ role: "system", content: prompt }, ...history, { role: "user", content: textoDoAluno }]
                    });

                    let respostaFinal = gptResponse.choices[0].message.content;
                    if (respostaFinal.includes('[XP]')) {
                        usuario.xp += 10;
                        respostaFinal = respostaFinal.replace('[XP]', '🌟 (+10 XP)');
                    } else { usuario.xp += 1; }

                    usuario.history.push({ role: "user", content: textoDoAluno });
                    usuario.history.push({ role: "assistant", content: respostaFinal });
                    await usuario.save();

                    await msg.reply(respostaFinal);
                    await enviarAudioDoProfessor(respostaFinal, chat);
                }
            } catch (e) { console.error("Erro Message:", e); }
        }
    });

    client.initialize().catch(err => console.error('Erro ao iniciar o bot:', err));
}

