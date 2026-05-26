# Kế hoạch cập nhật Environment Variables

> **Ngữ cảnh**: Tài liệu phụ cho [`DATABASE_ISOLATION_PLAN.md`](./DATABASE_ISOLATION_PLAN.md) và [`CROSS_DB_LOOKUP_PLAN.md`](./CROSS_DB_LOOKUP_PLAN.md). Liệt kê những env vars cần **thêm mới**, **deprecated**, hoặc **giữ nguyên** khi thực hiện migration sang Giải pháp A (gRPC).
>
> **Convention hiện tại**: Project dùng tiền tố `GATEWAY_<TARGET>_HOST/PORT/PROTO_PATH/TLS` cho mọi gRPC client config (cả api-gateway và service-to-service đều dùng chung — ví dụ `apps/socket/.env.example` dùng `GATEWAY_SFU_HOST` để socket gọi sang sfu). Plan này tuân thủ convention đó.

---

## 1. Tổng quan: Ai cần gọi ai?

Sau refactor, mỗi service caller cần env vars cho service callee. Bảng mapping:

| Caller service | Phải gọi gRPC tới | Lý do |
|---|---|---|
| `auth` | `notification` | `CreateOtp`, `VerifyOtp` |
| `chat` | `auth` | `GetUsersByIds`, `SearchUsers`, `ListUsers` (hydrate sender/reactions/reads/...) |
| `chat` | `notification` | `PushNotification` (chuyển push từ chat sang notification) |
| `chat` | `filesystem` | `GetAttachmentsByIds` (hydrate `message.attachment_ids`) |
| `chat` | `ai` | `GetEmbeddingsByContextIds` (hydrate AI embedding cho attachments) |
| `chat` | `learning` | `GetQuizzesByIds`, `GetFlashcardsByIds`, `GetTodoProjectsByIds` |
| `notification` | `auth` | `GetFcmTokensByUserId(s)` (lấy FCM token khi push) |
| `filesystem` | `auth` | `GetUsersByIds` (hydrate document owner & shared users) |
| `filesystem` | `chat` | `GetRoomsByIds` (hydrate document `room_infos`) |
| `ai` | `auth` | `GetUserById` (khi cần user info) |
| `ai` | `chat` | `GetMessagesByRoomId` (lấy message history để embedding) |
| `learning` | `auth` | `GetUsersByIds` (hydrate user info nếu cần) |

Ma trận hình ảnh:

```
                   AUTH    CHAT    NOTI    FS    AI    LRN
auth         →            ✗       ✅      ✗     ✗     ✗
chat         →    ✅      ✗       ✅      ✅    ✅    ✅
notification →    ✅      ✗       ✗      ✗     ✗     ✗
filesystem   →    ✅      ✅      ✗      ✗     ✗     ✗
ai           →    ✅      ✅      ✗      ✗     ✗     ✗
learning     →    ✅      ✗       ✗      ✗     ✗     ✗
```

---

## 2. Env vars cần thêm cho từng service

### 2.1. `apps/auth/.env.example`

**Hiện trạng**:
```env
HOST=0.0.0.0
PORT=5001
PROTO_URL=libs/grpc/auth.proto
DB_CONNECTION=mongodb
DB_HOST=mongodb-auth:27017
DB_NAME=auth
REDIS_HOST=redis
REDIS_PORT=6379
...
GATEWAY_URL=http://localhost:5000
```

**Thêm mới**:
```env
# gRPC client → Notification service (cho OTP RPC)
GATEWAY_NOTIFICATION_HOST=localhost          # docker: notification
GATEWAY_NOTIFICATION_PORT=5005
GATEWAY_NOTIFICATION_PROTO_PATH=libs/grpc/notification.proto
GATEWAY_NOTIFICATION_TLS=false
```

**Deprecated (sau khi refactor xong)**:
- `GATEWAY_URL` — chỉ còn dùng cho axios call `/api/notifications/send-otp`. Sau khi chuyển sang gRPC, biến này có thể được xoá. **Giữ tạm trong giai đoạn migration** để rollback dễ dàng; xoá hẳn sau khi verify production stable.

---

### 2.2. `apps/chat/.env.example`

