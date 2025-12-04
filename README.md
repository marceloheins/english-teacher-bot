# Professor de inglês BOT
![Node.js](https://img.shields.io/badge/Node.js-18.x-green)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-green)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-blue)

Um bot de Telegram inteligente projetado para ajudar usuários a praticar inglês através de conversação natural, correções gramaticais e feedback em áudio.

## Funcionalidades
- **Conversação Natural**: Pratique inglês conversando sobre qualquer assunto.
- **Correção**: Receba correções instantâneas dos seus erros (ex: `❌ Error | ✅ Correction`).
- **Voz e Áudio**: Envie mensagens de voz e receba respostas em áudio (Text-to-Speech) para treinar sua escuta (Listening).
- **Transcrição Automática**: Seus áudios são transcritos usando a tecnologia Whisper da OpenAI.
- **Sistema de XP e Níveis**: Ganhe XP a cada interação e suba de nível (Beginner -> Intermediate -> Advanced).
- **Feedback Visual**: O bot indica quando está "digitando" ou "gravando áudio".
- 
## 🛠️ Tecnologias Utilizadas
- **[Node.js](https://nodejs.org/)**: Ambiente de execução JavaScript.
- **[Telegraf](https://telegraf.js.org/)**: Framework para bots do Telegram.
- **[OpenAI API](https://openai.com/)**:
  - **GPT-4o**: Para inteligência de conversação e correções.
  - **Whisper**: Para transcrição de áudio.
  - **TTS (Text-to-Speech)**: Para gerar respostas em áudio.
- **[MongoDB](https://www.mongodb.com/)** & **[Mongoose](https://mongoosejs.com/)**: Banco de dados para salvar perfis de usuários e histórico.
- **[Express](https://expressjs.com/)**: Servidor web simples para health checks (útil para deploy no Render/Heroku).
- **[Docker](https://www.docker.com/)**: Dockerfile para as instruções de inicialização do aplicativo
- **[Render](https://render.com/)**: para deploy.
  
## 📖 Como Usar
1.  Abra o bot no Telegram e clique em **Start** (ou envie `/start`).
2.  Envie uma mensagem de texto ou áudio em inglês.
3.  O bot responderá corrigindo seus erros e mantendo a conversa.
4.  
### Comandos Disponíveis
- `/start` - Inicia a conversa e registra o usuário.
- `/perfil` - Mostra seu nível atual e XP acumulado.