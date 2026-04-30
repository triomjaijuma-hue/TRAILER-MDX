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

# yt-dlp — required for .play / .video / .ytmp3 / .ytmp4 since the public
# wrapper APIs (cobalt, giftedtech, davidcyril, ...) are mostly dead in 2026.
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

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
