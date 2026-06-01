# Sprint 0 - Shared Guardrail

## Goal

Dong khung ky thuat de cac sprint service tach DB khong lam vo build/runtime. Sprint nay chua doi behavior nghiep vu va chua cutover `DB_NAME`; muc tieu la lam ro ownership, module boundary, CI check, env convention va smoke test baseline.

Khong tu them model/modal/bang/collection moi trong sprint nay. Neu can du lieu cua service khac thi chi ghi contract API gateway -> service owner vao docs, khong them cache collection de workaround, khong query Mongo DB cua service khac, va khong goi direct gRPC cross-service de lay data.

## Shared ID Contract

- `_id` la MongoDB ObjectId cua document user trong auth `Users`.
- `usr_id` la business id cua user, luu tren `Users.usr_id`.
- `id` trong response da parse/unprefix tu auth, vi du `Utils.unprefix(..., 'usr_')`, la `usr_id`, khong phai Mongo `_id`.
- Auth la service duy nhat duoc resolve qua lai giua Mongo `_id` va `usr_id`.
- Moi contract noi bo co field `userId`/`userIds` mac dinh phai hieu la Mongo `_id`/Mongo `_id[]`, tru khi contract ghi ro field do la business id.
- Moi contract co field `usrId`/`usrIds` chi dung cho business id `usr_id` va thuong chi xuat hien o auth resolve/search/social flow.
- Neu service/gateway/socket chi co parsed `id` hoac `usr_id` ma can ghi vao field ObjectId, phai call API gateway den auth: `POST /internal/auth/users/resolve-business-ids`.
- User summary tu auth phai tra ca `_id` va `usr_id`; neu giu `id` de tuong thich public response thi document ro `id = usr_id`.
- Gateway protected context dung `req.user._id` lam actor Mongo `_id`; socket protected context dung `client.userId = payload._id` lam actor Mongo `_id`.
- Presence/public payload co the dung `usr_id` neu FE contract dang can, nhung khong duoc dung presence/public `id` thay Mongo `_id` cho domain write/call.
- FCM token contract dung Mongo `_id`: `Keys.tkn_userId`, Redis `USER_FCM_TOKENS(userId)`, va notification production `userIds` deu la Mongo `_id`.

## Scope

- `libs/db/src/mongo/mongo-connection.module.ts`
- `libs/db/src/mongo/mongodb.module.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/index.ts`
- `libs/db/src/mongo/model/*`
- Tat ca `apps/*/src/app.module.ts`
- Cac module con dang `MongooseModule.forFeature()`
- DTO/shared type dang import tu Mongo model.
- `.env.example`, `.env.development`, `.env.docker.example` neu co.
- `package.json` scripts.
- CI/lint/check script cho DB ownership.
- Sprint docs 1-7.

## Source Scan

Files can xu ly trong sprint nay:

- `docs/service-database-split-plan.md`
- `docs/service-database-sprints/*.md`
- `libs/db/src/mongo/mongo-connection.module.ts`
- `libs/db/src/mongo/mongodb.module.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/config/mongo.config.ts`
- `libs/db/src/index.ts`
- `apps/auth/src/app.module.ts`
- `apps/chat/src/app.module.ts`
- `apps/chat/src/rooms/rooms.module.ts`
- `apps/chat/src/social/social.module.ts`
- `apps/chat/src/handle-chat/handle-chat.module.ts`
- `apps/filesystem/src/app.module.ts`
- `apps/filesystem/src/documents/documents.module.ts`
- `apps/ai/src/app.module.ts`
- `apps/learning/src/app.module.ts`
- `apps/learning/src/learning/learning.module.ts`
- `apps/notification/src/app.module.ts`
- `apps/api-gateway/src/app.module.ts`
- `apps/socket/src/app.module.ts`
- `apps/sfu/src/app.module.ts`
- `libs/dto/src/*.ts`
- `libs/types/src/*.ts`
- `package.json`

## Current Findings

