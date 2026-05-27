# Kế hoạch tách Database riêng cho mỗi Microservice

## Tổng quan

Project hiện tại là một NestJS Monorepo với **9 microservice**. Docker Compose đã định nghĩa 5 MongoDB instances riêng (auth, chat, filesystem, notification, ai), nhưng **source code vẫn còn nhiều vấn đề về database isolation** — đặc biệt là việc các service cross-read models của nhau trực tiếp qua Mongoose thay vì giao tiếp qua gRPC.

> **Định hướng chung (Giải pháp A — gRPC)**: Mọi cross-service data access đều thực hiện qua **synchronous gRPC call** đến service chủ sở hữu model. Không emit Kafka event để sync data, không duplicate dữ liệu sang DB khác. Service chủ sở hữu là **single source of truth**.

### Tài liệu liên quan
- 📄 [`CROSS_DB_LOOKUP_PLAN.md`](./CROSS_DB_LOOKUP_PLAN.md) — chi tiết refactor pipeline có `$lookup` cross-DB (phần phức tạp nhất)
- 📄 [`ENV_MIGRATION_PLAN.md`](./ENV_MIGRATION_PLAN.md) — env vars mới/deprecated cần thêm khi migration

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
| `Otp` | **notification** | auth (❌ cross-DB read/write — cần refactor) |
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

#### 🔴 CRITICAL: Auth service đọc/ghi Otp (thuộc notification DB)

**`auth/auth.service.ts`** dùng:
- `otpModel.create()` → lưu OTP code khi user request
- `otpModel.findOne()` + `otpModel.deleteOne()` → verify & xóa OTP sau khi dùng

→ `Otp` được xác định thuộc sở hữu của **notification** service (vì notification là service quản lý toàn bộ flow gửi/verify OTP). Auth cần được refactor để không truy cập trực tiếp `Otp` model nữa.

#### 🟡 WARNING: Learning service đọc User từ auth DB

**`learning/learning.module`** dùng:
- `userModel` → chưa rõ dùng để làm gì (cần kiểm tra service)

---

### 🔥 Vấn đề lớn: MongoDB `$lookup` cross-collection (Cross-DB join)

Khi mỗi service có MongoDB instance riêng, **mọi `$lookup` join sang collection ở DB khác sẽ không hoạt động** vì `$lookup` chỉ join trong cùng 1 database. Đây là phần phức tạp và rủi ro nhất của migration này.

**Phạm vi ảnh hưởng** (chi tiết xem [`CROSS_DB_LOOKUP_PLAN.md`](./CROSS_DB_LOOKUP_PLAN.md)):

- `apps/chat/src/handle-chat/Pipeline/getMsg.ts` — 3 function (`buildMessageCorePipeline`, `buildMessageDetailPipeline`, `buildMessagesDetailPipeline`) + 1 helper `roomEventLookupStages` đều có cross-DB lookup
- `apps/chat/src/rooms/rooms.service.ts` — 3 stage `Rooms → Users`
- `apps/chat/src/social/aggregates/` — **7 pipeline** đều cross-DB:
  - `getFriends.ts`: 5 function (`getFriendsBaseAggregate`, `getFriendsAggregate`, `getFriendsRequestAggregate`, `searchUsersAggregate`, `getBlockedFriendsAggregate`)
  - `getFriendSuggestions.ts`: `getFriendSuggestionsAggregate` (5 lookup nested)
  - `contacts.ts`: `buildContactsPipeline`
- `apps/filesystem/src/documents/documents.service.ts` — `Documents → Users`, `Documents → Rooms` trong helper `getPopulateDocsPipeline`

**Định hướng**: Refactor sang **application-level join** — pipeline chỉ aggregate trong DB owner, sau đó batch gRPC `GetXxxByIds(ids[])` để hydrate ở app layer.

> 📄 **Xem chi tiết tại [`CROSS_DB_LOOKUP_PLAN.md`](./CROSS_DB_LOOKUP_PLAN.md)** — bao gồm inventory đầy đủ, pseudocode refactor cho từng pipeline, caching strategy 2 tầng, proto methods cần thêm, và verification plan.

---

## Proposed Changes

### Phase 1: Infrastructure (Docker Compose)

#### [MODIFY] docker-compose.yml
- Thêm `mongodb-learning` container (port 27022)
- Thêm `mongodb_learning_data` volume

---

### Phase 2: Xác nhận DB isolation trong source code

