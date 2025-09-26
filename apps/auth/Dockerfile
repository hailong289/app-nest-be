FROM node:20-alpine

WORKDIR /usr/src/app

# Cài đặt đầy đủ dependencies (bao gồm devDeps để build)
COPY package*.json ./
RUN npm install

# Copy toàn bộ source code
COPY . .

# Build project (NestJS sẽ tạo dist/)
RUN npm run build:auth

# Expose cổng mà service auth sẽ lắng nghe
EXPOSE 3001

# Chạy service auth
CMD ["node", "dist/apps/auth/main.js"]
