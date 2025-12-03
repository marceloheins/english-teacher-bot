const mongoose = require("mongoose");

//Conecta ao banco de dados
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("✅ MongoDB Conectado");
    } catch (err) {
        console.error('❌ Erro Mongo:', err);
        process.exit(1); //encerra se nao conectar
    }
};

module.exports = connectDB;