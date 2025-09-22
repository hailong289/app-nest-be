# AppChat Backend - NestJS Microservices

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

## Mô tả dự án

AppChat Backend là một hệ thống microservices được xây dựng bằng NestJS, cung cấp API cho ứng dụng chat với các tính năng:
- Xác thực và phân quyền người dùng
- Quản lý tin nhắn và cuộc trò chuyện 
- Thông báo real-time qua Firebase
- Quản lý file và media với AWS S3
- API Gateway để định tuyến và load balancing

## Kiến trúc hệ thống

Dự án được thiết kế theo mô hình microservices với các service:

### 🚪 API Gateway
- **Port**: 3000 (mặc định)
- **Chức năng**: Định tuyến request đến các microservice tương ứng
- **Location**: `apps/api-gateway/`

### 🔐 Auth Service  
- **Chức năng**: Xác thực, đăng nhập, đăng ký, quản lý JWT tokens
- **Location**: `apps/auth/`

### 💬 Chat Service
- **Chức năng**: Quản lý tin nhắn, cuộc trò chuyện, room chat
- **Location**: `apps/chat/`

### 📱 Notification Service
- **Chức năng**: Gửi thông báo push qua Firebase, quản lý queue
- **Technologies**: Firebase Admin SDK, Bull Queue, Redis
- **Location**: `apps/notification/`

### 📁 Filesystem Service
- **Chức năng**: Upload/download file, quản lý media với AWS S3
- **Technologies**: AWS SDK, S3 presigned URLs
- **Location**: `apps/filesystem/`

### 📚 Shared Libraries
- **Constants**: Định nghĩa các hằng số chung (`libs/constants/`)
- **DTOs**: Data Transfer Objects (`libs/dto/`)

## Công nghệ sử dụng

### Core Framework
- **NestJS** v11 - Node.js framework
- **TypeScript** - Ngôn ngữ lập trình
- **RxJS** - Reactive programming

### Microservices & Communication
- **Apache Kafka** - Message broker cho communication giữa services
- **KafkaJS** - Kafka client cho Node.js

### Database & Caching
- **Redis** - Caching và queue management
- **IORedis** - Redis client

### Cloud Services
- **AWS S3** - Object storage cho files/media
- **Firebase Admin** - Push notifications

### Queue & Background Jobs
- **Bull** - Queue management
- **@nestjs/bull** - NestJS integration

### Development Tools
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Jest** - Unit testing

## Yêu cầu hệ thống

- **Node.js** >= 18.x
- **npm** >= 8.x hoặc **yarn** >= 1.22.x
- **Docker** & **Docker Compose** (cho Kafka và Redis)

## Cài đặt dự án

### 1. Clone repository và cài đặt dependencies

```bash
# Clone project
git clone <repository-url>
cd app-nest-be

# Cài đặt dependencies
npm install
```

### 2. Khởi chạy infrastructure với Docker

```bash
# Khởi chạy Kafka và Kafka UI
docker-compose up -d

# Kiểm tra services đang chạy
docker-compose ps
```

**Services được khởi chạy:**
- **Kafka**: `localhost:9092` 
- **Kafka UI**: `http://localhost:8080`

### 3. Cấu hình environment variables

Tạo file `.env` trong thư mục root và cấu hình các biến môi trường cần thiết:

```env
# AWS S3 Configuration
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name

# Firebase Configuration  
FIREBASE_PROJECT_ID=your-firebase-project
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka Configuration
KAFKA_BROKERS=localhost:9092
```

## Build và chạy dự án

### Development Mode

```bash
# Chạy tất cả services
npm run start:dev

# Hoặc chạy từng service riêng biệt
npm run start:dev:gateway    # API Gateway
npm run start:dev:auth       # Auth Service  
npm run start:dev:chat       # Chat Service
npm run start:dev:notification # Notification Service
npm run start:dev:filesystem # Filesystem Service
```

### Production Mode

```bash
# Build tất cả services
npm run build:all

# Chạy production
npm run start:prod:gateway
npm run start:prod:auth
npm run start:prod:chat  
npm run start:prod:notification
npm run start:prod:filesystem
```

### Using Docker

```bash
# Build Docker image
docker build -t app-nest-be .

# Run với docker-compose (nếu có docker-compose.prod.yml)
docker-compose -f docker-compose.prod.yml up
```

