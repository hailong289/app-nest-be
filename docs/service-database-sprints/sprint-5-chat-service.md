# Sprint 5 - Chat Service

## Goal

Chat chi so huu room/message/social/call va khong doc DB cua service khac. Chat co DB rieng, cac du lieu user/file/document/learning/token chi dung qua snapshot hoac call API gateway den service owner.

## Database Target

`appchat_chat`

## Owned Models

- `Rooms`
- `RoomEvents`
- `RoomsState`
- `RoomsUsersState`
- `Messages`
- `MessageReads`
- `MessageHides`
- `MessageReactions`
- `Friendships`
- `CallHistories`

Khong tu them model/modal/collection moi trong sprint nay. Chi duoc dung va sua cac model hien co cua chat o tren. Neu can du lieu tu auth/filesystem/learning/ai/notification thi chat phai call qua API gateway den service do, khong query Mongo collection cua service khac va khong inject truc tiep model/client cua service khac.

ID contract cho sprint nay:

- `_id` la MongoDB ObjectId cua `Users`.
- `id` trong response auth sau khi parse/unprefix la `usr_id`, khong phai Mongo `_id`.
- Tat ca field chat dang la ObjectId user phai dung Mongo `_id`: `Rooms.room_members.user_id`, `Rooms.created_by`, `Messages.msg_sender`, `Messages.deletedBy`, `MessageReads.user_id`, `MessageHides.user_id`, `MessageReactions.user_id`, `RoomsUsersState.user_id`, `RoomEvents.actor_id`, `RoomEvents.target_user_ids`, `CallHistories.members.user_id` neu field do dang map user.
- `Rooms.room_members.id`, user summary `id`, va cac field `Friendships.frp_userId1/frp_userId2/frp_actionUserId` hien la business `usr_id` string theo schema hien co; chung khong duoc dua thang vao ObjectId fields hoac notification `userIds`.
- Neu caller chi co `id`/`usr_id`, phai call API gateway den auth `POST /internal/auth/users/resolve-business-ids` de lay Mongo `_id` truoc khi ghi room/message/read/reaction/call/notification.
- Nen tach ten bien trong code/DTO: `actorUserId`/`userId` cho Mongo `_id`, `actorUsrId`/`usrId` cho business `usr_id`; tranh dung chung `userId` cho ca hai loai.
- Gateway public chat/message phai lay actor tu `req.user._id`; social friendship co the dung `req.user.usr_id` cho `Friendships`, nhung khi tao room/gui notification phai resolve/giu kem Mongo `_id`.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/chat/src/app.module.ts`
- `apps/chat/src/rooms/rooms.module.ts`
- `apps/chat/src/rooms/rooms.service.ts`
- `apps/chat/src/rooms/rooms.controller.ts`
- `apps/chat/src/social/social.module.ts`
- `apps/chat/src/social/social.service.ts`
- `apps/chat/src/social/social.controller.ts`
- `apps/chat/src/social/aggregates/getFriends.ts`
- `apps/chat/src/social/aggregates/getFriendSuggestions.ts`
- `apps/chat/src/handle-chat/handle-chat.module.ts`
- `apps/chat/src/handle-chat/handle-chat.service.ts`
- `apps/chat/src/handle-chat/handle-chat.controller.ts`
- `apps/chat/src/handle-chat/Pipeline/getMsg.ts`
- `apps/api-gateway/src/chat/gateway-chat.controller.ts`
- `apps/api-gateway/src/chat/social/gateway-social.controller.ts`
- `apps/api-gateway/src/auth/gateway-auth.controller.ts`
- `apps/api-gateway/src/filesystem/gateway-filesystem.controller.ts`
- `apps/api-gateway/src/filesystem/docs/gateway-document.controller.ts`
- `apps/api-gateway/src/learning/quizz/gateway-quizz.controller.ts`
- `apps/api-gateway/src/learning/flashcard/gateway-flashcard.controller.ts`
- `apps/api-gateway/src/learning/todo/gateway-todo.controller.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `libs/helpers/src/utils.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/mongo/model/messages.model.ts`
- `libs/db/src/mongo/model/room.model.ts`
- `libs/grpc/chat.proto`

## Current Coupling To Remove

- `ChatDatabaseModule` van dang register legacy model ngoai chat domain:
  - `userModel`
  - `keysModel`
  - `attachmentModel`
  - `documentModel`
  - `quizModel`
  - `todoProjectModel`
