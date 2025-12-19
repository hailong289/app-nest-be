# 🚀 Quick Start Guide

## Chạy Tất Cả Trong Docker (Đơn Giản Nhất)

```bash
# Windows
.\start.ps1 docker

# Linux/Mac
./start.sh docker
```

## Chạy Tất Cả Local (Để Debug)

```bash
# 1. Start infrastructure
.\start.ps1 local

# 2. Mở terminal mới cho mỗi service và chạy:
cd apps\api-gateway
npm run start:dev

cd apps\auth
npm run start:dev

cd apps\chat
npm run start:dev

cd apps\filesystem
npm run start:dev
```

## Hybrid Mode (API Gateway Docker, Services Local)

```bash
# 1. Start API Gateway in Docker
.\start.ps1 hybrid

# 2. Start services locally (như trên)
```

## Stop Tất Cả

```bash
.\start.ps1 stop
```

---

## 📖 Đọc Thêm

Xem [HYBRID_MODE_GUIDE.md](./HYBRID_MODE_GUIDE.md) để biết chi tiết về các mode và troubleshooting.

## 🌐 URLs

- API Gateway: http://localhost:5000
- Kafka UI: http://localhost:8084
- Auth Service: http://localhost:5001
- Filesystem Service: http://localhost:5002
- Chat Service: http://localhost:5003
- Notification Service: http://localhost:5005
- AI Service: http://localhost:5006
