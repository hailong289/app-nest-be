# Kế hoạch & Sprint — Cơ cấu Chat mới (Kafka batch ingest)

> Nhánh: `perf/chat-fast-emit` · Trạng thái: **chưa merge master** · Cập nhật: 2026-06-21
> Legend: ✅ Done · 🟡 Một phần · ⬜ Chưa làm

---

## 1. Mục tiêu

Tăng **độ chịu tải + chịu burst** của luồng chat và **tối ưu chi phí Cloud Run**, trong khi **giữ độ trễ thấp** và **KHÔNG đổi FE**.

Hướng tới: hạ tầng Cloud Run autoscale, dài hạn nhắm tải lớn (đường tới ~1M msg/s được tài liệu hoá theo phase).

---

## 2. Kiến trúc: Cũ vs Mới

**Cũ (gRPC đồng bộ):**
```
client → socket(message:send) → gRPC CreateNewMsg → chat: findOneAndUpdate(1 tin)
       + aggregate(1 tin) → broadcast Redis → fire MESSAGE_PERSISTED
```
Mỗi tin = 1 gRPC round-trip + 2 op Mongo (tuần tự) → nghẽn khi burst, người gửi bị chặn.

**Mới (Kafka batch ingest — MẶC ĐỊNH, luôn chạy; đặt `CHAT_INGEST_MODE=grpc` để tắt):**
```
client → socket(message:send) → produce Kafka "chat.inbound" (key=roomId) → ack {msgId} NGAY
chat: eachBatch consumer → chunk → group theo roomId → bulkWrite(upsert _id, lô)
     → 1 aggregate/lô → broadcast Redis (message:upsert) → fire MESSAGE_PERSISTED (tail)
```
- Kafka **đệm burst**; ghi DB **theo lô**; ack optimistic; scale ngang qua partition + consumer instance.
- **Fallback**: đặt `CHAT_INGEST_MODE=grpc` → luồng cũ y nguyên, rollback tức thì (mặc định là kafka).
- **FE không đổi**: event `message:upsert` + payload giữ nguyên contract.

---

## 3. ĐÃ TRIỂN KHAI ✅ (trên nhánh `perf/chat-fast-emit`)

### 3.1 Phase 0 — Fast emit (giảm độ trễ luồng cũ) ✅
`apps/chat/src/handle-chat/handle-chat.service.ts` — `createMessage()`:
- Song song hoá `aggregate` + `changeFeed.nextSeq()` (Promise.all) → bớt 1 round-trip cloud.
- Broadcast `message:upsert` NGAY sau khi có payload.
- Tail `MESSAGE_PERSISTED` chuyển **fire-and-forget** (`void ... .catch`) → ACK người gửi không chờ Kafka.

### 3.2 Phase 1 — Kafka batch ingest ✅ (MẶC ĐỊNH BẬT)
| Hạng mục | File |
|---|---|
| Enum topic `CHAT_INBOUND='chat.inbound'` | `libs/dto/src/enum.type.ts` |
| Snowflake id (k-sortable, sinh tại chỗ) | `libs/helpers/src/snowflake.ts` (+ `index.ts`) |
| Socket produce `chat.inbound` (key=roomId) + ack optimistic; gRPC fallback | `apps/socket/src/chat/chat-gateway.ts` (`onMessage`) |
| Producer Kafka gộp chung 1 `ClientsModule.registerAsync` với gRPC | `apps/socket/src/chat/chat.module.ts` |
| Token producer tách file (tránh circular import) | `apps/socket/src/chat/chat.tokens.ts` |
| **eachBatch consumer** (raw kafkajs, mẫu hercules `createConsumerHandleBatch`): chunk → group roomId → heartbeat 2s → resolveOffset → commit; default OFF; reuse kafka config | `apps/chat/src/handle-chat/chat-inbound.consumer.ts` |
| `handleInboundBatch()`: validate lô → `bulkWrite(upsert _id, ordered:false)` → 1 aggregate/lô → broadcast → fire-and-forget tail | `apps/chat/src/handle-chat/handle-chat.service.ts` |
| Bỏ `@EventPattern` micro-buffer (eachBatch thay thế) | `apps/chat/src/handle-chat/handle-chat.controller.ts` |
| **Tune fetch**: `maxWaitTimeInMs=50` + `minBytes=1` → độ trễ tải thấp ~7.7s → ~50–150ms | `chat-inbound.consumer.ts` |