**Hiện trạng**:
```env
HOST=0.0.0.0
PORT=5003
KAFKA_BROKERS=kafka:29092
DB_CONNECTION=mongodb
DB_HOST=mongodb-chat:27017
DB_NAME=chat
REDIS_HOST=redis
...
GATEWAY_URL=http://localhost:5000
SECRET_KEY=123456
```

**Thêm mới** (chat trở thành caller lớn nhất — 5 service):
```env
# gRPC client → Auth (cho GetUsersByIds, SearchUsers, ListUsers — hydrate pipeline)
GATEWAY_AUTH_HOST=localhost                  # docker: auth
GATEWAY_AUTH_PORT=5001
GATEWAY_AUTH_PROTO_PATH=libs/grpc/auth.proto
GATEWAY_AUTH_TLS=false

# gRPC client → Notification (cho PushNotification)
GATEWAY_NOTIFICATION_HOST=localhost          # docker: notification
GATEWAY_NOTIFICATION_PORT=5005
GATEWAY_NOTIFICATION_PROTO_PATH=libs/grpc/notification.proto
GATEWAY_NOTIFICATION_TLS=false

# gRPC client → Filesystem (cho GetAttachmentsByIds)
GATEWAY_FILESYSTEM_HOST=localhost            # docker: filesystem
GATEWAY_FILESYSTEM_PORT=5002
GATEWAY_FILESYSTEM_PROTO_PATH=libs/grpc/filesystem.proto
GATEWAY_FILESYSTEM_TLS=false

# gRPC client → AI (cho GetEmbeddingsByContextIds)
GATEWAY_AI_HOST=localhost                    # docker: ai
GATEWAY_AI_PORT=5004
GATEWAY_AI_PROTO_PATH=libs/grpc/ai.proto
GATEWAY_AI_TLS=false

# gRPC client → Learning (cho GetQuizzesByIds, GetFlashcardsByIds, GetTodoProjectsByIds)
GATEWAY_LEARNING_HOST=localhost              # docker: learning
GATEWAY_LEARNING_PORT=5007
GATEWAY_LEARNING_PROTO_PATH=libs/grpc/learning.proto
GATEWAY_LEARNING_TLS=false

# ─── In-memory + Redis cache cho User info (giảm tải gRPC sang auth) ───
USER_CACHE_ENABLED=true
USER_CACHE_TTL_SECONDS=30                    # LRU in-memory TTL
USER_CACHE_MAX_SIZE=10000                    # LRU max entries
REDIS_USER_CACHE_TTL_SECONDS=300             # Redis cache TTL (5 phút)
REDIS_USER_CACHE_PREFIX=USER_INFO            # Redis key prefix

# (Optional) Cache cho các entity khác hay được hydrate
ATTACHMENT_CACHE_TTL_SECONDS=60
ROOM_CACHE_TTL_SECONDS=60
```

**Deprecated**:
- `GATEWAY_URL` — hiện chưa thấy code chat dùng, có thể là legacy. Verify trước khi xoá.

---

### 2.3. `apps/notification/.env.example`

**Hiện trạng**:
```env
DB_HOST=mongodb-notification:27017
DB_NAME=notification
FIREBASE_*=...
MAIL_*=...
KAFKA_*=...
URL_FRONTEND=http://localhost:3000
```

**Thêm mới**:
```env
# Service config (hiện thiếu HOST/PORT/PROTO_URL trong file example)
HOST=0.0.0.0
PORT=5005
PROTO_URL=libs/grpc/notification.proto

# gRPC client → Auth (cho GetFcmTokensByUserId(s))
GATEWAY_AUTH_HOST=localhost                  # docker: auth
GATEWAY_AUTH_PORT=5001
GATEWAY_AUTH_PROTO_PATH=libs/grpc/auth.proto
GATEWAY_AUTH_TLS=false

# (Optional) Cache FCM tokens — tránh gọi auth mỗi lần push
FCM_TOKEN_CACHE_TTL_SECONDS=120
FCM_TOKEN_CACHE_MAX_SIZE=5000
```

---

### 2.4. `apps/filesystem/.env.example`

**Hiện trạng**:
```env
HOST=0.0.0.0
PORT=5002
PROTO_URL=libs/grpc/filesystem.proto
S3_*=...
DB_HOST=mongodb-filesystem:27017
DB_NAME=filesystem
```

