# 🤖 Teacher Bot Telegram

![Node.js](https://img.shields.io/badge/Node.js-18.x-green)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-green)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-blue)

Um bot de Telegram inteligente projetado para ajudar usuários a praticar inglês através de conversação natural, correções gramaticais e feedback em áudio.

## 🚀 Funcionalidades

- **Conversação Natural**: Pratique inglês conversando sobre qualquer assunto.
- **Correção Gramatical**: Receba correções instantâneas dos seus erros (ex: `❌ Error -> ✅ Correction`).
- **Voz e Áudio**: Envie mensagens de voz e receba respostas em áudio (Text-to-Speech) para treinar sua escuta (Listening).
- **Transcrição Automática**: Seus áudios são transcritos usando a tecnologia Whisper da OpenAI.
- **Sistema de XP e Níveis**: Ganhe XP a cada interação e suba de nível (Beginner -> Intermediate -> Advanced).
- **Feedback Visual**: O bot indica quando está "digitando" ou "gravando áudio".

## 🛠️ Tecnologias Utilizadas

- **[Node.js](https://nodejs.org/)**: Ambiente de execução JavaScript.
- **[Telegraf](https://telegraf.js.org/)**: Framework para bots do Telegram.
- **[OpenAI API](https://openai.com/)**:
  - **GPT-4o**: Para inteligência de conversação e correções.
  - **Whisper**: Para transcrição de áudio.
  - **TTS (Text-to-Speech)**: Para gerar respostas em áudio.
- **[MongoDB](https://www.mongodb.com/)** & **[Mongoose](https://mongoosejs.com/)**: Banco de dados para salvar perfis de usuários e histórico.
- **[Express](https://expressjs.com/)**: Servidor web simples para health checks (útil para deploy no Render/Heroku).

## 📋 Pré-requisitos

Antes de começar, você precisará de:

1.  **Node.js** (v18 ou superior) instalado.
2.  Uma conta no **MongoDB Atlas** (ou um banco MongoDB local).
3.  Uma chave de API da **OpenAI**.
4.  Um token de bot do **Telegram** (obtenha com o [@BotFather](https://t.me/BotFather)).

## 🔧 Instalação e Configuração

1.  **Clone o repositório**
    ```bash
    git clone https://github.com/seu-usuario/teacher-bot-telegram.git
    cd teacher-bot-telegram
    ```

2.  **Instale as dependências**
    ```bash
    npm install
    ```

3.  **Configure as Variáveis de Ambiente**
    Crie um arquivo `.env` na raiz do projeto e adicione as seguintes chaves:

    ```env
    TELEGRAM_BOT_TOKEN=seu_token_do_telegram
    OPENAI_API_KEY=sua_chave_da_openai
    MONGODB_URI=sua_string_de_conexao_mongodb
    PORT=3000
    ```

4.  **Inicie o Bot**
    ```bash
    npm start
    ```

## 📖 Como Usar

1.  Abra o bot no Telegram e clique em **Start** (ou envie `/start`).
2.  Envie uma mensagem de texto ou áudio em inglês.
3.  O bot responderá corrigindo seus erros e mantendo a conversa.

### Comandos Disponíveis

- `/start` - Inicia a conversa e registra o usuário.
- `/perfil` - Mostra seu nível atual e XP acumulado.
- `/reset` - Apaga o histórico de conversa (memória de curto prazo) para começar um novo assunto.

## 🤝 Contribuição

Sinta-se à vontade para abrir issues ou enviar pull requests com melhorias!

---
Desenvolvido com 💙 para estudantes de inglês.
