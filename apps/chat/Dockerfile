# ---------- Stage 1: Builder ----------
FROM node:24-alpine AS builder

WORKDIR /app

# Cài đặt công cụ build cho Alpine
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
RUN npm install

# Copy toàn bộ source code (apps + libs)
COPY . .

# Build chỉ service chat
RUN npm run build:chat

# ---------- Stage 2: Production ----------
FROM node:24-alpine AS runner

WORKDIR /app

# Cài đặt công cụ build cho Alpine
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    gcc \
    linux-headers

# Link python3 thành python để mediasoup tìm thấy
RUN ln -sf python3 /usr/bin/python

# Copy package.json và cài dependencies production
COPY package*.json ./
RUN npm install --omit=dev

# Copy dist của service chat từ builder
COPY --from=builder /app/dist ./dist

# Copy libs từ builder stage
COPY libs ./libs

CMD ["node", "dist/apps/chat/main.js"]