**Thêm mới**:
```env
# gRPC client → Auth (cho GetUsersByIds — hydrate document owner & shared)
GATEWAY_AUTH_HOST=localhost                  # docker: auth
GATEWAY_AUTH_PORT=5001
GATEWAY_AUTH_PROTO_PATH=libs/grpc/auth.proto
GATEWAY_AUTH_TLS=false

# gRPC client → Chat (cho GetRoomsByIds — hydrate document room_infos)
GATEWAY_CHAT_HOST=localhost                  # docker: chat
GATEWAY_CHAT_PORT=5003
GATEWAY_CHAT_PROTO_PATH=libs/grpc/chat.proto
GATEWAY_CHAT_TLS=false
```

---

### 2.5. `apps/ai/.env.example`

**Hiện trạng**:
```env
HOST=0.0.0.0
PORT=5004
PROTO_URL=libs/grpc/ai.proto
GOOGLE_API_KEY=
KAFKA_*=...
DB_HOST=mongodb-ai:27017
DB_NAME=ai
```

**Thêm mới**:
```env
# gRPC client → Auth (cho GetUserById khi cần user info)
GATEWAY_AUTH_HOST=localhost                  # docker: auth
GATEWAY_AUTH_PORT=5001
GATEWAY_AUTH_PROTO_PATH=libs/grpc/auth.proto
GATEWAY_AUTH_TLS=false

# gRPC client → Chat (cho GetMessagesByRoomId khi cần message history)
GATEWAY_CHAT_HOST=localhost                  # docker: chat
GATEWAY_CHAT_PORT=5003
GATEWAY_CHAT_PROTO_PATH=libs/grpc/chat.proto
GATEWAY_CHAT_TLS=false
```

---

### 2.6. `apps/learning/.env.example`

**Hiện trạng**:
```env
HOST=0.0.0.0
PORT=5007
PROTO_URL=libs/grpc/learning.proto
DB_HOST=mongodb-learning:27017
DB_NAME=learning
```

**Thêm mới**:
```env
# gRPC client → Auth (cho GetUserById / GetUsersByIds khi cần user info)
GATEWAY_AUTH_HOST=localhost                  # docker: auth
GATEWAY_AUTH_PORT=5001
GATEWAY_AUTH_PROTO_PATH=libs/grpc/auth.proto
GATEWAY_AUTH_TLS=false
```

> **Lưu ý infrastructure**: Container `mongodb-learning` đã có trong `docker-compose.yml` (port 27022). Ổn.

---

### 2.7. `apps/api-gateway/.env.example`

**Hiện trạng** đã có gRPC client cho auth, chat, filesystem, notification.

**Thêm mới** (nếu chưa có — verify lại trong `.env.development`):
```env
# gRPC client → AI service (nếu gateway expose endpoint /api/ai/*)
GATEWAY_AI_HOST=localhost
GATEWAY_AI_PORT=5004
GATEWAY_AI_PROTO_PATH=libs/grpc/ai.proto
GATEWAY_AI_TLS=false

# gRPC client → Learning service (nếu gateway expose endpoint /api/learning/*)
GATEWAY_LEARNING_HOST=localhost
GATEWAY_LEARNING_PORT=5007
GATEWAY_LEARNING_PROTO_PATH=libs/grpc/learning.proto
GATEWAY_LEARNING_TLS=false
```

> Hai service này đã có config helper file (`config/ai.config.ts`, `config/learning.config.ts`) đọc các env vars trên — tức là code đã sẵn sàng, chỉ cần đảm bảo env file include đầy đủ.

---

### 2.8. `apps/socket/.env.example` (không bắt buộc)

Socket service không có DB nên không bị ảnh hưởng trực tiếp bởi DB isolation. Nhưng nếu socket gateway cần resolve user info cho events → thêm:

```env
# (Optional) gRPC client → Auth nếu socket cần user info
GATEWAY_AUTH_HOST=localhost
GATEWAY_AUTH_PORT=5001
GATEWAY_AUTH_PROTO_PATH=libs/grpc/auth.proto
GATEWAY_AUTH_TLS=false
```

Verify hiện tại socket có cần user info không — nếu chỉ relay events thì có thể bỏ qua.

---

## 3. Env vars cho Docker Compose (`docker-compose.yml`)

Mỗi service container cần env file `.env.docker` (đã có). Khi cập nhật `.env.example`, **đồng thời cập nhật `.env.docker`** với hostname đúng là **tên container** thay vì `localhost`:

