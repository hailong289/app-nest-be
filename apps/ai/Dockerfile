# ---------- Stage 1: Builder ----------
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package.json và lock file trước để tận dụng cache
COPY package*.json ./
RUN npm install --ignore-scripts

# Copy toàn bộ source code (apps + libs)
COPY . .

# Build chỉ service ai
RUN npm run build:ai

# ---------- Stage 2: Production ----------
FROM node:24-alpine AS runner

WORKDIR /app

# Copy package.json và cài dependencies production
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy dist của service ai từ builder
COPY --from=builder /app/dist ./dist

# Copy libs nếu runtime cần (proto, schema, asset…)
COPY libs ./libs

CMD ["node", "dist/apps/ai/main.js"]
