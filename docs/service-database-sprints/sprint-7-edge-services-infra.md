# Sprint 7 - Edge Services And Infra

## Goal

Dam bao cac service khong so huu DB van sach dependency va production-ready sau khi tach DB theo service. `api-gateway`, `socket`, `sfu` khong duoc so huu MongoDB, khong import Mongo model, va chi lam vai tro edge/orchestration/realtime/media.

## Scope

- `apps/api-gateway`
- `apps/socket`
- `apps/sfu`
- `libs/grpc`
- `libs/helpers`
- `libs/constants`
- Docker Compose, Cloud Build YAML, env examples
- CI/check scripts cho ownership va startup

## Ownership

### `api-gateway`

- Khong co database target.
- Duoc dung Redis de verify JWT blacklist va cache can thiet.
- Duoc dung gRPC client de forward den service owner.
- Duoc dung Kafka client cho event gateway da co contract.
- Khong import `MongooseModule`, `InjectModel`, `MongoConnectionModule`, `MongodbModule`, `*DatabaseModule`, hay `libs/db/src/mongo/model/*`.
- La lop public HTTP va internal HTTP cho service-to-service qua gateway.
- `req.user._id` tu JWT/auth middleware la MongoDB ObjectId; neu response co `id` sau parse/unprefix thi `id` la `usr_id`, khong phai Mongo `_id`.
- Khi forward den service owner bang field `userId`/`actorUserId`, gateway phai uu tien Mongo `_id`. Neu caller chi dua `usr_id`/parsed `id`, gateway phai goi internal auth resolve truoc.

### `socket`

- Khong co database target.
- Duoc dung Redis cho presence, Socket.IO adapter, token blacklist check, call state.
- Duoc dung Bull/Redis cho delayed job nhu auto-miss call.
- Duoc dung API gateway internal endpoints de goi chat/filesystem/ai khi can domain data/command.
- Duoc dung SFU RPC rieng cho media plane.
- Khong import Mongo model va khong co DB env.
- `client.userId` phai la JWT payload `_id` MongoDB; `client.user.usr_id` hoac parsed `id` chi la FE-facing business id.
- Presence/status co the dung `usr_id` neu contract FE dang dung `usr_id`; nhung CRUD/domain command di qua API gateway den owner service phai dung Mongo `_id`.

### `sfu`

- Khong co database target.
- Chay media control plane/mediasoup in-memory.
- Chi expose gRPC `sfu.proto`, protected bang `SFU_INTERNAL_SECRET`.
- Khong can Redis/Mongo/Kafka neu khong co use case moi ro rang.

Khong tu them model/modal/bang/collection moi trong sprint nay. Edge services khong duoc tao DB rieng. Neu can du lieu tu service nao thi API gateway forward den service owner; socket/SFU khong query DB, socket khong goi direct gRPC den domain service de lay data.

## ID Contract Cho Edge

