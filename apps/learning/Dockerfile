# ---------- Stage 1: Builder ----------
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY . .

RUN npm run build:learning

# ---------- Stage 2: Production ----------
FROM node:24-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY libs ./libs

CMD ["node", "dist/apps/learning/main.js"]
