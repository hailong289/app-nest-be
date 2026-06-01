# Tong Ket Xu Ly Service Database Sprints 0-7

Ngay tong ket: 2026-06-01

Tai lieu nay tong hop nhung viec da lam duoc va chua lam duoc sau chuoi sprint tach DB theo service va lam sach edge/infra.

## Ket Qua Kiem Chung Gan Nhat

- `npm run check:db-ownership`: pass, khong con violation ownership.
- `npm run check:no-direct-cross-service-grpc`: pass o che do strict, khong con direct cross-service gRPC bi cam.
- `npm run ci:guardrail`: pass, bao gom ownership checks va `build:all`.
- Build toan bo app da pass: api-gateway, auth, chat, notification, filesystem, ai, learning, socket, sfu.

## Sprint 0 - Shared Guardrail

Da lam duoc:

- Thiet lap guardrail ownership trong `scripts/check-db-ownership.mjs`.
- Kiem tra edge apps (`api-gateway`, `socket`, `sfu`) khong import Mongo model/DB barrel.
- Kiem tra shared libs (`libs/dto`, `libs/types`) khong phu thuoc Mongo model.
- Kiem tra service app chi import model thuoc DB owner cua minh.
- Kiem tra `.env.example` cua service co `DB_NAME` dung theo ownership.
- Them/duy tri scripts:
  - `check:db-ownership`
  - `check:edge-no-mongo`
  - `check:service-db-env`
  - `check:no-direct-cross-service-grpc`
  - `ci:guardrail`
- `check:no-direct-cross-service-grpc` hien chay strict, khong con warning legacy socket gRPC.

Chua lam duoc / can lam tiep:

- Chua dua guardrail nay vao pipeline CI thuc te cua repo/remote neu pipeline ngoai `package.json` chua goi script.
- Chua co smoke test runtime tu dong cho tung service voi Redis/Mongo/Kafka that.

## Sprint 1 - AI Service

Da lam duoc:

- AI duoc cau hinh DB rieng `appchat_ai`.
- AI chi so huu cac model AI-owned:
  - `AIEmbedding`
  - `AIUsageLogs`
- AI da dung `GatewayClientService` de goi API Gateway khi can du lieu/hanh dong cua filesystem, vi du:
  - resolve attachment cho AI.
  - persist transcript ve filesystem.
- AI khong query truc tiep `Users`, `Messages`, `Attachments`, `Documents` cua service khac.
- AI env examples/dockers gan voi `appchat_ai` va co `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET`.

Chua lam duoc / can lam tiep:

- Chua chay smoke test that voi Google/Gemini API key.
- Chua chay runtime test embedding/search/transcribe tren Mongo `appchat_ai` that.
- Chua verify chi phi/usage logs bang du lieu production-like.

## Sprint 2 - Notification Service

Da lam duoc:

- Notification duoc cau hinh DB rieng `appchat_notification`.
- Notification chi so huu model `Notification`.
- Da go bo phu thuoc truc tiep vao `Keys`; FCM token flow di Redis-first va fallback qua API Gateway -> Auth:
  - `/internal/auth/users/fcm-tokens`
  - `/internal/auth/users/resolve-business-ids`
- Notification co `GatewayClientService` dung `GATEWAY_URL` va `GATEWAY_INTERNAL_SECRET`.
- API Gateway tach public raw token test route voi production userIds flow.
- Auth -> Notification OTP/forgot-password da chuyen sang internal routes:
  - `/internal/notifications/send-otp`
  - `/internal/notifications/forgot-password`

Chua lam duoc / can lam tiep:

- Chua verify delivery that voi Firebase credential/mail credential.
- Chua test end-to-end push notification voi token mobile that.
- Chua cau hinh secret production trong secret manager; `.env.example` chi la template.

## Sprint 3 - Filesystem Service

Da lam duoc:

- Filesystem duoc cau hinh DB rieng `appchat_filesystem`.
- Filesystem chi so huu:
  - `Attachment`
  - `Document`
- Filesystem dung API Gateway internal endpoints de lay du lieu service khac:
  - Auth user batch/resolve.
  - Chat room resolve/check-access/members.
  - Chat attach message attachments.
