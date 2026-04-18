# ---------- Stage 1: deps (cache mediasoup build) ----------
FROM node:24-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 py3-pip make g++ gcc linux-headers \
  && ln -sf python3 /usr/bin/python

COPY package*.json ./
RUN npm install

# ---------- Stage 2: Builder ----------
FROM node:24-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

RUN npm run build:socket && npm prune --omit=dev

# ---------- Stage 3: Production ----------
FROM node:24-alpine AS runner

WORKDIR /app

RUN apk add --no-cache libstdc++ libgcc

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY libs ./libs

CMD ["node", "dist/apps/socket/main.js"]
