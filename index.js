const { Client, RemoteAuth } = require("whatsapp-web.js"); //importando as classes do whatsapp-web.js
const { MongoStore } = require("wwebjs-mongo"); //importando a classe do wwebjs-mongo
const qrcode = require("qrcode"); //importando a classe do qrcode
const OpenAI = require("openai"); //importando a classe do openai
const fs = require("fs"); //importando a classe do fs
const path = require("path"); //importando a classe do path
const mongoose = require("mongoose"); //importando a classe do mongoose
const express = require("express"); //importando a classe do express
const { MessageMedia } = require("whatsapp-web.js"); //importando a classe do message media
require('dotenv').config();

// configura servidor web
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Professor BOT esta Ativo e Rodando!');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

// conexao com o MONGO DB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log("Conectado ao MongoDB");
        //Só inicia o bot depois de conectar no banco
        const store =  new MongoStore({ mongoose: mongoose});
        iniciarBot(store);
    })
    .catch(err => console.error('Erro MONGO', err));

    //Aluno
    const userSchema = new mongoose.Schema({
        phoneNumber: { type: String, required: true, unique: true },
        level: { type: String, default: 'Beginner'},
        xp: { type: Number, default: 0},
        history: [{ role: String, content: String }]
    });
    const User = mongoose.model('User', userSchema);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    //Funçaõ principal do BOT
    function iniciarBot(store){
        console.log("Iniciando WhatsApp...");

        const client = new Client({
            authStrategy: new RemoteAuth({
                store: store, //Slava a sessão no MONGOBD
                backupSyncIntervalMs: 300000 // Slava backup a cada 5 minutos
            }),
            puppeteer:{
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: true
            }
        });

        //função Prompt e Audio
        function gerarSystemPrompt(nivel){
            let instrucao = "O aluno é INICIANTE. Use vocabulário simples.";
            if (nivel === 'Intermediate') instrucao = "O aluno é INTERMEDIARIO. Use vocabulário mais complexo.";
            if (nivel === 'Advanced') instrucao = "O aluno é AVANÇADO. Seja nativo.";

            return `Você é o Teacher AI. nível: ${nivel}. ${instrucao}.
             Regras: 1. Use '❌ Erro -> ✅ Correção'. 2. Termine com pergunta. 3. Se perfeotp, use [XP].`;
        }

        async function enviarAudioDoProfessor(texto, chat){
            try{
                const textoLimpo = texto.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, '').replace(/Correction:.*?Tip:.*?\n/gs, '');
                if (_textoLimpo.length < 2) return;
                const mp3 = await openai.audio.speech.create({
                    model: 'tts-1',
                    voice: 'onyx',
                    input: textoLimpo });
                
                const buffer = Buffer.from(await mp3.arrayBuffer());
                const caminho = path.join(__dirname, 'temp_audio.mp3');
                fs.writeFileSync(caminho, buffer);
                const media = MessageMedia.fromFilePath(caminho);
                await chat.sendMessage(media);
                }
                catch (e) { console.error('Erro ao enviar audio', e); }
            }
        
    // Eventos cliente
    client.on('qr', (qr) => qrcode.generate(qr, {small: true}));

    client.on('remote_session_saved', () => {
        console.log('Session salva no MongoDB');
    });

    client.on('ready', () => {
        console.log('Bot iniciado e pronto para receber mensagens');
    });

    client.on('message', async (msg) => {
        if (!msg.fromMe && !msg.isStatus){
            const chat = await msg.getChat();
            const userId = msg.from;

            try{
                let usuario = await User.findOne({ phoneNumber: userId });
                if (!usuario){
                    usuario =  new User({ phoneNumber: userId });
                    await usuario.save();
                }

                if (msg.body.toLowerCase() === '!perfil'){
                    await msg.reply(`Profile: ${usuario.level} | XP: ${usuario.xp}`)
                return;
                }

                // Lógica de Transcrição
                let textoDoAluno = msg.body;
                if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
                    chat.sendStateRecording();
                    const media = await msg.downloadMedia();
                    const buffer = Buffer.from(media.data, 'base64');
                    const caminho = './temp_audio.ogg';
                    fs.writeFileSync(caminho, buffer);
                    const trans = await openai.audio.transcriptions.create({ file: fs.createReadStream(caminho), model: "whisper-1" });
                    textoDoAluno = trans.text;
                    await msg.reply(`Wait... I heard: "${textoDoAluno}"`);
                }

                if (textoDoAluno) {
                    chat.sendStateTyping();
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

    client.initialize();
}
            
                 