- `RoomsModule` register `userModel`.
- `SocialModule` register `userModel`, `roomModel`; `keysModel` duoc inject qua `ChatDatabaseModule`.
- `SocialService` inject/query `User`, `Key`, `Room`.
- `SocialService` search/friend requests/friend suggestions dang aggregate tren `Users`.
- `SocialService` gui notification bang raw `fcmTokens` lay tu `Keys`.
- `Friendships` hien luu `frp_userId1`, `frp_userId2`, `frp_actionUserId` la `usr_id` string; can giu ro day la business id, khong phai Mongo `_id`.
- `GatewaySocialController` dang dung ca `req.user._id` va `req.user.usr_id`; can chuan hoa ten payload de khong nham `userId`.
- `RoomsService` inject/query `User` de:
  - resolve `usr_id`/profile khi tao room.
  - hydrate room member name/avatar trong room list.
  - resolve private room pair id.
  - add member/change nickname/role/pin/mute/delete.
- `HandleChatService` inject/query `Attachment`, `Document`, `User`, `Quiz`, `TodoProject`.
- `HandleChatService.createMessage()` query `TodoProject` de validate `todoProjectId`.
- `HandleChatService` query `User` cho call flow va room operations.
- `Pipeline/getMsg.ts` `$lookup` cross-service:
  - `Users`
  - `Attachments`
  - `aiembeddings`
  - `Quizzes`
  - `FlashcardDecks`
  - `TodoProjects`
- `RoomsService.handlePipeline()` `$lookup` `Users` de hydrate room members/current user/last message sender.
- `Messages` dang luu `attachment_ids`, `document_id`, `quiz_id`, `desk_id`, `todo_project_id` nhu Mongo refs sang collections cua service khac.

## Target Flow

- Chat chi doc/ghi owned collections trong `appchat_chat`.
- `room_members.user_id`, `msg_sender`, `attachment_ids`, `document_id`, `quiz_id`, `desk_id`, `todo_project_id`, `call members.user_id` duoc xem la foreign ids, khong phai Mongo relation cross DB.
- User foreign ids trong room/message/read/reaction/call la Mongo `_id`. `room_members.id` chi la snapshot `usr_id` de hien thi/private pair logic.
- Friendship graph tam thoi tiep tuc dung `usr_id` vi schema hien co la string; moi khi can user summary/Mongo `_id` thi hydrate/resolve qua auth gateway.
- User validation/profile/search qua API gateway den auth.
- Attachment/document metadata qua API gateway den filesystem.
- Quiz/flashcard/todo project metadata qua API gateway den learning.
- AI summary/embedding metadata qua API gateway den AI hoac qua snapshot payload tu filesystem/AI; chat khong `$lookup` `aiembeddings`.
- Notification gui bang Kafka `PUSH_NOTIFICATION_USERS` voi `userIds` Mongo `_id`; chat khong query `Keys`/notification DB.
- Message list khong `$lookup` cross-service. Chat dung snapshot co san trong message/room state, hoac gateway hydrate sau khi chat tra raw ids.

## Tasks

### 1. Them client goi API gateway cho chat

1. Them config gateway cho chat app, de xuat:
   - `apps/chat/src/config/gateway.config.ts`
   - env `GATEWAY_URL=http://localhost:5000`
   - optional env `GATEWAY_INTERNAL_SECRET` neu can endpoint noi bo.
2. Import config vao `ConfigModule.forRoot()` cua `apps/chat/src/app.module.ts`.
3. Dung `Utils.callApiGateway()` hoac tao wrapper nho `GatewayClient` trong chat de goi HTTP den API gateway.
4. Tat ca request noi bo den gateway can truyen du context:
   - `x-internal-service: chat`
   - `x-internal-secret` neu gateway bat buoc ky noi bo.
   - `x-request-id` neu co.
   - `userId`/`actorUserId` trong body khi call noi bo khong co browser cookie, bat buoc la Mongo `_id`.
   - `usrId`/`actorUsrId` chi dung cho friendship/business id flow.
5. Tao helper adapter noi bo, vi du:
   - `getUserSummary(userId)`
   - `getUsersSummary(userIds)`
   - `searchUsers(query, page, limit, excludeUserId)`
   - `resolveUsersByBusinessIds(usrIds)`
   - `hydrateAttachments(attachmentIds)`
   - `hydrateDocuments(documentIds)`
   - `hydrateLearningCards(items)`
