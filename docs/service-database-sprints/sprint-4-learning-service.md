# Sprint 4 - Learning Service

## Goal

Learning tach khoi user/message/chat truc tiep, chi so huu quiz/flashcard/todo. Learning co DB rieng va chi luu foreign id/snapshot can thiet, khong query DB auth/chat.

## Database Target

`appchat_learning`

## Owned Models

- `Quizzes`
- `Flashcards`
- `FlashcardDecks`
- `FlashcardProgresses`
- `Todos`
- `TodoProjects`

Khong tu them model/modal/collection moi trong sprint nay. Chi duoc dung va sua cac model hien co cua learning o tren. Neu can du lieu tu auth/chat/filesystem/notification thi learning phai call qua API gateway den service do, khong query Mongo collection cua service khac va khong inject truc tiep model/client cua service khac.

ID contract cho sprint nay:

- `_id` la MongoDB ObjectId cua `Users`.
- `id` trong response auth sau khi parse/unprefix la `usr_id`, khong phai Mongo `_id`.
- Tat ca field user ObjectId trong learning phai dung Mongo `_id`: `quiz_createdBy`, `quiz_results.user_id`, `card_userId`, `deck_userId`, `todo_createdBy`, `todo_assignees`, `project_createdBy`, `project_members`.
- `FlashcardProgress.user_id` hien la string, nhung gia tri van phai la Mongo `_id` string, khong luu `usr_id`.
- Neu caller chi co `id`/`usr_id`, phai call API gateway den auth de resolve sang Mongo `_id` truoc khi goi learning.
- Gateway public learning phai lay actor tu `req.user._id`; khong tin `userId`, `createdBy`, `member_id`, `assignee_ids` do client truyen neu cac field do dai dien cho actor hien tai.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/learning/src/app.module.ts`
- `apps/learning/src/learning/learning.module.ts`
- `apps/learning/src/quizz/quizz.controller.ts`
- `apps/learning/src/quizz/quizz.service.ts`
- `apps/learning/src/quizz/dto/quizz.dto.ts`
- `apps/learning/src/flashcard/flashcard.controller.ts`
- `apps/learning/src/flashcard/flashcard.service.ts`
- `apps/learning/src/flashcard/dto/flashcard.dto.ts`
- `apps/learning/src/todo/todo.controller.ts`
- `apps/learning/src/todo/todo.service.ts`
- `apps/learning/src/todo/todo-project.service.ts`
- `apps/learning/src/todo/dto/todo.dto.ts`
- `apps/learning/src/todo/dto/todo-project.dto.ts`
- `apps/api-gateway/src/learning/quizz/gateway-quizz.controller.ts`
- `apps/api-gateway/src/learning/flashcard/gateway-flashcard.controller.ts`
- `apps/api-gateway/src/learning/todo/gateway-todo.controller.ts`
- `apps/api-gateway/src/auth/gateway-auth.controller.ts`
- `apps/api-gateway/src/chat/gateway-chat.controller.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `libs/helpers/src/utils.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/mongo/model/quiz.model.ts`
- `libs/db/src/mongo/model/flashcard.model.ts`
- `libs/db/src/mongo/model/todo.model.ts`
- `libs/db/src/mongo/model/todo-project.model.ts`
- `libs/grpc/quizz.proto`
- `libs/grpc/flashcard.proto`
- `libs/grpc/todo.proto`
- Chat render coupling can sua: `apps/chat/src/handle-chat/handle-chat.service.ts`, `apps/chat/src/handle-chat/Pipeline/getMsg.ts`, `libs/grpc/chat.proto`

## Current Coupling To Remove

