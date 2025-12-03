const mongoose = require("mongoose");

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