6. Neu adapter nhan `usr_id`/parsed `id`, adapter phai goi gateway/auth resolve sang Mongo `_id` truoc khi ghi ObjectId field; khong fallback query `Users`.
7. Khong inject `ClientGrpc` auth/filesystem/learning/ai vao chat. Neu gateway can bo sung contract de forward xuong service dich thi thay doi o gateway va service dich, khong de chat goi thang service do.

### 2. Bo sung gateway endpoints noi bo neu API hien co chua du

1. Auth gateway:
   - `POST /internal/auth/users/batch`
   - request `{ userIds: string[] }`, trong do `userIds` la Mongo `_id`.
   - `POST /internal/auth/users/search`
   - request `{ keyword, page, limit, excludeUserIds? }`, `excludeUserIds` la Mongo `_id` neu co.
   - `POST /internal/auth/users/resolve-business-ids`
   - request `{ usrIds: string[] }`.
   - response user summary gom `_id`, `usr_id`, `fullname`, `email`, `phone`, `avatar`, `status`; `_id` la Mongo `_id`, `usr_id`/`id` chi la business id.
2. Filesystem gateway:
   - `POST /internal/filesystem/attachments/hydrate`
   - `POST /internal/filesystem/documents/hydrate`
   - response gom metadata render nhanh va summary neu filesystem/AI da co.
3. Learning gateway:
   - `POST /internal/learning/cards/hydrate`
   - request `{ items: Array<{ type: 'quiz' | 'flashcard_deck' | 'todo_project', id: string }> }`
   - response snapshot du de map sang `QuizCore`, `FlashcardDeckCore`, `TodoProjectCore`.
4. AI gateway neu can summary rieng:
   - `POST /internal/ai/embeddings/summary`
   - request theo source ids, response text summary; uu tien de filesystem push summary snapshot vao attachment.
5. Cac endpoint noi bo phai co guard/secret rieng, khong mo public neu co the doc/persist du lieu.
6. Khong tao collection cache user/file/learning trong chat de thay the gateway call.

### 3. Go DB coupling trong `SocialService`

1. Xoa import/inject `User`, `Key` khoi `SocialService`.
2. `sendFriendRequest()`:
   - input can tach ro `senderMongoId=req.user._id` va `senderUsrId=req.user.usr_id`.
   - resolve sender theo Mongo `_id` va receiver theo `usr_id` qua gateway/auth.
   - luu `Friendships` bang `frp_userId1`, `frp_userId2`, `frp_actionUserId` la `usr_id` string nhu hien tai.
   - gui notification bang `KafkaEvent.PUSH_NOTIFICATION_USERS` voi `userIds: [receiver._id]` Mongo `_id`, khong gui raw `fcmTokens`.
3. `acceptFriendRequest()`/`rejectFriendRequest()`:
   - input `usr_id`/`senderId` la `usr_id`; resolve 2 user qua gateway/auth de lay ca `usr_id` va Mongo `_id`.
   - notification bang `PUSH_NOTIFICATION_USERS`.
   - tao private room dung user summary tu gateway/auth, room member `user_id` luu Mongo `_id`, `id` snapshot luu `usr_id`.
4. `getFriendRequests()`:
   - query `Friendships` trong chat DB truoc.
   - collect business `usr_id` cua doi tuong can hien thi.
   - hydrate user summaries qua gateway/auth `resolve-business-ids` hoac search/batch phu hop; khong dua `usr_id` vao `users/batch` neu endpoint nay nhan Mongo `_id`.
   - bo aggregate tren `Users`.
5. `getFriends()` va `getBlockedFriends()`:
   - query `Friendships` trong chat DB.
   - hydrate/filter/search user summaries qua gateway/auth.
   - neu search phuc tap, chuyen search sang auth gateway roi intersect voi friendship ids.
6. `searchUsers()`:
   - call gateway/auth search users.
   - enrich friendship status tu `Friendships` trong chat DB.
7. `getFriendSuggestions()`:
   - tinh relationship graph tu `Friendships`.
   - hydrate candidate users qua gateway/auth.
   - neu can search/ranking theo profile thi auth gateway cung cap batch/search, chat khong aggregate `Users`.
