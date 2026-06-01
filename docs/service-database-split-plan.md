# Service Database Split Plan

Last scan: 2026-05-29

Current status: Phase 0 scaffold has started. `MongoConnectionModule` and service-specific database modules are in place; app modules now import their own `*DatabaseModule`. Legacy cross-service models are still registered intentionally so runtime behavior does not change before API/event replacements are ready.

## Goal

Tach MongoDB hien tai thanh mo hinh moi service so huu mot database rieng. Service chi doc/ghi database cua minh; moi truy cap du lieu ngoai domain phai di qua API gateway den service owner, Kafka event, Redis cache hop le, hoac snapshot da duoc dong bo. App service khong goi direct gRPC den service khac de hydrate data; ngoai le hop le la API gateway forward den owner services va socket chi goi SFU RPC cho media plane.

## Current Source Map

Repo da la NestJS monorepo voi cac application:

- `api-gateway`: HTTP gateway, Redis/JWT middleware, khong nen so huu MongoDB.
- `auth`: xac thuc, user profile, OTP, session/device token.
- `chat`: room, message, social/friendship, call history.
- `filesystem`: upload, attachment metadata, collaborative documents.
- `ai`: chat/file/doc embedding, AI usage logs, AI prompt workflow.
- `learning`: quiz, flashcard, todo/project.
- `notification`: in-app notification, push/email/firebase.
- `socket`: realtime gateway, Redis/Bull/gRPC clients, khong nen so huu MongoDB.
- `sfu`: media control plane, khong nen so huu MongoDB.

Truoc Phase 0, tat ca service Mongo dung chung `libs/db/src/mongo/mongodb.module.ts`. Module legacy nay van ton tai de rollback/build compat, nhung app khong duoc import moi. Module nay:

- `@Global()` va `MongooseModule.forRootAsync(...)` dung `DB_NAME` chung.
- `MongooseModule.forFeature([...])` dang dang ky gan nhu tat ca schema vao cung mot module.
- `libs/db/src/index.ts` export tat ca model, lam cac app de import thang schema cua nhau.

Day la diem can cat dau tien, vi neu de `MongodbModule` global nhu hien tai thi service van co the vo tinh doc/ghi collection cua service khac sau khi tach DB.

## Target Database Ownership

| Service        | Database de xuat       | Collection/model so huu                                                                                                                                |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`         | `appchat_auth`         | `Users`, `Keys`, `Otps`                                                                                                                                |
| `chat`         | `appchat_chat`         | `Rooms`, `RoomEvents`, `RoomsState`, `RoomsUsersState`, `Messages`, `MessageReads`, `MessageHides`, `MessageReactions`, `Friendships`, `CallHistories` |
| `filesystem`   | `appchat_filesystem`   | `Attachments`, `Documents`                                                                                                                             |
| `ai`           | `appchat_ai`           | `AIEmbedding`, `AIUsageLogs`                                                                                                                           |
| `learning`     | `appchat_learning`     | `Quizzes`, `Flashcards`, `FlashcardDecks`, `FlashcardProgresses`, `Todos`, `TodoProjects`                                                              |
| `notification` | `appchat_notification` | `Notifications`                                                                                                                                        |
| `api-gateway`  | none                   | Khong MongoDB                                                                                                                                          |
| `socket`       | none                   | Khong MongoDB, chi Redis/Bull va gRPC clients                                                                                                          |
| `sfu`          | none                   | Khong MongoDB                                                                                                                                          |

Database co the nam chung mot Mongo cluster luc dau, nhung moi service phai co `DB_NAME` rieng trong env cua chinh service do. Tach cluster vat ly co the lam sau khi da cat xong dependency code.

## Cross-Service DB Coupling Found

Nhung coupling nay phai duoc thay bang API/event/projection truoc khi doi `DB_NAME` rieng:

| Service dang doc/ghi | Model ngoai domain                  | Thay bang                                                                                                                                                                   |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`               | `User`, `Key`                       | API gateway -> auth (`users/batch`, `users/search`, `users/resolve-business-ids`, `users/fcm-tokens`)                                                                       |
| `chat`               | `Attachment`, `Document`            | API gateway -> filesystem, message chi giu `attachment_ids`/`document_id` va snapshot can render                                                                            |
| `chat`               | `Quiz`, `TodoProject`               | API gateway -> learning, message chi giu foreign id va card snapshot                                                                                                        |
| `filesystem`         | `User`, `Room`, `Message`           | API gateway -> auth/chat; chat so huu mutation message attachment hoac consume event `file.attached`                                                                        |
| `filesystem`         | cap nhat `Message.attachment_ids`   | chat phai so huu mutation nay; filesystem phat event hoac call API gateway -> chat                                                                                          |
| `ai`                 | `Message`, `Attachment`, `Document` | nguon du lieu gui payload/snapshot qua Kafka embedding events; AI khong query DB cua chat/filesystem                                                                        |
| `learning`           | `User`, `Message`                   | API gateway -> auth/chat (`users/batch`, `resolve-business-ids`, `GetOneMsg/GetMsgFromRoom`)                                                                                |
| `notification`       | `Key` de lay FCM token              | auth publish session/device token events; notification dung Redis projection, fallback qua API gateway -> auth. Khong them `NotificationDevices`/`PushTokens` vao DB rieng. |