- `_id` la MongoDB ObjectId cua user trong auth `Users`.
- `usr_id` la business id cua user.
- `id` trong response da parse/unprefix tu auth la `usr_id`, khong phai Mongo `_id`.
- Edge services khong tu resolve bang DB; chi auth la service duoc map Mongo `_id` <-> `usr_id`.
- Gateway request context sau auth middleware phai giu `req.user._id` la actor Mongo `_id`; khong overwrite bang `id`/`usr_id`.
- Socket request context phai giu `client.userId = payload._id` cho internal service calls; `client.user.usr_id` dung cho presence/FE-facing payload neu contract hien tai can `usr_id`.
- Internal auth routes co `userId`/`userIds` bat buoc nhan Mongo `_id`; routes co `usrId`/`usrIds` chi dung cho `resolve-business-ids`.
- Truoc khi edge/service nao can ghi ObjectId field ma chi co `id`/`usr_id`, phai call `POST /internal/auth/users/resolve-business-ids` qua API gateway de lay `_id`.
- Public response co the giu `id = usr_id` de tuong thich FE, nhung internal response/hydration phai tra ca `_id` va `usr_id`.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/api-gateway/src/app.module.ts`
- `apps/api-gateway/src/main.ts`
- `apps/api-gateway/src/gateway/gateway.module.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `apps/api-gateway/src/gateway/gateway.controller.ts`
- `apps/api-gateway/src/middlewares/auth.middleware.ts`
- `apps/api-gateway/src/middlewares/signature.middleware.ts`
- `apps/api-gateway/src/middlewares/request-logger.middleware.ts`
- `apps/api-gateway/src/auth/gateway-auth.controller.ts`
- `apps/api-gateway/src/chat/gateway-chat.controller.ts`
- `apps/api-gateway/src/chat/social/gateway-social.controller.ts`
- `apps/api-gateway/src/filesystem/gateway-filesystem.controller.ts`
- `apps/api-gateway/src/filesystem/docs/gateway-document.controller.ts`
- `apps/api-gateway/src/learning/quizz/gateway-quizz.controller.ts`
- `apps/api-gateway/src/learning/flashcard/gateway-flashcard.controller.ts`
- `apps/api-gateway/src/learning/todo/gateway-todo.controller.ts`
- `apps/api-gateway/src/ai/gateway-ai.controller.ts`
- `apps/api-gateway/src/notification/gateway-notification.controller.ts`
- `apps/api-gateway/src/config/*.ts`
- `apps/api-gateway/.env`
- `apps/api-gateway/.env.example`
- `apps/api-gateway/.env.development`
- `apps/socket/src/app.module.ts`
- `apps/socket/src/main.ts`
- `apps/socket/src/ws/*`
- `apps/socket/src/chat/chat.module.ts`
- `apps/socket/src/chat/chat-gateway.ts`
- `apps/socket/src/doc/doc.module.ts`
- `apps/socket/src/doc/doc-gateway.ts`
- `apps/socket/src/call/call.module.ts`
- `apps/socket/src/call/call.gateway.ts`
- `apps/socket/src/call/call-auto-miss.processor.ts`
- `apps/socket/src/config/*.ts`
- `apps/socket/.env`
- `apps/socket/.env.example`
- `apps/socket/.env.development`
- `apps/sfu/src/app.module.ts`
- `apps/sfu/src/main.ts`
- `apps/sfu/src/sfu.module.ts`
- `apps/sfu/src/sfu-grpc.controller.ts`
- `apps/sfu/src/auth/shared-secret.interceptor.ts`
- `apps/sfu/src/config/mediasoup.config.ts`
- `apps/sfu/.env.example` neu chua co thi tao template
- `libs/sfu/src/rpc/sfu-rpc.module.ts`
- `libs/sfu/src/rpc/sfu-rpc.client.ts`
- `libs/grpc/*.proto`
- `libs/grpc/grpc-client.module.ts`
- `libs/helpers/src/utils.ts`
- `libs/constants/src/RedisKey.ts`
- `libs/constants/src/services.ts`
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `docker-compose.local.yml`
- `build-gateway-service.yaml`
- `build-auth-service.yaml`
- `build-chat-service.yaml`
- `build-filesystem-service.yaml`
- `build-ai-service.yaml`
- `build-notification-service.yaml`

## Current Findings

- `api-gateway` khong import Mongo connection/module, dung `RedisModule`, `JwtModule`, gRPC clients va Kafka client.
- `api-gateway/src/learning/todo/gateway-todo.controller.ts` da chuyen `TodoStatus`, `TodoPriority` sang `libs/types`, khong con phu thuoc Mongo model cho type nay.
- `api-gateway` config tung service tu `apps/api-gateway/.env.development` khi `NODE_ENV/GATEWAY_*_NODE_ENV=local`; can dong bo voi `.env.example` va deploy env.
- `api-gateway/.env.development` dang co `PORT=5001`, trong khi `.env.example` dung `PORT=5000`; can chot port gateway nhat quan.
- `api-gateway` chua co internal endpoint matrix day du cho cac sprint 1-6; can them/standardize route internal.
- `AuthMiddleware` verify JWT bang Redis blacklist `REFRESH_TOKEN(userId, jti)` va khong doc DB, dung huong.
- `AuthMiddleware` gan payload vao `req.user`; `payload._id` dang la Mongo `_id` va la actor id canonical de forward den service owner.
- Can audit controller nao doc `req.user?.id` hoac parsed auth `id`; neu endpoint owner can ObjectId thi doi sang `req.user?._id` hoac resolve qua auth.
- `socket` khong import Mongo model, dung Redis/Bull, API gateway internal endpoints cho domain data/command, va SFU RPC cho media.
- `WsJwtGuard` gan `client.userId = payload._id`; day la Mongo `_id` cho internal service calls.
- `PresenceService` dang dung `usr_id` cho online/status FE-facing; giu behavior nay nhung document ro khong duoc dung presence `id` thay Mongo `_id` khi goi service owner.
- `socket/.env` hien trong repo co dau hieu bi lech domain (`PROTO_URL=libs/grpc/ai.proto`, `GOOGLE_*`), can don lai dung socket env.
- `socket/.env.example` da co API gateway internal URL/secret va SFU RPC config; tiep tuc khong them direct gRPC host/proto den chat/filesystem/ai/notification/auth.
- `sfu` khong import Mongo/Redis/Kafka, dung in-memory mediasoup va gRPC protected bang `SFU_INTERNAL_SECRET`, dung huong.
- `docker-compose.dev.yml` reference `apps/sfu/.env.local` va `apps/socket/.env.local`, nhung repo scan chua thay cac file nay; can tao template/example hoac sua compose dung `.env.example`/`.env.development` phu hop.
- `docker-compose.yml` reference nhieu `.env.docker` chua thay trong repo scan; can chuan hoa file template hoac update compose docs.
- `build-gateway-service.yaml` moi build image, chua deploy Cloud Run va chua set env gRPC/Redis/JWT/Kafka; cac build service khac co deploy block rieng.
- Hien chua co CI check fail neu edge app import Mongo model.