8. `removeFriend()`, `blockFriend()`, `openBlockedFriend()`, `getFriendByUserId()`:
   - `friendId` route hien la `usr_id`; resolve friend qua gateway/auth.
   - thao tac `Friendships` va `Rooms` trong chat DB nhu hien tai.
9. Xoa/sua cac aggregate helper `getFriends.ts`, `getFriendSuggestions.ts` neu chung phu thuoc `Users`.

### 4. Go DB coupling trong `RoomsService`

1. Xoa import/inject `User`.
2. `getUserInfo(userId)`:
   - `userId` input phai la Mongo `_id`; thay bang gateway/auth `getUserSummary`.
   - response noi bo can gom `_id`, `usr_id`, `fullname`, `avatar`.
3. `create()`:
   - gateway public phai set creator `userId=req.user._id`.
   - creator resolve qua gateway/auth bang Mongo `_id`.
   - `memberIds` dang la `usr_id`; resolve qua gateway/auth `resolve-business-ids`.
   - tao `room_members` bang foreign `_id`, `id=usr_id`, `name`, avatar snapshot neu can.
   - khong query `Users`.
4. `addMemberInRoom()`:
   - neu DTO member ids la `usr_id`, resolve qua gateway/auth; neu la Mongo `_id`, hydrate qua `users/batch`.
   - them member snapshot vao `room_members`.
5. `handlePipeline()`:
   - xoa `$lookup` `Users`.
   - dung snapshot trong `room_members.name/id/avatar` va `RoomsState.last_message_snapshot.sender_id`.
   - neu can hydrate avatar/name moi nhat, de API gateway hydrate sau khi chat tra room list.
6. `writeLogRoom()` va `roomEventLookupStages()`:
   - RoomEvent actor/targets chi luu ids.
   - message pipeline khong `$lookup` `Users`; actor/target display lay tu snapshot payload hoac gateway hydrate.
7. `request pin/mute/delete/change name/change role`:
   - khong `userModel.findById`; actor `userId` la Mongo `_id`, resolve qua gateway/auth neu can `usr_id`/display.
8. Redis `USER_ROOMS` sync van chi tu `Rooms` chat DB, giu nhu hien tai.

### 5. Go DB coupling trong `HandleChatService`

1. Xoa import/inject:
   - `Attachment`
   - `Document`
   - `User`
   - `Quiz`
   - `TodoProject`
2. `createMessage()`:
   - `userId` payload phai la Mongo `_id`, gateway public lay tu `req.user._id`.
   - user summary lay tu `RoomsService.getUserInfo()` da qua gateway/auth.
   - `attachments` ids validate/hydrate qua gateway/filesystem neu can.
   - `documentId` validate/hydrate qua gateway/filesystem.
   - `quizId`, `desk_id`, `todoProjectId` validate/hydrate qua gateway/learning.
   - luu ids/snapshot tren message/metadata hien co; khong query owner DB.
3. Todo project:
   - bo `todoProjectModel.findOne({ project_id })`.
   - call gateway/learning hydrate/validate todo project, lay source id/snapshot.
4. Call flow:
   - `requestCall()`, `acceptCall()`, `endCall()`, call history member data lay tu room_members snapshot va gateway/auth batch neu can refresh.
   - khong query `Users`.
5. AI event:
   - `AI_CHAT_MSG_EMBEDDING` payload gui du snapshot: `userId` Mongo `_id`, `roomId`, `messageId`, `text`, `msgType`, `isSystemMessage`, `createdAt`.
6. Filesystem events:
   - `PROCESS_LINK`, `SHARE_DOC_FOR_ROOM` giu Kafka, payload phai co `userId` Mongo `_id`, `roomId`, `messageId`, ids can thiet.
   - chat khong query filesystem DB.
7. Notification:
   - tiep tuc `PUSH_NOTIFICATION_USERS` voi `userIds` Mongo `_id`.
   - khong query `Keys`, khong gui raw `fcmTokens` trong chat production flow.

### 6. Sua message pipeline khong `$lookup` cross-service

1. Trong `apps/chat/src/handle-chat/Pipeline/getMsg.ts`, giu `$lookup` noi bo chat domain:
   - `Rooms`
   - `RoomsUsersState`
   - `Messages`
   - `MessageHides`
   - `MessageReactions`
   - `MessageReads`
   - `CallHistories`
   - `RoomEvents`