#### 🔧 Auth Service — DB: `mongodb-auth`

**Models owned**: `User`, `Key`

**Vấn đề hiện tại**:
- Đang dùng `otpModel` (thuộc notification DB) để tạo/verify/xóa OTP trong `auth.service.ts`
- Đang gọi `axios.post(${gatewayUrl}/api/notifications/send-otp)` — REST round-trip qua gateway

**Giải pháp (gRPC)**:
- Thay axios REST call + direct `otpModel` access bằng gRPC client đến Notification service
- Auth inject `NotificationGrpcClient`, gọi 2 RPC:
  - `CreateOtp({ indicator, type, channel })` — notification tự generate code, lưu DB, gửi email
  - `VerifyOtp({ indicator, otp, type })` — notification check + xóa entry, trả về kết quả
- Auth không còn truy cập `otpModel`, không còn gọi gateway qua HTTP

**Files cần sửa**:
- `apps/auth/src/app.module.ts` — xóa `otpModel`, thêm `GrpcClientModule` cho notification
- `apps/auth/src/auth.service.ts` — xóa `@InjectModel('Otp')` + axios call, thay bằng gRPC client
- `apps/notification/src/app.module.ts` — thêm `otpModel`
- `apps/notification/src/notification.service.ts` — thêm methods `createOtp`, `verifyOtp`
- `apps/notification/src/notification.controller.ts` — expose `CreateOtp` / `VerifyOtp` qua `@GrpcMethod`
- `libs/grpc/notification.proto` — thêm RPC `CreateOtp` và `VerifyOtp`

---

#### 🔧 Chat Service — DB: `mongodb-chat`

**Models owned**: `Room`, `RoomEvent`, `RoomsState`, `RoomsUsersState`, `Message`, `MessageRead`, `MessageReaction`, `MessageHide`, `Friendship`, `CallHistory`

**Vấn đề hiện tại**:
- Đang đọc `userModel` từ auth DB
- Đang đọc `keysModel` từ auth DB (cho FCM push)
- `rooms.module.ts` và `handle-chat.module.ts` import `userModel`
- `social.module.ts` import `userModel`, `keysModel`

**Giải pháp (gRPC)**:
- Tạo gRPC client đến Auth service để lấy user info (`GetUserById`, `GetUsersByIds`)
- Di chuyển FCM push notification ra khỏi `social.service`: thay vì chat tự đọc FCM tokens + tự push, chat gọi gRPC `PushNotification` của Notification service (notification tự gọi gRPC `GetFcmTokensByUserId` đến Auth khi cần)
- Xóa `userModel`, `keysModel` khỏi chat service

**Files cần sửa**:
- `apps/chat/src/rooms/rooms.module.ts` — xóa `userModel`, inject gRPC auth client
- `apps/chat/src/rooms/rooms.service.ts` — bỏ các stage `$lookup → Users` trong pipeline; sau aggregate gom userIds + batch `authGrpcClient.GetUsersByIds()` → merge ở app layer
- `apps/chat/src/social/social.module.ts` — xóa `userModel`, `keysModel`, inject gRPC auth + notification clients
- `apps/chat/src/social/social.service.ts` — **đảo chiều toàn bộ 8 pipeline**: đổi `this.userModel.aggregate()` sang `this.friendshipModel.aggregate()` hoặc `.find()`, sau đó batch `GetUsersByIds` để hydrate; push qua notification gRPC
- `apps/chat/src/social/aggregates/getFriends.ts` — refactor 5 function (`getFriendsBaseAggregate`, `getFriendsAggregate`, `getFriendsRequestAggregate`, `searchUsersAggregate`, `getBlockedFriendsAggregate`) sang entry point Friendship
- `apps/chat/src/social/aggregates/getFriendSuggestions.ts` — refactor `getFriendSuggestionsAggregate` (5 nested lookup) sang Friendship-first
- `apps/chat/src/social/aggregates/contacts.ts` — refactor `buildContactsPipeline` dùng `ListUsers` gRPC + Friendship status map
- `apps/chat/src/handle-chat/handle-chat.module.ts` — xóa `userModel`, inject gRPC auth client + filesystem + ai + learning gRPC clients
- `apps/chat/src/handle-chat/handle-chat.service.ts` — thay `this.userModel` bằng gRPC
- `apps/chat/src/handle-chat/Pipeline/getMsg.ts` — **refactor lớn nhất**:
  - Xoá tất cả stage `$lookup → Users` (sender, reply_sender, reactions.user, reads.user, roomEvent actors/targets)
  - Xoá `$lookup → Attachments` (chuyển sang gRPC filesystem)
  - Xoá `$lookup → aiembeddings` (chuyển sang gRPC ai)
  - Xoá `$lookup → Quizzes / Flashcards / TodoProjects` (chuyển sang gRPC learning)
  - **Tiện thể fix 2 bug** phát hiện khi audit: (a) `buildMessageCorePipeline` lookup Flashcards/TodoProjects bị lặp 3 lần vô ích; (b) `buildMessageDetailPipeline` + `buildMessagesDetailPipeline` thiếu lookup Flashcards/TodoProjects mặc dù `$project` có dùng — cần verify behavior.
  - Sau aggregate: gom IDs từ tất cả các trường, batch gRPC calls song song (`Promise.all`), merge bằng `Map` ở app layer
  - Áp dụng cho cả 3 function: `buildMessageCorePipeline`, `buildMessageDetailPipeline`, `buildMessagesDetailPipeline` + helper `roomEventLookupStages`

