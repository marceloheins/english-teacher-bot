
//mongoose para banco de dados
const mongoose = require("mongoose");

//Schema do usuario
const userSchema = new mongoose.Schema({
    telegramId : { type: String, required: true, unique: true },
    fisrtName: String,
    level: { type: String, default: 'Beginner' },
    xp: { type: Number, default: 0 },
    history: [{ role: String, content: String }]
});

module.exports = mongoose.model("TelegramUser", userSchema);
