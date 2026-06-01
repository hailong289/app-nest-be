# Sprint 3 - Filesystem Service

## Goal

Filesystem chi so huu file/document metadata, khong sua message/room/user truc tiep.

## Database Target

`appchat_filesystem`

## Owned Models

- `Attachments`
- `Documents`

Khong tu them model/modal/collection moi trong sprint nay. Chi dung cac model hien co cua filesystem: `Attachments` va `Documents`. Neu can du lieu tu auth/chat thi filesystem phai call qua API gateway den service do, khong query Mongo collection cua service khac va khong inject truc tiep model cua service khac.

ID contract cho sprint nay:

- `_id` la MongoDB ObjectId cua `Users`.
- `id` trong response auth sau khi parse/unprefix la `usr_id`, khong phai Mongo `_id`.
- Tat ca input `userId`/`actorUserId` vao filesystem, `Attachments.user_id`, `Documents.ownerId`, `Documents.sharedWith.userId`, notification `userIds`, va AI event `userId` phai dung Mongo `_id`.
- Neu caller chi co `id`/`usr_id`, phai call API gateway den auth de resolve sang Mongo `_id` truoc khi goi filesystem.
- Filesystem chi dung `usr_id` de hien thi neu auth summary tra ve; khong dung `usr_id` de luu DB, check access, emit notification, hay tu build private pair room.
- Gateway public filesystem/documents phai tiep tuc lay actor tu `req.user._id`; khong tin `userId` do client tu truyen trong body/query.

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
- `uploadSingleFileByUser()` va `uploadMultipleFilesByUser()` dang lay `user.usr_id` de tu build `pairRoomId`; logic nay phai chuyen ve chat service.
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
- `room_id`, `roomIds`, `user_id`, `ownerId`, `sharedWith.userId`, `contextId` duoc giu nhu foreign ids cua service owner, khong populate relation va khong `$lookup` cross-DB.
- Cac field user-owned (`user_id`, `ownerId`, `sharedWith.userId`, `userId`, `actorUserId`) dung Mongo `_id`.
- Neu flow chi co `usr_id`, resolve qua `POST /internal/auth/users/resolve-business-ids` truoc khi luu/check/emit.
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
   - `userId`/`actorUserId` trong body voi cac call noi bo khong co browser cookie, bat buoc la Mongo `_id`.
5. Tao helper adapter noi bo, vi du:
   - `getUserSummary(userId)`
   - `getUsersSummary(userIds)`
   - `resolveUserBusinessIds(usrIds)`
   - `resolveRoomForUser(roomId, userId)`
   - `getRoomMembers(roomId, userId)`
   - `attachFilesToMessage(messageId, attachmentIds, actorUserId)`
6. Neu adapter nhan `usr_id`/parsed `id`, adapter phai goi gateway/auth resolve sang Mongo `_id` truoc; khong fallback query `Users`.
7. Khong inject client auth/chat truc tiep vao filesystem. Neu gateway can bo sung contract de forward xuong auth/chat thi thay doi o gateway va service dich, khong de filesystem goi thang service do.

### 2. Bo sung gateway endpoints noi bo neu API hien co chua du

1. Auth gateway:
   - endpoint batch user summary canonical: `POST /internal/auth/users/batch`.
   - request: `{ userIds: string[] }`, trong do `userIds` la Mongo `_id`.
   - response chi can cac field hien thi: `_id`, `usr_id`, `name`, `email`, `avatar`, `status` neu can.
   - endpoint resolve business id canonical: `POST /internal/auth/users/resolve-business-ids`.
   - request: `{ usrIds: string[] }`.
   - response can co mapping `{ usrId: string; userId: string }`, trong do `userId`/`_id` la Mongo `_id`.
2. Chat gateway:
   - endpoint check access canonical: `POST /internal/chat/rooms/check-access`.
   - endpoint resolve room va validate membership canonical: `POST /internal/chat/rooms/resolve`.
   - endpoint lay room members canonical: `POST /internal/chat/rooms/members`.
   - endpoint attach attachments vao message canonical: `POST /internal/chat/messages/:messageId/attachments`.
   - cac request user context phai dung `{ userId }` hoac `{ actorUserId }` la Mongo `_id`.
   - chat response can tra `{ mongoRoomId, roomId, roomName, memberIds }`; `memberIds` la Mongo `_id`.
3. Gateway chiu trach nhiem forward den auth/chat bang co che hien co cua gateway. Filesystem chi biet URL gateway va contract HTTP noi bo.
4. Cac endpoint noi bo phai co guard/secret rieng, khong mo public neu co the mutate data.
5. Khong tao collection cache user/room/message trong filesystem de thay the gateway call.

### 3. Bo query `User` trong `FilesystemService`

