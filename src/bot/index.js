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
    
    const userId = String(ctx.from.id);
    let user = await User.findOne({ telegramId: userId });

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

bot.start((ctx) => {
    ctx.reply(`Hello ${ctx.user.firstName}! 👋\nI'm your English Teacher.\nSend me a voice message or text to start practicing!`);
});

bot.command('perfil', (ctx) => {
    ctx.reply(`📊 **Profile**\nName: ${ctx.user.firstName}\nLevel: ${ctx.user.level}\nXP: ${ctx.user.xp} ✨`);
});

bot.command('reset', async (ctx) => {
    ctx.user.history = [];
    await ctx.user.save();
    ctx.reply("🧠 Memory erased. Let's start fresh!");
});

// --- PROCESSAMENTO DE MENSAGENS ---

// Função central de resposta (usada para texto e áudio)
async function processInteraction(ctx, inputText) {
    // 1. Mostrar que está "escrevendo..."
    await ctx.sendChatAction('typing');

    // 2. Obter resposta da IA
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
        const audioBuffer = await aiService.textToSpeech(responseText);
        if (audioBuffer) {
            await ctx.sendChatAction('record_voice');
            await ctx.replyWithVoice({ source: audioBuffer });
        }
    } catch (e) {
        console.error("Erro ao enviar áudio:", e);
    }
}

// Handler de Texto
bot.on(message('text'), async (ctx) => {
    await processInteraction(ctx, ctx.message.text);
});

// Handler de Áudio
bot.on(message('voice'), async (ctx) => {
    try {
        await ctx.sendChatAction('typing');
        
        // 1. Baixar arquivo
        const fileId = ctx.message.voice.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        
        const tempPath = path.resolve(__dirname, `../../voice_${ctx.user.telegramId}.ogg`);
        const writer = fs.createWriteStream(tempPath);
        
        const response = await axios({ url: fileLink.href, responseType: 'stream' });
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // 2. Transcrever
        const text = await aiService.transcribeAudio(tempPath);
        
        // Feedback visual
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