2. Xoa `$lookup` cross-service:
   - `Users`
   - `Attachments`
   - `aiembeddings`
   - `Quizzes`
   - `FlashcardDecks`
   - `TodoProjects`
3. Sender/reply/reaction/read_by:
   - dung snapshot user trong message/reaction/read state neu co.
   - neu schema hien co chua co snapshot, API gateway hydrate user summaries sau khi lay message list.
4. Attachments:
   - tra `attachment_ids` hoac attachment snapshot da luu tren message.
   - hydrate qua gateway/filesystem sau query.
5. Document/quiz/flashcard/todo project:
   - tra ids/snapshot da luu tren message.
   - hydrate qua gateway/filesystem/learning sau query.
6. `buildMessageCorePipeline`, `buildMessageDetailPipeline`, `buildMessagesDetailPipeline` phai co cung contract output cho FE.
7. Khong tao collection moi de cache projection.

### 7. Chuan hoa snapshot tren message/room state

1. Khong tao model/collection moi; neu can thi chi mo rong schema `Messages`/`RoomsState` hien co.
2. De xuat snapshot nho trong `Messages`:
   - `sender_snapshot`: `{ userId, usrId, fullname, avatar }`, trong do `userId` la Mongo `_id`, `usrId` la `usr_id`.
   - `attachment_snapshot`: metadata file can render nhanh.
   - `document_snapshot`: `{ docId, title, visibility }`
   - `learning_snapshot`: `{ type, id, title/name, status, image, counts }`
   - `reply_snapshot`: sender/content/type toi thieu neu muon bo lookup reply sender.
3. `RoomsState.last_message_snapshot` tiep tuc la source render room list nhanh; bo nhu cau lookup `Users` last sender.
4. Neu khong muon sua schema trong sprint nay, gateway hydrate sau query la bat buoc truoc khi cat DB.
5. Proto `libs/grpc/chat.proto` chi update neu output field snapshot can them; khong them DB collection moi.

### 8. Sua social notification flow

1. `sendFriendRequest()` gui:
   - `KafkaEvent.PUSH_NOTIFICATION_USERS`
   - `userIds: [receiver._id]` Mongo `_id`
   - `saveToDb: true` neu can in-app notification.
2. `acceptFriendRequest()` gui `userIds: [sender._id]` Mongo `_id`.
3. `rejectFriendRequest()` gui `userIds: [sender._id]` Mongo `_id`.
4. Payload `data` can gom `senderId` Mongo `_id`, `senderUsrId`, `senderName`, `senderAvatar`, `push_type`.
5. Xoa moi query `Key`/`tkn_fcmToken` trong social.

### 9. Sua gateway public orchestration

1. `GatewayChatController`/`GatewaySocialController` co the hydrate response sau khi chat tra ids:
   - user summaries qua auth gateway/service.
   - attachments/documents qua filesystem gateway/service.
   - learning cards qua learning gateway/service.
2. Tranh de chat service call nguoc gateway cho cac public response co the hydrate ngay trong API gateway.
3. Noi bo chat service chi call gateway khi can validate truoc khi ghi DB.
4. Can them internal gateway endpoints cho chat nhu:
   - `POST /internal/chat/rooms/check-access`
   - `POST /internal/chat/messages/learning-card-status`
   - `POST /internal/chat/messages/:messageId/attachments`
   de filesystem/learning/notification sprint khac su dung.

### 10. Don database module va imports

1. Trong `ChatDatabaseModule`, chi register:
   - `roomModel`
   - `roomEventsModel`
   - `roomsStateModel`
   - `roomsUsersStateModel`
   - `messagesModel`
   - `messageReadsModel`
   - `messageHidesModel`
   - `messageReactionsModel`
   - `friendshipModel`
   - `callHistoryModel`
2. Xoa legacy:
   - `userModel`
   - `keysModel`
   - `attachmentModel`
   - `documentModel`
   - `quizModel`
   - `todoProjectModel`
3. `RoomsModule` chi register model chat-owned.
4. `SocialModule` chi register `friendshipModel` va cac chat-owned model can thiet.
5. `HandleChatModule` chi inject chat-owned models.
6. Dam bao `apps/chat` khong import model auth/filesystem/learning/ai/notification.
7. Dam bao `apps/chat` khong import/inject truc tiep client auth/filesystem/learning/ai neu khong phai Kafka event da co contract.
8. Dam bao gateway public `apps/api-gateway/src/chat/*`:
   - chat room/message routes truyen actor bang `req.user._id`.
   - social routes neu truyen `req.user.usr_id` thi field phai dat ten `usrId`/`actorUsrId`, khong dat chung `userId` neu service ky vong Mongo `_id`.
   - khi social can tao room/gui notification phai co hoac resolve duoc Mongo `_id`.