- `LearningDatabaseModule` van dang register legacy `userModel`, `messagesModel`.
- `LearningModule` van register `userModel`.
- `QuizzService` inject `User` va `Message`.
- `QuizzService.listQuizzes()` query `Messages` de tinh `is_send` theo `quiz_id`.
- `QuizzService.getQuizzResults()` query `Users` de hydrate leaderboard user name/avatar.
- `TodoProjectService` inject `User`.
- `TodoProjectService.getProjectMembers()` query `Users` de hydrate member profile va search theo `usr_fullname`.
- `Quiz`, `Flashcard`, `FlashcardDeck`, `Todo`, `TodoProject` dang luu user/room id bang ObjectId ref; sau khi tach DB cac field nay chi la foreign ids, khong populate/query cross DB.
- Gateway public da co nhieu endpoint truyen `req.user._id` vao learning, nhung `createQuizz()` hien con nhan body truc tiep nen can chuan hoa actor o gateway.
- `FlashcardProgress.user_id` dang la string trong schema; can chot convention gia tri la Mongo `_id` string.
- Chat service hien inject/query learning collections:
  - `handle-chat.service.ts` inject `Quiz`, `TodoProject`.
  - `messages.model.ts` link `quiz_id`, `desk_id`, `todo_project_id`.
  - `Pipeline/getMsg.ts` `$lookup` sang `Quizzes`, `FlashcardDecks`, `TodoProjects` de render message card.

## Target Flow

- Learning chi doc/ghi 6 collection owned trong `appchat_learning`.
- `quiz_roomId`, `quiz_createdBy`, `card_userId`, `deck_userId`, `todo_roomId`, `todo_createdBy`, `todo_assignees`, `project_roomId`, `project_createdBy`, `project_members` duoc xem la foreign ids, khong phai Mongo relation cross DB.
- Cac user foreign ids o tren dung Mongo `_id`; parsed auth `id`/`usr_id` khong duoc luu vao cac field nay.
- Neu flow chi co `usr_id`, resolve qua `POST /internal/auth/users/resolve-business-ids` truoc khi validate/luu/query/emit notification.
- Validate/hydrate user qua API gateway den auth.
- Validate room/member va check message/link status qua API gateway den chat.
- Chat khong `$lookup` truc tiep vao learning DB. Chat luu id + snapshot render nhanh, hoac hydrate learning card qua API gateway den learning.
- Notification neu can gui theo user thi learning emit Kafka `PUSH_NOTIFICATION_USERS` voi `userIds` Mongo `_id` hoac call API gateway theo contract production; khong query notification DB.

## Tasks

### 1. Them client goi API gateway cho learning

1. Them config gateway cho learning app, de xuat:
   - `apps/learning/src/config/gateway.config.ts`
   - env `GATEWAY_URL=http://localhost:5000`
   - optional env `GATEWAY_INTERNAL_SECRET` neu can endpoint noi bo.
2. Import config vao `ConfigModule.forRoot()` cua `apps/learning/src/app.module.ts`.
3. Dung `Utils.callApiGateway()` hoac tao wrapper nho `GatewayClient` trong learning de goi HTTP den API gateway.
4. Tat ca request noi bo den gateway can truyen du context:
   - `x-internal-service: learning`
   - `x-internal-secret` neu gateway bat buoc ky noi bo.
   - `x-request-id` neu co.
   - `userId`/`actorUserId` trong body khi call noi bo khong co browser cookie, bat buoc la Mongo `_id`.
5. Tao helper adapter noi bo, vi du:
   - `getUserSummary(userId)`
   - `getUsersSummary(userIds, search?)`
   - `resolveUserBusinessIds(usrIds)`
   - `resolveRoomForUser(roomId, userId)`
   - `checkRoomAccess(roomId, userId)`
   - `checkLearningCardSentToRoom(sourceType, sourceId, roomId)`
6. Neu adapter nhan `usr_id`/parsed `id`, adapter phai goi gateway/auth resolve sang Mongo `_id` truoc; khong fallback query `Users`.
7. Khong inject `ClientGrpc` auth/chat vao learning. Neu gateway can bo sung contract de forward xuong auth/chat thi thay doi o gateway va service dich, khong de learning goi thang service do.

### 2. Bo sung gateway endpoints noi bo neu API hien co chua du

