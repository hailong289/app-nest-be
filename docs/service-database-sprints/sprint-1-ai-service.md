# Sprint 1 - AI Service

## Goal

Dua `ai` ve database rieng som nhat vi domain so huu ro nhat. AI chi so huu embedding/log usage, khong doc/ghi truc tiep DB cua chat/filesystem/auth.

## Database Target

`appchat_ai`

## Owned Models

- `AIEmbedding`
- `AIUsageLogs`

Khong tu them model/modal/collection moi trong sprint nay. Chi duoc dung va sua cac model hien co cua AI la `AIEmbedding` va `AIUsageLogs`. Neu can du lieu tu chat/filesystem/auth thi AI phai call qua API gateway den service do, khong query Mongo collection cua service khac va khong inject truc tiep model/client cua service khac.

## Source Scan

Files can xu ly trong sprint nay:

- `apps/ai/src/app.module.ts`
- `apps/ai/src/ai.controller.ts`
- `apps/ai/src/ai.service.ts`
- `apps/ai/src/embedding.service.ts`
- `apps/ai/src/ai-log-use.service.ts`
- `apps/ai/src/config/google.config.ts`
- `apps/api-gateway/src/ai/gateway-ai.controller.ts`
- `apps/api-gateway/src/filesystem/gateway-filesystem.controller.ts`
- `apps/api-gateway/src/filesystem/docs/gateway-document.controller.ts`
- `apps/api-gateway/src/chat/gateway-chat.controller.ts`
- `apps/api-gateway/src/gateway/gateway.service.ts`
- `libs/helpers/src/utils.ts`
- `libs/db/src/mongo/service-database.modules.ts`
- `libs/db/src/mongo/model/AIEmbedding.model.ts`
- `libs/db/src/mongo/model/AIUsageLogs.model.ts`
- `libs/grpc/ai.proto`
- Producers hien tai: `apps/chat/src/handle-chat/handle-chat.service.ts`, `apps/filesystem/src/filesystem.service.ts`, `apps/filesystem/src/documents/documents.service.ts`

## Current Coupling To Remove

- `apps/ai/src/app.module.ts` van import/register `User`, `Message`, `Attachment` ngoai AI domain.
- `AiDatabaseModule` van dang giu legacy models: `userModel`, `messagesModel`, `attachmentModel`, `documentModel`.
- `AIService` inject `Message` va `Attachment`.
- `AIService.searchMessages()` fallback query truc tiep `Messages`.
- `AIService.transcribeAttachment()` query/update truc tiep `Attachments` de doc URL audio va luu transcript.
- `EmbeddingService` inject `Attachment`, `Document`, `Message`.
- `EmbeddingService.searchSimilarMessages()` query `Attachments` va `Documents` de lay file/doc ids trong room.
- `EmbeddingService.searchSimilarMessages()` query `Messages` de loc system messages.
- `EmbeddingService.fallbackKeywordSearchOnMessages()` query truc tiep `Messages`.
- `AI_PROCESS_FILE_EMBEDDING` consumer hien dang goi `createEmbedding()` voi `text = fileUrl`, chua dung `processFileEmbedding()` de download file va trich xuat text/image/video/audio description.

## Target Flow

- AI chi doc/ghi `AIEmbedding` va `AIUsageLogs` trong `appchat_ai`.
- Chat/filesystem gui du snapshot qua Kafka de AI tao embedding ma khong can query DB cua service khac.
- Search cua AI chi search tren `AIEmbedding`; metadata/snapshot can render phai nam trong embedding record hoac API gateway/caller hydrate tu owner service.
- Neu AI can du lieu owner theo request on-demand, vi du lay file URL de transcribe attachment, AI call API gateway den filesystem endpoint noi bo.
- STT cho attachment khong cap nhat `Attachments` truc tiep; AI tra transcript cho gateway/caller hoac call gateway/filesystem endpoint noi bo de filesystem persist transcript.
- Gateway la lop forward/orchestrate den chat/filesystem/auth; AI khong goi thang gRPC/chat/filesystem/auth va khong query DB cua cac service do.

## Tasks

### 1. Chuan hoa schema metadata cua `AIEmbedding`

1. Khong tao collection/model moi; chi mo rong schema `AIEmbedding` hien co neu can.
2. Mo rong `AIEmbedding` de luu metadata can search/render:
   - `sourceService`: `chat` | `filesystem` | `document`
   - `sourceType`: `message` | `attachment` | `document`
   - `sourceId`
   - `roomId`
   - `roomIds`
   - `userId`
   - `messageId`
   - `isSystemMessage`
   - `visibility`
   - `snapshot`: object nho gom content/name/mimeType/kind/url/title/size neu can render nhanh.
3. Giu backward compatibility voi field cu `contextType`, `contextId`, `messageId` trong giai do migrate.
4. Cap nhat index cho cac query AI can dung:
   - `{ sourceService: 1, sourceType: 1, sourceId: 1 }`
   - `{ roomId: 1, sourceType: 1, createdAt: -1 }`
   - `{ userId: 1, sourceType: 1, createdAt: -1 }`
   - `{ roomIds: 1, sourceType: 1, createdAt: -1 }`
