# Kế hoạch tách Database riêng cho mỗi Microservice

## Tổng quan

Project hiện tại là một NestJS Monorepo với **9 microservice**. Docker Compose đã định nghĩa 5 MongoDB instances riêng (auth, chat, filesystem, notification, ai), nhưng **source code vẫn còn nhiều vấn đề về database isolation** — đặc biệt là việc các service cross-read models của nhau trực tiếp qua Mongoose thay vì giao tiếp qua gRPC/Kafka.

---

## Hiện trạng phân tích

### Sơ đồ Services & Ports

| Service | Port | DB hiện tại (env) | DB Instance (Docker) |
|---------|------|-------------------|----------------------|
| `api-gateway` | 5000 | ❌ Không có DB | ❌ |
| `auth` | 5001 | `mongodb-auth:27017` / DB=`auth` | ✅ mongodb-auth |
| `filesystem` | 5002 | `mongodb-filesystem:27017` / DB=`filesystem` | ✅ mongodb-filesystem |
| `chat` | 5003 | `mongodb-chat:27017` / DB=`chat` | ✅ mongodb-chat |
| `notification` | 5005 | `mongodb-notification:27017` / DB=`notification` | ✅ mongodb-notification |
| `ai` | 5006 | `mongodb-ai:27017` / DB=`ai` | ✅ mongodb-ai |
| `learning` | 5007 | `mongodb-learning:27017` / DB=`learning` | ❌ **Thiếu trong docker-compose** |
| `sfu` | - | ❌ Không có DB | ❌ |
| `socket` | - | ❌ Không có DB | ❌ |

---

### Models và service chủ sở hữu

| Model | Service Owner (đề xuất) | Hiện tại dùng ở |
|-------|------------------------|--------------------|
| `User` | **auth** | auth, chat (social, rooms, handle-chat), ai, filesystem, learning |
| `Otp` | **auth** | auth |
| `Key` (JWT tokens, FCM) | **auth** | auth, chat (social), notification |
| `Room` | **chat** | chat (rooms, social), filesystem (documents) |
| `RoomEvent` | **chat** | chat (rooms) |
| `RoomsState` | **chat** | chat (rooms) |
| `RoomsUsersState` | **chat** | chat (rooms) |
| `Message` | **chat** | chat (rooms), filesystem, ai |
| `MessageRead` | **chat** | chat (rooms) |
| `MessageReaction` | **chat** | chat (rooms) |
| `MessageHide` | **chat** | chat (rooms) |
| `Friendship` | **chat** | chat (social) |
| `CallHistory` | **chat** | chat (handle-chat) |
| `Attachment` | **filesystem** | filesystem, chat (rooms) |
| `Document` | **filesystem** | filesystem (documents) |
| `Notification` | **notification** | notification |
| `AIEmbedding` | **ai** | ai |
| `AIUsageLogs` | **ai** | ai |
| `Quiz` | **learning** | learning |
| `Flashcard`, `FlashcardDeck`, `FlashcardProgress` | **learning** | learning |
| `Todo`, `TodoProject` | **learning** | learning |

---

### Vấn đề Cross-Service Database Access (Vi phạm isolation)

#### 🔴 CRITICAL: Chat service đọc User, Key từ auth DB

**`chat/social` module** dùng:
- `userModel` → đọc trực tiếp user data (tên, avatar, usr_id)
- `keysModel` → đọc FCM tokens để gửi push notification

**`chat/rooms` module** dùng:
- `userModel` → kiểm tra member info khi tạo phòng

**`chat/handle-chat` module** dùng:
- `userModel` → lấy thông tin user khi xử lý chat events

#### 🔴 CRITICAL: Filesystem service đọc User, Message, Room từ chat/auth DB

**`filesystem` app.module** dùng:
- `userModel`, `messagesModel`, `roomModel`, `attachmentModel`

#### 🔴 CRITICAL: AI service đọc User, Message từ auth/chat DB

**`ai` app.module** dùng:
- `Userschema` → đọc user data
- `MessageSchema` → đọc message history để generate embedding

#### 🟡 WARNING: Notification service đọc Key từ auth DB