## Shared ID Contract

- `_id` la MongoDB ObjectId cua document user trong auth `Users`.
- `usr_id` la business id cua user, luu tren `Users.usr_id`.
- `id` trong public response sau parse/unprefix la alias cua `usr_id`, khong phai Mongo `_id`.
- Auth la service duy nhat resolve qua lai giua Mongo `_id` va `usr_id`.
- Internal field `userId`/`userIds` mac dinh la Mongo `_id`/`_id[]`; field `usrId`/`usrIds` moi la business id.
- Service/gateway/socket chi co parsed `id` hoac `usr_id` ma can ghi ObjectId phai call API gateway -> auth `POST /internal/auth/users/resolve-business-ids`.
- Gateway protected context dung `req.user._id`; socket protected context dung `client.userId = payload._id`. Presence/public payload co the dung `usr_id` nhung khong dung thay ObjectId cho domain write.

## Legacy Coupling Ledger

| Service        | Legacy model                                | File/module hien tai                                          | Sprint go bo     | Replacement                                                                                       |
| -------------- | ------------------------------------------- | ------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `chat`         | `User`, `Key`                               | `ChatDatabaseModule`, `RoomsModule`, `SocialModule`, services | Sprint 5         | API gateway -> auth; `userIds`/FCM token lookup dung Mongo `_id`, `usrIds` chi cho resolve/search |
| `chat`         | `Attachment`, `Document`                    | `ChatDatabaseModule`, `HandleChatService`, message pipeline   | Sprint 5         | API gateway -> filesystem                                                                         |
| `chat`         | `Quiz`, `TodoProject`                       | `ChatDatabaseModule`, `HandleChatService`, message pipeline   | Sprint 5         | API gateway -> learning                                                                           |
| `filesystem`   | `User`, `Room`, `Message`                   | `FilesystemDatabaseModule`, `DocumentsModule`, services       | Sprint 3         | API gateway -> auth/chat                                                                          |
| `ai`           | `User`, `Message`, `Attachment`, `Document` | `AiDatabaseModule`, `AIService`, `EmbeddingService`           | Sprint 1         | Kafka payload/snapshot; API gateway -> owner only for runtime lookup                              |
| `learning`     | `User`, `Message`                           | `LearningDatabaseModule`, `LearningModule`, services          | Sprint 4         | API gateway -> auth/chat                                                                          |
| `notification` | `Key`                                       | `NotificationDatabaseModule`, `FirebaseService`               | Sprint 2         | Redis first, API gateway -> auth fallback                                                         |
| `api-gateway`  | Mongo model types                           | `gateway-todo.controller.ts` history                          | Done in Sprint 0 | `libs/types`/DTO shared types                                                                     |

Legacy ledger ID rule: auth replacements must document which endpoints take Mongo `_id` (`users/batch`, `users/fcm-tokens`) and which take `usr_id` (`resolve-business-ids`). `Keys.tkn_userId`, Redis `USER_FCM_TOKENS(userId)`, and notification `userIds` use Mongo `_id`. Chat `Friendships` may keep existing `usr_id` fields, but room/message/read/reaction/notification ObjectId writes must resolve to Mongo `_id` first.

## Migration Order

### Phase 0 - Guardrail khong doi behavior

1. Tach `MongodbModule` hien tai thanh 2 lop:
   - `MongoConnectionModule`: chi `forRootAsync`, khong `forFeature` tat ca model.
   - `*DatabaseModule` theo service: `AuthDatabaseModule`, `ChatDatabaseModule`, `FilesystemDatabaseModule`, `AiDatabaseModule`, `LearningDatabaseModule`, `NotificationDatabaseModule`.
2. Moi app chi import database module cua chinh minh, tam thoi co the them model ngoai domain vao danh sach "legacy dependency" de build khong vo.
3. Cam import truc tiep `libs/db/src/mongo/model/*` tu app khac bang lint/convention. Shared DTO/type nen dat o `libs/dto` hoac `libs/types`, khong import Mongoose model.

### Phase 1 - Tach AI truoc

AI la ung vien tach truoc vi data so huu chinh la `AIEmbedding` va `AIUsageLogs`; cac data chat/file/doc nen di qua Kafka event.

1. Doi env `apps/ai` thanh `DB_NAME=appchat_ai`.
2. AI chi register `AIEmbedding`, `AIUsageLogs`.
3. Cac event `ai.createChatMessageEmbedding`, `ai.createDocumentEmbedding`, `ai.processFileEmbedding` phai mang du payload can embedding, khong de AI query `Messages`, `Attachments`, `Documents`.
4. Neu can RAG theo room/document, AI luu snapshot toi thieu tren model hien co (`AIEmbedding`) hoac de API gateway/caller hydrate tu owner service; khong tao collection moi trong sprint nay.

### Phase 2 - Tach Notification

