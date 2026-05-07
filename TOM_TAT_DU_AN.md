# 📱 TÓM TẮT DỰ ÁN - APP NEST BE

## 📋 Giới thiệu

Đây là backend của ứng dụng chat đa năng được xây dựng bằng **NestJS** với kiến trúc **Microservices**. Dự án sử dụng gRPC, Kafka, WebSocket, MongoDB, Redis để xây dựng một hệ thống chat real-time với đầy đủ tính năng hiện đại.

## 🏗️ Kiến trúc hệ thống

### Microservices Architecture

Dự án được chia thành 6 microservices độc lập:

1. **API Gateway** (Port 5000)
   - Điểm truy cập chính của hệ thống
   - Định tuyến request đến các microservices
   - Xử lý authentication và authorization
   - WebSocket gateway cho real-time messaging

2. **Auth Service** (Port 5001)
   - Quản lý đăng ký, đăng nhập, đăng xuất
   - JWT authentication
   - OTP verification
   - Quản lý session và refresh token
   - gRPC server

3. **Chat Service** (Port 5003)
   - Quản lý phòng chat (tạo, xóa, cập nhật)
   - Gửi/nhận tin nhắn real-time
   - Message reactions, read receipts
   - Flashcards và Quiz trong phòng
   - WebSocket server
   - gRPC server

4. **Filesystem Service** (Port 5002)
   - Upload/download files
   - Xử lý hình ảnh, video, audio
   - Tích hợp AWS S3
   - Tạo thumbnail, preview
   - Metadata extraction
   - gRPC server

5. **Notification Service** (Port 5005)
   - Push notification (Firebase Cloud Messaging)
   - Email notification
   - In-app notification
   - Notification history
   - gRPC server

6. **AI Service** (Port 5006)
   - Tích hợp Google Generative AI
   - Chatbot thông minh
   - Tạo nội dung tự động
   - Gợi ý câu trả lời
   - gRPC server

### Công nghệ sử dụng

**Backend Framework:**
- NestJS 11.x (Node.js framework)
- TypeScript
- Express

**Communication:**
- gRPC (@grpc/grpc-js) - Inter-service communication
- Kafka (KafkaJS) - Event-driven messaging
- WebSocket (Socket.io) - Real-time bidirectional communication
- REST API - External communication

**Database:**
- MongoDB 8.x - Primary database
- Mongoose - ODM for MongoDB

**Cache & Queue:**
- Redis - Caching, session store, pub/sub
- Bull - Job queue processing

**Storage:**
- AWS S3 - File storage
- Local filesystem (development)

**Media Processing:**
- Sharp - Image processing
- FFmpeg - Video/audio processing
- music-metadata - Audio metadata extraction

**Authentication:**
- Passport.js
- JWT (JSON Web Tokens)
- Firebase Admin SDK

**AI:**
- Google Generative AI (@google/generative-ai)

**Development Tools:**
- ESLint - Code linting
- Prettier - Code formatting
- Jest - Testing framework
- Docker & Docker Compose
- Concurrently - Run multiple commands

## 📊 Cơ sở dữ liệu

### 17 MongoDB Collections

1. **Users** - Thông tin người dùng (10 trường)
2. **Rooms** - Phòng chat (9 trường)
3. **Messages** - Tin nhắn (13 trường)
4. **Attachments** - File đính kèm (12 trường)
5. **Friendships** - Quan hệ bạn bè (5 trường)
6. **Notifications** - Thông báo (11 trường)
7. **Keys** - Token và FCM keys (4 trường)
8. **Otps** - OTP codes (6 trường)
9. **MessageReactions** - Reaction tin nhắn (5 trường)
10. **MessageReads** - Trạng thái đã đọc (5 trường)
11. **MessageHides** - Tin nhắn đã ẩn (5 trường)
12. **RoomEvents** - Sự kiện phòng (8 trường)
13. **RoomsState** - Trạng thái phòng (3 trường)
14. **RoomsUsersState** - Trạng thái người dùng trong phòng (9 trường)
15. **Flashcards** - Thẻ học (17 trường)
16. **FlashcardDecks** - Bộ thẻ học (14 trường)
17. **Quizzes** - Quiz trong phòng (16 trường)

Chi tiết xem thêm trong file `NOTES.md`.

## 🚀 Hướng dẫn cài đặt và chạy

### Yêu cầu hệ thống

- Node.js >= 18.x
- Yarn hoặc npm
- Docker & Docker Compose (cho mode Docker)
- MongoDB 7.x+ (cho mode local)
- Redis 7.x+ (cho mode local)
- Kafka/RedPanda (cho mode local)

### 1. Clone repository

```bash
git clone <repository-url>
cd app-nest-be
```

### 2. Cài đặt dependencies

```bash
# Sử dụng yarn (khuyến nghị)
yarn install

# Hoặc npm
npm install
```

### 3. Cấu hình Environment Variables

Mỗi service cần file `.env` riêng. Xem `.env.example` trong mỗi folder service:

```bash
# Tạo file .env cho từng service
cp apps/api-gateway/.env.example apps/api-gateway/.env
cp apps/auth/.env.example apps/auth/.env
cp apps/chat/.env.example apps/chat/.env
cp apps/filesystem/.env.example apps/filesystem/.env
cp apps/notification/.env.example apps/notification/.env
cp apps/ai/.env.example apps/ai/.env
```

**Cấu hình quan trọng:**
- MongoDB connection string
- Redis connection string
- Kafka brokers
- AWS S3 credentials
- Firebase credentials
- Google AI API key
- JWT secret keys

## 📦 Các lệnh chạy dự án