## Target Flow

- Browser/mobile chi goi public HTTP/WebSocket vao `api-gateway` va `socket`.
- Internal service-to-service khi can du lieu service khac thi call API gateway internal endpoint.
- API gateway forward request den service owner bang gRPC/Kafka theo contract.
- API gateway co the hydrate public response bang batch call den service owner, nhung khong query Mongo.
- Gateway khi hydrate user qua auth phai nhan va forward ro `_id` Mongo va `usr_id`; public `id` neu co chi la alias cua `usr_id`.
- Gateway khi gan actor cho request den chat/filesystem/learning/ai/notification phai dung `req.user._id` neu field ten `userId`/`actorUserId` yeu cau Mongo ObjectId.
- Neu public/client gui parsed `id`/`usr_id`, gateway phai resolve sang Mongo `_id` qua `/internal/auth/users/resolve-business-ids` truoc khi forward den owner co ObjectId field.
- Socket gateway chi handle realtime transport, auth token, presence, fan-out; CRUD/nghiep vu domain phai goi API gateway internal endpoint de gateway forward den service owner.
- Socket presence/status co the key theo `usr_id`; chat/doc/call domain commands phai gui `client.userId` la Mongo `_id` qua API gateway. Chi SFU media commands duoc goi SFU RPC truc tiep.
- SFU chi xu ly media room/transport/producer/consumer in-memory; chat/call history van thuoc chat service.
- Redis la shared infrastructure cho token blacklist, presence, Socket.IO adapter, FCM token cache, Bull queue.
- Mongo credentials chi duoc cap cho services co DB target: auth/chat/filesystem/ai/learning/notification. Gateway/socket/sfu khong co `DB_*` env.

## Internal Gateway Contract Matrix

Chot mot naming convention: internal route bat dau bang `/internal/<owner-service>/...`, co guard/secret, va gateway forward den owner service. Neu sprint truoc da de xuat ten khac, sprint 7 can tao alias tam thoi hoac sua lai docs/code ve mot canonical route.

### Auth internal routes

1. `POST /internal/auth/users/batch`
   - caller: chat, filesystem, learning, ai, gateway public hydration.
   - request: `{ userIds: string[] }` voi `userIds` la Mongo `_id[]`.
   - response: `{ users: UserSummary[] }` trong do moi user co `_id`, `usr_id`, va optional `id = usr_id`.
2. `POST /internal/auth/users/resolve-business-ids`
   - caller: chat/social, gateway/socket khi chi co parsed `id`/`usr_id`.
   - request: `{ usrIds: string[] }` voi `usrIds` la `usr_id[]`.
   - response: `{ users: UserSummary[] }` dung de lay Mongo `_id` truoc khi forward den owner service.
3. `POST /internal/auth/users/search`
   - caller: chat/social, gateway social.
   - request: `{ keyword, page, limit, excludeUserIds? }` voi `excludeUserIds` la Mongo `_id[]`.
   - response: paged user summaries co `_id` va `usr_id`; `id` neu co la `usr_id`.
4. `POST /internal/auth/users/fcm-tokens`
   - caller: notification.
   - request: `{ userIds: string[] }` voi `userIds` la Mongo `_id[]`.
   - response: `{ items: Array<{ userId: string, tokens: string[] }> }` voi `userId` la Mongo `_id`.
   - compatibility: sprint 2 co de xuat `/internal/auth/fcm-tokens`; giu alias tam thoi hoac migrate notification ve canonical route nay.