**Idempotency**: `bulkWrite` upsert theo `_id` (client `id` hoặc snowflake) → redeliver Kafka an toàn, không trùng.

### 3.3 Fix DI circular import ✅
`CHAT_KAFKA_PRODUCER` để trong `chat.module.ts` mà `chat-gateway.ts` import ngược → token `undefined` lúc `@Inject` → socket crash boot (WS connect fail). → Tách sang `chat.tokens.ts`. Đã verify socket boot + bind 5006.

### 3.4 Keep-warm — tối ưu chi phí Cloud Run ✅
| Hạng mục | File |
|---|---|
| `rpc KeepWarm` | `libs/grpc/chat.proto` |
| Handler `@GrpcMethod KeepWarm` (no-op) | `apps/chat/src/handle-chat/handle-chat.controller.ts` |
| Wake-on-connect + keep-warm interval 5' (kafka mode) + `liveConns()` + `onModuleDestroy` | `apps/socket/src/chat/chat-gateway.ts` |

Cơ chế: còn ≥1 user online ở bất kỳ socket instance → ping `KeepWarm` → chat **thức** (consumer chạy). Hết user → hết ping → chat idle → **scale 0** (ngủ, tiết kiệm). → *Chat chỉ ngủ khi 0 user online.*

### 3.5 CI/CD (auto deploy sau merge master) ✅
`.github/workflows/deploy.yml` đã sẵn (push master + paths-filter). Đã thêm:
- `deploy-chat.yml`: `CHAT_INGEST_MODE=kafka`, `KAFKA_AUTO_CREATE_TOPICS=true`, `--min-instances=0 --no-cpu-throttling`.
- `deploy-socket.yml`: `CHAT_INGEST_MODE=kafka`, `KAFKA_AUTO_CREATE_TOPICS=true`, thêm `KAFKA_HOST/PORT/SASL/SASL_USERNAME/SASL_PASSWORD/SASL_MECHANISM` (producer cần).

### 3.6 FE ✅ (không đổi)
Đã xác minh: FE gửi `message:send` fire-and-forget (không dùng ack), render optimistic theo client `id`, `upsetMsg` merge theo `id`. Path kafka phát ra `message:upsert` cùng shape → **FE giữ nguyên**.

---

## 4. CHƯA TRIỂN KHAI ⬜ (Backlog theo phase)

### 4.1 Phase 1b — hoàn thiện ingest 🟡
- ⬜ **DLQ** cho poison batch (hiện: log + commit qua, dựa idempotency `_id`). Cần route value lỗi + error sang dead-letter topic để replay.
- ⬜ **Bỏ hẳn aggregate/lô**: build `serializedMsg` từ room cache + payload (không query Mongo cho broadcast) → bớt 1 read/lô.
- ⬜ Tune `CHAT_INBOUND_CHUNK` / `CHAT_INBOUND_CONCURRENCY` theo benchmark thật.

### 4.2 Phase 2 — Data tier (trần thật hiện tại) ⬜
- ⬜ **Mongo sharded** — hiện **STANDALONE** (167 docs). Cần:
  - Dựng **sharded cluster** (config RS + shard RS + mongos) **hoặc Atlas tier sharded**.
  - Sửa code: bỏ `directConnection:true` (`mongodb.module.ts`), `DB_HOST`→mongos (`mongo.config.ts`), thêm env `DB_DIRECT_CONNECTION`.
  - `sh.enableSharding` + index hashed + `sh.shardCollection("appchat.Messages", { msg_roomId:"hashed" })`.
  - **Audit ràng buộc**: query Messages phải kèm `msg_roomId` (tránh scatter-gather); giữ collection bị `$lookup` (Users, MessageReactions) **unsharded**; unique index phải prefix shard key.
  - ⚠️ **Chỉ shard khi benchmark chứng minh Mongo nghẽn ghi** — chưa cần lúc này.
- ⬜ **Replica set** (bước trung gian, rẻ hơn shard): HA + transactions.
- ⬜ **Redis Cluster / Memorystore cluster** cho fan-out scale.

### 4.3 Phase 2 — Consumer scaling trên Cloud Run ⬜
- ⬜ **Tạo sẵn topic `chat.inbound` nhiều partition** (auto-create = **1 partition = không song song**). Vd 12+ partition.
- ⬜ **Cloud Run KHÔNG autoscale theo Kafka lag** → cân nhắc tách consumer sang **GKE + KEDA** (scale theo consumer lag) khi tải cao.

