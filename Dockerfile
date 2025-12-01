FROM node:22-slim

# 1. Instalar Chromium (Versão leve), Git e dependências
# O Chromium do repositório oficial é mais otimizado para containers que o Chrome Stable
# O Git é necessário para instalar a biblioteca whatsapp-web.js do GitHub
RUN apt-get update \
    && apt-get install -y git chromium \
    && rm -rf /var/lib/apt/lists/*

# 2. Configurar diretório
WORKDIR /usr/src/app

# 3. Variáveis de ambiente para o Puppeteer usar o Chromium instalado
# Isso impede que o Puppeteer tente baixar outra versão do Chrome, economizando espaço e memória
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 4. Copiar dependências
COPY package*.json ./

# 5. Instalar pacotes do Node
RUN npm install --production

# 6. Copiar o código fonte
COPY . .

# 7. Expor a porta do servidor web
EXPOSE 3000

# 8. Iniciar
CMD [ "node", "index.js" ]