### Chat internal routes

1. `POST /internal/chat/rooms/check-access`
   - caller: filesystem, learning.
   - request: `{ roomId, userId }`
   - response: `{ allowed, roomId, mongoRoomId?, memberIds? }`
2. `POST /internal/chat/rooms/resolve`
   - caller: filesystem.
   - request: `{ roomId, actorUserId }`
   - response: room summary va permission.
3. `POST /internal/chat/rooms/members`
   - caller: filesystem, learning.
   - request: `{ roomId }`
   - response: `{ memberIds: string[] }`
4. `POST /internal/chat/messages/:messageId/attachments`
   - caller: filesystem.
   - request: `{ attachmentIds: string[], actorUserId }`
   - response: updated message summary.
5. `POST /internal/chat/messages/learning-card-status`
   - caller: learning.
   - request: `{ roomId, sourceType, sourceIds: string[] }`
   - response: `{ items: Array<{ sourceId, isSend, messageId? }> }`

### Filesystem internal routes

1. `POST /internal/filesystem/attachments/hydrate`
   - caller: chat/gateway.
   - request: `{ attachmentIds: string[] }`
   - response: attachment summaries.
2. `POST /internal/filesystem/documents/hydrate`
   - caller: chat/gateway.
   - request: `{ documentIds: string[], actorUserId? }`
   - response: document summaries.

### Learning internal routes

1. `POST /internal/learning/cards/hydrate`
   - caller: chat/gateway.
   - request: `{ items: Array<{ type: 'quiz' | 'flashcard_deck' | 'todo_project', id: string }> }`
   - response: card snapshots enough for chat message render.

### AI internal routes

1. `POST /internal/ai/embeddings/summary`
   - caller: chat/filesystem/gateway if runtime summary is needed.
   - request: source ids and source type.
   - response: summary text/metadata.
2. Neu transcript/STT can persist vao filesystem, AI phai call gateway/filesystem internal endpoint; gateway forward den filesystem.

### Notification internal routes

1. `POST /internal/notifications/send-otp`
   - caller: auth.
   - request: `{ email, otp }`
   - response: delivery result.
2. `POST /internal/notifications/forgot-password`
   - caller: auth.
   - request: `{ email, token }`
   - response: delivery result.
3. Public/test push routes phai tach ro voi internal production route de tranh raw token flow ghi notification sai.

## Tasks

### 1. Lam sach dependency cua `api-gateway`

1. Xac nhan `apps/api-gateway` khong import:
   - `@nestjs/mongoose`
   - `mongoose`
   - `InjectModel`
   - `MongooseModule`
   - `MongoConnectionModule`
   - `MongodbModule`
   - `*DatabaseModule`
   - `libs/db/src/mongo/model/*`
2. Sua `apps/api-gateway/src/learning/todo/gateway-todo.controller.ts`:
   - bo import `TodoStatus`, `TodoPriority` tu Mongo model.
   - chuyen type sang `libs/dto` hoac khai bao DTO/shared enum khong phu thuoc Mongoose.
   - neu chi can string, dung `string` trong gateway va de learning validate.
3. Dam bao gateway modules chi import:
   - `ConfigModule`
   - `RedisModule`
   - `JwtModule`
   - `GrpcClientModule`
   - `SharedKafkaClientModule` neu can.
4. Khong them Mongo provider vao gateway de hydrate response; hydrate bang gRPC den owner service.
5. Xoa log config nhay cam neu in secret/env trong production.

### 2. Chuan hoa internal endpoint guard

1. Dung mot guard/middleware chung cho `/internal/*`, de xuat:
   - header `x-internal-service`
   - header `x-internal-secret`
   - optional `x-request-id`
2. `x-internal-secret` doc tu `GATEWAY_INTERNAL_SECRET`.
3. Chi allow known services:
   - `auth`
   - `chat`
   - `filesystem`
   - `learning`
   - `ai`
   - `notification`
   - `socket` neu co internal HTTP call.
4. Public browser request khong duoc goi `/internal/*`.
5. Gateway forward context xuong gRPC metadata:
   - `x-request-id`
   - `x-internal-service`
   - actor/user id neu caller da pass va endpoint cho phep.
   - actor Mongo `_id` trong `x-actor-user-id` neu downstream can ObjectId.
   - actor `usr_id` trong `x-actor-usr-id` neu downstream can FE-facing/business id.
