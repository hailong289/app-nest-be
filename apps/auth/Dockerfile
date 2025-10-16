# ---------- Stage 1: Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json và lock file trước để tận dụng cache
COPY package*.json ./
RUN npm install

# Copy toàn bộ source code (apps + libs)
COPY . .

# Build chỉ service auth
RUN npm run build:auth


# ---------- Stage 2: Production ----------
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package.json và cài dependencies production
COPY package*.json ./
RUN npm install --omit=dev

# Copy dist của service auth từ builder
COPY --from=builder /app/dist ./dist

# Copy libs nếu runtime cần (proto, schema, asset…)
COPY libs ./libs

CMD ["node", "dist/apps/auth/main.js"]