1. Auth gateway:
   - canonical: `POST /internal/auth/users/batch`
   - request `{ userIds: string[], search?: string }`, trong do `userIds` la Mongo `_id`.
   - response `{ users: Array<{ _id, usr_id, fullname, email, phone, avatar }> }`, trong do `_id` la Mongo `_id`, `usr_id` chi de hien thi/search.
   - canonical: `POST /internal/auth/users/resolve-business-ids`
   - request `{ usrIds: string[] }`
   - response can co mapping `{ usrId: string; userId: string }`, trong do `userId`/`_id` la Mongo `_id`.
2. Chat gateway:
   - `POST /internal/chat/rooms/check-access`
   - request `{ roomId, userId }`, trong do `userId` la Mongo `_id`.
   - response `{ allowed, mongoRoomId, roomId, memberIds }`, trong do `memberIds` la Mongo `_id`.
3. Chat gateway check learning card da gui vao room:
   - `POST /internal/chat/messages/learning-card-status`
   - request `{ roomId, sourceType: 'quiz' | 'flashcard_deck' | 'todo_project', sourceIds: string[] }`
   - response `{ items: Array<{ sourceId, isSend, messageId? }> }`
4. Learning gateway hydrate card cho chat:
   - `POST /internal/learning/cards/hydrate`
   - request `{ items: Array<{ type: 'quiz' | 'flashcard_deck' | 'todo_project', id: string }> }`
   - response snapshot du de chat render message card.
5. Cac endpoint noi bo phai co guard/secret rieng, khong mo public neu co the doc/persist du lieu.
6. Khong tao collection cache user/room/message trong learning de thay the gateway call.

### 3. Go DB coupling trong `QuizzService`

1. Xoa import/inject `User`, `Message`.
2. `createQuizz()`:
   - gateway public `apps/api-gateway/src/learning/quizz/gateway-quizz.controller.ts` phai set `quiz_createdBy=req.user._id`, khong tin `quiz_createdBy` tu body client.
   - validate `quiz_createdBy` la Mongo `_id` qua gateway/auth neu request khong di tu gateway public.
   - validate `quiz_roomId` va membership qua gateway/chat.
   - luu `quiz_roomId` va `quiz_createdBy` nhu foreign ids.
3. `listQuizzes()`:
   - bo query `Messages`.
   - neu can `is_send`, call gateway/chat `learning-card-status` voi danh sach quiz ids trong page.
   - neu gateway/chat fail thi tra `is_send=false` hoac bo field theo behavior da chon, khong query `Messages`.
4. `getQuizzResults()`:
   - collect `quiz_results.user_id`.
   - hydrate user summary qua `POST /internal/auth/users/batch`, request dung Mongo `_id`.
   - map leaderboard voi `fullname/avatar` tu gateway response.
   - neu auth gateway fail thi van tra ket qua score voi user_id, user_name/avatar rong.
5. `submitQuizz()`:
   - user id lay tu gateway public `req.user._id` va ghi vao `quiz_results.user_id` bang Mongo `_id`.
   - validate user qua gateway/auth neu request noi bo khong di tu gateway public.
   - khong query user DB.
6. Khong them model/collection moi cho quiz results.

### 4. Go DB coupling trong `TodoProjectService`

1. Xoa import/inject `User`.
2. `createProject()` va `getOrCreateDefaultProject()`:
   - gateway public phai set `project_createdBy=req.user._id`.
   - validate creator la Mongo `_id` qua gateway/auth neu request khong di tu gateway public.
   - neu co `project_roomId`, validate room/member qua gateway/chat.
3. `addProjectMember()`:
   - `member_id` phai la Mongo `_id`; neu UI co `usr_id` thi gateway/learning adapter phai resolve qua auth truoc.
   - validate member id qua gateway/auth.
   - neu project co `project_roomId`, validate member thuoc room qua gateway/chat neu nghiep vu yeu cau.
4. `getProjectMembers()`:
   - khong query `Users`.
   - collect `project_members`.
   - call gateway/auth batch voi `member_ids` Mongo `_id` va `search`.
   - filter/search user o auth gateway hoac filter tren response summary, khong query Mongo `Users`.
5. `removeProjectMember()` giu rule khong remove creator, khong query user DB.
6. Khong tao user cache collection trong learning.