| File | Sửa giá trị |
|---|---|
| `apps/auth/.env.docker` | `GATEWAY_NOTIFICATION_HOST=notification` |
| `apps/chat/.env.docker` | `GATEWAY_AUTH_HOST=auth`<br>`GATEWAY_NOTIFICATION_HOST=notification`<br>`GATEWAY_FILESYSTEM_HOST=filesystem`<br>`GATEWAY_AI_HOST=ai`<br>`GATEWAY_LEARNING_HOST=learning` |
| `apps/notification/.env.docker` | `GATEWAY_AUTH_HOST=auth` |
| `apps/filesystem/.env.docker` | `GATEWAY_AUTH_HOST=auth`<br>`GATEWAY_CHAT_HOST=chat` |
| `apps/ai/.env.docker` | `GATEWAY_AUTH_HOST=auth`<br>`GATEWAY_CHAT_HOST=chat` |
| `apps/learning/.env.docker` | `GATEWAY_AUTH_HOST=auth` |

> **Note**: `docker-compose.yml` hiện tại chưa định nghĩa container `learning` (chỉ có `mongodb-learning`). Khi đưa learning service vào docker, cần thêm service definition và update env files của các caller (chat) cho khớp.

---

## 4. Env vars cho CI/CD (`.github/workflows/*`)

Các workflow file `.github/workflows/deploy-<service>.yml` cần inject env vars khi deploy. Kiểm tra và thêm secrets/vars trong GitHub repo settings:

### `deploy-auth.yml`
Thêm:
- `GATEWAY_NOTIFICATION_HOST` (production hostname)
- `GATEWAY_NOTIFICATION_PORT`
- `GATEWAY_NOTIFICATION_PROTO_PATH`
- `GATEWAY_NOTIFICATION_TLS`

### `deploy-chat.yml`
Thêm tất cả vars dưới mục 2.2 (5 service callees + cache config).

### `deploy-notification.yml`
Thêm vars trong 2.3.

### `deploy-filesystem.yml`, `deploy-ai.yml`, `deploy-learning.yml`
Thêm vars tương ứng trong 2.4–2.6.

### Secrets cần thêm trong GitHub
- `GATEWAY_AUTH_HOST_PROD`, `GATEWAY_AUTH_PORT_PROD` (URLs production)
- `GATEWAY_CHAT_HOST_PROD`, ...
- Tương tự cho mọi target service

> **Lưu ý**: Workflow deploy hiện tại đã có `GATEWAY_URL` secret. Khi xoá axios call ở auth, có thể bỏ secret này (sau khi confirm không service nào còn dùng).

---

## 5. Tổng hợp danh sách env vars MỚI cần thêm

### Đếm tổng:
- **gRPC client configs**: 4 var/relationship × 12 relationships = **48 env vars** (host, port, proto_path, tls)
- **Cache configs** (chat): 5-6 vars
- **Cache configs** (notification, optional): 2 vars

### Danh sách phẳng (để paste vào CI/CD secret manager):
```
# Auth → Notification
GATEWAY_NOTIFICATION_HOST
GATEWAY_NOTIFICATION_PORT
GATEWAY_NOTIFICATION_PROTO_PATH
GATEWAY_NOTIFICATION_TLS

# Chat → Auth, Notification, Filesystem, AI, Learning (mỗi service 4 vars)
GATEWAY_AUTH_HOST
GATEWAY_AUTH_PORT
GATEWAY_AUTH_PROTO_PATH
GATEWAY_AUTH_TLS
GATEWAY_FILESYSTEM_HOST
GATEWAY_FILESYSTEM_PORT
GATEWAY_FILESYSTEM_PROTO_PATH
GATEWAY_FILESYSTEM_TLS
GATEWAY_AI_HOST
GATEWAY_AI_PORT
GATEWAY_AI_PROTO_PATH
GATEWAY_AI_TLS
GATEWAY_LEARNING_HOST
GATEWAY_LEARNING_PORT
GATEWAY_LEARNING_PROTO_PATH
GATEWAY_LEARNING_TLS
GATEWAY_CHAT_HOST
GATEWAY_CHAT_PORT
GATEWAY_CHAT_PROTO_PATH
GATEWAY_CHAT_TLS

# Chat cache config
USER_CACHE_ENABLED
USER_CACHE_TTL_SECONDS
USER_CACHE_MAX_SIZE
REDIS_USER_CACHE_TTL_SECONDS
REDIS_USER_CACHE_PREFIX
ATTACHMENT_CACHE_TTL_SECONDS
ROOM_CACHE_TTL_SECONDS

# Notification cache config
FCM_TOKEN_CACHE_TTL_SECONDS
FCM_TOKEN_CACHE_MAX_SIZE
```

