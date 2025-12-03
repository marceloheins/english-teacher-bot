const express = require("express");
const connectDB = require("./src/config/db");
const bot = require("./src/bot/index");
require('dotenv').config();

// --- 1. CONFIGURAÇÃO INICIAL ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- 2. CONECTAR BANCO DE DADOS ---
connectDB();

// --- 3. SERVIDOR WEB (Health Check para o Render) ---
app.get('/', (req, res) => {
    res.send('<h1 style="font-family:sans-serif; text-align:center; margin-top:50px; color:#0088cc;">🤖 Telegram Teacher Bot is Running!</h1>');
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor Web rodando na porta ${PORT}`);
});

// --- 4. INICIAR O BOT ---
// Graceful Stop: Garante que o bot pare corretamente se o servidor reiniciar
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log("🚀 Iniciando Bot...");
bot.launch().then(() => {
    console.log("✅ Bot do Telegram Online!");
}).catch((err) => {
    console.error("❌ Erro ao iniciar o bot:", err);
});