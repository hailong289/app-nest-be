# Kế hoạch tối ưu CPU MongoDB — luồng gửi tin & đánh dấu đã đọc

- **Ngày:** 2026-05-30
- **Triệu chứng:** Mongo CPU 90–100% khi tải luồng `createMessage` + `markReadUpTo`.
- **Repo:** `app-nest-be`, file chính [handle-chat.service.ts](../../../apps/chat/src/handle-chat/handle-chat.service.ts) + [Pipeline/getMsg.ts](../../../apps/chat/src/handle-chat/Pipeline/getMsg.ts).

## Kết luận ngắn

CPU bị đốt KHÔNG phải do ghi tin nhắn, mà do **các phép ĐỌC/AGGREGATE nặng chạy lặp theo số thành viên** trên mỗi lần gửi/đọc, cộng với **vài index còn thiếu** khiến nhiều `$lookup` phải **collection-scan**.

Thủ phạm theo mức ảnh hưởng:

| # | Nguyên nhân | Mức |
|---|---|---|
| 1 | `recomputeUnreadForUserRoom` chạy **per-member** (aggregate + write) trên mỗi `createMessage` và mỗi `markReadUpTo` | 🔴 Chính |
| 2 | `markReadUpTo` recompute cho **TẤT CẢ** member (kể cả người không đọc) | 🔴 Chính |
| 3 | Thiếu index `MessageReads.msg_id` và `MessageHides.msg_id` → collscan mỗi lần build message detail & recompute | 🔴 Chính |
| 4 | `buildMessageDetailPipeline` ~15 `$lookup` (có nested) chạy mỗi lần gửi/đọc/react | 🟠 Phụ |
| 5 | `buildMessageCorePipeline` lặp lookup FlashcardDeck/TodoProject **3 lần** | 🟠 Phụ (lãng phí thuần) |

---

## Phân tích chi tiết

### 1. Fan-out `recomputeUnreadForUserRoom` (nguyên nhân số 1)