- `MongoConnectionModule` da duoc tach rieng va chi lam `MongooseModule.forRootAsync()`.
- `service-database.modules.ts` da co:
  - `AuthDatabaseModule`
  - `ChatDatabaseModule`
  - `FilesystemDatabaseModule`
  - `AiDatabaseModule`
  - `LearningDatabaseModule`
  - `NotificationDatabaseModule`
- `MongodbModule` legacy van ton tai va register gan nhu tat ca model; can giu tam thoi neu con app dung, nhung phai cam app moi import.
- `libs/db/src/index.ts` van export `MongodbModule` va `export * from './mongo/model'`, lam app rat de import model ngoai domain.
- `apps/auth/src/app.module.ts` da import `AuthDatabaseModule` nhung van register them `MongooseModule.forFeature([userModel, otpModel, keysModel])`.
- `apps/ai/src/app.module.ts` da import `AiDatabaseModule` nhung van register them `MongooseModule.forFeature()` voi AI model va legacy cross-service model.
- Mot so module con van register model truc tiep bang `MongooseModule.forFeature()`; can phan loai cai nao la owned, cai nao la legacy cross-service.
- `service-database.modules.ts` con legacy cross-service registrations:
  - chat: `userModel`, `keysModel`, `attachmentModel`, `documentModel`, `quizModel`, `todoProjectModel`.
  - filesystem: `userModel`, `roomModel`, `messagesModel`.
  - ai: `userModel`, `messagesModel`, `attachmentModel`, `documentModel`.
  - learning: `userModel`, `messagesModel`.
  - notification: `keysModel`.
- `api-gateway` va `socket` khong nen import Mongo model, nhung hien co `apps/api-gateway/src/learning/todo/gateway-todo.controller.ts` import type tu `libs/db/src/mongo/model/todo.model`.
- DTO/shared type co mot so import tu Mongo model, vi du `libs/dto/src/room.dto.ts` import `EventRoomType` tu room-events model. Can chuyen type shared sang `libs/dto`/`libs/types` de app khong phu thuoc Mongoose.
- Auth proto/response co ca `_id` va `id`; can document ro `User._id` la Mongo ObjectId, `User.id` la parsed `usr_id`.
- `apps/api-gateway/src/middlewares/auth.middleware.ts` gan JWT payload vao `req.user`; `payload._id` la actor Mongo `_id` can forward den service owner.
- `apps/socket/src/ws/ws-jwt.guard.ts` gan `client.userId = payload._id`; field nay phai dung cho domain command qua gateway.
- `apps/socket/src/ws/presence.service.ts` dang dung `usr_id` cho presence/status FE-facing; giu duoc nhung khong duoc dung presence `id` thay Mongo `_id` khi call owner service.
- `package.json` da co build scripts cho tung app va `build:all`.

## Ownership Matrix

| Service | Database | Owned collections/models | Edge/infra |
| --- | --- | --- | --- |
| `auth` | `appchat_auth` | `Users`, `Keys`, `Otps` | No |
| `chat` | `appchat_chat` | `Rooms`, `RoomEvents`, `RoomsState`, `RoomsUsersState`, `Messages`, `MessageReads`, `MessageHides`, `MessageReactions`, `Friendships`, `CallHistories` | No |
| `filesystem` | `appchat_filesystem` | `Attachments`, `Documents` | No |
| `ai` | `appchat_ai` | `AIEmbedding`, `AIUsageLogs` | No |
| `learning` | `appchat_learning` | `Quizzes`, `Flashcards`, `FlashcardDecks`, `FlashcardProgresses`, `Todos`, `TodoProjects` | No |
| `notification` | `appchat_notification` | `Notifications` | No |
| `api-gateway` | none | none | Yes |
| `socket` | none | none | Yes |
| `sfu` | none | none | Yes |

Note: `Otps` thuoc auth vi la state xac thuc identity. Notification chi deliver email/SMS/push, khong so huu OTP. Token thiet bi/Firebase token tiep tuc thuoc auth `Keys`; notification chi doc qua Redis hoac API gateway den auth.

ID note: auth `Users._id` la Mongo ObjectId, `Users.usr_id` la business id. Public/parsed `id` la `usr_id`. Cac service khac muon dung user id cho ObjectId field phai dung `_id`; neu chi co `usr_id`/parsed `id` thi resolve qua API gateway den auth truoc.

