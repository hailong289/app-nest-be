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

# Install toàn bộ deps (mediasoup sẽ tự build worker trong postinstall)
RUN npm install

# Copy toàn bộ source code (apps + libs)
COPY . .

# Build chỉ service socket
RUN npm run build:socket

# Pruning: giữ lại chỉ production deps
RUN npm prune --omit=dev

# ---------- Stage 2: Production ----------
FROM node:24-alpine AS runner

WORKDIR /app

# Cài đặt runtime libs cần thiết cho mediasoup worker binary
RUN apk add --no-cache libstdc++ libgcc

# Copy node_modules đã build sẵn (bao gồm mediasoup worker binary) từ builder
COPY --from=builder /app/node_modules ./node_modules

# Copy dist của service socket từ builder
COPY --from=builder /app/dist ./dist

# Copy libs nếu runtime cần (proto, schema, asset…)
COPY libs ./libs

CMD ["node", "dist/apps/socket/main.js"]