Hàm [recomputeUnreadForUserRoom](../../../apps/chat/src/handle-chat/handle-chat.service.ts#L399) cho **một** (user, room):

```
RoomsUsersState.findOne(...)                       // 1 read
messageModel.aggregate([                            // 1 aggregate nặng
  $match { msg_roomId, msg_sender != uid, deletedAt null, createdAt > baseTs },
  $lookup MessageHides (sub-pipeline cho TỪNG message),   // O(số message chưa đọc)
  $match { hiddenByMe size 0 },
  $count
])
RoomsUsersState.findOneAndUpdate($set unread_count) // 1 write
```

Được gọi **theo vòng lặp số thành viên**:

- `createMessage` ([dòng 374-378](../../../apps/chat/src/handle-chat/handle-chat.service.ts#L374)): chạy cho **mọi member khác** người gửi → nhóm N người = **(N-1) aggregate + (N-1) write** mỗi tin.
- `markReadUpTo` ([dòng 538-545](../../../apps/chat/src/handle-chat/handle-chat.service.ts#L538)): chạy cho **TẤT CẢ member** → **N aggregate + N write** mỗi lần ai đó đọc.

Với phòng đông + nhiều người gửi/đọc đồng thời → số aggregate bùng nổ theo (số tin × số member). Mỗi aggregate lại có `$lookup MessageHides` chạy cho từng message chưa đọc → cực tốn CPU. **Đây là nguồn chính của 90–100% CPU.**

Đáng nói: `markReadUpTo` recompute cho cả những member **không liên quan** (họ không đọc gì) — sai về mặt ngữ nghĩa và lãng phí toàn bộ.

### 2. Thiếu index → collscan

Index hiện có (xác minh từ model):

- `Messages`: `{msg_roomId,createdAt}`, `{msg_sender,createdAt}`, `{msg_roomId,msg_content_norm}`, `{msg_roomId,deletedAt,createdAt}` ✅ đủ cho recompute match.
- `MessageReactions`: `{msg_id,emoji}` ✅ phủ lookup reactions.
- `RoomsUsersState`: `{user_id,room_id}` unique, `{user_id,unread_count}` ✅.
- **`MessageReads`: chỉ `{room_id,user_id}` unique — KHÔNG có index theo `msg_id`.**
- **`MessageHides`: `{user_id,room_id,msg_id}` và `{room_id,msg_id}` — `msg_id` KHÔNG đứng đầu index nào.**

Hệ quả: trong `buildMessageDetailPipeline` (và Core/Multiple), các lookup
`MessageReads {$eq msg_id}` ([getMsg.ts:970](../../../apps/chat/src/handle-chat/Pipeline/getMsg.ts#L970)),
`MessageHides {$eq msg_id}` (hides + reply-hides, [getMsg.ts:948](../../../apps/chat/src/handle-chat/Pipeline/getMsg.ts#L948)) đều **không dùng được index theo `msg_id`** → **COLLSCAN** mỗi lần build detail. Mà build detail chạy trên **mọi** `createMessage`/`markReadUpTo`/react/delete. Recompute cũng dùng `$lookup MessageHides` per-message với cùng vấn đề.

### 3. `buildMessageDetailPipeline` nặng và chạy quá thường xuyên

Mỗi lần gửi/đọc/react/xoá, code chạy `messageModel.aggregate(buildMessageDetailPipeline(...))` để dựng payload realtime. Pipeline có ~15 `$lookup`: Users(sender), Attachments + nested aiembeddings, Messages(reply) + Users(reply_sender) + MessageHides(reply), MessageReactions + Users, MessageHides, MessageReads + Users, CallHistories, Quizzes, FlashcardDecks, TodoProjects, RoomEvents + Users×2. Với index thiếu (mục 2) thì càng đắt.

Riêng [buildMessageCorePipeline](../../../apps/chat/src/handle-chat/Pipeline/getMsg.ts#L296) **lặp y hệt** khối lookup `FlashcardDecks` + `TodoProjects` **3 lần** ([dòng 617-681](../../../apps/chat/src/handle-chat/Pipeline/getMsg.ts#L617)) — 4 lookup thừa hoàn toàn mỗi message trong danh sách.

---

## Kế hoạch tối ưu (phân pha theo rủi ro/độ lợi)

### Phase A — Quick wins (rủi ro thấp, không đổi hành vi)

- **A1. Thêm index `MessageReads.index({ msg_id: 1 })`** (hoặc `{ msg_id: 1, user_id: 1 }`). Bỏ collscan ở read_list lookup.
- **A2. Thêm index `MessageHides.index({ msg_id: 1 })`.** Bỏ collscan ở hides/reply-hides lookup + recompute.
- **A3. Bỏ 2 khối lookup FlashcardDecks/TodoProjects lặp lại** trong `buildMessageCorePipeline` (giữ 1 lần). Giảm 4 lookup thừa/message ở danh sách.
- *Lưu ý:* index phải được tạo thật trong Mongo (nếu prod tắt `autoIndex` thì chạy `createIndex` thủ công).

### Phase B — Sửa fan-out unread (độ lợi CPU lớn nhất)

- **B1. `createMessage`: thay (N-1) recompute bằng MỘT `updateMany($inc unread_count: 1)`** cho các member khác người gửi (lọc `muted:false` nếu muốn). Bỏ vòng `userMongoIds.map(recompute...)` ([dòng 374-378](../../../apps/chat/src/handle-chat/handle-chat.service.ts#L374)). Counter tăng O(1), không aggregate.
- **B2. `markReadUpTo`: chỉ reset unread của CHÍNH người đọc về 0** (đã có update riêng ở [dòng 526-535](../../../apps/chat/src/handle-chat/handle-chat.service.ts#L526)); **bỏ hẳn** vòng recompute cho mọi member ([dòng 538-545](../../../apps/chat/src/handle-chat/handle-chat.service.ts#L538)). Người khác đọc không làm đổi unread của họ.
- **B3. Recompute chính xác (có trừ hidden) chỉ chạy khi cần:** khi ẩn/xoá tin (`handleDeleteForUser`/`handleDelete`) cho đúng (các) user bị ảnh hưởng, hoặc một job reconcile định kỳ — KHÔNG chạy trên mỗi gửi/đọc.
  - Đánh đổi: `$inc` không trừ tin bị ẩn. Vì ẩn tin hiếm, chấp nhận sai lệch nhỏ và để recompute lúc ẩn/xoá đưa về đúng. (Bản chất giống mọi hệ chat lớn.)

### Phase C — Giảm tải build detail (cấu trúc)

- **C1.** Với realtime emit sau khi gửi/đọc, cân nhắc dựng payload **slim** (bỏ read_list/hides/quiz/desk/todo nếu client không cần ngay), hoặc tái dùng dữ liệu đã có thay vì aggregate lại toàn bộ.
- **C2.** Gộp các `$lookup` Users lặp (sender/reply_sender/reaction users/read users) khi có thể; hoặc denormalize tên/avatar sender vào Message lúc tạo để khỏi lookup Users cho sender.
- **C3.** Cân nhắc tách "ghi + counter" (đồng bộ) khỏi "dựng detail để emit" (có thể async/queue) để giảm thời gian giữ kết nối Mongo trên hot-path.

---

## Thứ tự đề xuất thực thi

1. **A1 + A2** (index) — rẻ nhất, hiệu quả tức thì cho mọi build detail/recompute.
2. **B2** (bỏ recompute-all ở markReadUpTo) — xoá ngay một nửa fan-out, gần như không rủi ro.
3. **B1** (đổi send sang `$inc`) — xoá nửa fan-out còn lại.
4. **B3** (recompute chính xác khi ẩn/xoá) — giữ đúng số liệu.
5. **A3** + **C** — dọn pipeline, giảm tải còn lại.

## Cách đo (trước/sau)

- Bật profiler: `db.setProfilingLevel(1, { slowms: 50 })`, xem `system.profile` các op trên `Messages`/`MessageReads`/`MessageHides`.
- `db.MessageReads.find({ msg_id: ObjectId('...') }).explain('executionStats')` → xác nhận `IXSCAN` thay vì `COLLSCAN` sau A1.
- Theo dõi `mongostat` / CPU khi bắn tải gửi+đọc vào phòng đông trước và sau Phase B.

## Ngoài phạm vi (chưa làm)

- Chuyển unread sang Redis hoàn toàn (counter ở Redis, sync DB nền) — phương án xa hơn nếu Phase A+B chưa đủ.
- Sharding/đổi storage engine.
