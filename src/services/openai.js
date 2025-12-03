const OpenAI = require("openai");
// fs para arquivos
const fs = require("fs");
// dotenv para variaveis de ambiente
require('dotenv').config();

//inicia o OpenAI "gpt"
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

//Ouvir áudio
async function transcribeAudio(filePath) {
    try {
        //
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
            language: "en"
        });

        return transcription.text;
    } catch (error) {
        console.error("Erro ao transcrever áudio:", error);
        return null;

    }
}

//Pensar em resposta
async function getChatResponse(user, inputText) {
    try {
        //prompt
        const systemPrompt = `You are an English Teacher. Student Level: ${user.level}.
        1. Reply concisely in English and Portuguese.
        2. Format corrections like: "❌ Error -> ✅ Correction".
        3. If the user's sentence is perfect, add [XP] at the end.
        4. Always end with a simple follow-up question to keep the conversation going.`;

        //Historico recente limitado a 6 interações 
        const history = user.history.slice(-6).map(h => ({
            role: h.role,
            content: h.content
        }));

        //Gera resposta
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                //Prompt
                { role: "system", content: systemPrompt },
                //Historico
                ...history,
                //Input
                { role: "user", content: inputText }
            ]
        });

        //Retorna resposta
        return completion.choices[0].message.content;
    } catch (error) {
        console.error("Erro ao obter resposta:", error);
        return "Sorry, I am having trouble thinking right now. ";

    }
}

//Falar 
async function textToSpeech(text) {
    try {
        //limpa formatação para nao ler caracteres especiais
        const cleanText = text.replace(/[\*\[\]]/g, '').replace(/❌.*?✅.*?\n/g, '').replace(/Correction:.*?Tip:.*?\n/gs, '');

        //se texto for menor que 2 caracteres, nao gera áudio
        if (cleanText.length < 2) return null;

        //Gera áudio
        const mp3 = await openai.audio.speech.create({
            model: "tts-1-hd",
            voice: "onyx",
            input: cleanText
        });

        //Retorna áudio
        return Buffer.from(await mp3.arrayBuffer());

    } catch (error) {
        console.error("Erro ao converter texto em áudio:", error);
        return null;
    }
}

module.exports = {
    transcribeAudio,
    getChatResponse,
    textToSpeech
};
