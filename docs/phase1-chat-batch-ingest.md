# Phase 1 — High-throughput chat ingest (Kafka micro-batch)

Additive, reversible refactor of the message send path. The legacy gRPC path
(`socket → CreateNewMsg → upsert(1) → broadcast`) is **100% intact** and remains
the default. A new optional Kafka batch path is gated behind one env var.

## Architecture

```
CHAT_INGEST_MODE=grpc  (DEFAULT, unchanged):
  socket onMessage → gRPC ChatService.CreateNewMsg → upsert(1) → broadcast

CHAT_INGEST_MODE=kafka  (new batch path):
  socket onMessage
    → produce Kafka topic "chat.inbound"  key=roomId  { ...data, userId, msgId }
    → ACK client immediately { ok:true, data:{ msgId } }   (optimistic)
  chat service — ChatInboundConsumer (raw kafkajs `eachBatch`, in-process)
    → real broker-side batch of records (NOT 1-msg-per-call)
    → chunk(batch.messages) by CHAT_INBOUND_CHUNK (default 500)
    → parse each message.value JSON; group items by payload.roomId
    → handleInboundBatch(items) per room group (Promise.all):
        validate members via room cache (per item, bad items dropped)
        messageModel.bulkWrite(updateOne upsert _id, { ordered:false })
        ONE aggregate $match{_id:$in} to enrich + serialize all msgs
        broadcast via existing RemoteSocketEmitter (Redis adapter)
        fire-and-forget MESSAGE_PERSISTED tail per msg (reuses existing consumer)
    → setInterval(heartbeat, 2000) while a chunk runs (cleared in finally)
    → resolveOffset(message.offset) per message, then commitOffsetsIfNecessary()
```

