FROM node:22-slim

# 1. Instalar Git e dependências básicas (ffmpeg é útil para áudio)
RUN apt-get update \
    && apt-get install -y git ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Configurar diretório
WORKDIR /usr/src/app

# 3. Copiar dependências
COPY package*.json ./

# 4. Instalar pacotes
RUN npm install --production

# 5. Copiar o código fonte
COPY . .

# 6. Expor a porta do servidor web
EXPOSE 3000

# 7. Iniciar
CMD [ "node", "index.js" ]