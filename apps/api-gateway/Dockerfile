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

# Copy package.json để cache cài deps
COPY package*.json ./
RUN npm install

# Copy toàn bộ source (apps + libs)
COPY . .

# Build service gateway
RUN npm run build:gateway

# ---------- Stage 2: Runner ----------
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

# Copy package.json & install production deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy dist từ builder
COPY --from=builder /app/dist ./dist

# Copy libs
COPY libs ./libs

CMD ["node", "dist/apps/api-gateway/main.js"]
