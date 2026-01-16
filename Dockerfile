FROM node:20-alpine

RUN apk add --no-cache \
    ffmpeg \
    wget \
    imagemagick \
    git

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN npm run build

VOLUME ["/app/auth"]

CMD ["node", "dist/index.js"]