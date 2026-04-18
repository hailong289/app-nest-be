# Tạo `apps/learning` – Microservice riêng cho Flashcard, Quizz, Todo

## Mô tả

Tạo một **NestJS microservice app mới** tên `learning` (tương tự `apps/ai`) để tách Flashcard, Quizz, Todo ra khỏi `apps/ai`.
Service mới chạy gRPC trên port **5005**, dùng chung file proto hiện có (`flashcard.proto`, `quizz.proto`, `todo.proto`).
Gateway sẽ kết nối tới `LEARNING_SERVICE` thay vì `AI_SERVICE` cho 3 tính năng này.

---

## Proposed Changes

### 1. Microservice mới: `apps/learning`

#### [NEW] `apps/learning/src/main.ts`
- Bootstrap NestJS gRPC microservice
- packages: `['quizz', 'flashcard', 'todo']`
- protoPath: `libs/grpc/ai.proto` (dùng chung)
- Port: **5005**

#### [NEW] `apps/learning/src/app.module.ts`
- Import MongooseModule, KafkaAdminModule, LearningModule

#### [NEW] `apps/learning/src/learning/learning.module.ts`
- Tương tự `learning.module.ts` đã tạo ở bước trước
- Import schema: QuizSchema, FlashcardSchema, flashcardDeckModel, flashcardProgressModel, TodoSchema
- controllers: QuizzController, FlashcardController, TodoController
- providers: QuizzService, FlashcardService, TodoService

#### [NEW] `apps/learning/.env.development`
- PORT=5005, DB, Kafka config

#### [NEW] `apps/learning/tsconfig.app.json`
- Extends root tsconfig

#### [NEW] `apps/learning/Dockerfile`
- Clone từ ai Dockerfile, thay `build:ai` → `build:learning`

---

### 2. Remove khỏi `apps/ai`

#### [MODIFY] [app.module.ts (ai)](file:///Users/hailong/daihoc/project-dh/app-nest-be/apps/ai/src/app.module.ts)
- Xóa `LearningModule` import (đã làm ở bước trước, giờ chuyển sang service riêng)
- Giữ nguyên `MongooseModule.forFeature` chỉ với AI schemas

#### [DELETE] `apps/ai/src/learning/learning.module.ts`
- File tạm đã tạo ở bước trước → xóa

---

### 3. Cấu hình monorepo

#### [MODIFY] [nest-cli.json](file:///Users/hailong/daihoc/project-dh/app-nest-be/nest-cli.json)
- Thêm project `learning`

#### [MODIFY] [package.json](file:///Users/hailong/daihoc/project-dh/app-nest-be/package.json)
- Thêm scripts: `build:learning`, `start:learning`, `dev:learning`

---

### 4. Gateway: kết nối tới `LEARNING_SERVICE`

#### [MODIFY] [libs/constants/src/services.ts](file:///Users/hailong/daihoc/project-dh/app-nest-be/libs/constants/src/services.ts)
- Thêm `LEARNING: 'LEARNING_SERVICE'`

#### [NEW] `apps/api-gateway/src/config/learning.config.ts`
- host: `GATEWAY_LEARNING_HOST` (default: localhost)
- port: `GATEWAY_LEARNING_PORT` (default: 5005)
- protoPath: `libs/grpc/ai.proto`

#### [NEW] `apps/api-gateway/src/learning/gateway-learning.module.ts`
- `GrpcClientModule.registerAsync` với `LEARNING_SERVICE`, packages: `['quizz', 'flashcard', 'todo']`
- controllers: GatewayQuizzController, GatewayFlashcardController, GatewayTodoController

#### [MODIFY] [gateway-quizz.controller.ts](file:///Users/hailong/daihoc/project-dh/app-nest-be/apps/api-gateway/src/ai/quizz/gateway-quizz.controller.ts)
- Thay `@Inject(SERVICES.AI)` → `@Inject(SERVICES.LEARNING)`

#### [MODIFY] [gateway-flashcard.controller.ts](file:///Users/hailong/daihoc/project-dh/app-nest-be/apps/api-gateway/src/ai/flashcard/gateway-flashcard.controller.ts)
- Thay `@Inject(SERVICES.AI)` → `@Inject(SERVICES.LEARNING)`

#### [MODIFY] [gateway-todo.controller.ts](file:///Users/hailong/daihoc/project-dh/app-nest-be/apps/api-gateway/src/ai/todo/gateway-todo.controller.ts)
- Thay `@Inject(SERVICES.AI)` → `@Inject(SERVICES.LEARNING)`

#### [MODIFY] [gateway-ai.module.ts](file:///Users/hailong/daihoc/project-dh/app-nest-be/apps/api-gateway/src/ai/gateway-ai.module.ts)
- Xóa 3 gateway controllers (Quizz/Flashcard/Todo) khỏi `GatewayAiModule`
- Xóa `packages: 'todo', 'quizz', 'flashcard'` khỏi AI gRPC client

#### [MODIFY] [app.module.ts (gateway)](file:///Users/hailong/daihoc/project-dh/app-nest-be/apps/api-gateway/src/app.module.ts)
- Import thêm `GatewayLearningModule`

---

## Open Questions

> [!IMPORTANT]
> Các file source của Quizz/Flashcard/Todo (`apps/ai/src/quizz/`, `apps/ai/src/flashcard/`, `apps/ai/src/todo/`) sẽ **giữ nguyên vị trí vật lý** và được import bởi `apps/learning`. Không di chuyển file để tránh break import paths trong gateway.

> [!NOTE]
> `apps/ai/src/learning/learning.module.ts` đã tạo ở bước trước sẽ bị xóa (thay bằng learning app riêng).

---

## Verification Plan

### Automated
```bash
nest build learning
nest build ai
nest build api-gateway
```

### Manual
- Chạy `dev:learning` và `dev:gateway`, kiểm tra gRPC endpoints của Flashcard/Quizz/Todo trả về đúng kết quả