### 4.4 Phase 2/3 — Fan-out ⬜
- ⬜ Fan-out (`message:upsert` qua Redis adapter) **chưa đổi** — ở scale rất cao là nút thắt. Cần **session registry / routing có chủ đích / sharded pub-sub**.

### 4.5 Phase 3 — Web-scale (~1M msg/s) ⬜
- ⬜ **ScyllaDB/Cassandra** cho message store (thay/bổ sung Mongo).
- ⬜ Regional sharding, fan-out layer chuyên dụng, edge.

### 4.6 FE (tuỳ chọn) ⬜
- ⬜ **Confirm-by-upsert timeout**: nếu sau ~5–8s không nhận `message:upsert` cho `id` → mark `failed` + cho retry (chắc hơn `autoMarkMessageSent` 3s).

### 4.7 Quan sát & kiểm thử ⬜
- ⬜ **Benchmark** (k6/artillery): bắn N tin/s qua socket, đo throughput + độ trễ + Kafka consumer lag.
- ⬜ **Load test thật** (hiện mới compile + smoke boot, **chưa chạy tải**).
- ⬜ **Monitoring**: Kafka lag, consumer health, hot-shard, độ trễ p95/p99.

---

## 5. Sprint đề xuất

| Sprint | Nội dung | Trạng thái |
|---|---|---|
| **S1 — Core ingest** | Phase 0 + Phase 1 (eachBatch + bulkWrite + tune fetch) + fix DI + FE giữ nguyên | ✅ Xong (trên nhánh) |
| **S2 — Deploy & cost** | CI env kafka + keep-warm + min-instances=0/no-cpu-throttling | ✅ Xong (trên nhánh) |
| **S3 — Verify** | Benchmark + load test + chốt tham số chunk/concurrency/partition | ⬜ |
| **S4 — Resilience** | DLQ + bỏ aggregate/lô + monitoring/alert | ⬜ |
| **S5 — Data tier** | Replica set/Atlas → (nếu write-bound) sharded cluster + audit query | ⬜ |
| **S6 — Scale-out** | Partition nhiều + consumer GKE/KEDA + fan-out routing | ⬜ |

---

## 6. Cấu hình / Env tham chiếu

| Env | Service | Mặc định | Ý nghĩa |
|---|---|---|---|
| `CHAT_INGEST_MODE` | socket, chat | **`kafka` (mặc định, luôn chạy)** | Đặt `grpc` để TẮT luồng mới, fallback gRPC cũ |
| `KAFKA_AUTO_CREATE_TOPICS` | socket, chat | — | `true` cho topic tự tạo (nên tạo tay nhiều partition) |
| `CHAT_INBOUND_MAX_WAIT_MS` | chat | `50` | fetch long-poll window (độ trễ tải thấp) |
| `CHAT_INBOUND_CHUNK` | chat | `500` | số tin/lô xử lý + commit |
| `CHAT_INBOUND_CONCURRENCY` | chat | `3` | partitionsConsumedConcurrently |
| `KAFKA_CHAT_INBOUND_CONSUMER` | chat | `chat-inbound-batch` | consumer groupId |
| `CHAT_KEEPWARM_MS` | socket | `300000` | chu kỳ ping keep-warm (<15' của Cloud Run) |

---

## 7. Rủi ro / Đánh đổi đã biết

- **Optimistic ack + fire-and-forget tail**: process chết giữa chừng có thể mất event tail của tin đó (unread lệch/không push). Change-feed catch-up bù phần lớn; bền tuyệt đối cần transactional-outbox.
- **Tin đầu sau khi chat ngủ dậy**: trễ ~2–5s (cold start + consumer join group). Wake-on-connect giảm nhẹ.
- **`--no-cpu-throttling` bắt buộc**: đánh thức instance chưa đủ — throttle CPU thì consumer vẫn đứng.
- **Auto-create 1 partition**: nghẽn throughput → phải tạo topic nhiều partition.
- **Trần hiện tại**: Mongo chưa shard + Cloud Run không scale theo lag + fan-out chưa đổi.

## 8. Rollback
Đặt `CHAT_INGEST_MODE=grpc` (hoặc xoá) ở socket + chat → về luồng gRPC cũ ngay, không cần đổi code/FE.