6. Log internal calls co route, caller, status, latency; khong log token/secret/payload nhay cam.
7. Guard khong duoc bien doi `req.user._id` thanh parsed `id`; neu can them alias thi them field rieng, khong overwrite.

### 3. Hoan thien `GatewayService`

1. Tach helper forward:
   - `dispatchGrpcRequest`
   - `dispatchServiceEvent`
   - `dispatchServiceRequest`
   - `dispatchInternalGrpcRequest` neu can metadata noi bo rieng.
2. Standard timeout:
   - public gRPC read: 20s nhu hien tai.
   - internal hydrate batch: 5-10s tuy route.
   - notification/fire-and-forget: 5s.
3. Response error phai giu status va message co ich, khong nuot thanh 503 chung neu service owner tra business error.
4. Propagate request headers co chon loc; khong copy tat ca header neu co cookie/authorization den service khong can.
5. Them circuit/log metric co ban cho service unavailable.
6. Dam bao `dispatchGrpcRequest` khong can Mongo dependency.

### 4. Hoan thien gateway public hydration

1. Chat public responses:
   - sau khi chat tra raw ids/snapshot, gateway co the hydrate user qua auth.
   - hydrate attachments/documents qua filesystem.
   - hydrate learning cards qua learning.
   - neu raw ids la Mongo `_id` thi goi `/internal/auth/users/batch`.
   - neu raw ids la `usr_id`/parsed `id` thi goi `/internal/auth/users/resolve-business-ids` truoc khi can ObjectId.
2. Filesystem public responses:
   - hydrate owner/shared users qua auth khi can.
   - owner/shared user ObjectId phai la Mongo `_id`; public `id` trong hydrated user van la `usr_id` neu giu shape cu.
3. Learning public responses:
   - hydrate quiz results/todo project members qua auth.
   - check card sent status qua chat.
   - user result/member fields dang ObjectId phai dung Mongo `_id` khi call auth batch.
4. AI public responses:
   - neu can user/file/message metadata, hydrate qua owner service.
   - neu AI payload chi co `usr_id`, gateway resolve auth truoc khi forward sang owner can Mongo `_id`.
5. Hydration phai batch, co timeout, va degrade graceful:
   - neu owner service fail thi tra raw id/snapshot hien co.
   - khong query Mongo fallback.
6. Khong tao cache collection trong gateway.
7. Khong them collection projection/cache user trong gateway de giai quyet hydration.

### 5. Lam sach dependency cua `socket`

1. Xac nhan `apps/socket` khong import:
   - `@nestjs/mongoose`
   - `mongoose`
   - `InjectModel`
   - `MongooseModule`
   - `libs/db/src/mongo/model/*`
2. `SharedBullModule` trong socket chi duoc dung Redis/Bull, khong keo Mongo.
3. `ChatWebSocketModule` chi goi API gateway internal chat endpoints; gateway forward den chat service.
4. `DocWebSocketModule` chi goi API gateway internal filesystem/document endpoints; gateway forward den filesystem service.
5. `CallWebSocketModule` chi goi API gateway internal chat/ai endpoints cho domain state va SFU RPC cho media plane.
6. Auth trong socket chi verify JWT va Redis blacklist, khong call/query auth DB.
7. Presence/room/socket mapping chi dung Redis keys trong `REDISKEY`.
8. Neu socket can data service khac de emit payload day du, goi API gateway internal endpoint qua contract da co; khong import model va khong goi direct owner DB/gRPC.
9. Khi goi API gateway hoac SFU RPC:
   - user/actor id cho domain service gui qua gateway dung `client.userId` = Mongo `_id`.
   - FE-facing status/member display co the dung `client.user.usr_id`.
   - neu event payload tu client chi co parsed `id`/`usr_id`, socket phai resolve qua gateway/auth truoc khi goi owner service can ObjectId.

### 6. Chuan hoa socket realtime contracts

1. JWT secret:
   - socket env phai dung cung secret voi gateway/auth.
   - `GATEWAY_JWT_ACCESS_SECRET` hoac `JWT_ACCESS_SECRET` phai duoc standardize, tranh 2 ten bien bi lech.
2. Redis blacklist:
   - socket tiep tuc check `REFRESH_TOKEN(userId, jti)`.
   - `userId` trong blacklist la Mongo `_id` tu JWT payload `_id`.
   - khong check DB `Keys`.