5. Kiem tra unique `hash` hien tai co phu hop khong. Neu cung noi dung xuat hien o 2 room khac nhau, unique hash global co the lam mat embedding; can doi sang unique compound theo `hash + sourceId/sourceType` neu can.

### 2. Them client goi API gateway cho AI khi can du lieu owner

1. Them config gateway cho AI app, de xuat:
   - `apps/ai/src/config/gateway.config.ts`
   - env `GATEWAY_URL=http://localhost:5000`
   - optional env `GATEWAY_INTERNAL_SECRET` neu can endpoint noi bo.
2. Import config vao `ConfigModule.forRoot()` cua `apps/ai/src/app.module.ts`.
3. Dung `Utils.callApiGateway()` hoac tao wrapper nho `GatewayClient` trong AI de goi HTTP den API gateway.
4. Tat ca request noi bo den gateway can truyen du context:
   - `x-internal-service: ai`
   - `x-internal-secret` neu gateway bat buoc ky noi bo.
   - `x-request-id` neu co.
   - `userId`/`actorUserId` trong body khi call noi bo khong co browser cookie.
5. Khong inject `ClientGrpc` chat/filesystem/auth vao AI. Neu gateway can bo sung contract de forward xuong service dich thi thay doi o gateway va service dich, khong de AI goi thang service do.

### 3. Bo sung gateway endpoints noi bo neu API hien co chua du

1. Filesystem gateway cho attachment/STT:
   - `POST /internal/filesystem/attachments/resolve-for-ai`
   - request `{ attachmentId, messageId, userId }`
   - response `{ attachmentId, messageId, roomId, userId, fileUrl, mimeType, kind, transcript, transcribedAt }`
2. Filesystem gateway persist transcript:
   - `POST /internal/filesystem/attachments/:attachmentId/transcript`
   - request `{ messageId, userId, transcript, detectedLanguage }`
   - filesystem validate ownership/context va update `Attachments`.
3. Chat gateway cho permission/hydration neu can:
   - `POST /internal/chat/rooms/check-access`
   - `POST /internal/chat/messages/hydrate`
   - dung de gateway/caller hydrate search result, khong bat AI query `Messages`.
4. Document/filesystem gateway cho permission/hydration neu can:
   - `POST /internal/filesystem/documents/check-access`
   - `POST /internal/filesystem/documents/hydrate`
5. Cac endpoint noi bo phai co guard/secret rieng, khong mo public neu co the doc/persist du lieu owner.
6. Khong tao cache collection user/message/attachment/document trong AI de thay the gateway call.

### 4. Sua Kafka payload vao AI

1. `KafkaEvent.AI_CHAT_MSG_EMBEDDING` tu chat can gui them:
   - `userId`
   - `roomId`
   - `messageId`
   - `text`
   - `msgType`
   - `isSystemMessage`
   - `createdAt`
2. `KafkaEvent.AI_DOC_EMBEDDING` tu filesystem/documents can gui them:
   - `docId`
   - `userId`
   - `roomIds`
   - `title`
   - `plainText`
   - `visibility`
   - `updatedAt`
3. `KafkaEvent.AI_PROCESS_FILE_EMBEDDING` tu filesystem can gui them:
   - `attachmentId`
   - `messageId`
   - `roomId`
   - `userId`
   - `fileUrl`
   - `fileType`
   - `mimeType`
   - `name`
   - `size`
4. Tao DTO/interface rieng cho cac payload tren trong `libs/dto` de producers va consumer dung chung type.
5. Producers phai gui snapshot du dung de AI index, tranh viec AI phai goi gateway trong path Kafka binh thuong.

### 5. Sua consumer trong `AIController`

1. `createChatMessageEmbedding()` truyen metadata moi vao `EmbeddingService.createEmbedding()`.
2. `createDocumentEmbedding()` dung `plainText/text` va luu `sourceType=document`, `sourceId=docId`, `roomIds`, `visibility`.
3. `processFileEmbedding()` phai goi `EmbeddingService.processFileEmbedding()` thay vi goi `createEmbedding()` voi `text=fileUrl`.
4. Them validate payload toi thieu; neu thieu `sourceId`/`text`/`fileUrl` thi log va skip, khong throw lam retry vo han.
5. Neu payload Kafka thieu du lieu owner, yeu cau producer bo sung snapshot; chi fallback gateway cho case on-demand/compat, khong query DB.

### 6. Go DB coupling trong `AIService`

1. Xoa inject `Message` va `Attachment`.
2. Xoa import `Message`, `Attachment` tu `libs/db/src`.
3. `searchMessages()` khong fallback query `Messages`; neu vector/keyword tren `AIEmbedding` khong co ket qua thi tra `[]`.
4. `transcribeAttachment()` khong query/update `Attachments`:
   - Option A uu tien: API gateway/filesystem resolve attachment truoc, roi goi AI voi `fileUrl`, `mimeType`, `cachedTranscript`, `attachmentId`, `messageId`.
   - Option B: AI call API gateway endpoint `POST /internal/filesystem/attachments/resolve-for-ai` de lay file metadata.
   - Sau khi co transcript, AI tra response cho gateway/caller hoac call gateway/filesystem endpoint persist transcript.