## Target Guardrail

- Moi app co DB chi import dung `*DatabaseModule` cua minh.
- App edge (`api-gateway`, `socket`, `sfu`) khong co Mongo dependency va khong co `DB_*` env.
- Model ngoai domain chi duoc giu trong `*DatabaseModule` neu co comment `Legacy cross-service reads` va co sprint owner de go bo.
- Khong app nao import `MongodbModule` legacy.
- Khong app nao import Mongo model ngoai ownership, ke ca type-only import.
- Shared DTO/type khong import tu `libs/db/src/mongo/model/*`.
- Khong service nao direct query DB cua service khac.
- Khong app service nao goi direct gRPC den service khac de lay data; neu can data ngoai domain thi call API gateway internal endpoint de gateway forward den owner service.
- Ngoai le hop le: `api-gateway` duoc goi gRPC/Kafka den owner services; `socket` duoc goi SFU RPC cho media plane, con domain data/command van di qua API gateway.
- Internal route convention: `/internal/<owner-service>/...`, co guard/secret, timeout, va request/response schema ro rang.
- ID contract phai dong nhat trong toan bo sprint docs: `_id` la Mongo ObjectId, parsed `id` la `usr_id`, `userIds` internal la Mongo `_id[]`, `usrIds` la business id `usr_id[]`.
- Env example co `DB_NAME` dung ownership cho service co DB.
- CI fail neu co import/model/env sai guardrail.
- `npm run build:all` xanh sau khi them guardrail.

## Tasks

### 1. Dong bang ownership matrix trong docs

1. Cap nhat `docs/service-database-split-plan.md` theo quyet dinh moi:
   - notification chi so huu `Notifications`.
   - khong them `NotificationDevices`/`PushTokens`.
   - token thiet bi nam o auth `Keys`, notification fallback qua Redis/API gateway.
2. Dam bao sprint 1-7 dung chung ownership matrix.
3. Moi sprint service phai co:
   - database target.
   - owned models.
   - list legacy coupling can go.
   - rule khong them model/modal/collection moi neu user da yeu cau.
   - rule can data service khac thi call API gateway den service owner.
   - rule ID: `_id` Mongo, `id` parsed la `usr_id`, can ObjectId thi resolve qua auth truoc.
4. Sprint docs phai khong de xuat tao bang/model/cache collection moi de workaround viec thieu data.

### 2. Chot DB module architecture

1. `MongoConnectionModule`:
   - chi `MongooseModule.forRootAsync()`.
   - khong `forFeature()`.
   - khong import model.
   - doc `DB_NAME` tu env service hien tai.
2. `service-database.modules.ts`:
   - moi service DB module chi register owned model + legacy model da ghi ro.
   - moi legacy model phai co comment ly do va sprint se go bo.
   - khong them legacy model moi neu khong co task migration ro.
3. `MongodbModule` legacy:
   - danh dau deprecated trong comment.
   - khong cho app import moi.
   - tao task xoa sau khi tat ca app chuyen sang `*DatabaseModule`.
4. `libs/db/src/index.ts`:
   - can nhac ngung `export * from './mongo/model'` trong phase sau.
   - trong Sprint 0, it nhat ghi guardrail: app service khong import model qua barrel neu ngoai ownership.

### 3. Don app module imports

1. Auth:
   - giu `AuthDatabaseModule`.
   - bo `MongooseModule.forFeature([userModel, otpModel, keysModel])` trung lap trong `apps/auth/src/app.module.ts`.
   - bo import truc tiep `userModel`, `otpModel`, `keysModel` khoi app module neu khong can.
2. AI:
   - giu `AiDatabaseModule`.
   - bo `MongooseModule.forFeature()` trung lap trong `apps/ai/src/app.module.ts`.
   - legacy models trong AI phai chi nam o `AiDatabaseModule` cho den sprint 1 go bo.
3. Chat:
   - app root dung `ChatDatabaseModule`.
   - module con nao `forFeature()` model owned thi ghi nhan; module con nao register model ngoai domain thi dua vao sprint 5.
