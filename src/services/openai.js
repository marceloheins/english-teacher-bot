// dotenv para variaveis de ambiente
require('dotenv').config();

const OpenAI = require("openai");
// fs para arquivos
const fs = require("fs");


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
        let systemPrompt;
        if (user.mode === 'roleplay_restaurant') {
            systemPrompt = `ACT AS A WAITER in a fancy retaurant in New York. The user is the customer.
            Current Level: ${user.level}.
            1. Keep your responses short and polite.
            2. do NOT correct grammar explicitly unside the roleplay, just repeat the correct phrase naturally.
            3. Ask what they want to eat/drink.
            4. If the user says "Stop" or "Exit", break character.`
        }
        else if (user.mode === 'roleplay_immigration') {
            systemPrompt = `ACT AS AN IMMIGRATION OFFICER at Heathrow Airport. The user a traveler.
            Current Level: ${user.level}.
            1. Be serious and formal.
            2. Ask about visa, purpose of visit, duration of stay.
            3. Keep responses strictly professional.`;
        }
        else {
            systemPrompt = `You are an English Teacher. Student Level: ${user.level}.
            
            CRITICAL RULES:
            1. SPEAK ONLY IN ENGLISH. Never use Portuguese.
            2. If the user speaks Portuguese, reply in English: "Please, try in English!"
            3. ANALIZE the user's sentence for grammar/vocab error.
            
            IF THERE IS AN ERROR< USE THIS FORMAT EXACTLY:
            ⚠️ **Correction Needed**
            ❌ You said: "[User's phrase]"
            ✅ Better: "[Correct phrase]"
            💡 Why: [Bref grammatical explanation in simple English]

            -----------------------------
            [Then wirte youor conversational reply here, asking a follow-up question]
            
            IF THE ENGLISH IS PERFECT, USE THIS FORMAT:
            ✅ **Perfect English** [XP]

            -----------------------------
            [Your conversational reply here]
            `;
        }
           
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
        let conversationalText = text;
        if (text.includes('-----------------------------')) {
            conversationalText = text.split('-----------------------------')[1];
        }

        //limpa formatação para nao ler caracteres especiais
        const cleanText = conversationalText
        .replace(/[\*\[\]]/g, '')
        .replace(/⚠️|❌|✅|💡/g, '')
        .replace('Correction Needed', '')
        .replace('Perfect English!', '')
        .trim();

        //se texto for menor que 2 caracteres, nao gera áudio
        if (cleanText.length < 2) return null;

        //Gerando áudio
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
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
