# Sprint 3 - Filesystem Service

## Goal

Filesystem chi so huu file/document metadata, khong sua message/room/user truc tiep.

## Database Target

`appchat_filesystem`

## Owned Models

- `Attachments`
- `Documents`

Khong tu them model/modal/collection moi trong sprint nay. Chi dung cac model hien co cua filesystem: `Attachments` va `Documents`. Neu can du lieu tu auth/chat thi filesystem phai call qua API gateway den service do, khong query Mongo collection cua service khac va khong inject truc tiep model cua service khac.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/filesystem/src/app.module.ts`
- `apps/filesystem/src/filesystem.controller.ts`
- `apps/filesystem/src/filesystem.service.ts`
- `apps/filesystem/src/documents/documents.module.ts`
- `apps/filesystem/src/documents/documents.controller.ts`
- `apps/filesystem/src/documents/documents.service.ts`
- `apps/api-gateway/src/auth/gateway-auth.controller.ts`
- `apps/api-gateway/src/chat/gateway-chat.controller.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `libs/helpers/src/utils.ts`
- `libs/grpc/filesystem.proto`
- `libs/grpc/document.proto`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/mongo/model/Attachment.model.ts`
- `libs/db/src/mongo/model/Document.model.ts`

## Current Coupling To Remove

- `FilesystemDatabaseModule` van dang register legacy `userModel`, `roomModel`, `messagesModel`.
- `DocumentsModule` dang register `RoomSchema`.
- `FilesystemService` inject `User`, `Room`, `Message`.
- `uploadSingleFileByUser()` query `Users` va `Rooms` de validate upload.
- `uploadMultipleFilesByUser()` query `Users` va `Rooms` roi lai goi `uploadSingleFileByUser()` lam validate lap lai.
- `getAttachments()` query `Rooms` de resolve `roomId` va query `Users` de validate/filter `userId`.
- `processLinks()` create `Attachment`, sau do update truc tiep `Messages.attachment_ids`.
- `DocumentsService` inject `Room` va `User`.
- `checkDocAccess()` query `Rooms` de check membership.
- `findRoom()` query `Users` va `Rooms`.
- `getPopulateDocsPipeline()` dung `$lookup` sang `Users` va `Rooms`.
- `createDoc()`, `deleteDoc()`, `listDocs()`, `shareDocumentForRoom()` query room/members truc tiep.
- `deleteDoc()` va `shareDocument()` query `Users` de lay display name cho notification.

## Target Flow

- Filesystem chi doc/ghi `Attachments` va `Documents` trong `appchat_filesystem`.
- `room_id`, `roomIds`, `user_id`, `ownerId`, `sharedWith.userId`, `contextId` duoc giu nhu foreign ids, khong phai Mongo relation.
- Validate user/user summary bang HTTP call den API gateway, gateway forward den auth service.
- Validate room/member/room summary bang HTTP call den API gateway, gateway forward den chat service.
- Cap nhat message attachment bang gateway endpoint cua chat, vi chat so huu `Messages`.
- Notification va AI tiep tuc qua Kafka events, nhung payload phai du thong tin filesystem dang so huu; neu can enrich user/room thi lay qua gateway truoc.

## Tasks

### 1. Them client goi API gateway cho filesystem

1. Them config gateway cho filesystem app, de xuat:
   - `apps/filesystem/src/config/gateway.config.ts`
   - env `GATEWAY_URL=http://localhost:5000`
   - optional env `GATEWAY_INTERNAL_SECRET` neu can endpoint noi bo.
2. Import config vao `ConfigModule.forRoot()` cua `apps/filesystem/src/app.module.ts`.
3. Dung `Utils.callApiGateway()` hoac tao wrapper nho `GatewayClient` trong filesystem de goi HTTP den API gateway.
4. Tat ca request den gateway can truyen du context:
   - `x-internal-service: filesystem`
   - `x-internal-secret` neu gateway bat buoc ky noi bo.
   - `x-request-id` neu request goc co.
   - `userId`/`actorUserId` trong body voi cac call noi bo khong co browser cookie.
5. Tao helper adapter noi bo, vi du:
   - `getUserSummary(userId)`
   - `getUsersSummary(userIds)`
   - `resolveRoomForUser(roomId, userId)`
   - `getRoomMembers(roomId, userId)`
   - `attachFilesToMessage(messageId, attachmentIds, actorUserId)`
6. Khong inject client auth/chat truc tiep vao filesystem. Neu gateway can bo sung contract de forward xuong auth/chat thi thay doi o gateway va service dich, khong de filesystem goi thang service do.