1. Doi env `apps/notification` thanh `DB_NAME=appchat_notification`.
2. Notification chi register `Notification`.
3. Auth publish event khi login/register/refresh/logout/update FCM token.
4. Notification dung Redis token cache de push, Redis miss thi fallback qua API gateway -> auth, khong query `Keys` va khong tao `NotificationDevices`/`PushTokens`.

### Phase 3 - Tach Filesystem

1. Doi env `apps/filesystem` thanh `DB_NAME=appchat_filesystem`.
2. Filesystem chi register `Attachment`, `Document`.
3. Thay cac query `User`, `Room` bang gRPC:
   - Auth: lay user summary.
   - Chat: validate room/member.
4. Filesystem khong update `Message` truc tiep. Sau upload, service phat event/gRPC command de chat cap nhat message attachment.

### Phase 4 - Tach Learning

1. Doi env `apps/learning` thanh `DB_NAME=appchat_learning`.
2. Learning chi register quiz/flashcard/todo models.
3. Thay query `User` bang auth API/cache.
4. Thay query `Message` bang chat API hoac event de lay ngu canh khi tao quiz tu message.
5. Chat message chi giu `quiz_id`, `desk_id`, `todo_project_id` va snapshot nho de render nhanh.

### Phase 5 - Tach Chat

Chat co nhieu luong can user/file/learning nen tach sau khi cac service kia da co API/event.

1. Doi env `apps/chat` thanh `DB_NAME=appchat_chat`.
2. Chat chi register room/message/social/call models.
3. Social search/friend suggestion khong aggregate truc tiep `Users`; dung API gateway -> auth search/resolve API.
4. Message render co the dung snapshot da luu, cache, hoac call service theo batch. Khong dung Mongo `populate`/`$lookup` sang DB khac.

### Phase 6 - Tach Auth cuoi cung

Auth la source of truth cua `Users`, `Keys`, `Otps`.

1. Doi env `apps/auth` thanh `DB_NAME=appchat_auth`.
2. Auth expose/hoan thien API can thiet: `GetUser`, `SearchUser`, batch user summary, device token events.
3. Sau khi khong service nao import `User`, `Key`, `Otp`, co the coi auth DB la doc lap.

## Sprint Plan Per Service

Moi sprint nen tach theo nguyen tac: mot service, mot nhom coupling chinh, mot cutover nho. Khong doi `DB_NAME` rieng cho service do cho den khi Definition of Done cua sprint da dat.

- [Sprint 0 - Shared Guardrail](service-database-sprints/sprint-0-shared-guardrail.md)
- [Sprint 1 - AI Service](service-database-sprints/sprint-1-ai-service.md)
- [Sprint 2 - Notification Service](service-database-sprints/sprint-2-notification-service.md)
- [Sprint 3 - Filesystem Service](service-database-sprints/sprint-3-filesystem-service.md)
- [Sprint 4 - Learning Service](service-database-sprints/sprint-4-learning-service.md)
- [Sprint 5 - Chat Service](service-database-sprints/sprint-5-chat-service.md)
- [Sprint 6 - Auth Service](service-database-sprints/sprint-6-auth-service.md)
- [Sprint 7 - Edge Services And Infra](service-database-sprints/sprint-7-edge-services-infra.md)

## Data Migration Plan

1. Freeze schema va index hien tai truoc migration.
2. Tao database moi trong cung cluster:
   - `appchat_auth`
   - `appchat_chat`
   - `appchat_filesystem`
   - `appchat_ai`
   - `appchat_learning`
   - `appchat_notification`
3. Copy collection theo ownership matrix tu DB cu (`appchat`/`AppChat`) sang DB moi.
4. Chay smoke test tung service voi `DB_NAME` moi.
5. Chay dual-read/compat layer neu can cho cac endpoint rui ro cao.
6. Cutover theo thu tu phase, moi phase rollback bang cach tra `DB_NAME` ve DB cu.
7. Sau cutover on dinh, khoa quyen Mongo user cua tung service chi vao database cua service do.

## Implementation Checklist Per Service

Cho moi service:

- Env rieng: `DB_NAME=appchat_<service>`.
- Mongo user rieng: chi duoc read/write database cua service.
- Database module rieng: chi `forFeature` model owned.
- Khong import Mongoose model ngoai domain trong `apps/<service>`.
- Khong `populate`/`$lookup` cross-service.
- Foreign id duoc luu nhu id tham chieu, khong coi la relation DB.
- Can render nhanh thi luu denormalized snapshot, cap nhat bang event.
- Can tinh dung thoi gian thuc thi thi goi API gateway den service owner.
- Test smoke: startup, create/read/update/delete path chinh, Kafka consumer path, gRPC path.

## First Concrete Coding Tasks

1. Done: tao `MongoConnectionModule` va cac service database module, sau do thay app modules import module rieng.
2. Doi `apps/ai` truoc de khong inject `Message`, `Attachment`, `Document` truc tiep; event embedding phai du payload.
3. Thay notification `Keys` lookup bang Redis first va API gateway -> auth fallback; khong them token collection moi.
4. Sua filesystem upload flow de chat la service duy nhat update `Messages`.
5. Them lint rule hoac script CI: fail neu `apps/*` import model ngoai ownership matrix.
