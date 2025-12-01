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

# 4. LIMITADOR DE MEMÓRIA (EXTREMO PARA O PLANO FREE)
# Baixamos de 256MB para 128MB. O Node.js do bot é leve, o pesado é o Chromium.
# Isso libera quase 400MB para o navegador respirar sem estourar os 512MB do Render.
ENV NODE_OPTIONS="--max-old-space-size=128"

# 5. Copiar dependências
COPY package*.json ./

# 6. Instalar pacotes do Node
RUN npm install --production

# 7. Copiar o código fonte
COPY . .

# 8. Expor a porta do servidor web
EXPOSE 3000

# 9. Iniciar
CMD [ "node", "index.js" ]