---

#### 🔧 Filesystem Service — DB: `mongodb-filesystem`

**Models owned**: `Attachment`, `Document`

**Vấn đề hiện tại**:
- Đang dùng `userModel`, `messagesModel`, `roomModel` (thuộc auth/chat DB)

**Giải pháp (gRPC)**:
- Xóa `userModel`, `messagesModel`, `roomModel` khỏi filesystem
- Gọi gRPC `chatGrpcClient.GetRoomById()` / `GetMessagesByRoomId()` khi cần room/message info
- Gọi gRPC `authGrpcClient.GetUserById()` khi cần user info

**Files cần sửa**:
- `apps/filesystem/src/app.module.ts` — xóa userModel, messagesModel, roomModel, inject gRPC clients (auth + chat)
- `apps/filesystem/src/documents/documents.module.ts` — xóa Room, inject gRPC chat client
- `apps/filesystem/src/filesystem.service.ts` — refactor: dùng gRPC calls thay direct query
- `apps/filesystem/src/documents/documents.service.ts` — **refactor pipeline**: xoá stage `$lookup → Users` (owner_info + combined_shared.user_info) và `$lookup → Rooms` (room_infos); sau aggregate gom ownerIds/sharedUserIds/roomIds → batch `authGrpcClient.GetUsersByIds()` + `chatGrpcClient.GetRoomsByIds()` → merge ở app layer

---

#### 🔧 Notification Service — DB: `mongodb-notification`

**Models owned**: `Notification`, `Otp`

**Vấn đề hiện tại**:
- Đang dùng `keysModel` (thuộc auth DB) để lấy FCM tokens
- Chưa quản lý `otpModel` mặc dù đây là service chủ sở hữu — hiện auth đang tự lưu/verify OTP

**Giải pháp (gRPC)**:
- **FCM tokens**: Xóa `keysModel` khỏi notification. Khi cần push, notification gọi gRPC `authGrpcClient.GetFcmTokensByUserId(userId)` đến Auth — Auth vẫn là single source of truth của FCM tokens.
- **OTP**: Đưa `otpModel` về notification service. Expose 2 gRPC methods cho auth dùng:
  - `CreateOtp({ indicator, type, channel })` → generate code, lưu DB, gửi email/SMS
  - `VerifyOtp({ indicator, otp, type })` → check + xóa entry sau khi verify

**Files cần sửa**:
- `apps/notification/src/app.module.ts` — xóa `keysModel`, thêm `otpModel`, inject gRPC auth client
- `apps/notification/src/notification.service.ts` — refactor lấy FCM tokens qua gRPC + thêm `createOtp`, `verifyOtp`
- `apps/notification/src/notification.controller.ts` — expose RPC `CreateOtp`, `VerifyOtp`

---

#### 🔧 AI Service — DB: `mongodb-ai`

**Models owned**: `AIEmbedding`, `AIUsageLogs`

**Vấn đề hiện tại**:
- Đang dùng `Userschema`, `MessageSchema` (thuộc auth/chat DB)

**Giải pháp (gRPC)**:
- Khi cần user info → gọi `authGrpcClient.GetUserById()`
- Khi cần message history → gọi `chatGrpcClient.GetMessagesByRoomId()`
- Xóa `Userschema`, `MessageSchema` khỏi AI service