### 11. Doi database rieng va migrate data

1. Doi env chat:
   - `.env.development`
   - `.env.example`
   - `.env.docker` neu co
   - `build-chat-service.yaml`
2. Set `DB_NAME=appchat_chat`.
3. Copy collections tu DB cu sang DB moi:
   - `Rooms`
   - `RoomEvents`
   - `RoomsState`
   - `RoomsUsersState`
   - `Messages`
   - `MessageReads`
   - `MessageHides`
   - `MessageReactions`
   - `Friendships`
   - `CallHistories`
4. Khong copy `Users`, `Keys`, `Attachments`, `Documents`, `Quizzes`, `FlashcardDecks`, `TodoProjects`, `AIEmbedding` sang chat DB.
5. Tao Mongo credential rieng cho chat chi co quyen tren `appchat_chat`.
6. Chay index migration cho cac index hien co tren chat-owned collections.

### 12. Backfill va compatibility

1. Backfill user snapshots cho `Messages`, `RoomEvents`, `RoomsState`, `Rooms.room_members` neu chon snapshot approach.
   - snapshot `userId` la Mongo `_id`, `usrId`/`id` la `usr_id`.
2. Backfill file/document/learning snapshot cho messages co:
   - `attachment_ids`
   - `document_id`
   - `quiz_id`
   - `desk_id`
   - `todo_project_id`
3. Nguon backfill lay qua API gateway den owner service, khong copy owner collections vao chat DB.
4. Neu khong backfill, API gateway hydrate runtime la bat buoc truoc cutover.
5. Chay song song dev/staging va compare response message/room list truoc khi cutover.

### 13. Smoke test can co

1. Tao room private/group -> chat validate user qua gateway/auth, chi ghi `Rooms`.
2. Add/remove member/change role/nickname -> khong query `Users`, `room_members.user_id` la Mongo `_id`, `room_members.id` la `usr_id`.
3. Send text message -> ghi `Messages`, emit AI/notification events.
4. Send message co attachments/document/quiz/deck/todo project -> validate/hydrate qua gateway owner, khong query owner DB.
5. Message list/detail -> khong `$lookup` cross-service, response van render du sender/attachments/learning card qua snapshot/gateway hydrate.
6. Friend request/accept/reject/search/friend suggestions -> khong query `Users`/`Keys`; friendship fields la `usr_id`, notification `userIds` la Mongo `_id`.
7. Call request/accept/end -> call history chay voi snapshot/user ids, khong query `Users`.
8. Gateway public chat/message routes dung `req.user._id`; social friendship route dung `req.user.usr_id` chi cho friendship business id.
9. Case caller chi co `usr_id` -> call `POST /internal/auth/users/resolve-business-ids` -> chat nhan Mongo `_id` moi ghi room/message/notification.
10. `npm run build:chat` va `npm run build:all` xanh.

## Definition of Done

- Chat startup voi `DB_NAME=appchat_chat`.
- Tao room, gui tin, reaction, read receipt, social, call history chay tren DB chat rieng.
- Chat khong import/inject model auth/filesystem/learning/ai/notification.
- `ChatDatabaseModule` khong con legacy model ngoai chat domain.
- `SocialService` khong query `Users`/`Keys`.
- `RoomsService` khong query `Users`.
- `HandleChatService` khong query `Attachments`, `Documents`, `Users`, `Quizzes`, `TodoProjects`.
- Message list/detail khong dung `$lookup`/`populate` cross-service.
- Cac field user ObjectId trong chat dung Mongo `_id`; parsed `id`/`usr_id` khong duoc dung thay `_id`.
- Friendship fields neu giu schema string thi do la `usr_id`; bat buoc resolve qua auth/gateway truoc khi dung cho room/message/notification.
- Notification `userIds` tu chat luon la Mongo `_id`.
- Moi data can tu service khac duoc lay bang API gateway den service do.
- Khong them model/modal/collection moi.
- `npm run build:chat` va `npm run build:all` xanh.
