# Sprint 2 - Notification Service

## Goal

Tach notification khoi `Keys` cua auth. Notification chi so huu in-app notification, khong so huu device/session token.

## Database Target

`appchat_notification`

## Owned Models

- `Notifications`

Khong tu them model/modal/bang/collection moi trong sprint nay. Token thiet bi van thuoc `Keys` cua auth; notification chi doc token qua Redis/cache hoac call API gateway den auth, khong query Mongo `Keys` truc tiep.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/notification/src/app.module.ts`
- `apps/notification/src/notification.controller.ts`
- `apps/notification/src/notification.service.ts`
- `apps/notification/src/firebase.service.ts`
- `apps/notification/src/config/app/app.config.ts`
- `apps/api-gateway/src/notification/gateway-notification.controller.ts`
- `apps/api-gateway/src/auth/gateway-auth.controller.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `libs/helpers/src/utils.ts`
- `libs/db/src/mongo/model/notification.model.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/dto/src/enum.type.ts`
- `libs/constants/src/RedisKey.ts`
- `libs/grpc/notification.proto`
- Token source can sua o auth: `apps/auth/src/auth.controller.ts`, `apps/auth/src/auth.service.ts`
- Notification producers can sua payload: `apps/chat/src/social/social.service.ts`, `apps/chat/src/handle-chat/handle-chat.service.ts`, `apps/filesystem/src/documents/documents.service.ts`, `apps/api-gateway/src/notification/gateway-notification.controller.ts`

## Current Coupling To Remove

- `NotificationDatabaseModule` van dang register legacy `keysModel`.
- `apps/notification/src/app.module.ts` van co comment `Provide Key model for injection`.
- `FirebaseService` inject `Key` va query `Keys`.
- `FirebaseService.pushNotification()` query `Keys` theo `tkn_fcmToken` de map token -> userId khi save notification.
- `FirebaseService.pushNotificationForUsers()` doc Redis `chat:user:{userId}:fcm_tokens`, neu Redis rong thi fallback query `Keys`.
- `AuthService` hien la noi ghi FCM token vao `Keys` va Redis trong login/register/logout/logoutDevice/logoutAllDevices.
- `AuthService.onModuleInit()` sync `Keys` -> Redis, lam cache FCM duoc phuc hoi sau Redis restart/flush.
- `chat/social` dang query `Key` de lay FCM token roi gui `PUSH_NOTIFICATION` bang raw tokens.
- `PUSH_NOTIFICATION` payload hien chi co `fcmTokens`, khong bat buoc co `userIds`, nen kho save notification vao DB rieng ma khong query auth `Keys`.

## Target Flow

- Notification chi doc/ghi `Notifications` trong `appchat_notification`.
- Auth la source of truth session/device va tiep tuc so huu `Keys.tkn_fcmToken`.
- Auth tiep tuc dong bo active FCM tokens sang Redis key hien co `chat:user:{userId}:fcm_tokens`.
- Notification resolve active tokens tu Redis truoc.
- Neu Redis miss, notification call API gateway den auth endpoint noi bo de lay active FCM tokens tu `Keys`; gateway forward den auth service, notification khong goi thang auth service.
- Token lay tu gateway/auth duoc add lai vao Redis set de warm cache.
- Cac service khac gui notification theo `userIds`; notification tu resolve active tokens tu Redis/gateway.
- Raw `fcmTokens` chi dung cho test/admin/direct push va khong nen dung de tao in-app notification neu khong co `userIds`.

## Tasks

### 1. Giu FCM token tren bang hien co cua auth va Redis cache

1. Khong tao `NotificationDevices`/`PushTokens` hay collection tuong duong.
2. `Keys` tiep tuc la bang source of truth cho device session va `tkn_fcmToken`.
3. Redis set hien co `REDISKEY.USER_FCM_TOKENS(userId)` la token cache chung cho fan-out notification.
4. Auth tiep tuc cap nhat Redis trong login/register/logout/logoutDevice/logoutAllDevices.
5. Giu `AuthService.onModuleInit()` sync `Keys` -> Redis de phuc hoi cache sau Redis flush/restart.
6. Xac nhan Redis key convention hien tai du dung cho notification, chua can doi namespace de tranh migration lon.