5. Neu can async persist transcript, them Kafka event `ai.attachmentTranscribed` de filesystem consume va update `Attachments`; khong them collection moi trong AI.

### 7. Go DB coupling trong `EmbeddingService`

1. Xoa inject `Attachment`, `Document`, `Message`.
2. `searchSimilarMessages()` chi query `AIEmbedding` theo `roomId`, `sourceType`, `isSystemMessage`.
3. Xoa buoc query `Attachments`/`Documents` de lay ids theo room; thay bang metadata `roomId`/`roomIds` da luu trong embedding.
4. Xoa buoc query `Messages` de loc system message; thay bang `isSystemMessage`.
5. Xoa `fallbackKeywordSearchOnMessages()` hoac doi thanh fallback keyword tren `AIEmbedding.text`.
6. `searchSimilarDocuments()` loc theo metadata trong `AIEmbedding`; neu can permission thi de API gateway/caller goi owner service check/hydrate, hoac AI call gateway endpoint noi bo.
7. `processFileEmbedding()` chi dung `fileUrl`/metadata tu Kafka payload hoac gateway response; khong query `Attachments`.

### 8. Don `app.module` va database module

1. Trong `apps/ai/src/app.module.ts`, chi register:
   - `AIUsageLogSchema`
   - `AIEmbeddingSchema`
2. Xoa register `Userschema`, `MessageSchema`, `AttachmentSchema`.
3. Trong `AiDatabaseModule`, chi register:
   - `aIEmbeddingModel`
   - `aIUsageLogModel`
4. Xoa legacy:
   - `userModel`
   - `messagesModel`
   - `attachmentModel`
   - `documentModel`
5. Dam bao `apps/ai` khong con import/inject model ngoai domain.
6. Dam bao `apps/ai` khong import/inject truc tiep client chat/filesystem/auth.

### 9. Doi database rieng va migrate data

1. Doi env AI:
   - `.env.development`
   - `.env.example`
   - `.env.docker` neu co
   - Cloud Build YAML neu dang truyen `DB_NAME`
2. Set `DB_NAME=appchat_ai`.
3. Copy collections tu DB cu sang DB moi:
   - `AIEmbedding`
   - `AIUsageLogs`
4. Khong copy `Users`, `Messages`, `Attachments`, `Documents` sang AI DB.
5. Tao Mongo credential rieng cho AI chi co quyen tren `appchat_ai`.
6. Tao/kiem tra Atlas vector index `vector_index` tren `AIEmbedding.vector`.

### 10. Backfill va compatibility

1. Viet script backfill embedding metadata cho records cu:
   - `contextType=room` -> `sourceType=message`, `roomId=contextId`, `sourceService=chat`
   - `contextType=doc` -> `sourceType=document`, `sourceService=filesystem`
   - `contextType=file` -> `sourceType=attachment`, `sourceService=filesystem`
2. Neu thieu `roomId` cho file/doc embedding cu:
   - uu tien re-emit Kafka snapshot tu filesystem/chat truoc cutover.
   - chi call gateway owner service trong script compat neu that su can.
3. Chay song song voi DB cu trong dev/staging truoc khi cutover.
4. Khong tao collection backfill/cache moi trong AI DB.

### 11. Smoke test can co

1. Chat message event -> AI tao `AIEmbedding` voi `sourceType=message`, `roomId`, `messageId`, `isSystemMessage`.
2. File event -> AI dung `processFileEmbedding()`, trich xuat text/image/video/audio va luu `sourceType=attachment`.
3. Document event -> AI luu `sourceType=document`, `roomIds`, `visibility`.
4. Search trong room -> chi query `AIEmbedding`, khong query `Messages`, `Attachments`, `Documents`.
5. Search doc/file -> chi query `AIEmbedding`; permission/hydration qua gateway/caller neu can.
6. Transcribe attachment -> khong query/update `Attachments` truc tiep; resolve/persist qua API gateway/filesystem hoac caller gui du file metadata.
7. Usage report van doc `AIUsageLogs` trong AI DB rieng.
8. `npm run build:ai` va `npm run build:all` xanh.

## Definition of Done

- AI startup voi `DB_NAME=appchat_ai`.
- Embedding chat/file/doc van chay qua Kafka snapshot.
- AI khong import/inject model cua chat/filesystem/auth.
- AI khong import/inject truc tiep client chat/filesystem/auth.
- `apps/ai` chi inject `AIEmbedding` va `AIUsageLogs`.
- `AiDatabaseModule` khong con legacy model ngoai AI domain.
- Khong them model/modal/collection moi.
- Moi data can tu chat/filesystem/auth duoc lay bang API gateway den service do.
- `SearchMessages`, `Search`, `TranscribeAttachment`, usage report co smoke test.
- `npm run build:ai` va `npm run build:all` xanh.