4. Filesystem:
   - app root dung `FilesystemDatabaseModule`.
   - `DocumentsModule`/submodule chi register owned model neu co the; legacy `Room/User/Message` dua vao sprint 3.
5. Learning:
   - app root dung `LearningDatabaseModule`.
   - `LearningModule` con neu register `userModel` thi dua vao sprint 4.
6. Notification:
   - app root dung `NotificationDatabaseModule`.
   - `keysModel` chi duoc o legacy list cho den sprint 2 go bo.
7. Edge services:
   - `api-gateway`, `socket`, `sfu` khong import DB module.

### 4. Lap ledger legacy coupling

Tao bang trong docs hoac JSON/script config de theo doi tung legacy dependency:

| Service | Legacy model | File/module hien tai | Sprint go bo | Replacement |
| --- | --- | --- | --- | --- |
| `chat` | `User`, `Key` | `ChatDatabaseModule`, `RoomsModule`, `SocialModule`, services | Sprint 5 | API gateway -> auth |
| `chat` | `Attachment`, `Document` | `ChatDatabaseModule`, `HandleChatService`, message pipeline | Sprint 5 | API gateway -> filesystem |
| `chat` | `Quiz`, `TodoProject` | `ChatDatabaseModule`, `HandleChatService`, message pipeline | Sprint 5 | API gateway -> learning |
| `filesystem` | `User`, `Room`, `Message` | `FilesystemDatabaseModule`, `DocumentsModule`, services | Sprint 3 | API gateway -> auth/chat |
| `ai` | `User`, `Message`, `Attachment`, `Document` | `AiDatabaseModule`, `AIService`, `EmbeddingService` | Sprint 1 | Kafka payload/snapshot, API gateway -> owner if runtime lookup needed |
| `learning` | `User`, `Message` | `LearningDatabaseModule`, `LearningModule`, services | Sprint 4 | API gateway -> auth/chat |
| `notification` | `Key` | `NotificationDatabaseModule`, `FirebaseService` | Sprint 2 | Redis first, API gateway -> auth fallback |
| `api-gateway` | `TodoStatus`, `TodoPriority` type from Mongo model | `gateway-todo.controller.ts` | Sprint 7 | DTO/shared type |

Legacy ledger ID rule:

- `User` replacement qua auth phai ghi ro call nao dung Mongo `_id` (`users/batch`, `users/fcm-tokens`) va call nao dung `usr_id` (`resolve-business-ids`).
- `Key`/FCM replacement qua auth phai dung Mongo `_id` cho `userIds`, Redis `USER_FCM_TOKENS(userId)`, va `Keys.tkn_userId`.
- Chat `Friendships` neu dang luu `usr_id` thi giu schema hien co, nhung truoc khi ghi room/message/read/reaction/notification ObjectId fields phai resolve sang Mongo `_id`.

### 5. Tao import ownership check

1. Them script de fail neu app import model ngoai domain.
2. De xuat file:
   - `scripts/check-db-ownership.mjs`
   - hoac `scripts/check-db-ownership.ts`.
3. Input config de xuat:
   - service name.
   - allowed model import patterns.
   - allowed DB modules.
   - legacy allowed patterns co expiry sprint.
4. Script can scan:
   - `apps/**/*.ts`
   - `libs/dto/**/*.ts`
   - `libs/types/**/*.ts`
5. Rule can check:
   - edge apps khong import `libs/db/src/mongo/model`.
   - `libs/dto` va `libs/types` khong import Mongo model.
   - app service chi import model owned hoac legacy allowlist.
   - khong app nao import `MongodbModule`.
   - app service khong inject direct gRPC client den service khac de lay data neu policy la call gateway.
   - socket khong co direct gRPC client den chat/filesystem/ai/notification/auth; socket chi duoc co SFU RPC client.
6. Them npm scripts:
   - `check:db-ownership`
   - `check:edge-no-mongo`
   - `check:service-db-env` neu can.
   - `check:no-direct-cross-service-grpc` neu can tach rieng.