> Mỗi service chỉ cần subset env vars tương ứng (xem section 2 cho chi tiết per-service).

---

## 6. Env vars có thể DEPRECATE/REMOVE

| Var | File | Lý do | Khi nào xoá |
|---|---|---|---|
| `GATEWAY_URL` | `apps/auth/.env.example` | Chỉ dùng cho axios call `/api/notifications/send-otp`. Sau gRPC migration không cần. | Sau khi auth chuyển hoàn toàn sang gRPC OTP + verify production stable 1-2 tuần |
| `GATEWAY_URL` | `apps/chat/.env.example` | Hiện chưa thấy code dùng — có thể là legacy | Verify code không reference, xoá luôn |
| `KAFKA_*` (1 số) | `apps/notification/.env.example` | Nếu chuyển từ Kafka FCM events sang gRPC sync. | **KHÔNG xoá** — Kafka vẫn dùng cho async events khác |

> **Nguyên tắc**: KHÔNG xoá env var ngay khi refactor. Đợi 1-2 sprint stable rồi mới xoá để có cơ chế rollback an toàn.

---

## 7. Verification Plan cho Env Migration

### Cho mỗi service sau khi cập nhật env:
- [ ] Service start được không lỗi `Cannot read property of undefined`
- [ ] gRPC client config được load đúng (log ra host/port khi bootstrap)
- [ ] Kết nối gRPC tới downstream service thành công (kiểm tra `nestjs/microservices` connection log)
- [ ] Health check endpoint trả 200

### Cho docker-compose:
- [ ] `docker-compose up --build` không error
- [ ] Container resolve được hostname (vd: `nslookup auth` trong container chat trả về IP)
- [ ] Mỗi service log "gRPC client connected to X" cho mỗi downstream cần gọi

### Cho production deploy:
- [ ] Tất cả CI/CD pipeline pass với env vars mới
- [ ] Smoke test các flow chính (OTP login, send message, mở document, push notification) — verify gRPC call không timeout
- [ ] Monitoring: kiểm tra gRPC client metrics (success rate, latency) — không có error spike

---

## 8. Recommended Order

Đồng bộ với order trong [`DATABASE_ISOLATION_PLAN.md`](./DATABASE_ISOLATION_PLAN.md):

1. **Phase 1 (infra)**: `mongodb-learning` đã có sẵn ✅. Verify docker compose volume + container learning service nếu chưa.
2. **Phase 4 proto + env**: Cập nhật `.env.example` cho tất cả service trước. Generate gRPC client modules.
3. **Phase 2a (notification)**: Thêm env `GATEWAY_AUTH_*` vào notification. Test FCM token call.
4. **Phase 2a' (auth)**: Thêm env `GATEWAY_NOTIFICATION_*` vào auth. Test OTP gRPC.
5. **Phase 2b-2e**: Mỗi service refactor → cập nhật env tương ứng.
6. **Cleanup**: Sau 1-2 sprint stable → deprecate `GATEWAY_URL` cũ.

---

## 9. Mapping summary table (per service)

| Service | New env vars count | Cache vars? | Deprecated vars |
|---|---|---|---|
| `auth` | 4 (notification client) | 0 | `GATEWAY_URL` (sau refactor) |
| `chat` | 20 (5 services × 4 vars) | 7 | `GATEWAY_URL` (verify) |
| `notification` | 4 (auth client) + 3 (HOST/PORT/PROTO_URL nếu thiếu) | 2 (FCM cache) | 0 |
| `filesystem` | 8 (auth + chat × 4 vars) | 0 | 0 |
| `ai` | 8 (auth + chat × 4 vars) | 0 | 0 |
| `learning` | 4 (auth client) | 0 | 0 |
| `api-gateway` | 8 (ai + learning × 4 vars — nếu thiếu) | 0 | 0 |
| `socket` | 4 (auth, optional) | 0 | 0 |
| **Total** | **~60 env vars mới** | **~9 cache vars** | **1-2 deprecated** |