The old app-level micro-batch (a `setInterval` buffer fed by a NestJS
`@EventPattern("chat.inbound")` handler) has been **replaced** by a real
kafkajs `eachBatch` consumer (`apps/chat/src/handle-chat/chat-inbound.consumer.ts`,
modeled on hercules' batch pattern). This gives true broker-side batches plus
explicit offset + heartbeat control instead of an app-side timer. It runs in
the **same chat process** — no new microservice. The legacy gRPC path
(`ChatService.CreateNewMsg`) and the `MESSAGE_PERSISTED` NestJS consumer are
unchanged.

## How to enable

Both services now require the flag:

1. **socket** (producer gate):
   ```
   CHAT_INGEST_MODE=kafka
   ```
   (A commented `# CHAT_INGEST_MODE=grpc` line lives next to the KAFKA_* vars in
   `apps/socket/.env.development`.)
2. **chat** (consumer gate): set the SAME env var for the chat service. Unlike
   before, the chat `eachBatch` consumer is now **gated** — `ChatInboundConsumer.
   onModuleInit` is a no-op unless `CHAT_INGEST_MODE=kafka`, so by default
   nothing connects or consumes `chat.inbound`.
3. Restart both services. Default (`grpc` or unset) on either side → behavior
   unchanged.

To roll back: unset / set `CHAT_INGEST_MODE=grpc` on both services and restart.

### New env vars (chat service)

| Var | Default | Purpose |
| --- | --- | --- |
| `KAFKA_CHAT_INBOUND_CONSUMER` | `chat-inbound-batch` | consumer groupId for the `chat.inbound` `eachBatch` consumer |
| `CHAT_INBOUND_CONCURRENCY` | `3` | `partitionsConsumedConcurrently` (partitions processed in parallel) |
| `CHAT_INBOUND_CHUNK` | `500` | messages per inner chunk / commit boundary |

The consumer reuses the SAME Kafka connection config as the NestJS Kafka
transport (the `kafka` registerAs config → `client`: brokers / ssl / sasl,
read from `KAFKA_BROKERS` or `KAFKA_HOST`/`KAFKA_PORT`, `KAFKA_SASL*`), so
brokers + SASL always match the rest of the service.

## Mongo sharding (run manually, once)

The batch path is designed for a sharded `Messages` collection so writes spread
across shards. Run on a `mongos` against the `appchat` DB:

```js
sh.enableSharding("appchat")
sh.shardCollection("appchat.Messages", { msg_roomId: "hashed" })
```

`msg_roomId: "hashed"` spreads write load evenly while co-locating a room's
messages on a shard. (If sharding on a different key, ensure an index exists
first.)

## Idempotency

- The message `_id` is the idempotency key: client-supplied `data.id` if present,
  otherwise a server-generated **snowflake** (`libs/helpers/src/snowflake.ts`) —
  a 24-hex, time-ordered, monotonic, ObjectId-compatible string.
- `bulkWrite` uses `updateOne` with `upsert: true` filtered on `{ _id }`.
  Kafka redelivery → same `_id` → upsert no-op (no duplicate **within a shard**;
  hashed `_id`/`msg_roomId` keeps each id on one shard so dedup holds).
- The downstream `MESSAGE_PERSISTED` tail is itself deduped via the existing
  `MSG_PROCESSED(messageId)` Redis key.

## Manual test plan

1. **Default (grpc) regression** — leave `CHAT_INGEST_MODE` unset. Send messages
   from the FE. Confirm identical behavior to before (message appears, unread,
   push, read receipts all work). gRPC path untouched.
2. **Enable kafka** — set `CHAT_INGEST_MODE=kafka` on socket, restart.
   - Send a single message. Confirm the client gets `{ ok:true, data:{ msgId } }`
     near-instantly and the message appears for all room members via
     `message:upsert` (broadcast from chat service, not gateway).
   - Confirm the row exists in Mongo `Messages` with `_id === msgId`.
   - Confirm unread counts / push / last_message update (the MESSAGE_PERSISTED
     tail still fires).
3. **Idempotency** — send two messages with the *same* client `id` (or replay the
   Kafka record). Confirm only ONE `Messages` doc exists for that `_id`.
4. **Batch / throughput** — fire a burst (e.g. >500 quick sends, or multiple
   rooms). Confirm all messages land, ordering within a room is preserved
   (key=roomId), and the flush batches them (watch chat logs for batch sizes).
5. **Bad input resilience** — send to a room the user is not a member of (or a
   blocked private peer). Confirm that item is silently dropped and the rest of
   the batch still succeeds.

## Risks / assumptions / TODO

- **Assumption:** the Kafka producer uses `emit({ key: roomId, value })` so the
  partition key = roomId, giving per-room ordering. Cross-room ordering is not
  guaranteed (acceptable).
- **Risk (latency vs durability):** tail is fire-and-forget (same trade-off as
  the existing gRPC path). If the chat process dies between broadcast and
  MESSAGE_PERSISTED produce, that message's tail (unread/push/embedding) is lost
  — switch to transactional-outbox for absolute durability later.
- **Risk (optimistic ack):** the socket acks before the DB write. A failed batch
  means the message is dropped after the client already saw an ack. The client
  should reconcile via the catch-up sync (`SyncEvents` / change-feed) — same as
  today's realtime-first design.
- **TODO Phase 1b:** the batch enrichment reuses `buildMessagesDetailPipeline`
  (`$match {_id:{$in}}`) — already a single aggregate per flush, good. Consider a
  leaner projection for the broadcast-only fields to cut aggregate cost further.
- **TODO Phase 1b — DLQ / poison batch:** the `eachBatch` handler wraps each
  chunk in try/catch and, on error, **logs then still resolves offsets** for the
  chunk so a poison record can't infinite-loop the consumer. This is safe because
  items are idempotent via `_id` (bulkWrite upsert), but it means a permanently
  failing record is dropped. Phase 1b should route the raw failed value + error
  to a dead-letter topic for inspection/replay instead of silently committing
  past it.
- **TODO Phase 1b — tuning:** `CHAT_INBOUND_CHUNK` (commit granularity) and
  `CHAT_INBOUND_CONCURRENCY` (`partitionsConsumedConcurrently`) should be tuned
  against measured throughput and the partition count of `chat.inbound`.
```
