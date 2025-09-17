FROM node:18-alpine

WORKDIR /usr/src/app

# Sao chép package files
COPY package*.json ./

# Cài đặt tất cả dependencies
RUN npm ci

# Sao chép mã nguồn
COPY . .

# Xây dựng ứng dụng NestJS
RUN npm run build

# Mở cổng ứng dụng
EXPOSE 3000

CMD ["npm", "run", "start:prod"]