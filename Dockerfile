FROM node:18-alpine

# Tạo thư mục làm việc
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

# Sao chép toàn bộ mã nguồn vào container
COPY . .

# Xây dựng ứng dụng NestJS
RUN npm run build

# Mở cổng ứng dụng
EXPOSE 3000

CMD ["npm", "run", "start:prod"]