- Bo lookup/import truc tiep `Users`, `Rooms`, `Messages` cua service khac.
- Bo sung/hop thuc cac contract hydration:
  - attachments hydrate.
  - documents hydrate.
  - resolve attachment for AI.
  - save attachment transcript.

Chua lam duoc / can lam tiep:

- Chua smoke test upload/download voi S3 credential that.
- Chua chay migration copy `Attachments`/`Documents` sang `appchat_filesystem`.
- Chua verify tat ca permission document/room tren data production-like.

## Sprint 4 - Learning Service

Da lam duoc:

- Learning duoc cau hinh DB rieng `appchat_learning`.
- Learning chi so huu:
  - `Quiz`
  - `Flashcard`
  - `FlashcardDeck`
  - `FlashcardProgress`
  - `Todo`
  - `TodoProject`
- Learning dung `GatewayClientService` de hydrate/resolve:
  - Auth user summary/batch/resolve.
  - Chat room resolve/check-access.
  - Chat learning-card-status.
- Bo phu thuoc truc tiep vao `Users` va `Messages`.
- API Gateway co internal learning card hydrate route.
- Them `.env.docker.example` cho learning.

Chua lam duoc / can lam tiep:

- Chua chay migration copy quiz/flashcard/todo data sang `appchat_learning`.
- Chua runtime smoke test tao quiz/flashcard/todo trong room that.
- Chua xac minh full FE flow learning-card render tren chat sau split DB.

## Sprint 5 - Chat Service

Da lam duoc:

- Chat duoc cau hinh DB rieng `appchat_chat`.
- Chat chi so huu cac collection chat/social/call:
  - Rooms, Messages, message reads/hides/reactions.
  - Room state/event collections.
  - Friendships.
  - CallHistory.
- Chat khong con query/import truc tiep auth/filesystem/learning-owned models.
- Them `GatewayClientService` va config gateway cho Chat.
- Room/message/social/call flow dung API Gateway de hydrate/resolve user/file/learning data khi can.
- Social/friendship flow phan biet `usr_id` cho social public/business flow va Mongo `_id` cho object fields/notification.
- API Gateway co internal chat endpoints cho:
  - room resolve/check-access/members.
  - message attachments.
  - learning-card-status.
  - socket message/call commands sau Sprint 7.
- `ci:guardrail` pass sau Sprint 5, khi do con 8 warning socket direct gRPC duoc danh dau cho Sprint 7.

Chua lam duoc / can lam tiep:

- Chua chay migration copy chat/social/call collections sang `appchat_chat`.
- Chua runtime smoke test day du send/read/react/pin/delete/recall/call tren multi-user data that.
- Chua xac minh tat ca FE payload cu khong con truyen nham `usr_id` vao field can Mongo `_id`.

## Sprint 6 - Auth Service

Da lam duoc:

- Auth duoc cau hinh DB rieng `appchat_auth`.
- Auth chi so huu:
  - `Users`
  - `Keys`
  - `Otps`
- Auth la source of truth cho user/session/OTP/device FCM token.
- Them `AuthGatewayClient` co timeout, internal headers va secret.
- Thay cac call notification cua Auth bang API Gateway internal route.
- Them/chuan hoa gRPC contracts:
  - `GetFcmTokensByUsers`
  - `ResolveUsersByBusinessIds`
  - `GetUserSummary`
  - `GetUsersBatch`
- Chuan hoa user summary an toan, co ca:
  - `_id` / `userId`: Mongo ObjectId.
  - `usr_id` / `id`: business id.
  - name/fullname/email/phone/avatar/status/slug/gender/dateOfBirth/address.
- FCM token lookup Redis-first, miss thi fallback `Keys` active va hydrate lai Redis.
- `OtpSchema` index da sua tu `email` sang `indicator`.
- Auth env/build chuan hoa `DB_NAME=appchat_auth`, `PROTO_URL`, `GATEWAY_INTERNAL_SECRET`.
- API Gateway co internal auth endpoints:
  - `/internal/auth/users/batch`
  - `/internal/auth/users/resolve-business-ids`
  - `/internal/auth/users/search`
  - `/internal/auth/users/fcm-tokens`

Chua lam duoc / can lam tiep:

- Chua chay migration copy `Users`, `Keys`, `Otps` sang `appchat_auth`.
- Chua tao Mongo credential rieng `appchat_auth_rw`.
- Chua runtime smoke test register OTP -> verify -> register -> login -> refresh -> logout tren DB split that.
- Chua verify email OTP delivery that sau khi doi sang internal notification route.

## Sprint 7 - Edge Services And Infra

Da lam duoc:

- `api-gateway`, `socket`, `sfu` khong co DB ownership va khong co DB env trong `.env.example`.
- `socket` khong con direct gRPC client den Chat/Filesystem/AI.
- `socket` dung `SocketGatewayClient` goi API Gateway internal endpoints voi:
  - `x-internal-service: socket`
  - `x-internal-secret` neu cau hinh.
- `socket` van giu ngoai le hop le: goi SFU RPC truc tiep cho media plane.
- Them middleware guard/log co ban cho `/internal/*` trong API Gateway.
- Them internal routes phuc vu socket:
  - chat message create/read/react/pin/delete/recall.
  - chat call request/accept/end/status.
  - filesystem document open/update.
  - AI realtime transcription.
- Them internal notification routes cho Auth.
- Don env:
  - socket `.env.example`, `.env.development`, `.env.docker.example`.
  - sfu `.env.example`, `.env.docker.example`.
  - api-gateway `.env.example`, `.env.development`, `.env.docker.example`.
- Docker compose cap nhat:
  - them learning, socket, sfu.
  - edge services dung env khong co DB.
  - `docker-compose.dev.yml` khong con reference `.env.local` khong ton tai.
- Cloud Build:
  - gateway deploy block co env day du va khong co DB env.
  - them `build-socket-service.yaml`.
  - them `build-sfu-service.yaml`.
- `check:no-direct-cross-service-grpc` chay strict va pass sach.

Chua lam duoc / can lam tiep:

- Chua chay socket runtime smoke voi Redis adapter multi-instance.
- Chua chay SFU media smoke that:
  - CreateRoom/JoinRoom/CreateTransport/Produce/Consume/LeaveRoom.
  - verify secret sai bi reject.
  - verify UDP announced IP/port range trong moi truong production.
- Chua xac thuc Docker compose full stack bang `docker compose up`.
- Chua deploy Cloud Run/VM thuc te tu cac build yaml moi.

## Viec Con Lai Mang Tinh Van Hanh

- Tao Mongo databases:
  - `appchat_auth`
  - `appchat_chat`
  - `appchat_filesystem`
  - `appchat_ai`
  - `appchat_learning`
  - `appchat_notification`
- Tao Mongo users rieng va chi cap `readWrite` tren DB cua tung service:
  - `appchat_auth_rw`
  - `appchat_chat_rw`
  - `appchat_filesystem_rw`
  - `appchat_ai_rw`
  - `appchat_learning_rw`
  - `appchat_notification_rw`
- Khong tao Mongo credential cho edge services:
  - `api-gateway`
  - `socket`
  - `sfu`
- Copy/migrate collection tu DB cu sang DB moi theo ownership.
- Recreate indexes tren tung DB moi.
- Chay dry-run migration, verify document count/index, sau do moi switch traffic.
- Dua secrets that vao secret manager/env protected:
  - JWT secrets.
  - Gateway internal secret.
  - Firebase/mail credentials.
  - Google API key.
  - S3 credentials.
  - Mongo credentials.
- Chay smoke tests runtime voi Redis, Mongo, Kafka, Firebase/Mail, S3, Google API va SFU that.
- Xac nhan FE/mobile compatibility voi ID contract:
  - `_id` la Mongo ObjectId.
  - `usr_id` la business id.
  - public `id` neu co la alias cua `usr_id`, khong phai Mongo `_id`.
  - internal `userId/userIds` la Mongo `_id`.
  - internal `usrId/usrIds` chi dung de resolve business id qua Auth.

## Ket Luan

Phan code-level cho Sprint 0-7 da dat trang thai build/guardrail sach. Nhung phan chua hoan tat chu yeu la van hanh ha tang va runtime smoke test tren moi truong co dich vu that: Mongo split, credentials, migration data, Kafka/Redis, external providers, Docker/Cloud Run/VM va SFU media network.
