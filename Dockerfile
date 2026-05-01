FROM node:20-bullseye-slim

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak-ng \
    webp \
    imagemagick \
    libwebp-dev \
    libvips-dev \
    git \
    ca-certificates \
    curl \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp via pip — standalone curl binary fails with Python zipimport errors;
# pip installs a proper wrapper script that works reliably with system Python
RUN pip3 install -U yt-dlp

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