**`notification` app.module** dùng:
- `keysModel` → đọc FCM tokens để push notification

#### 🟡 WARNING: Learning service đọc User từ auth DB

**`learning/learning.module`** dùng:
- `userModel` → chưa rõ dùng để làm gì (cần kiểm tra service)

---

## Proposed Changes

### Phase 1: Infrastructure (Docker Compose)

#### [MODIFY] docker-compose.yml
- Thêm `mongodb-learning` container (port 27022)
- Thêm `mongodb_learning_data` volume

---

### Phase 2: Xác nhận DB isolation trong source code

#### 🔧 Auth Service — DB: `mongodb-auth`

**Models owned**: `User`, `Otp`, `Key`

**Hiện trạng**: ✅ Đã isolation tốt — chỉ dùng models của riêng mình.

**File cần sửa**: Không có thay đổi về models.

---

#### 🔧 Chat Service — DB: `mongodb-chat`

**Models owned**: `Room`, `RoomEvent`, `RoomsState`, `RoomsUsersState`, `Message`, `MessageRead`, `MessageReaction`, `MessageHide`, `Friendship`, `CallHistory`

**Vấn đề hiện tại**:
- Đang đọc `userModel` từ auth DB
- Đang đọc `keysModel` từ auth DB (cho FCM push)
- `rooms.module.ts` và `handle-chat.module.ts` import `userModel`
- `social.module.ts` import `userModel`, `keysModel`

**Giải pháp (Hướng A - gRPC)**:
- Tạo gRPC client đến Auth service để lấy user info
- Di chuyển FCM push notification ra khỏi social.service → emit Kafka event đến notification service
- Xóa `userModel`, `keysModel` khỏi chat service

**Files cần sửa**:
- `apps/chat/src/rooms/rooms.module.ts` — xóa `userModel`
- `apps/chat/src/rooms/rooms.service.ts` — thay `this.userModel.find()` bằng gRPC call
- `apps/chat/src/social/social.module.ts` — xóa `userModel`, `keysModel`
- `apps/chat/src/social/social.service.ts` — refactor dùng gRPC, emit Kafka thay vì direct DB read
- `apps/chat/src/handle-chat/handle-chat.module.ts` — (kiểm tra `userModel`)
- `apps/chat/src/handle-chat/handle-chat.service.ts` — thay `this.userModel` bằng gRPC call

---

#### 🔧 Filesystem Service — DB: `mongodb-filesystem`

**Models owned**: `Attachment`, `Document`

**Vấn đề hiện tại**:
- Đang dùng `userModel`, `messagesModel`, `roomModel` (thuộc auth/chat DB)

**Giải pháp**:
- Xóa `userModel`, `messagesModel`, `roomModel` khỏi filesystem
- Gọi gRPC đến Chat service để lấy room/message info khi cần
- Gọi gRPC đến Auth service để lấy user info khi cần

**Files cần sửa**:
- `apps/filesystem/src/app.module.ts` — xóa userModel, messagesModel, roomModel
- `apps/filesystem/src/documents/documents.module.ts` — xóa Room
- `apps/filesystem/src/filesystem.service.ts` — refactor gRPC calls
- `apps/filesystem/src/documents/documents.service.ts` — refactor gRPC calls

---

#### 🔧 Notification Service — DB: `mongodb-notification`

**Models owned**: `Notification`

**Vấn đề hiện tại**:
- Đang dùng `keysModel` (thuộc auth DB) để lấy FCM tokens

**Giải pháp**:
- Khi auth service tạo/update FCM token (Key) → emit Kafka event
- Notification service subscribe event → lưu FCM token vào local collection `DeviceToken`
- HOẶC: Notification service gọi gRPC đến Auth để lấy FCM tokens khi cần push

**Files cần sửa**:
- `apps/notification/src/app.module.ts` — xóa `keysModel`, thêm local DeviceToken model
- `apps/notification/src/notification.service.ts` — refactor

---

#### 🔧 AI Service — DB: `mongodb-ai`

**Models owned**: `AIEmbedding`, `AIUsageLogs`

**Vấn đề hiện tại**:
- Đang dùng `Userschema`, `MessageSchema` (thuộc auth/chat DB)