### 2. Bo sung gateway endpoints noi bo neu API hien co chua du

1. Auth gateway:
   - endpoint lay user summary theo id: `GET /internal/auth/users/:userId` hoac `POST /internal/auth/users/resolve`.
   - endpoint batch user summary: `POST /internal/auth/users/batch`.
   - response chi can cac field hien thi: `_id`, `usr_id`, `name`, `email`, `avatar`, `status` neu can.
2. Chat gateway:
   - endpoint resolve room va validate membership: `POST /internal/chat/rooms/resolve`.
   - endpoint lay room members: `POST /internal/chat/rooms/members`.
   - endpoint attach attachments vao message: `POST /internal/chat/messages/:messageId/attachments`.
3. Gateway chiu trach nhiem forward den auth/chat bang co che hien co cua gateway. Filesystem chi biet URL gateway va contract HTTP noi bo.
4. Cac endpoint noi bo phai co guard/secret rieng, khong mo public neu co the mutate data.
5. Khong tao collection cache user/room/message trong filesystem de thay the gateway call.

### 3. Bo query `User` trong `FilesystemService`

1. Xoa import/inject `User` va `userModel`.
2. `uploadSingleFileByUser()`:
   - thay `userModel.findById(userId)` bang gateway call den auth user summary endpoint.
   - khong can `usr_id` de tu build private room pair trong filesystem; viec resolve room/pair room phai de chat service lam.
3. `uploadMultipleFilesByUser()`:
   - validate user mot lan qua gateway/auth.
   - truyen user summary/validated context xuong helper upload de khong validate lap lai tung file.
4. `getAttachments()`:
   - neu co `userId`, chi convert id thanh ObjectId de filter `Attachment.user_id`; validation user neu can thi goi gateway/auth.

### 4. Bo query `Room` trong `FilesystemService`

1. Xoa import/inject `Room` va `roomModel`.
2. `uploadSingleFileByUser()`:
   - goi gateway/chat de validate user la member va resolve room.
   - gateway response can co it nhat `{ mongoRoomId, roomId, roomName, memberIds }`.
   - luu `Attachment.room_id = mongoRoomId` de tuong thich data hien co.
3. `uploadMultipleFilesByUser()` dung room context da resolve mot lan.
4. `getAttachments()`:
   - neu `roomId` la custom room id thi goi gateway/chat resolve sang mongo room id.
   - neu chat khong tim thay room thi return empty list nhu behavior hien tai.
5. Khong tao cache/model room trong filesystem.

### 5. Bo update truc tiep `Messages`

1. Xoa import/inject `Message` va `messageModel`.
2. `processLinks()`:
   - filesystem van create `Attachment` kind `link`.
   - sau khi create attachment, goi gateway/chat endpoint de attach vao message.
3. Them/sua gateway/chat endpoint neu chua co method phu hop, de xuat:
   - `POST /internal/chat/messages/:messageId/attachments`
   - body `{ roomId, actorUserId, attachmentIds }`
   - chat service tu validate message/room/user va update `Messages.attachment_ids`.
4. `uploadSingleFileByUser()` neu co `messageId`:
   - sau khi upload thanh cong va attachment status `uploaded`, goi gateway/chat attach attachment vao message neu chat chua tu lam viec nay.
5. Neu gateway/chat attach fail:
   - khong rollback S3 ngay.
   - mark attachment `uploaded` nhung log warning/return partial error tuy endpoint.
   - can co retry/manual reconcile sau, nhung khong them collection moi trong sprint nay.

### 6. Sua document access khong query `Rooms`