7. CI phai chay script truoc build.

### 6. Tao env guardrail

1. Moi service co DB phai co `.env.example` voi `DB_NAME` dung:
   - auth: `appchat_auth`
   - chat: `appchat_chat`
   - filesystem: `appchat_filesystem`
   - ai: `appchat_ai`
   - learning: `appchat_learning`
   - notification: `appchat_notification`
2. Edge apps khong co `DB_NAME`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`:
   - api-gateway.
   - socket.
   - sfu.
3. Standardize `PROTO_URL` vs `PROTO_PATH`:
   - app code doc bien nao thi env example/build yaml dung bien do.
4. Standardize JWT secret naming giua auth/gateway/socket.
5. Standardize auth user id docs/env:
   - JWT payload cho gateway/socket phai co `_id` Mongo va `usr_id`.
   - Public docs phai ghi `id = usr_id`, `_id = Mongo`.
   - Internal auth route docs phai ghi `userIds` la Mongo `_id[]`, `usrIds` la business id `usr_id[]`.
6. Socket env khong nen co direct gRPC host/proto den chat/filesystem/ai/notification/auth neu socket domain calls phai di qua API gateway; chi giu API gateway internal URL/secret va SFU RPC config.
7. Tao `.env.docker.example` neu `docker-compose.yml` reference `.env.docker`.
8. Khong commit secret production trong `.env.example`.

### 7. Chot shared API gateway contract

1. Auth internal routes:
   - `POST /internal/auth/users/batch` nhan `{ userIds: string[] }` voi `userIds` la Mongo `_id[]`.
   - `POST /internal/auth/users/resolve-business-ids` nhan `{ usrIds: string[] }` voi `usrIds` la `usr_id[]`.
   - `POST /internal/auth/users/search` tra user summaries co `_id` va `usr_id`; `id` neu co la `usr_id`.
   - `POST /internal/auth/users/fcm-tokens` nhan `{ userIds: string[] }` voi `userIds` la Mongo `_id[]`.
2. Gateway protected controllers:
   - forward `req.user._id` cho `userId`/`actorUserId` khi owner service can ObjectId.
   - khong forward parsed `id` nhu Mongo `_id`.
   - neu client gui `usr_id`/parsed `id`, gateway resolve qua auth truoc khi forward den owner service co ObjectId field.
3. Socket realtime:
   - domain command den chat/filesystem/ai di qua API gateway internal endpoint.
   - actor id gui qua gateway la `client.userId = payload._id`.
   - presence/status co the dung `client.user.usr_id` neu FE contract dang dung business id.
   - chi SFU media plane moi goi SFU RPC truc tiep.
4. Service-to-service:
   - app service muon hydrate data ngoai domain thi call API gateway internal endpoint.
   - khong direct query Mongo DB service khac.
   - khong direct gRPC cross-service de lay data.
   - ngoai le chi ap dung cho `api-gateway` forward den owner service va `socket` -> SFU RPC cho media plane.

### 8. Tao smoke test checklist chung

1. Auth:
   - boot voi `DB_NAME=appchat_auth`.
   - login/register/refresh/logout.
   - `GetUser`, search user, batch user summary.
   - `GET /auth/me`/user summary phan biet ro `_id` Mongo voi `id`/`usr_id`.
   - `POST /internal/auth/users/batch` chi nhan Mongo `_id`.
   - `POST /internal/auth/users/resolve-business-ids` map `usr_id` sang Mongo `_id`.
   - OTP register/reset-password nam trong auth.
2. Chat:
   - boot voi `DB_NAME=appchat_chat`.
   - create room, list room, send message, list message.
   - social friend request/search.
   - neu friend/social flow co `usr_id`, resolve qua gateway/auth truoc khi ghi room/message ObjectId fields.
   - khong `$lookup`/query DB service khac sau sprint 5.
3. Filesystem:
   - boot voi `DB_NAME=appchat_filesystem`.
   - upload attachment, create/list/share document.
   - attach file to message qua gateway/chat.
   - owner/shared users dung Mongo `_id`; neu chi co parsed `id`/`usr_id` thi resolve qua gateway/auth.
4. AI:
   - boot voi `DB_NAME=appchat_ai`.
   - create embedding/log usage tu payload.
   - khong query chat/filesystem DB; neu can runtime data thi call API gateway den owner service.
5. Learning:
   - boot voi `DB_NAME=appchat_learning`.
   - quiz/flashcard/todo CRUD.
   - hydrate user/room qua gateway owner.
   - user/member/result ObjectId fields dung Mongo `_id`.
6. Notification:
   - boot voi `DB_NAME=appchat_notification`.
   - create/list/read/delete notification.
   - push theo `userIds` Mongo `_id[]`, Redis miss fallback qua gateway/auth.
   - khong tao bang OTP/token moi; OTP thuoc auth, FCM token thuoc auth `Keys`.
7. API gateway:
   - boot khong co Mongo env.
   - public route auth/chat/filesystem/learning/ai/notification forward duoc.
   - internal route guard reject/accept dung.
   - protected controllers forward `req.user._id`, khong forward parsed `id` cho ObjectId fields.
8. Socket:
   - boot khong co Mongo env.
   - websocket auth gan `client.userId = payload._id` Mongo.
   - presence Redis co the key theo `usr_id`.
   - chat/doc/call domain events goi API gateway internal endpoints.
   - SFU media events goi SFU RPC.
9. SFU:
   - boot khong co Mongo/Redis/Kafka env.
   - gRPC rejects missing/wrong internal secret.
   - socket can call SFU RPC with correct secret.

### 9. Build va CI baseline

1. Chay rieng:
   - `npm run build:gateway`
   - `npm run build:auth`
   - `npm run build:chat`
   - `npm run build:notification`
   - `npm run build:filesystem`
   - `npm run build:ai`
   - `npm run build:learning`
   - `npm run build:socket`
   - `npm run build:sfu`
2. Chay tong:
   - `npm run build:all`
3. Neu build fail do guardrail type import, sua type sang `libs/dto`/`libs/types`.
4. CI order de xuat:
   - `npm run check:db-ownership`
   - `npm run check:no-direct-cross-service-grpc` neu co.
   - `npm run build:all`
   - smoke test scripts neu co.

### 10. Rollback guardrail

1. Sprint 0 khong doi DB runtime, nen rollback chinh la revert code guardrail/script/module cleanup neu build fail.
2. Neu bo duplicate `MongooseModule.forFeature()` lam DI fail, rollback tam thoi bang them model vao service `*DatabaseModule`, khong quay lai `MongodbModule` global.
3. Khong doi `DB_NAME` rieng trong Sprint 0.
4. Moi service sprint sau chi cutover DB khi smoke test cua service do pass.

## Definition of Done

- `MongoConnectionModule` chi quan ly connection, khong register model.
- Moi app Mongo import dung `*DatabaseModule` cua minh.
- Khong app nao import `MongodbModule` legacy.
- Duplicate `MongooseModule.forFeature()` o app root duoc go bo hoac duoc ghi ro ly do tam thoi.
- Legacy cross-service models duoc liet ke day du voi sprint go bo.
- Ownership matrix trong docs khop voi sprint 1-7.
- Shared ID contract duoc ghi ro va cac sprint 1-7 khop: `_id` la Mongo ObjectId, parsed `id` la `usr_id`, `userIds` internal la Mongo `_id[]`, `usrIds` la business id `usr_id[]`.
- Neu service chi co `usr_id`/parsed `id` ma can ObjectId, plan bat buoc call API gateway -> auth `resolve-business-ids`.
- Cross-service data access di qua API gateway -> service owner; khong direct Mongo query, khong direct gRPC cross-service de lay data.
- Co script/CI check import Mongo model sai ownership.
- Co guardrail/CI de phat hien direct cross-service gRPC sai policy neu ap dung duoc.
- Edge apps khong import Mongo model/module va khong co `DB_*` env.
- `.env.example` co `DB_NAME` dung cho service co DB.
- Smoke test checklist cho 9 app/service da duoc ghi ro.
- `npm run build:all` xanh sau khi guardrail duoc ap dung.