## Testing

```bash
# Unit tests
npm run test

# Test coverage
npm run test:cov

# E2E tests  
npm run test:e2e

# Watch mode
npm run test:watch
```

## Development Tools

```bash
# Code formatting
npm run format

# Linting
npm run lint
```

## API Documentation

### API Gateway Routes

API Gateway sẽ proxy các request đến các microservice tương ứng:

```
POST /auth/login          → Auth Service
POST /auth/register       → Auth Service
GET  /auth/profile        → Auth Service

POST /chat/messages       → Chat Service  
GET  /chat/conversations  → Chat Service
POST /chat/rooms          → Chat Service

POST /files/upload        → Filesystem Service
GET  /files/:id          → Filesystem Service
DELETE /files/:id        → Filesystem Service

POST /notifications/send  → Notification Service
GET  /notifications/      → Notification Service
```

### Message Queues & Events

Các service giao tiếp với nhau thông qua Kafka topics:

- `user.created` - Khi user mới được tạo
- `message.sent` - Khi có tin nhắn mới
- `notification.push` - Khi cần gửi thông báo
- `file.uploaded` - Khi file được upload thành công

## Cấu trúc thư mục

```
app-nest-be/
├── apps/                     # Microservices
│   ├── api-gateway/         # API Gateway service
│   ├── auth/                # Authentication service
│   ├── chat/                # Chat management service  
│   ├── filesystem/          # File management service
│   └── notification/        # Push notification service
├── libs/                    # Shared libraries
│   ├── constants/           # Shared constants
│   └── dto/                 # Data transfer objects
├── docker-compose.yml       # Docker services (Kafka, Redis)
├── Dockerfile              # Application container
├── nest-cli.json           # NestJS CLI configuration
└── package.json            # Dependencies & scripts
```

## Monitoring & Debugging

### Kafka UI
- URL: `http://localhost:8080`
- Theo dõi messages, topics, và consumer groups

### Health Checks
```bash
# Kiểm tra health của từng service
curl http://localhost:3000/health        # API Gateway
curl http://localhost:3001/health        # Auth Service
curl http://localhost:3002/health        # Chat Service
curl http://localhost:3003/health        # Notification Service  
curl http://localhost:3004/health        # Filesystem Service
```

### Logs
```bash
# Xem logs của Docker services
docker-compose logs -f kafka
docker-compose logs -f kafka-ui

# Xem logs của NestJS services (sử dụng built-in logger)
# Logs sẽ được hiển thị trong console khi chạy ở development mode
```

## Deployment

### Production Deployment

1. **Build Docker images**
```bash
docker build -t app-nest-be:latest .
```

2. **Deploy với Docker Compose**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

3. **Deploy lên Kubernetes**
```bash
kubectl apply -f k8s/
```

### Environment Variables cho Production

```env
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis Cluster
REDIS_CLUSTER_NODES=redis-1:6379,redis-2:6379,redis-3:6379

# Kafka Cluster  
KAFKA_BROKERS=kafka-1:9092,kafka-2:9092,kafka-3:9092

# Monitoring
ELASTIC_URL=http://elasticsearch:9200
KIBANA_URL=http://kibana:5601
```

## Troubleshooting

### Các lỗi thường gặp

1. **Kafka connection failed**
```bash
# Kiểm tra Kafka đang chạy
docker-compose ps kafka
# Restart nếu cần
docker-compose restart kafka
```

2. **Redis connection timeout**  
```bash
# Kiểm tra Redis service
docker exec -it redis redis-cli ping
```

3. **S3 upload failed**
```bash
# Kiểm tra AWS credentials và permissions
aws s3 ls s3://your-bucket-name
```

## Contributing

1. Fork repository
2. Tạo feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)  
5. Tạo Pull Request

## Resources & Documentation

### NestJS Resources
- [NestJS Documentation](https://docs.nestjs.com)
- [NestJS Microservices](https://docs.nestjs.com/microservices/basics)
- [NestJS Kafka](https://docs.nestjs.com/microservices/kafka)

### Technologies Documentation  
- [Apache Kafka](https://kafka.apache.org/documentation/)
- [Redis](https://redis.io/documentation)
- [AWS S3 SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