1. Xoa import/inject `User` va `userModel`.
2. `uploadSingleFileByUser()`:
   - thay `userModel.findById(userId)` bang gateway call den auth user summary endpoint.
   - validate `userId` la Mongo `_id`; neu input la `usr_id` thi resolve qua gateway/auth truoc.
   - khong can `usr_id` de tu build private room pair trong filesystem; viec resolve room/pair room phai de chat service lam.
3. `uploadMultipleFilesByUser()`:
   - validate user mot lan qua gateway/auth.
   - truyen user summary/validated context xuong helper upload de khong validate lap lai tung file.
4. `getAttachments()`:
   - neu co `userId`, chi convert Mongo `_id` thanh ObjectId de filter `Attachment.user_id`; validation user neu can thi goi gateway/auth.
   - khong chap nhan `usr_id` de filter `Attachment.user_id` vi field nay dang la ObjectId.

### 4. Bo query `Room` trong `FilesystemService`

1. Xoa import/inject `Room` va `roomModel`.
2. `uploadSingleFileByUser()`:
   - goi gateway/chat de validate user la member va resolve room.
   - request gui `actorUserId` la Mongo `_id`; chat tu xu ly private pair room neu `roomId` la business id.
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
   - `userId` input la Mongo `_id`; `ownerId` va `sharedWith.userId` trong doc cung la Mongo `_id`.
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
   - goi `POST /internal/auth/users/batch` de hydrate owner/shared users; request dung Mongo `_id`.
   - goi gateway/chat de lay room members neu response can merge room members vao `sharedWith`.
3. Neu gateway/auth chua co batch endpoint:
   - them `POST /internal/auth/users/batch` hoac dung nhieu gateway call song song tam thoi qua API gateway.
   - khong tao collection user cache trong filesystem.
4. Cap nhat `DocumentMetadata` response mapping neu can, nhung khong them model Mongo moi.

### 8. Sua notification payload trong documents

1. `createDoc()`:
   - lay room members qua gateway/chat thay vi `roomModel.findById`.
   - gui `DOC_CREATED` voi `userIds` Mongo `_id` tu chat response.
2. `deleteDoc()`:
   - lay members cua cac `doc.roomIds` qua gateway/chat.
   - lay ten nguoi xoa qua gateway/auth user summary endpoint.
3. `shareDocument()`:
   - lay ten nguoi share qua gateway/auth user summary endpoint.
4. `updateDoc()`, `updateTitle()`, `updateVisibility()`:
   - receiverIds lay tu `doc.sharedWith` va room members qua gateway/chat khi can; tat ca receiverIds la Mongo `_id`.
5. Notification van gui Kafka event, khong query DB notification.

### 9. Chuan hoa AI events tu filesystem

1. `AI_PROCESS_FILE_EMBEDDING` payload can gui du data filesystem so huu:
   - `attachmentId`
   - `messageId`
   - `roomId`
   - `userId` la Mongo `_id`
   - `fileUrl`
   - `fileType`
   - `mimeType`
   - `name`
   - `size`
2. `AI_DOC_EMBEDDING` payload can gui:
   - `docId`
   - `userId` la Mongo `_id`
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
7. Dam bao gateway public `apps/api-gateway/src/filesystem/*` tiep tuc truyen `req.user._id` vao filesystem gRPC, khong truyen `req.user.id`/`req.user.usr_id` lam `userId`.

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
7. Document notification events van co `userIds` Mongo `_id`, khong dung `usr_id`.
8. Gateway public upload/document routes truyen `req.user._id`; neu payload/body co `id`/`usr_id` thi khong dung lam `userId`.
9. Case caller chi co `usr_id` -> call `POST /internal/auth/users/resolve-business-ids` -> filesystem nhan Mongo `_id` moi tiep tuc.
10. `npm run build:filesystem` va `npm run build:all` xanh.

## Definition of Done

- Upload file/document khong doc/ghi DB chat/auth.
- Chat la service duy nhat update `Messages`.
- Document share notification van chay qua Kafka.
- Filesystem khong import/inject `User`, `Room`, `Message`.
- Filesystem khong import/inject truc tiep client auth/chat.
- `FilesystemDatabaseModule` khong con legacy model ngoai filesystem domain.
- `DocumentsModule` khong register `RoomSchema`.
- Cac field user trong filesystem contract dung Mongo `_id`; parsed `id`/`usr_id` khong duoc dung thay `_id`.
- Neu can user info/summary/resolve business id thi filesystem call API gateway den auth.
- Private/pair room resolve nam o chat qua API gateway, filesystem khong tu build bang `usr_id`.
- Khong them model/modal/collection moi.
- Moi data can tu auth/chat duoc lay bang API gateway den service do.
