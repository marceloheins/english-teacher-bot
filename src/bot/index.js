const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const User = require('../models/User');
const aiService = require('../services/openai');

// Inicializa o Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware: Carrega o usuário do banco em toda mensagem
async function getUserMiddleware(ctx, next) {
    if (!ctx.from) return next();
    //pega o id do usuario
    const userId = String(ctx.from.id);
    //busca o usuario no banco de dados
    let user = await User.findOne({ telegramId: userId });

    //se nao existir, cria um novo usuario
    if (!user) {
        user = new User({ 
            telegramId: userId,
            firstName: ctx.from.first_name 
        });
        await user.save();
        console.log(`🆕 Novo aluno: ${ctx.from.first_name}`);
    }
    
    ctx.user = user; // Anexa o usuário ao contexto
    return next();
}

bot.use(getUserMiddleware);

// --- COMANDOS ---

//Startar Bot
bot.start((ctx) => {
    ctx.reply(`Hello ${ctx.user.firstName}! 👋\nI'm your English Teacher.\nSend me a voice message or text to start practicing!`);
});

//Comando perfil
bot.command('perfil', (ctx) => {
    ctx.reply(`📊 **Profile**\nName: ${ctx.user.firstName}\nLevel: ${ctx.user.level}\nXP: ${ctx.user.xp} ✨`);
});

//Comando reset
bot.command('reset', async (ctx) => {
    ctx.user.history = [];
    await ctx.user.save();
    ctx.reply("🧠 Memory erased. Let's start fresh!");
});

// --- PROCESSAMENTO DE MENSAGENS ---

//Função central de resposta (usada para texto e áudio)
async function processInteraction(ctx, inputText) {
    //Mostrar que está "escrevendo..."
    await ctx.sendChatAction('typing');

    //Obter resposta da IA 
    let responseText = await aiService.getChatResponse(ctx.user, inputText);

    // 3. Sistema de XP
    if (responseText.includes('[XP]')) {
        ctx.user.xp += 10;
        responseText = responseText.replace('[XP]', '🌟 (+10 XP)');
        
        // Level Up simples
        if (ctx.user.xp > 100 && ctx.user.level === 'Beginner') {
            ctx.user.level = 'Intermediate';
            responseText += "\n\n🎉 **Level Up!** You are now Intermediate!";
        }
    } else {
        ctx.user.xp += 1; // 1 XP por esforço
    }

    // 4. Salvar Histórico
    ctx.user.history.push({ role: "user", content: inputText });
    ctx.user.history.push({ role: "assistant", content: responseText });
    await ctx.user.save();

    // 5. Responder texto
    await ctx.reply(responseText);

    // 6. Responder áudio (Voice)
    try {
        //converte texto em áudio
        const audioBuffer = await aiService.textToSpeech(responseText);
        if (audioBuffer) {
            await ctx.sendChatAction('record_voice');
            await ctx.replyWithVoice({ source: audioBuffer });
        }
    } catch (e) {
        console.error("Erro ao enviar áudio:", e);
    }
}

//Agente de texto
bot.on(message('text'), async (ctx) => {
    await processInteraction(ctx, ctx.message.text);
});

//Agente de áudio
bot.on(message('voice'), async (ctx) => {
    try {
        await ctx.sendChatAction('typing');
        
        // 1. Baixar arquivo
        const fileId = ctx.message.voice.file_id;
        //pega o link do arquivo
        const fileLink = await ctx.telegram.getFileLink(fileId);
        //cria um arquivo temporario
        const tempPath = path.resolve(__dirname, `../../voice_${ctx.user.telegramId}.ogg`);
        //cria um stream para o arquivo
        const writer = fs.createWriteStream(tempPath);
        //baixa o arquivo
        const response = await axios({ url: fileLink.href, responseType: 'stream' });
        //escreve o arquivo
        response.data.pipe(writer);

        //espera o arquivo ser escrito
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // 2. Transcrever o audio
        const text = await aiService.transcribeAudio(tempPath);
        
        // Feedback visual Ouvindo
        await ctx.reply(`👂 Heard: _"${text}"_`, { parse_mode: 'Markdown' });
        
        // Limpeza
        fs.unlinkSync(tempPath);

        // 3. Processar
        await processInteraction(ctx, text);

    } catch (e) {
        console.error("Erro no processamento de voz:", e);
        ctx.reply("❌ Sorry, I couldn't hear you properly.");
    }
});

module.exports = bot;