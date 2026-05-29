# Sprint 6 - Auth Service

## Goal

Auth tro thanh source of truth duy nhat cho user/session/otp/device token. Auth co DB rieng, cac service khac khong doc truc tiep `Users`, `Keys`, `Otps`; neu can user profile/search/fcm token thi call API gateway den auth.

## Database Target

`appchat_auth`

## Owned Models

- `Users`
- `Keys`
- `Otps`

Khong tu them model/modal/collection moi trong sprint nay. Chi duoc dung va sua cac model hien co cua auth o tren. Neu auth can gui mail/push hoac can du lieu tu service khac thi auth phai call qua API gateway den service do, khong query Mongo collection cua service khac va khong inject truc tiep model/client cua service khac.

Luu y domain: `Otps` thuoc auth, khong thuoc notification. OTP dung de chung minh identity trong register/reset-password/change-password, nen service verify identity phai so huu state OTP. Notification chi nhan email/phone + otp/token da tao san de deliver, khong luu/verify OTP va khong them bang OTP rieng.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/auth/src/app.module.ts`
- `apps/auth/src/auth.controller.ts`
- `apps/auth/src/auth.service.ts`
- `apps/auth/src/main.ts`
- `apps/auth/.env`
- `apps/auth/.env.example`
- `apps/auth/.env.development` neu dung local runtime
- `apps/auth/.env.docker` neu dung docker-compose
- `apps/api-gateway/src/auth/gateway-auth.controller.ts`
- `apps/api-gateway/src/auth/gateway-auth.module.ts`
- `apps/api-gateway/src/middlewares/auth.middleware.ts`
- `apps/api-gateway/src/notification/gateway-notification.controller.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/mongo/model/user.model.ts`
- `libs/db/src/mongo/model/keys.model.ts`
- `libs/db/src/mongo/model/otp.model.ts`
- `libs/dto/src/auth.dto.ts`
- `libs/grpc/auth.proto`
- `libs/constants/src/RedisKey.ts`
- `build-auth-service.yaml`
- `docker-compose.yml`
- Coupling tu service khac can duoc ho tro bang API auth: chat, filesystem, learning, ai, notification, socket.

## Current Coupling To Remove

- `AuthDatabaseModule` da dung dung 3 model owned, nhung `apps/auth/src/app.module.ts` van import them `MongooseModule.forFeature([userModel, otpModel, keysModel])`; can don ve 1 noi dang ky de tach DB ro rang.
- `apps/auth/src/app.module.ts` dang load `apps/auth/.env.development`, trong repo hien co `.env` va `.env.example`; can dong bo env file de DB split khong bi sai runtime.
- `AuthService` dang call notification qua `${GATEWAY_URL}/api/notifications/send-otp` va `/forgot-password`; day la dung huong gateway nhung can chuan hoa thanh gateway client noi bo co timeout/header/secret.
- `AuthService` dang sync FCM token tu `Keys` sang Redis `USER_FCM_TOKENS` luc start; notification sprint can Redis-first va fallback qua gateway/auth, nen auth phai expose contract lay token theo user.
- API hien tai co `GetUser` va `SearchUser`, nhung chua co batch user summary, resolve theo `usr_id`, va FCM token lookup cho service khac.
- `SearchUser` hien search truc tiep trong auth la dung owner DB, nhung response can thanh user summary an toan va paging on dinh cho chat/social.
- Cac service khac van con import/query auth-owned model:
  - chat: `userModel`, `keysModel`, `$lookup Users`.
  - filesystem: `userModel`, `$lookup Users`.
  - learning: `userModel`.
  - ai: `userModel`.
  - notification: `keysModel`.
  Auth sprint phai cung cap API/gateway contract de cac sprint do go coupling, khong copy `Users`/`Keys` sang DB cua service khac.
- JWT middleware/socket gateways dang verify token bang Redis blacklist `REFRESH_TOKEN(userId, jti)`. DB `Keys.tkn_jit` la durable blacklist trong auth DB; cac app khac khong duoc doc `Keys` truc tiep.

## Target Flow

- Auth chi doc/ghi `Users`, `Keys`, `Otps` trong `appchat_auth`.
- Login/register/refresh/logout/session management chi thao tac `Users` va `Keys` cua auth.
- OTP register/reset-password chi thao tac `Otps` trong auth; gui email/notification qua API gateway den notification.
- User summary/search/batch/resolve/fcm-token la auth-owned API. Service khac chi call API gateway, khong import `User`, `Key`, `Otp`.
- FCM tokens tiep tuc nam trong `Keys` va Redis set `USER_FCM_TOKENS(userId)`. Notification service dung Redis first; neu miss thi call API gateway den auth de fallback va hydrate Redis lai.
- Neu service khac can display user name/avatar/status thi call gateway/auth hoac dung snapshot da nhan tu event; khong tao collection cache moi trong auth.
- Neu auth can attachment/avatar file metadata tu filesystem trong tuong lai, auth call API gateway den filesystem; hien tai `updateAvatar()` chi nhan URL va luu vao `Users`.

## Tasks

### 1. Don DB module va imports cua auth

1. Giu `AuthDatabaseModule` chi register:
   - `userModel`
   - `otpModel`
   - `keysModel`
2. Trong `apps/auth/src/app.module.ts`, bo `MongooseModule.forFeature([userModel, otpModel, keysModel])` neu da import `AuthDatabaseModule`.
3. Xoa import truc tiep `userModel`, `otpModel`, `keysModel` khoi `app.module.ts` neu khong can.
4. Dam bao `apps/auth` khong import model cua chat/filesystem/learning/ai/notification.
5. Dam bao `apps/auth` khong inject `ClientGrpc` den service khac; neu can external action thi call qua API gateway.

### 2. Chuan hoa gateway client trong auth

1. Tao helper nho cho auth goi API gateway, de xuat:
   - `apps/auth/src/gateway/gateway-client.ts` hoac method rieng trong `AuthService`.
   - dung `GATEWAY_URL`.
   - co timeout ngan va log loi co context.
2. Header cho request noi bo:
   - `x-internal-service: auth`
   - `x-internal-secret` neu gateway bat buoc ky noi bo.
   - `x-request-id` neu co.
3. Thay `axios.post()` trong `sendOtp()` va `forgotPassword()` bang helper nay.
4. Auth chi goi notification qua API gateway:
   - `POST /api/notifications/send-otp`
   - `POST /api/notifications/forgot-password`
   - hoac internal endpoint tuong duong neu gateway tach public/internal.
5. Neu notification gateway fail, auth van tra error ro rang nhu hien tai; khong fallback sang doc/ghi notification DB.

### 3. Bo sung auth service contracts cho user summary

1. Them method trong `AuthService`:
   - `getUserSummary(userId)`
   - `getUsersBatch(userIds)`
   - `resolveUsersByBusinessIds(usrIds)`
   - `searchUsersForInternal(keyword, page, limit, excludeUserIds?)`
2. Output user summary thong nhat:
   - `_id`
   - `usr_id`
   - `slug`
   - `fullname`
   - `email`
   - `phone`
   - `avatar`
   - `gender`
   - `dateOfBirth`
   - `address`
   - `status`
3. Tuyet doi khong tra:
   - `usr_salt`
   - password/hash fields
   - `__v`
   - token/JTI/session fields.
4. `getUsersBatch()` can preserve order theo input hoac tra map `{ [userId]: summary }`; ghi ro contract trong proto/DTO.
5. `resolveUsersByBusinessIds()` dung `usr_id` de chat/social resolve member id, friend id.
6. `searchUsersForInternal()` chi search tren `Users` cua auth, co paging va limit toi da de tranh scan lon.
7. Khong tao collection projection/cache moi trong auth cho user summary.

### 4. Cap nhat gRPC proto/controller cho auth contracts

1. Trong `libs/grpc/auth.proto`, bo sung RPC neu chua co:
   - `GetUsersBatch`
   - `ResolveUsersByBusinessIds`
   - `GetFcmTokensByUsers`
2. Co the giu `SearchUser` hien co nhung can chuan response summary cho internal consumers.
3. Trong `apps/auth/src/auth.controller.ts`, map cac RPC moi den `AuthService`.
4. Trong `apps/api-gateway/src/auth/gateway-auth.controller.ts`, them interface method cho cac RPC moi.
5. Cap nhat `libs/dto/src/auth.dto.ts` cho request/response:
   - `GetUsersBatchDto`
   - `ResolveUsersByBusinessIdsDto`
   - `GetFcmTokensByUsersDto`
6. Neu proto output thay doi, cap nhat FE/gateway mapping de khong pha public `/auth/me` va `/auth/search`.

### 5. Bo sung API gateway internal endpoints cho service khac

1. Auth gateway can expose endpoints noi bo:
   - `POST /internal/auth/users/batch`
   - `POST /internal/auth/users/resolve-business-ids`
   - `POST /internal/auth/users/search`
   - `POST /internal/auth/users/fcm-tokens`
2. Cac endpoint noi bo phai co guard/secret rieng, khong mo public neu co the doc danh sach user/token.
3. Request batch:
   - `{ userIds: string[] }`
4. Request resolve business ids:
   - `{ usrIds: string[] }`
5. Request search:
   - `{ keyword, page, limit, excludeUserIds? }`
6. Request fcm tokens:
   - `{ userIds: string[] }`
7. Response fcm tokens:
   - `{ items: Array<{ userId: string, tokens: string[] }> }`
8. API gateway la noi cac service khac goi den; chat/filesystem/learning/ai/notification khong duoc goi thang auth gRPC.

### 6. FCM token ownership va notification fallback

1. `Keys.tkn_fcmToken` tiep tuc la source DB cua device FCM token.
2. Redis `USER_FCM_TOKENS(userId)` la cache/fan-out nhanh.
3. `AuthService.onModuleInit()` co the giu sync tu `Keys` sang Redis, nhung can:
   - chi lay session active `tkn_revokedAt: null`.
   - bo token null/empty.
   - log count theo user/token.
4. Them service method `getFcmTokensByUsers(userIds)`:
   - doc Redis set truoc.
   - neu Redis miss, query `Keys` active theo `tkn_userId`.
   - hydrate Redis lai bang ket qua DB.
   - tra unique tokens.
5. Notification service khi can fallback chi call gateway/auth endpoint o tren, khong inject `keysModel`.
6. Login/register/logout/logoutDevice/logoutAllDevices tiep tuc update Redis FCM set nhu hien tai.
7. Neu client refresh co cap nhat FCM token trong tuong lai, chi sua `Keys` hien co; khong tao collection token moi.

### 7. Public auth flow khong bi pha

1. `login()`:
   - query `Users` bang email/phone trong auth DB.
   - tao `Keys` row device session.
   - set Redis FCM token neu co.
   - return cookie metadata qua gateway nhu hien tai.
2. `register()`:
   - verify `tempRegisterToken`.
   - tao `Users` va `Keys`.
   - khong tao room/friend/profile collection o service khac.
3. `sendOtp()` va `forgotPassword()`:
   - tao `Otps` trong auth DB.
   - gui email qua API gateway den notification.
4. `verifyOtp()`:
   - verify/delete `Otps` trong auth DB.
   - khong query service khac.
5. `refreshToken()`:
   - check Redis blacklist va `Keys` active.
   - rotate JTI, update `Keys.tkn_jit`, `tkn_lastSeenAt`, `tkn_lastSeenIp`.
6. `logout()`, `logoutDevice()`, `logoutAllDevices()`:
   - blacklist JTI trong Redis.
   - soft revoke `Keys`.
   - clean Redis FCM set.
7. `updateAvatar()` va `updateProfile()`:
   - update `Users`.
   - publish event/snapshot neu co Kafka contract, hoac de service khac hydrate qua gateway/auth.
8. Khong them model/modal/collection de luu profile history trong sprint nay.

### 8. User events/snapshot cho service khac

1. Khi `Users` thay doi, can co cach de service khac update snapshot:
   - cach mac dinh: service khac hydrate runtime qua API gateway/auth.
   - cach bo sung: auth publish Kafka event neu da co infra.
2. Event de xuat:
   - `USER_CREATED`
   - `USER_PROFILE_UPDATED`
   - `USER_AVATAR_UPDATED`
   - `USER_STATUS_CHANGED`
3. Payload chi gom user summary an toan, khong gom `usr_salt`/token.
4. Neu chua them Kafka event trong sprint nay, phai ghi ro service khac dung gateway hydrate la bat buoc truoc khi cat DB.
5. Khong tao collection outbox/projection moi trong auth cho sprint nay.

### 9. Sua contract cho cac service dang doc `Users`/`Keys`

1. Chat service:
   - dung `POST /internal/auth/users/batch` de hydrate room/message/social.
   - dung `POST /internal/auth/users/resolve-business-ids` cho `usr_id`.
   - dung `POST /internal/auth/users/search` cho social search.
   - khong query `Users`, `Keys`.
2. Filesystem service:
   - dung `POST /internal/auth/users/batch` de hydrate owner/shared users.
   - khong `$lookup Users`.
3. Learning service:
   - dung `POST /internal/auth/users/batch` de hydrate quiz results/todo project members.
   - khong query `Users`.
4. AI service:
   - dung `POST /internal/auth/users/batch` neu can user metadata cho logs/summary.
   - khong query `Users`.
5. Notification service:
   - Redis first cho FCM token.
   - Redis miss -> `POST /internal/auth/users/fcm-tokens` qua API gateway.
   - khong query `Keys`.
6. Socket/gateway:
   - JWT verify co the tiep tuc dung shared Redis blacklist.
   - khong doc `Keys` DB truc tiep; neu can session detail thi call gateway/auth.

### 10. Env, config va database migration

1. Doi env auth:
   - `apps/auth/.env`
   - `apps/auth/.env.example`
   - `apps/auth/.env.development` neu can tao/dong bo.
   - `apps/auth/.env.docker` neu docker-compose dung.
   - `build-auth-service.yaml`
2. Set `DB_NAME=appchat_auth`.
3. Kiem tra `PROTO_URL`/`PROTO_PATH` dang dung thong nhat; `main.ts` dung `PROTO_URL`, `.env` hien co `PROTO_PATH`.
4. Copy collections tu DB cu sang DB moi:
   - `Users`
   - `Keys`
   - `Otps`
5. Khong copy `Rooms`, `Messages`, `Attachments`, `Documents`, `Notifications`, `Quizzes`, `Flashcards`, `Todos`, `AIEmbedding`, `AIUsageLogs` sang auth DB.
6. Tao Mongo credential rieng cho auth chi co quyen tren `appchat_auth`.
7. Recreate indexes hien co:
   - `Users.usr_slug` unique.
   - `Keys` compound `{ tkn_userId, tkn_clientId }` unique.
   - `Keys.tkn_userId`.
   - `Otps.createdAt` TTL.
   - `Otps.indicator`.
8. Sua `OtpSchema` index dang dung `email` neu can, vi schema field la `indicator`; khong tao collection moi.
9. Chay dry-run migration va verify count/index truoc khi switch traffic.

### 11. Security va access control

1. Internal auth endpoints phai bat buoc header secret hoac service identity.
2. FCM token endpoint chi cho notification/gateway noi bo, khong public.
3. Batch user summary chi tra field safe.
4. Search user public `/auth/search` can limit field va paging; neu endpoint nay dung cho social thi can gateway auth guard/rate limit.
5. Khong expose `Keys`, `Otps`, `tkn_jit`, `tkn_clientId`, `tkn_fcmToken` qua public response.
6. JWT secret trong auth va gateway/socket phai dong bo sau khi tach deploy.
7. Redis blacklist key `REFRESH_TOKEN(userId, jti)` tiep tuc la contract shared; DB `Keys` khong bi service khac doc truc tiep.

### 12. Smoke tests

1. Register OTP -> verify OTP -> register -> login cookie/token OK.
2. Login co `fcmToken` -> `Keys` co session active -> Redis `USER_FCM_TOKENS(userId)` co token.
3. Refresh token -> old JTI bi blacklist -> `Keys.tkn_jit` update -> token moi dung duoc.
4. Logout device -> `Keys.tkn_revokedAt` set -> Redis FCM token bi xoa.
5. `GET /auth/me` tra user profile dung shape hien tai.
6. `POST /internal/auth/users/batch` tra summary theo list user ids.
7. `POST /internal/auth/users/resolve-business-ids` resolve dung `usr_id`.
8. `POST /internal/auth/users/search` co paging va khong tra sensitive fields.
9. `POST /internal/auth/users/fcm-tokens` Redis hit va Redis miss fallback DB deu dung.
10. Notification OTP email van di qua API gateway, khong co direct notification DB access.
11. Chay `npm run build:auth` neu repo co script; neu khong thi chay build chung phu hop.

## Definition of Done

- Auth service chi register/doc/ghi `Users`, `Keys`, `Otps` trong `appchat_auth`.
- Khong them model/modal/collection moi.
- Khong service nao con import/query truc tiep `User`, `Key`, `Otp`; tat ca di qua API gateway den auth.
- Auth neu can notification/email thi call API gateway den notification, khong doc/ghi notification DB.
- User batch/search/resolve/fcm-token contracts du de chat/filesystem/learning/ai/notification cat DB coupling.
- Login/register/refresh/logout/session management chay tren auth DB rieng.
- Public response khong ro ri password hash, OTP, token blacklist, FCM token hay device secret.