### 5. Ra soat `TodoService`

1. `TodoService` hien chi inject `Todo` va `TodoProject`; giu nhu vay.
2. `createTodo()`:
   - gateway public phai set `todo_createdBy=req.user._id`.
   - validate `todo_createdBy` la Mongo `_id` qua gateway/auth neu request khong di tu gateway public.
   - validate `todo_assignees` la Mongo `_id` qua gateway/auth batch.
   - neu co `todo_roomId`, validate room/member qua gateway/chat.
   - neu assignee phai thuoc room thi check qua gateway/chat.
3. `listTodos()`:
   - chi query `Todos` trong learning DB.
   - neu can room access, check permission qua gateway/chat truoc khi query theo `roomId`.
4. `assignTodo()`:
   - `assignee_ids` phai la Mongo `_id`; neu client gui `usr_id` thi resolve qua gateway/auth truoc.
   - validate assignees qua gateway/auth batch.
   - neu todo co `todo_roomId`, validate assignees thuoc room qua gateway/chat.
5. `toMetadata()` chi tra foreign ids; user/room display name do gateway/caller hydrate neu can.

### 6. Ra soat `FlashcardService`

1. `FlashcardService` hien chi inject `Flashcard`, `FlashcardDeck`, `FlashcardProgress`; giu nhu vay.
2. `createFlashcard()` va `createFlashcardDeck()`:
   - `card_userId`/`deck_userId` lay tu gateway public `req.user._id`, khong tin body client.
   - validate user qua gateway/auth neu request noi bo khong di tu gateway public.
3. `cloneFlashcardDeck()`:
   - target user lay tu gateway public `req.user._id`; validate qua gateway/auth neu request noi bo khong di tu gateway public.
   - khong query user DB.
4. `FlashcardProgress` tiep tuc dung `user_id` string hien co; gia tri phai la Mongo `_id` string, khong tao progress collection moi va khong luu `usr_id`.
5. Neu flashcard/deck can gui vao chat message, chat hoac gateway phai luu snapshot/hydrate qua learning gateway, khong `$lookup` cross DB.

### 7. Sua chat integration voi learning card

1. Chat khong duoc `$lookup` sang `Quizzes`, `FlashcardDecks`, `TodoProjects` sau khi tach DB.
2. Trong `apps/chat/src/handle-chat/handle-chat.service.ts`:
   - bo inject/query `Quiz`, `TodoProject` khoi chat DB.
   - khi tao message co `quiz_id`, `desk_id`, `todo_project_id`, call API gateway den learning de validate va lay snapshot.
   - luu id va snapshot render nhanh vao message payload/metadata neu schema hien co ho tro; neu schema chua ho tro snapshot thi can cap nhat message metadata trong sprint chat, khong tao collection moi trong learning.
3. Trong `apps/chat/src/handle-chat/Pipeline/getMsg.ts`:
   - xoa `$lookup` `from: 'Quizzes'`, `from: 'FlashcardDecks'`, `from: 'TodoProjects'`.
   - tra snapshot da luu tren message, hoac de API gateway hydrate sau khi lay messages.
4. Trong `libs/grpc/chat.proto`:
   - giu response card fields hien co neu co the map tu snapshot.
   - neu can them field snapshot/metadata, thay doi proto o sprint chat; learning khong them model moi.
5. Learning can expose endpoint hydrate card theo id de chat/gateway dung.

### 8. Don database module va imports

1. Trong `LearningDatabaseModule`, chi register:
   - `quizModel`
   - `flashcardModel`
   - `flashcardDeckModel`
   - `flashcardProgressModel`
   - `todoModel`
   - `todoProjectModel`
2. Xoa legacy:
   - `userModel`
   - `messagesModel`
