# ---------- Stage 1: Builder ----------
FROM node:24-alpine AS builder

WORKDIR /app

# Cài đặt công cụ build cho Alpine (cần cho mediasoup)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    gcc \
    linux-headers

# Link python3 thành python để mediasoup tìm thấy
RUN ln -sf python3 /usr/bin/python

# Copy package.json và lock file trước để tận dụng cache
COPY package*.json ./

# Install tất cả deps nhưng skip postinstall scripts (bỏ qua mediasoup build)
RUN npm install --ignore-scripts

# Chỉ build mediasoup riêng (chạy postinstall của mediasoup)
RUN npm rebuild mediasoup --update-binary || npm run --prefix node_modules/mediasoup postinstall || node node_modules/mediasoup/npm-scripts.mjs postinstall

# Copy toàn bộ source code (apps + libs)
COPY . .

# Build chỉ service chat
RUN npm run build:chat

# ---------- Stage 2: Production ----------
FROM node:24-alpine AS runner

WORKDIR /app

# Cài đặt công cụ build cho Alpine (cần cho mediasoup)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    gcc \
    linux-headers

# Link python3 thành python để mediasoup tìm thấy
RUN ln -sf python3 /usr/bin/python

# Copy package.json và cài dependencies production (skip postinstall)
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Chỉ build mediasoup riêng (chạy postinstall của mediasoup)
RUN node node_modules/mediasoup/npm-scripts.mjs postinstall

# Copy dist của service chat từ builder
COPY --from=builder /app/dist ./dist

# Copy libs từ builder stage
COPY libs ./libs

CMD ["node", "dist/apps/chat/main.js"]