1. Xoa import/inject `Room` va `roomModel` trong `DocumentsService`.
2. `checkDocAccess()`:
   - owner/shared/public check tren `Documents` nhu hien tai.
   - neu doc co `roomIds`, goi gateway/chat check membership cho user voi danh sach room ids.
   - role `guest -> viewer`, role khac -> editor` logic nam trong filesystem helper hoac chat response.
3. `findRoom()`:
   - thay bang gateway/chat `resolveRoomForUser(roomId, userId)`.
   - chat service chiu trach nhiem private pair room logic.
4. `listDocs()`:
   - khi co `roomId`, resolve room qua gateway/chat, lay `mongoRoomId`, check membership tu chat.
   - query `Documents.roomIds` bang `mongoRoomId`.
5. `createDoc()` va `shareDocumentForRoom()`:
   - resolve room qua gateway/chat.
   - luu `roomIds` bang mongo room id do chat tra ve.

### 7. Sua document formatting khong `$lookup` sang `Users`/`Rooms`

1. Xoa `$lookup` `from: 'Users'` va `from: 'Rooms'` trong `getPopulateDocsPipeline()`.
2. Doi flow format:
   - query `Documents` bang `find/aggregate` chi tren collection `Documents`.
   - collect `ownerId`, `sharedWith.userId`, `roomIds`.
   - goi gateway/auth batch user summary de hydrate owner/shared users.
   - goi gateway/chat de lay room members neu response can merge room members vao `sharedWith`.
3. Neu gateway/auth chua co batch endpoint:
   - them `POST /internal/auth/users/batch` hoac dung nhieu gateway call song song tam thoi.
   - khong tao collection user cache trong filesystem.
4. Cap nhat `DocumentMetadata` response mapping neu can, nhung khong them model Mongo moi.

### 8. Sua notification payload trong documents

1. `createDoc()`:
   - lay room members qua gateway/chat thay vi `roomModel.findById`.
   - gui `DOC_CREATED` voi `userIds` tu chat response.
2. `deleteDoc()`:
   - lay members cua cac `doc.roomIds` qua gateway/chat.
   - lay ten nguoi xoa qua gateway/auth user summary endpoint.
3. `shareDocument()`:
   - lay ten nguoi share qua gateway/auth user summary endpoint.
4. `updateDoc()`, `updateTitle()`, `updateVisibility()`:
   - receiverIds lay tu `doc.sharedWith` va room members qua gateway/chat khi can.
5. Notification van gui Kafka event, khong query DB notification.

### 9. Chuan hoa AI events tu filesystem

1. `AI_PROCESS_FILE_EMBEDDING` payload can gui du data filesystem so huu:
   - `attachmentId`
   - `messageId`
   - `roomId`
   - `userId`
   - `fileUrl`
   - `fileType`
   - `mimeType`
   - `name`
   - `size`
2. `AI_DOC_EMBEDDING` payload can gui:
   - `docId`
   - `userId`
   - `roomIds`
   - `title`
   - `plainText`
   - `visibility`
   - `updatedAt`
3. AI event la fire-and-forget, khong dung de lay data tu service khac.

### 10. Don database module va imports

1. Trong `FilesystemDatabaseModule`, chi register:
   - `attachmentModel`
   - `documentModel`
2. Xoa legacy:
   - `userModel`
   - `roomModel`
   - `messagesModel`
3. Trong `DocumentsModule`, chi `MongooseModule.forFeature()`:
   - `Document`
   - `Attachment`
4. Xoa `RoomSchema` khoi `DocumentsModule`.
5. Dam bao `apps/filesystem` khong import `User`, `Room`, `Message` tu `libs/db/src`.
6. Dam bao `apps/filesystem` khong import/inject truc tiep client auth/chat.

### 11. Doi database rieng va migrate data

1. Doi env filesystem:
   - `.env.development`
   - `.env.example`
   - `.env.docker` neu co
   - `build-filesystem-service.yaml`
2. Set `DB_NAME=appchat_filesystem`.
3. Copy collections tu DB cu sang DB moi:
   - `Attachments`
   - `Documents`
4. Khong copy `Users`, `Rooms`, `Messages` sang filesystem DB.
5. Tao Mongo credential rieng cho filesystem chi co quyen tren `appchat_filesystem`.

### 12. Smoke test can co

1. Upload single file voi user/room hop le -> filesystem goi API gateway den auth/chat, luu `Attachment`, upload S3, emit AI event.
2. Upload voi user khong ton tai -> gateway/auth fail, khong tao attachment.
3. Upload voi room/user khong phai member -> gateway/chat fail, khong tao attachment.
4. Process link event -> tao attachment kind `link`, gateway/chat attach vao message.
5. Get attachments theo room -> resolve room qua gateway/chat, query `Attachments`.
6. Create/list/get/update/delete/share document -> khong `$lookup` Users/Rooms, hydrate qua gateway.
7. Document notification events van co `userIds`.
8. `npm run build:filesystem` va `npm run build:all` xanh.

## Definition of Done

- Upload file/document khong doc/ghi DB chat/auth.
- Chat la service duy nhat update `Messages`.
- Document share notification van chay qua Kafka.
- Filesystem khong import/inject `User`, `Room`, `Message`.
- Filesystem khong import/inject truc tiep client auth/chat.
- `FilesystemDatabaseModule` khong con legacy model ngoai filesystem domain.
- `DocumentsModule` khong register `RoomSchema`.
- Khong them model/modal/collection moi.
- Moi data can tu auth/chat duoc lay bang API gateway den service do.
