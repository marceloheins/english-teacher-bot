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

// BOTÔES

//Startar Bot
bot.start((ctx) => {
    ctx.reply(
        `Welcome back, ${ctx.user.firstName}! 🎓\nLevel: ${ctx.user.level} | XP: ${ctx.user.xp}\n\nChoose an option:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('💬 Free Chat', 'mode_chat')],
            [Markup.button.callback('🍔 Roleplay: Restaurant', 'mode_restaurant')],
            [Markup.button.callback('✈️ Roleplay: Airport', 'mode_immigration')],
            [Markup.button.callback('🗑️ Reset Memory', 'cmd_reset')]
        ])
    );
});

//Botao voltar ao CHAT NORMAL
bot.action('mode_chat', async (ctx) => {
    ctx.user.mode = 'chat';
    await ctx.user.save();
    ctx.reply("👨‍🏫 Okay! Back to normal classes. What do you want to learn today?");
});

//Botao restaurante
bot.action('mode_restaurant', async (ctx) => {
    ctx.user.mode = 'roleplay_restaurant';
    ctx.user.history = [];
    await ctx.user.save();
    ctx.reply("🍽️ **Scene Started:** You are at a restaurant in NYC. I am your waiter.\n\n*Waiter:* 'Good evening! Table for one?'");
});

//Botao aeroporto
bot.action('mode_immigration', async (ctx) => {
    ctx.user.mode = 'roleplay_immigration';
    ctx.user.history = [];
    await ctx.user.save();
    ctx.reply("✈️ **Scene Started:** You just landed in London. I am the officer.\n\n*Officer:* 'Passport, please. What is the purpose of your visit?'");
});

//Botao reset
bot.action('cmd_reset',  async (ctx) => {
    ctx.user.history = [];
    ctx.user.xp = 0;
    ctx.user.level = 'Beginner';
    await ctx.user.save();
    ctx.reply('  Memory wiped. Brand new start !');
});

// --- PROCESSAMENTO DE MENSAGENS ---

//Função central de resposta (usada para texto e áudio)
async function processInteraction(ctx, inputText) {
if (!ctx.user) return;

try{
    //Mostrar que está "escrevendo..."
    await ctx.sendChatAction('typing');

    //Obter resposta da IA 
    let responseText = await aiService.getChatResponse(ctx.user, inputText);

    // 3. Sistema de XP
    if (ctx.user.mode === 'chat') {
        if (responseText.includes('[XP]')) {
        ctx.user.xp += 10;
        responseText = responseText.replace('[XP]', '🌟 (+10 XP)');
        } else {ctx.user.xp += 1;}// 1 XP por esforço
    }
    // Level Up simples
    if (ctx.user.xp > 200 && ctx.user.level === 'Beginner') {
        ctx.user.level = 'Intermediate';
        responseText += "\n\n🎉 **Level Up!** You are now Intermediate!";
    } else if (ctx.user.xp > 400 && ctx.user.level === 'Intermediate') {
        ctx.user.level = 'Advanced';
        responseText += "\n\n🎉 **Level Up!** You are now Advanced!";
    } else if (ctx.user.xp > 600 && ctx.user.level === 'Advanced') {
        ctx.user.level = 'Expert';
        responseText += "\n\n🎉 **Level Up!** You are now Expert!";
    } else if (ctx.user.xp > 800 && ctx.user.level === 'Expert') {
        ctx.user.level = 'Master';
        responseText += "\n\n🎉 **Level Up!** You are now Master!";
    } else if (ctx.user.xp > 1000 && ctx.user.level === 'Master') {
        ctx.user.level = 'Legend';
        responseText += "\n\n🎉 **Level Up!** You are now Legend!";
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
        
    }
});

module.exports = bot;