**Giải pháp**:
- Khi cần user info → gRPC call đến Auth service
- Khi cần message history → gRPC call đến Chat service (đã có Kafka client)
- Xóa `Userschema`, `MessageSchema` khỏi AI service

**Files cần sửa**:
- `apps/ai/src/app.module.ts` — xóa userModel, MessageSchema
- `apps/ai/src/embedding.service.ts` — refactor gRPC/Kafka calls

---

#### 🔧 Learning Service — DB: `mongodb-learning` [NEW DB]

**Models owned**: `Quiz`, `Flashcard`, `FlashcardDeck`, `FlashcardProgress`, `Todo`, `TodoProject`

**Vấn đề hiện tại**:
- Đang dùng `userModel` (thuộc auth DB)

**Giải pháp**:
- Xóa `userModel` khỏi learning module
- Gọi gRPC đến Auth service khi cần user info

**Files cần sửa**:
- `apps/learning/src/learning/learning.module.ts` — xóa `userModel`
- Kiểm tra service files xem dùng userModel để làm gì

---

### Phase 3: Libs DB — Tách model theo service

Hiện tại tất cả models nằm trong `libs/db/src/mongo/model/`. Sau khi tách, cần tổ chức lại:

**Đề xuất cấu trúc mới** (không xóa shared models, chỉ tổ chức):

```
libs/db/src/mongo/
├── model/                    # Giữ nguyên (backward compatible)
│   ├── user.model.ts         → owned by auth
│   ├── otp.model.ts          → owned by auth
│   ├── keys.model.ts         → owned by auth
│   ├── room.model.ts         → owned by chat
│   ├── messages.model.ts     → owned by chat
│   ├── friendship.model.ts   → owned by chat
│   ├── ...
│   ├── notification.model.ts → owned by notification
│   ├── AIEmbedding.model.ts  → owned by ai
│   └── ...
```

> **Note**: Models vẫn để trong shared lib nhưng mỗi service chỉ import models của mình. Việc tổ chức lại thành sub-folders là optional.

---

### Phase 4: Proto files — Thêm gRPC methods cần thiết

#### [MODIFY] libs/grpc/auth.proto
- Thêm `GetUserById(userId)` nếu chưa có
- Thêm `GetFcmTokensByUserId(userId)` để chat/notification lấy FCM tokens

#### [MODIFY] libs/grpc/chat.proto
- Thêm `GetMessagesByRoomId(roomId, limit, offset)` để filesystem/ai lấy messages
- Thêm `GetRoomById(roomId)` để filesystem lấy room info

---

## Verification Plan

### Phase 1 - Docker Compose
- [ ] Chạy `docker-compose up mongodb-learning` thành công
- [ ] Verify 6 MongoDB instances chạy độc lập

### Phase 2 - Source Code
- [ ] Chạy từng service riêng lẻ — không bị lỗi inject model
- [ ] Unit test cho các service đã refactor
- [ ] Integration test: chat service → auth gRPC → lấy user info thành công
- [ ] Integration test: notification service → không cần keysModel

### Manual Verification
- [ ] Test send friend request → push notification hoạt động
- [ ] Test send message → AI embedding hoạt động
- [ ] Test upload file → filesystem ghi vào đúng DB
- [ ] Test quiz/flashcard/todo → learning service hoạt động với DB riêng

---

## Ưu tiên thực hiện (Recommended Order)

1. ✅ **Phase 1**: Thêm `mongodb-learning` vào docker-compose (dễ, không breaking)
2. 🔧 **Phase 2a**: Tách Notification service (đơn giản nhất — chỉ cần bỏ keysModel)
3. 🔧 **Phase 2b**: Tách Learning service (bỏ userModel)
4. 🔧 **Phase 2c**: Tách AI service (bỏ User + Message models)
5. 🔧 **Phase 2d**: Tách Filesystem service (phức tạp hơn)
6. 🔧 **Phase 2e**: Tách Chat service (phức tạp nhất — cần gRPC auth calls)
7. 📝 **Phase 3**: Refactor libs nếu cần
8. 🔌 **Phase 4**: Thêm proto methods cần thiết