### 2. Them client goi API gateway cho notification

1. Them config gateway cho notification app, de xuat:
   - `apps/notification/src/config/app/gateway.config.ts`
   - env `GATEWAY_URL=http://localhost:5000`
   - optional env `GATEWAY_INTERNAL_SECRET` neu can endpoint noi bo.
2. Import config vao `ConfigModule.forRoot()` cua `apps/notification/src/app.module.ts`.
3. Dung `Utils.callApiGateway()` hoac tao wrapper nho `GatewayClient` trong notification de goi HTTP den API gateway.
4. Tat ca request noi bo den gateway can truyen du context:
   - `x-internal-service: notification`
   - `x-internal-secret` neu gateway bat buoc ky noi bo.
   - `x-request-id` neu co.
   - `userIds` trong body voi request lay FCM tokens.
5. Khong inject client auth truc tiep vao notification. Neu gateway can bo sung contract de forward xuong auth thi thay doi o gateway/auth, khong de notification goi thang auth service.

### 3. Bo sung gateway/auth endpoint lay active FCM tokens

1. Them endpoint noi bo tren API gateway, de xuat:
   - `POST /internal/auth/fcm-tokens`
2. Request/response de xuat:
   - request: `{ userIds: string[] }`
   - response: `{ items: Array<{ userId: string; fcmTokens: string[] }> }`
3. Gateway endpoint phai co guard/secret rieng, khong mo public.
4. Gateway chiu trach nhiem forward den auth service bang co che hien co cua gateway.
5. Auth service implement logic doc `Keys`:
   - `tkn_userId in userIds`
   - `tkn_fcmToken != null`
   - `tkn_revokedAt == null`
6. Auth service la service duy nhat doc `Keys`; notification chi call gateway.
7. Khong tao collection cache token trong notification.

### 4. Resolve FCM tokens trong notification qua Redis truoc, gateway sau

1. Tao helper `resolveFcmTokensForUsers(userIds)` trong `FirebaseService` hoac helper rieng.
2. Flow helper:
   - de-duplicate `userIds`.
   - doc Redis `REDISKEY.USER_FCM_TOKENS(userId)` cho tung user.
   - user nao Redis miss thi call `POST /internal/auth/fcm-tokens` qua API gateway.
   - token lay tu gateway/auth duoc add lai vao Redis set de warm cache.
   - de-duplicate token truoc khi goi Firebase.
3. Neu gateway/auth khong tra token cho user nao thi log warning va bo qua user do.
4. Neu Redis loi, van co the fallback gateway/auth cho user bi loi doc Redis.
5. Khong fallback query Mongo `Keys` trong notification.

### 5. Don `FirebaseService` khong query `Keys`

1. Xoa import/inject `Key`.
2. Xoa `keyModel` khoi constructor.
3. `pushNotificationForUsers()` resolve token theo helper `resolveFcmTokensForUsers(userIds)`.
4. `pushNotification()` voi raw `fcmTokens`:
   - khong query auth `Keys`.
   - neu payload co `userIds` thi save DB theo `userIds`.
   - neu khong co `userIds` thi chi push, khong save in-app notification.
5. De-duplicate token truoc khi goi Firebase.
6. Xu ly token invalid tu Firebase response:
   - remove token khoi Redis set neu xac dinh duoc userId tu mapping trong helper.
   - khong tao collection moi de tracking token invalid.

### 6. Sua payload producers dung `userIds`

1. `apps/chat/src/handle-chat/handle-chat.service.ts` da gui `PUSH_NOTIFICATION_USERS`; giu luong nay va dam bao `userIds` dung voi Redis token cache cua auth.
2. `apps/chat/src/social/social.service.ts` khong query `Key` nua:
   - xoa `keysModel`/`Key` import va injection.
   - thay `PUSH_NOTIFICATION` + `fcmTokens` bang `PUSH_NOTIFICATION_USERS` + `userIds`.
   - notification service tu resolve token.
