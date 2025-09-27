# ---------- Stage 1: Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json để cache cài deps
COPY package*.json ./
RUN npm install

# Copy toàn bộ source (apps + libs)
COPY . .

# Build service gateway
RUN npm run build:gateway


# ---------- Stage 2: Runner ----------
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package.json & install production deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy dist từ builder
COPY --from=builder /app/dist ./dist

# Copy libs nếu runtime cần (DTO/proto/schema)
COPY libs ./libs

CMD ["node", "dist/apps/api-gateway/main.js"]
