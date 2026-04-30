FROM node:20-bullseye-slim

# Install system deps for sharp, ffmpeg, canvas-like libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    webp \
    imagemagick \
    libwebp-dev \
    libvips-dev \
    git \
    ca-certificates \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy app
COPY . .

# Persistent session dir
RUN mkdir -p /app/auth_info

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
