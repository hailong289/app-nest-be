FROM node:20-alpine

WORKDIR /usr/src/app

# Cài đặt đầy đủ dependencies (bao gồm devDeps để build)
COPY package*.json ./
RUN npm install

# Copy toàn bộ source code
COPY . .

# Build project (NestJS sẽ tạo dist/)
RUN npm run build:gateway

# Expose cổng mà service api-gateway sẽ lắng nghe
EXPOSE 3000

# Chạy service api-gateway
CMD ["node", "dist/apps/api-gateway/main.js"]
