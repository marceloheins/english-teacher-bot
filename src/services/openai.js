const OpenAI = require("openai");
const fs = require("fs");
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

//Ouvir 
async function transcribeAudio(filePath){
    try{
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
            language: "en"
        });

        return transcription.text;
    }catch(error){
        console.error("Erro ao transcrever áudio:", error);
        return null;

    }
}

//Pensar
async function getChatresponse(user, inputText){
    try{
        //prompt
         const systemPrompt = `You are an English Teacher. Student Level: ${user.level}.
        1. Reply concisely in English.
        2. Format corrections like: "❌ Error -> ✅ Correction".
        3. If the user's sentence is perfect, add [XP] at the end.
        4. Always end with a simple follow-up question to keep the conversation going.`;

        //Historico recente
        const history = user.history.slice(-6).map(h => ({
            role: h.role,
            content: h.content
        }));

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                ...history,
                { role: "user", content: inputText }
            ]
        });

        return completion.choices[0].message.content;
    }catch(error){
        console.error("Erro ao obter resposta:", error);
        return "Sorry, I am having trouble thinking right now. ";

    }
}

//Falar
async function textSpeech(text){
    try{
        //limpa formatação para nao ler caracteres especiais
        const cleanText = text.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, '').replace(/Correction:.*?Tip:.*?\n/gs, '');
        
        if (cleanText.lenght < 2) return null;

        const mp3 = await openai.audio.speech.create({
            model: "tts-1-hd",
            voice: "onyx",
            input: cleanText
        });

        return Buffer.from(await mp3.arrayBuffer());

    }catch(error){
        console.error("Erro ao converter texto em áudio:", error);
        return null;
    }
}

module.exports = {
    transcribeAudio,
    getChatresponse,
    textSpeech
};
