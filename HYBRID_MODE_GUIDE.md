# Hướng Dẫn Chạy Hybrid Mode (Docker + Local)

## 🎯 Mục đích

Hỗ trợ chạy các services linh hoạt: một số trong Docker, một số chạy local trên máy, tất cả đều kết nối được với nhau.

---

## 📋 Các File Cấu Hình

### 1. `.env.docker`

- **Khi nào dùng**: Service chạy **TRONG Docker**
- **Kết nối**: Sử dụng service names (`auth`, `chat`, `filesystem`, etc.)
- **Kafka**: `redpanda:29092`

### 2. `.env.local`

- **Khi nào dùng**: Service chạy **NGOÀI Docker** (local)
- **Kết nối**: Sử dụng `localhost` với ports được expose
- **Kafka**: `localhost:9092`

### 3. `.env.hybrid`

- **Khi nào dùng**: Service chạy **TRONG Docker** nhưng cần kết nối tới services **CHẠY LOCAL**
- **Kết nối**: Sử dụng `host.docker.internal` để truy cập host machine
- **Kafka**: `redpanda:29092`

---

## 🚀 Các Kịch Bản Sử Dụng

### Kịch Bản 1: Tất Cả Chạy Trong Docker

```bash
# Start all services
docker-compose up -d

# Frontend kết nối tới:
# http://localhost:5000 (API Gateway)
```

**Cấu hình**: Mặc định dùng `.env.docker`

---

### Kịch Bản 2: Tất Cả Chạy Local

```bash
# 1. Start only infrastructure (Kafka, Redis, MongoDB)
docker-compose up -d redpanda

# 2. Run each service locally (mở terminal riêng cho mỗi service)
cd apps/api-gateway && npm run start:dev
cd apps/auth && npm run start:dev
cd apps/chat && npm run start:dev
cd apps/filesystem && npm run start:dev
cd apps/notification && npm run start:dev
cd apps/ai && npm run start:dev
```

**Lưu ý**:

- Copy `.env.local` thành `.env` cho mỗi service
- Hoặc đổi tên `.env.local` trong `package.json` scripts

---

### Kịch Bản 3: Hybrid Mode - API Gateway Trong Docker, Services Chạy Local

**Bước 1**: Start infrastructure và API Gateway

```bash
docker-compose up -d redpanda api-gateway
```

**Bước 2**: Đổi env file của API Gateway sang hybrid mode

```bash
# Option 1: Sửa docker-compose.yml
services:
  api-gateway:
    env_file:
      - apps/api-gateway/.env.hybrid  # Đổi từ .env.docker

# Option 2: Override khi start
docker-compose run -e GATEWAY_AUTH_HOST=host.docker.internal api-gateway
```

**Bước 3**: Start các services local

```bash
cd apps/auth && npm run start:dev
cd apps/chat && npm run start:dev
cd apps/filesystem && npm run start:dev
```

---

### Kịch Bản 4: Hybrid Mode - Một Số Services Docker, Một Số Local

**Ví dụ**: API Gateway + Auth trong Docker, Chat + Filesystem chạy local

**Bước 1**: Start services trong Docker

```bash
docker-compose up -d redpanda api-gateway auth
```

**Bước 2**: Sửa API Gateway env sang hybrid mode cho Chat và Filesystem

```bash
# Trong apps/api-gateway/.env.hybrid hoặc docker-compose override
GATEWAY_CHAT_HOST=host.docker.internal
GATEWAY_FILESYSTEM_HOST=host.docker.internal
GATEWAY_AUTH_HOST=auth  # vẫn dùng service name vì trong Docker
```

**Bước 3**: Start local services

```bash
cd apps/chat && npm run start:dev
cd apps/filesystem && npm run start:dev
```

---

## 🔧 Cấu Hình Chi Tiết

### API Gateway Environment Variables

| Environment                                    | Auth Host              | Chat Host              | Filesystem Host        | Kafka            |
| ---------------------------------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------- |
| **Docker** (all in Docker)                     | `auth`                 | `chat`                 | `filesystem`           | `redpanda:29092` |
| **Local** (all local)                          | `localhost`            | `localhost`            | `localhost`            | `localhost:9092` |
| **Hybrid** (gateway in Docker, services local) | `host.docker.internal` | `host.docker.internal` | `host.docker.internal` | `redpanda:29092` |

### Ports Mapping

| Service          | Container Port | Host Port |
| ---------------- | -------------- | --------- |
| API Gateway      | 5000           | 5000      |
| Auth             | 5001           | 5001      |
| Filesystem       | 5002           | 5002      |
| Chat             | 5003           | 5003      |
| Notification     | 5005           | 5005      |
| AI               | 5006           | 5006      |
| Kafka (External) | 9092           | 9092      |
| Kafka (Internal) | 29092          | -         |
| Kafka UI         | 8080           | 8084      |

---

## 📝 Package.json Scripts Mẫu

Thêm scripts vào `package.json` của mỗi service:

```json
{
  "scripts": {
    "start:dev": "nest start --watch",
    "start:local": "NODE_ENV=development nest start --watch",
    "start:docker": "NODE_ENV=docker node dist/main"
  }
}
```

---

## 🐛 Troubleshooting

### Lỗi: "Name resolution failed for target dns:chat:5003"

**Nguyên nhân**: Service đang chạy local nhưng cố kết nối bằng service name
**Giải pháp**:

- Đổi sang `.env.local` (dùng `localhost`)
- Hoặc chạy service đó trong Docker

### Lỗi: "Connection refused" từ Docker tới local service

**Nguyên nhân**: Dùng `localhost` trong Docker container
**Giải pháp**: Dùng `host.docker.internal` thay vì `localhost`

### Lỗi: Kafka connection timeout

**Nguyên nhân**:

- Local service kết nối tới `redpanda:29092` (chỉ hoạt động trong Docker)
- Docker service kết nối tới `localhost:9092`

**Giải pháp**:

- Local services: Dùng `localhost:9092`
- Docker services: Dùng `redpanda:29092`

### Service không kết nối được với nhau trong Docker

**Giải pháp**: Đảm bảo `depends_on` được cấu hình đúng và các services cùng network

---

## 🎓 Best Practices

1. **Development**: Chạy tất cả local để debug dễ dàng
2. **Testing Integration**: Chạy tất cả trong Docker
3. **Debug Specific Service**: Chạy service đó local, còn lại trong Docker
4. **Luôn start infrastructure trước**: `docker-compose up -d redpanda`
5. **Check logs**:
   - Docker: `docker-compose logs -f service-name`
   - Local: Console output

---

## 📚 Tham Khảo

- Docker docs: https://docs.docker.com/desktop/networking/#i-want-to-connect-from-a-container-to-a-service-on-the-host
- `host.docker.internal`: Special DNS name to access host machine from Docker
- `extra_hosts`: Thêm custom DNS mappings trong Docker

---

## 🔄 Quick Commands

```bash
# Start only Kafka
docker-compose up -d redpanda

# Start all Docker services
docker-compose up -d

# Stop all Docker services
docker-compose down

# Rebuild and restart a service
docker-compose up -d --build api-gateway

# View logs
docker-compose logs -f api-gateway

# Check which services are running
docker-compose ps
```
