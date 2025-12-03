FROM node:22-slim

# 1. Instalar FFmpeg (Necessário para converter áudios do Telegram)
RUN apt-get update \
    && apt-get install -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Configurar diretório
WORKDIR /usr/src/app

# 3. Copiar dependências
COPY package*.json ./

# 4. Instalar pacotes
RUN npm install --production

# 5. Copiar o código fonte
COPY . .

# 6. Expor a porta do servidor web (Health Check)
EXPOSE 3000

# 7. Iniciar
CMD [ "node", "index.js" ]