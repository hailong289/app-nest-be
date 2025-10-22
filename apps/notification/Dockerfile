# ---------- Stage 1: Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json và lock file trước để tận dụng cache
COPY package*.json ./
RUN npm install

# Copy toàn bộ source code (apps + libs)
COPY . .

# Build chỉ service notification
RUN npm run build:notification

# ---------- Stage 2: Production ----------
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package.json và cài dependencies production
COPY package*.json ./
RUN npm install --omit=dev

# Copy dist của service notification từ builder
COPY --from=builder /app/dist ./dist

# Copy libs từ builder stage
COPY --from=builder /app/libs ./libs

CMD ["node", "dist/apps/notification/main.js"]