3. Presence:
   - `USER_ONLINE`, `SOCKET_ALIVE`, `USER_LAST_SEEN` chi nam Redis.
   - presence `id` hien co the la `usr_id` de FE query/status; khong dung presence `id` thay Mongo `_id` khi ghi/call domain.
   - online cleanup task khong query DB.
4. Socket.IO Redis adapter:
   - can fail soft ve in-memory trong local.
   - production phai co Redis bat buoc neu chay multi-instance.
5. Call auto-miss:
   - Bull queue dung Redis.
   - job id deterministic de tranh duplicate khi multi-instance.
6. Chat/doc/call gateways phai emit theo response tu API gateway/owner service, khong tu tinh business state bang DB.

### 7. Lam sach dependency cua `sfu`

1. Xac nhan `apps/sfu` khong import:
   - Redis module.
   - Kafka module.
   - Mongo/Mongoose.
   - service DB modules.
2. `SfuModule` chi provide:
   - `SfuService`
   - `SfuRoomService`
   - `SfuTransportService`
3. `SfuGrpcController` chi expose methods trong `libs/grpc/sfu.proto`.
4. `SharedSecretInterceptor` bat buoc `SFU_INTERNAL_SECRET`; neu thieu thi reject request nhu hien tai.
5. Khong persist room/transport/producer vao DB trong sprint nay.
6. Chat service van la owner call history; socket/call gateway goi API gateway -> chat khi can log call.

### 8. Chuan hoa SFU deployment

1. Tao/cap nhat `apps/sfu/.env.example`:
   - `HOST=0.0.0.0`
   - `PORT=5008`
   - `NODE_ENV=development`
   - `SFU_INTERNAL_SECRET=change-me`
   - `MEDIASOUP_ANNOUNCED_IP=127.0.0.1`
   - `MEDIASOUP_RTC_MIN_PORT=40000`
   - `MEDIASOUP_RTC_MAX_PORT=49999`
   - worker/log env neu `mediasoup.config.ts` can.
2. Tao/cap nhat `apps/socket/.env.example` cho SFU client:
   - `GATEWAY_SFU_HOST`
   - `GATEWAY_SFU_PORT`
   - `GATEWAY_SFU_TLS`
   - `GATEWAY_SFU_PROTO_PATH`
   - `SFU_INTERNAL_SECRET`
3. `docker-compose.dev.yml`:
   - neu dung `apps/sfu/.env.local` va `apps/socket/.env.local`, tao template hoac doi ve file ton tai.
   - local Docker dung port range nho la ok cho smoke; docs phai noi ro production can Linux VM/network phu hop.
4. Production:
   - SFU nen chay tren VM/co network UDP stable.
   - socket Cloud Run goi SFU gRPC qua TLS neu public network.
   - `GATEWAY_SFU_TLS=true` khi host la domain/443.
5. Khong dua mediasoup native dependency vao `apps/socket`.

### 9. Env file cleanup