**Files cần sửa**:
- `apps/ai/src/app.module.ts` — xóa `userModel`, `MessageSchema`, inject gRPC clients (auth + chat)
- `apps/ai/src/embedding.service.ts` — refactor: dùng gRPC calls thay direct query

---

#### 🔧 Learning Service — DB: `mongodb-learning` [NEW DB]

**Models owned**: `Quiz`, `Flashcard`, `FlashcardDeck`, `FlashcardProgress`, `Todo`, `TodoProject`

**Vấn đề hiện tại**:
- Đang dùng `userModel` (thuộc auth DB)

**Giải pháp (gRPC)**:
- Xóa `userModel` khỏi learning module
- Gọi `authGrpcClient.GetUserById()` / `GetUsersByIds()` khi cần user info

**Files cần sửa**:
- `apps/learning/src/learning/learning.module.ts` — xóa `userModel`, inject gRPC auth client
- Kiểm tra service files xem dùng userModel để làm gì và refactor sang gRPC

---

### Phase 3: Libs DB — Tách model theo service

Hiện tại tất cả models nằm trong `libs/db/src/mongo/model/`. Sau khi tách, cần tổ chức lại:

**Đề xuất cấu trúc mới** (không xóa shared models, chỉ tổ chức):

```
libs/db/src/mongo/
├── model/                    # Giữ nguyên (backward compatible)
│   ├── user.model.ts         → owned by auth
│   ├── otp.model.ts          → owned by notification
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

> **Nguyên tắc**: Tất cả method dùng để **hydrate cross-DB join** đều phải có dạng **batch** (`GetXxxByIds`) để tránh N+1 gRPC call khi pipeline trả về nhiều documents.

#### [MODIFY] libs/grpc/auth.proto
- `GetUserById(userId) → User` — single lookup
- `GetUsersByIds(userIds[]) → User[]` — **batch hydrate** cho mọi pipeline message/room/social (cực kỳ quan trọng cho `getMsg`)
- `SearchUsers(query, page, limit, excludeUserId) → User[]` — cho `searchUsersAggregate` (chat social)
- `ListUsers(page, limit, excludeUserId) → User[]` — cho `buildContactsPipeline` (danh bạ)
- `GetFcmTokensByUserId(userId) → string[]` — phục vụ notification lấy FCM tokens khi push
- `GetFcmTokensByUserIds(userIds[]) → Map<userId, string[]>` — batch push (nhiều user 1 lần)

#### [MODIFY] libs/grpc/chat.proto
- `GetRoomById(roomId) → Room` — single lookup
- `GetRoomsByIds(roomIds[]) → Room[]` — **batch** cho filesystem hydrate document.roomIds
- `GetMessagesByRoomId(roomId, limit, offset) → Message[]` — phục vụ filesystem/ai
- `GetFriendsOfUser(userId) → Friendship[]` — phục vụ social pipeline đảo chiều

#### [MODIFY] libs/grpc/filesystem.proto
- `GetAttachmentsByIds(attachmentIds[]) → Attachment[]` — **batch** cho chat hydrate `message.attachment_ids`
- `GetDocumentsByIds(documentIds[]) → Document[]` — nếu chat cần
- (vẫn giữ các method hiện có)

#### [MODIFY] libs/grpc/ai.proto
- `GetEmbeddingsByContextIds(contextIds[]) → AIEmbedding[]` — **batch** cho chat/filesystem hydrate AI embedding cho attachments

#### [MODIFY] libs/grpc/learning.proto / quizz.proto / flashcard.proto / todo.proto
- `GetQuizzesByIds(quizIds[]) → Quiz[]` — **batch** cho chat hydrate `message.quiz_id`
- `GetFlashcardsByIds(flashcardIds[]) → Flashcard[]` — **batch** cho chat hydrate `message.flashcard_id`
- `GetTodoProjectsByIds(todoProjectIds[]) → TodoProject[]` — **batch** cho chat hydrate `message.todo_project_id`

#### [MODIFY] libs/grpc/notification.proto
- `CreateOtp({ indicator, type, channel }) → { success }` — phục vụ auth: tạo OTP + lưu DB + gửi email/SMS
- `VerifyOtp({ indicator, otp, type }) → { valid, accessToken? }` — phục vụ auth: verify + xóa entry
- `PushNotification({ userId, title, content, data })` — phục vụ chat gọi push (notification sẽ tự lấy FCM tokens qua gRPC sang auth)

---

## Verification Plan

### Phase 1 - Docker Compose
- [x] Docker Compose có `mongodb-learning` + volume `mongodb_learning_data`
- [ ] Verify 6 MongoDB instances chạy độc lập

### Phase 2 - Source Code
- [x] Code refactor cross-DB: dùng gRPC batch hydrate thay vì inject model cross-DB (auth OTP, notification FCM, chat `hydrateMessages`)
- [ ] Unit test cho các service đã refactor
- [ ] Integration test: chat → `authGrpcClient.GetUsersByIds` (batch) → trả về đúng user info
- [ ] Integration test: notification → `authGrpcClient.GetFcmTokensByUserId` → lấy FCM tokens thành công
- [ ] Integration test: auth → `notificationGrpcClient.CreateOtp` / `VerifyOtp` → OTP flow đầy đủ
- [x] **Pipeline (code) chuẩn bị**: `apps/chat/src/handle-chat/Pipeline/getMsg.ts` có `hydrateMessages()` với batch gRPC cho user/attachments/embeddings/learning docs
- [ ] **Performance test**: đo latency `getMsg` trước/sau refactor — không tăng quá 2x (mục tiêu: tăng <50% nhờ batch + cache)
- [ ] Verify N+1: với 1 request `getMsg`, monitoring chỉ thấy 1 gRPC call mỗi service đích (không có N call lặp lại)

### Manual Verification
- [ ] Test login flow OTP: request OTP → email nhận → verify OK (toàn bộ qua gRPC, không còn axios call gateway)
- [ ] Test send friend request → push notification hoạt động (chat → notification gRPC → auth gRPC lấy FCM)
- [ ] Test mở phòng chat (load 50 messages mới nhất) → render đầy đủ sender, reaction users, read receipts
- [ ] Test reply message → reply_sender hiển thị đúng
- [ ] Test message có attachment + AI embedding → load đầy đủ thông tin
- [ ] Test message gắn quiz/flashcard/todo → load đầy đủ
- [ ] Test send message → AI embedding hoạt động (ai → chat gRPC lấy messages)
- [ ] Test upload file → filesystem ghi vào đúng DB; mở document → owner & shared users hiện đúng
- [ ] Test list bạn bè / gợi ý kết bạn / contacts → user info đầy đủ (social aggregates đã đảo chiều)
- [ ] Test quiz/flashcard/todo → learning service hoạt động với DB riêng

---

## Ưu tiên thực hiện (Recommended Order)

1. ✅ **Phase 1**: Thêm `mongodb-learning` vào docker-compose (dễ, không breaking)
2. 🔌 **Phase 4 (sớm)**: Thêm proto methods trước cho tất cả service — đặc biệt các method **batch `GetXxxByIds`** cần thiết cho aggregate hydration. Generate client/types xong sẽ thuận lợi cho mọi phase refactor sau.
3. 🔧 **Phase 2a**: Tách Notification service (bỏ `keysModel`, gọi `auth.GetFcmTokensByUserId` qua gRPC; đưa `otpModel` về notification + expose RPC `CreateOtp`/`VerifyOtp`)
4. 🔧 **Phase 2a'**: Refactor Auth service bỏ `otpModel` + bỏ axios call gateway, gọi gRPC sang notification
5. 🔧 **Phase 2b**: Tách Learning service (bỏ `userModel`, gọi gRPC auth) — pipeline đơn giản
6. 🔧 **Phase 2c**: Tách AI service (bỏ User + Message models, gọi gRPC auth + chat)
7. 🔧 **Phase 2d**: Tách Filesystem service — **bao gồm refactor pipeline `documents.service.ts`** (xoá `$lookup → Users`, `$lookup → Rooms`, hydrate sau aggregate)
8. 🔧 **Phase 2e**: Tách Chat service — **phức tạp nhất, chia 2 sub-phase**:
   - **2e.1**: Refactor `social/` aggregates (đảo chiều pipeline: User-first → Friendship-first + hydrate)
   - **2e.2**: Refactor `rooms.service.ts` pipeline (xoá lookup → Users, hydrate sau)
   - **2e.3**: Refactor `handle-chat/Pipeline/getMsg.ts` (3 biến thể) — bỏ lookup cross-DB sang auth/filesystem/ai/learning, batch gRPC hydrate. Đây là file ảnh hưởng performance nhất → cần benchmark trước/sau.
9. 📝 **Phase 3**: Tổ chức lại libs (optional — chỉ là re-organize, không breaking)