### Mode 1: Chạy tất cả trong Docker (Khuyến nghị cho Production)

```bash
# Khởi động tất cả services trong Docker
./start.sh docker
# Hoặc
docker-compose up -d

# Xem logs
docker-compose logs -f

# Dừng tất cả services
./start.sh stop
# Hoặc
docker-compose down
```

**Ports:**
- API Gateway: http://localhost:5000
- Auth Service: http://localhost:5001
- Filesystem Service: http://localhost:5002
- Chat Service: http://localhost:5003
- Notification Service: http://localhost:5005
- AI Service: http://localhost:5006

### Mode 2: Chạy local (Development)

**Bước 1: Khởi động infrastructure (MongoDB, Redis, Kafka)**

```bash
./start.sh local
# Hoặc
docker-compose -f docker-compose.local.yml up -d
```

**Bước 2: Khởi động các services**

```bash
# Chạy tất cả services cùng lúc (khuyến nghị)
yarn dev:all

# Hoặc chạy từng service riêng lẻ
yarn dev:gateway    # API Gateway
yarn dev:auth       # Auth Service
yarn dev:chat       # Chat Service
yarn dev:filesystem # Filesystem Service
yarn dev:notification # Notification Service
yarn dev:ai         # AI Service
```

### Mode 3: Hybrid Mode

API Gateway chạy trong Docker, các microservices chạy local:

```bash
./start.sh hybrid
```

### Các lệnh phát triển khác

#### Build

```bash
# Build tất cả services
yarn build:all

# Build từng service
yarn build:gateway
yarn build:auth
yarn build:chat
yarn build:filesystem
yarn build:notification
yarn build:ai
```

#### Run Production

```bash
# Sau khi build, chạy production
yarn prod:all

# Hoặc chạy từng service
yarn prod:gateway
yarn prod:auth
yarn prod:chat
yarn prod:filesystem
yarn prod:notification
```

#### Testing

```bash
# Unit tests
yarn test

# E2E tests
yarn test:e2e

# Test coverage
yarn test:cov

# Watch mode
yarn test:watch
```

#### Code Quality

```bash
# Lint code
yarn lint

# Format code
yarn format
```

#### Kafka Topics

```bash
# Tạo Kafka topics
yarn kafka:create-topics
```

## 📁 Cấu trúc thư mục

```
app-nest-be/
├── apps/                          # Microservices
│   ├── api-gateway/              # API Gateway service
│   ├── auth/                     # Auth service
│   ├── chat/                     # Chat service
│   ├── filesystem/               # Filesystem service
│   ├── notification/             # Notification service
│   └── ai/                       # AI service
├── libs/                         # Shared libraries
│   ├── constants/                # Constants, enums
│   ├── db/                       # Database models, schemas
│   ├── dto/                      # Data Transfer Objects
│   ├── grpc/                     # gRPC proto files, clients
│   ├── helpers/                  # Helper functions
│   ├── kafka/                    # Kafka configuration
│   ├── scripts/                  # Utility scripts
│   ├── types/                    # TypeScript types
│   └── ws/                       # WebSocket shared code
├── docker-compose.yml            # Docker compose cho production
├── docker-compose.local.yml      # Docker compose cho local dev
├── docker-compose.hybrid.yml     # Docker compose cho hybrid mode
├── start.sh                      # Script khởi động nhanh
├── start-all.sh                  # Script chạy tất cả services local
├── package.json                  # Dependencies và scripts
├── nest-cli.json                 # NestJS CLI config
├── tsconfig.json                 # TypeScript config
├── NOTES.md                      # Ghi chú về database
├── UPLOAD_FLOW_FIX.md           # Tài liệu fix upload flow
└── README.md                     # README gốc của NestJS
```

## 🔧 Debugging

### Xem logs Docker

```bash
# Tất cả services
docker-compose logs -f

# Service cụ thể
docker-compose logs -f api-gateway
docker-compose logs -f auth
docker-compose logs -f chat
```

### Debug mode

```bash
# Start với debug mode
yarn start:debug
```

### Common Issues

1. **Port đã được sử dụng**
   - Kiểm tra và kill process đang dùng port: `lsof -i :5000`
   
2. **MongoDB connection failed**
   - Kiểm tra MongoDB đang chạy: `docker ps | grep mongo`
   - Kiểm tra connection string trong `.env`

3. **Redis connection failed**
   - Kiểm tra Redis đang chạy: `docker ps | grep redis`
   - Kiểm tra Redis password trong `.env`

4. **Kafka connection failed**
   - Kiểm tra Kafka/RedPanda đang chạy
   - Tạo topics: `yarn kafka:create-topics`

5. **File upload không hoạt động**
   - Xem hướng dẫn trong `UPLOAD_FLOW_FIX.md`
   - Kiểm tra AWS S3 credentials

## 📚 Tài liệu bổ sung

- `README.md` - Hướng dẫn NestJS cơ bản
- `NOTES.md` - Chi tiết về database collections
- `UPLOAD_FLOW_FIX.md` - Hướng dẫn xử lý upload flow với temporary IDs

## 🛠️ Scripts hữu ích

```bash
# Xem tất cả containers
docker ps -a

# Xem network
docker network ls

# Restart service
docker-compose restart auth

# Rebuild service
docker-compose up -d --build auth

# Xóa volumes
docker-compose down -v

# Xem resource usage
docker stats

# Clean up
docker system prune -a
```

## 📞 Liên hệ & Support

- Repository: https://github.com/hailong289/app-nest-be
- Issues: https://github.com/hailong289/app-nest-be/issues

## 📄 License

UNLICENSED - Private project

---

**Chúc bạn code vui vẻ! 🚀**