1. `apps/api-gateway/.env.example` can co day du:
   - gateway host/port.
   - gRPC host/port/proto cho auth, chat, filesystem, notification, ai, learning.
   - Redis config.
   - Kafka config neu gateway emit notification event.
   - JWT secrets.
   - `GATEWAY_INTERNAL_SECRET`.
   - khong co `DB_NAME`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`.
2. `apps/api-gateway/.env.development`:
   - chot `PORT=5000` neu gateway local dung port 5000.
   - dong bo full service host/port voi `.env.example`.
   - bo secret production hard-code neu file duoc commit.
3. `apps/socket/.env.example` can co day du:
   - socket host/port.
   - Redis config.
   - Bull Redis config neu khac Redis chung.
   - JWT secret naming thong nhat.
   - API gateway internal URL va `GATEWAY_INTERNAL_SECRET` de socket goi domain owner qua gateway.
   - SFU client config.
   - khong co `DB_*`.
4. `apps/socket/.env`:
   - don noi dung lech domain AI/Google neu khong con dung.
5. `apps/sfu/.env.example` can co SFU-only config.
6. Tao `.env.docker.example` cho cac app neu compose dung `.env.docker`.
7. `api-gateway`, `socket`, `sfu` startup phai pass khi khong co Mongo env.

### 10. Docker Compose cleanup

1. `docker-compose.yml`:
   - them `learning` service neu production compose local can run all backend services.
   - them `socket` service neu can realtime local full stack.
   - can nhac them `sfu` hoac link den `docker-compose.dev.yml`.
   - `api-gateway.depends_on` can include `learning`, `ai`, `socket` neu gateway route den cac service do trong compose.
2. Tat ca service co DB target can dung `.env.docker` voi DB rieng:
   - auth: `appchat_auth`
   - chat: `appchat_chat`
   - filesystem: `appchat_filesystem`
   - ai: `appchat_ai`
   - learning: `appchat_learning`
   - notification: `appchat_notification`
3. Edge services khong co DB env:
   - api-gateway.
   - socket.
   - sfu.
4. `docker-compose.local.yml` hien chi run Redpanda/Kafka UI; giu nhu infra-only, nhung docs phai noi service chay host-local.
5. Redis service phai la dependency cua gateway/socket/notification/auth/chat neu cac app dung Redis.

### 11. Cloud Build va deployment

1. `build-gateway-service.yaml`:
   - them deploy step neu gateway deploy Cloud Run tu file nay.
   - set env cho gRPC host/port/proto, Redis, Kafka, JWT, internal secret.
   - khong set `DB_*`.
2. Neu co build socket:
   - tao `build-socket-service.yaml` neu chua co.
   - set Redis, JWT, API gateway internal URL/secret, SFU host/port/tls/secret.
   - khong set `DB_*`.
3. Neu co build SFU:
   - tao `build-sfu-service.yaml` hoac deploy VM script.
   - set `SFU_INTERNAL_SECRET`, mediasoup announced IP, RTC port range.
   - khong set `DB_*`.
4. Service build YAML co DB target phai set `DB_NAME` dung ownership.
5. Standardize `PROTO_URL` vs `PROTO_PATH`:
   - app main/config dang dung bien nao thi env/build dung bien do.
   - tranh deploy set `PROTO_PATH` nhung code doc `PROTO_URL`.
6. Standardize auth user id env/docs:
   - gateway/socket JWT payload phai co `_id` Mongo va `usr_id`.
   - public docs phai noi `id = usr_id`, `_id = Mongo`.
   - internal route docs phai noi `userIds` la Mongo `_id[]`, `usrIds` la business id `usr_id[]`.
7. Document rollback:
   - service DB owner rollback bang `DB_NAME` ve DB cu.
   - edge rollback bang image/env previous revision.

### 12. Mongo users va permission

1. Tao Mongo database:
   - `appchat_auth`
   - `appchat_chat`
   - `appchat_filesystem`
   - `appchat_ai`
   - `appchat_learning`
   - `appchat_notification`
2. Tao Mongo user rieng:
   - `appchat_auth_rw`
   - `appchat_chat_rw`
   - `appchat_filesystem_rw`
   - `appchat_ai_rw`
   - `appchat_learning_rw`
   - `appchat_notification_rw`
3. Moi user chi co `readWrite` tren database cua minh.
4. Khong tao Mongo user cho:
   - `api-gateway`
   - `socket`
   - `sfu`
5. Sau cutover, revoke credential cu co quyen all DB khoi service env.
6. Secrets nam trong secret manager/env protected, khong commit vao `.env.example`.

### 13. CI ownership checks

1. Them script check edge khong import Mongo:
   - `rg -n "MongooseModule|InjectModel|MongoConnectionModule|MongodbModule|DatabaseModule|libs/db/src/mongo/model" apps/api-gateway apps/socket apps/sfu`
   - expected: no output.
2. Them script check edge env khong co DB vars:
   - `rg -n "^DB_|MONGO" apps/api-gateway/.env.example apps/socket/.env.example apps/sfu/.env.example`
   - expected: no output.
3. Them script check service DB env co DB_NAME dung:
   - auth -> `appchat_auth`
   - chat -> `appchat_chat`
   - filesystem -> `appchat_filesystem`
   - ai -> `appchat_ai`
   - learning -> `appchat_learning`
   - notification -> `appchat_notification`
4. Them script check forbidden direct service client trong app services neu policy la call gateway:
   - app service khong inject direct `ClientGrpc` den service khac ngoai allowed Kafka/gateway.
   - gateway duoc phep co gRPC clients den owner services.
   - socket chi duoc phep co SFU RPC client; khong co direct gRPC client den chat/filesystem/ai/notification/auth.
5. CI build:
   - `npm run build:gateway`
   - `npm run build:socket`
   - `npm run build:sfu`
   - sau cung `npm run build:all`.
6. CI khong can Mongo service de build/start gateway/socket/sfu smoke.

### 14. Smoke tests cho gateway

1. Gateway boot khong co `DB_*` env.
2. `GET /api/gateway/health` hoac health route hien co tra OK.
3. Auth public:
   - login/register/send-otp route forward den auth/notification dung.
4. Auth protected:
   - `/auth/me` reject khi thieu token.
   - `/auth/me` accept token hop le.
   - token co JTI trong Redis blacklist bi reject.
5. Internal guard:
   - `/internal/*` reject khi thieu `x-internal-secret`.
   - accept khi secret dung va caller service hop le.
6. Internal auth batch/search/fcm-token routes forward den auth.
7. `POST /internal/auth/users/batch` chi nhan `userIds` Mongo `_id`; khong treat `usr_id` nhu `_id`.
8. `POST /internal/auth/users/resolve-business-ids` map `usr_id`/parsed `id` sang `_id` truoc khi gateway forward sang owner can ObjectId.
9. Gateway protected controllers forward `req.user._id` cho `userId`/`actorUserId`; khong forward parsed `id`.
10. Internal chat/filesystem/learning hydrate routes forward den owner.
11. Notification route co raw token/test va userIds production flow tach ro, trong do production `userIds` la Mongo `_id[]`.
12. Gateway khong log secret/cookie/token trong error output.

### 15. Smoke tests cho socket

1. Socket boot khong co `DB_*` env.
2. Socket connect thieu JWT -> reject.
3. Socket connect JWT hop le -> `client.userId = payload._id` Mongo va `client.user.usr_id` duoc giu rieng.
4. Socket connect JWT hop le -> register presence Redis bang `usr_id` neu contract presence FE dang dung `usr_id`.
5. Token JTI bi blacklist -> socket reject/re-auth fail voi Redis key dung Mongo `_id`.
6. Chat socket event:
   - send message -> goi API gateway internal chat route.
   - mark read/react/pin/delete/recall -> goi API gateway internal chat route.
   - payload user/actor gui sang gateway/chat la Mongo `_id`, khong phai parsed `id`.
7. Doc socket event:
   - document access/mutation -> goi API gateway internal filesystem/document route.
   - payload actor gui sang gateway/filesystem la Mongo `_id`.
8. Presence heartbeat refresh `SOCKET_ALIVE`.
9. Multi-instance local test voi Redis adapter neu co the.
10. Bull auto-miss job enqueue/process duoc voi Redis.

### 16. Smoke tests cho SFU

1. SFU boot khong co Redis/Mongo/Kafka env.
2. SFU boot fail/reject RPC neu thieu `SFU_INTERNAL_SECRET`.
3. Socket -> SFU gRPC voi secret dung:
   - `CreateRoom`
   - `JoinRoom`
   - `CreateWebRtcTransport`
   - `Produce`
   - `Consume`
   - `LeaveRoom`
4. Socket -> SFU gRPC voi secret sai -> unauthenticated.
5. RTC port range dung env.
6. `MEDIASOUP_ANNOUNCED_IP` dung trong environment production.
7. SFU restart mat in-memory room la accepted behavior; chat/call history khong mat vi thuoc chat service.

## Definition of Done

- `api-gateway`, `socket`, `sfu` build/start khong can Mongo env.
- `api-gateway`, `socket`, `sfu` khong import Mongo model/module.
- `api-gateway` khong con import `TodoStatus`/`TodoPriority` tu `libs/db/src/mongo/model/todo.model`.
- Internal gateway endpoints cho auth/chat/filesystem/learning/ai/notification duoc chot route, guard va timeout.
- Edge ID contract duoc document/enforce: `_id` la Mongo ObjectId, parsed `id` la `usr_id`, `userIds` internal la Mongo `_id[]`, `usrIds` chi dung cho resolve business id.
- Gateway/socket forward actor Mongo `_id` cho domain service; presence/public payload duoc phep dung `usr_id` nhung khong duoc ghi/call ObjectId field bang `usr_id`.
- Cac sprint service co the call API gateway de lay data service khac, khong can goi direct Mongo/gRPC cross-service; ngoai le cua edge la socket -> SFU RPC cho media plane.
- Env examples day du va khong commit secret production.
- Docker Compose va Cloud Build phan biet ro service co DB va edge service khong DB.
- Mongo credential cua tung service bi gioi han theo dung DB ownership; edge services khong co Mongo credential.
- CI co check import ownership va build gateway/socket/sfu.
- Smoke tests gateway/socket/sfu pass.