3. `apps/filesystem/src/documents/documents.service.ts` tiep tuc gui document events voi `userIds`; chuan hoa `saveToDb=true` trong notification consumer.
4. `apps/api-gateway/src/notification/gateway-notification.controller.ts`:
   - endpoint `/push-notification` production nen nhan `userIds` va emit `PUSH_NOTIFICATION_USERS`.
   - raw `fcmTokens` chi dung `/push-notification-test` hoac admin test.
5. Neu caller chi co raw token va khong co userId, chi push test/direct, khong tao in-app notification.

### 7. Neu can realtime cache sync thi them event, khong tao bang moi

1. Event lifecycle la optional trong sprint nay vi Auth da ghi Redis truc tiep.
2. Neu muon giam coupling Redis write ve sau, co the them event:
   - `AUTH_DEVICE_TOKEN_UPSERTED = 'auth.deviceToken.upserted'`
   - `AUTH_DEVICE_TOKEN_REVOKED = 'auth.deviceToken.revoked'`
   - `AUTH_USER_TOKENS_REVOKED = 'auth.userTokens.revoked'`
3. Notification consume event chi de update Redis cache, khong persist Mongo collection moi.
4. Khong dua event lifecycle vao Definition of Done bat buoc neu Redis sync tu auth da on dinh.

### 8. Don database module va app module

1. Trong `NotificationDatabaseModule`, chi register:
   - `notificationModel`
2. Xoa legacy:
   - `keysModel`
3. Trong `apps/notification`, khong con import `Key`/`keys.model`.
4. Cap nhat comment trong `app.module.ts` dang noi `Provide Key model for injection`.
5. Khong them auth client truc tiep vao notification app.
6. Neu them `GatewayClient`, chi la HTTP client den API gateway, khong phai model/database.

### 9. Doi database rieng va migrate data

1. Doi env notification:
   - `.env.development`
   - `.env.example`
   - `.env.docker` neu co
   - `build-notification-service.yaml`
2. Set `DB_NAME=appchat_notification`.
3. Copy `Notifications` tu DB cu sang DB moi.
4. Khong copy `Keys` sang notification DB.
5. Dam bao auth service sync Redis FCM set tu `Keys` sau deploy/cutover.
6. Dam bao notification service goi duoc API gateway trong local/docker/prod.
7. Tao Mongo credential rieng cho notification chi co quyen tren `appchat_notification`.

### 10. Smoke test can co

1. Login/register voi `fcmToken` -> auth ghi `Keys` va Redis FCM set.
2. Gui message chat -> `PUSH_NOTIFICATION_USERS` -> lay token tu Redis cache va push.
3. Xoa Redis FCM set thu cong trong local -> gui notification -> notification call API gateway den auth lay token va warm Redis lai.
4. Send friend request/accept/reject -> social khong query `Key`, notification van push dung user.
5. Logout one device -> token bi remove, push sau logout khong gui toi device do.
6. Logout all devices -> tat ca token inactive.
7. Push raw `fcmTokens` test -> chi push Firebase, khong save in-app notification neu khong co `userIds`.
8. GetNotifications/mark read/delete van doc/ghi `Notifications` trong DB rieng.
9. `npm run build:notification` va `npm run build:all` xanh.

## Definition of Done

- Push notification khong doc DB auth.
- In-app notification doc/ghi trong notification DB rieng.
- Logout/revoke device lam Redis token cache het hieu luc.
- `NotificationDatabaseModule` khong con `keysModel`.
- `FirebaseService` khong import/inject/query `Key`.
- Notification khong import/inject truc tiep client auth.
- Notification fallback Redis miss bang API gateway den auth, khong goi thang auth service.
- Chat social khong query `Key` de lay FCM token.
- Khong them model/modal/bang/collection moi.
- Notification startup voi `DB_NAME=appchat_notification`.
- `npm run build:notification` va `npm run build:all` xanh.