3. Trong `apps/learning/src/learning/learning.module.ts`, chi `MongooseModule.forFeature()` cac model owned.
4. Xoa `userModel` khoi `LearningModule`.
5. Dam bao `apps/learning` khong import `User`, `Message`, `Room` tu `libs/db/src`.
6. Dam bao `apps/learning` khong import/inject truc tiep client auth/chat.
7. Dam bao gateway public `apps/api-gateway/src/learning/*` tiep tuc truyen `req.user._id` vao learning gRPC cho actor hien tai:
   - quiz: `quiz_createdBy`, submit/result `user_id`.
   - flashcard: `card_userId`, `deck_userId`, progress `user_id`.
   - todo: `todo_createdBy`, `project_createdBy`, join/leave `member_id`.
8. Gateway khong duoc truyen `req.user.id`/`req.user.usr_id` lam `userId` vao learning.

### 9. Doi database rieng va migrate data

1. Doi env learning:
   - `.env.development`
   - `.env.example`
   - `.env.docker` neu co
   - `build-learning-service.yaml`
2. Set `DB_NAME=appchat_learning`.
3. Copy collections tu DB cu sang DB moi:
   - `Quizzes`
   - `Flashcards`
   - `FlashcardDecks`
   - `FlashcardProgresses`
   - `Todos`
   - `TodoProjects`
4. Khong copy `Users`, `Messages`, `Rooms` sang learning DB.
5. Tao Mongo credential rieng cho learning chi co quyen tren `appchat_learning`.
6. Chay index migration cho cac index hien co tren quiz/flashcard/todo.

### 10. Backfill va compatibility

1. Neu chat dang render learning card bang `$lookup`, can backfill snapshot vao messages truoc khi bo lookup hoac chap nhan hydrate qua gateway runtime.
2. Backfill snapshot nguon tu learning DB:
   - quiz: `quiz_id`, `quiz_title`, `quiz_description`, `quiz_status`, question count.
   - flashcard deck: `deck_id`, `deck_name`, `deck_description`, `deck_totalCards`, `deck_image`.
   - todo project: `project_id`, `project_name`, `project_color`, statuses.
3. Neu can hydrate user display cho existing quiz results/project members, khong backfill user collection; goi gateway/auth batch khi render.
4. Khong tao collection compatibility moi trong learning.

### 11. Smoke test can co

1. Quiz CRUD voi `roomId/userId` hop le -> learning validate qua gateway, chi ghi `Quizzes`.
2. List quizzes -> `is_send` lay qua gateway/chat, khong query `Messages`.
3. Quiz results -> leaderboard hydrate user qua gateway/auth, khong query `Users`.
4. Flashcard/deck/progress CRUD -> chi ghi `Flashcards`, `FlashcardDecks`, `FlashcardProgresses`.
5. Todo/project CRUD -> chi ghi `Todos`, `TodoProjects`.
6. Project members -> hydrate/search user qua gateway/auth.
7. Chat message co quiz/deck/todo project -> render card khong `$lookup` learning collection trong chat DB.
8. Gateway public learning routes truyen `req.user._id`; payload/body co `id`/`usr_id` khong duoc dung lam actor.
9. Case caller chi co `usr_id` -> call `POST /internal/auth/users/resolve-business-ids` -> learning nhan Mongo `_id` moi tiep tuc.
10. Notification/event payload neu co `userIds` phai la Mongo `_id`.
11. `npm run build:learning` va `npm run build:all` xanh.

## Definition of Done

- Learning startup voi `DB_NAME=appchat_learning`.
- Quiz/flashcard/todo CRUD chay tren DB learning rieng.
- Learning khong import/inject model cua auth/chat.
- Learning khong import/inject truc tiep client auth/chat.
- `LearningDatabaseModule` khong con `userModel`, `messagesModel`.
- `LearningModule` khong register `userModel`.
- Cac field user trong learning contract dung Mongo `_id`; parsed `id`/`usr_id` khong duoc dung thay `_id`.
- `FlashcardProgress.user_id` neu giu string thi string do van la Mongo `_id`, khong phai `usr_id`.
- Neu can user info/summary/resolve business id thi learning call API gateway den auth.
- Chat khong query/lookup truc tiep learning collections de render card.
- Moi data can tu auth/chat duoc lay bang API gateway den service do.
- Khong them model/modal/collection moi.
- `npm run build:learning` va `npm run build:all` xanh.
