# Kế hoạch xử lý MongoDB `$lookup` cross-DB

> **Ngữ cảnh**: Đây là tài liệu phụ cho [`DATABASE_ISOLATION_PLAN.md`](./DATABASE_ISOLATION_PLAN.md). Tập trung riêng vào vấn đề lớn nhất khi tách database physical: **mọi `$lookup` join sang collection ở DB khác sẽ không hoạt động**, vì `$lookup` của MongoDB chỉ join trong cùng 1 database.
>
> **Định hướng**: Theo Giải pháp A (gRPC) — refactor pipeline thành **application-level join**: chạy aggregate chỉ với data của service đó, sau đó batch gRPC sang service chủ sở hữu để hydrate, cuối cùng merge ở app layer.

---

## 1. Inventory: Liệt kê tất cả pipeline có `$lookup` cross-DB

### A. `apps/chat/src/handle-chat/Pipeline/getMsg.ts`

Pipeline lấy message list/detail/search — gọi mỗi lần user mở phòng chat hoặc cuộn xem tin. File này **export 3 function pipeline** + 1 helper được reuse:

| Function | Line | Mục đích sử dụng | Mức độ phức tạp |
|---|---|---|---|
| `buildMessageCorePipeline(userId)` | 305 | Pipeline cốt lõi để load message list cho 1 room | 🔴🔴 Cao nhất — đầy đủ Quiz/Flashcard/TodoProject |
| `buildMessageDetailPipeline(msgId)` | 793 | Lấy detail 1 message (sau create, reply, react, ...) | 🔴 Thiếu Flashcard + TodoProject lookup (chỉ có Quiz) — *có thể là bug, xem mục dưới* |
| `buildMessagesDetailPipeline(msgIds[])` | 1145 | Lấy detail nhiều message cùng lúc | 🔴 Giống Detail (chỉ Quiz) |
| `roomEventLookupStages()` (helper) | 219 | Được spread vào cả 3 pipeline qua `...roomEventLookupStages()` | Chứa 2 cross-DB lookup |

**Các stage `$lookup` cross-DB trong cả 3 pipeline:**

| Stage | From → To | Cross-DB | Có trong Core | Có trong Detail | Có trong MultipleDetail | Line refs (Core) |
|---|---|---|---|---|---|---|
| `Messages → Users` (sender) | chat → auth | 🔴 | ✅ | ✅ | ✅ | ~373 |
| `Messages → reply_doc → Users` (reply sender) | chat → auth | 🔴 | ✅ | ✅ | ✅ | ~462 |
| `MessageReactions → Users` (nested) | chat → auth | 🔴 | ✅ | ✅ | ✅ | ~500 |
| `MessageReads → Users` (nested) | chat → auth | 🔴 | ✅ | ✅ | ✅ | ~560 |
| `RoomEvents → Users` (actor) — từ helper `roomEventLookupStages` | chat → auth | 🔴 | ✅ | ✅ | ✅ | ~235 |
| `RoomEvents → Users` (targets) — từ helper | chat → auth | 🔴 | ✅ | ✅ | ✅ | ~247 |
| `Messages → Attachments` | chat → filesystem | 🔴 | ✅ | ✅ | ✅ | ~389 |
| `Attachments → aiembeddings` (nested) | filesystem → ai | 🔴 | ✅ | ✅ | ✅ | ~397 |
| `Messages → Quizzes` | chat → learning | 🔴 | ✅ | ✅ (1040) | ✅ (1392) | ~613 |
| `Messages → Flashcards` | chat → learning | 🔴 | ✅ (x3 — bug) | ❌ | ❌ | ~628, ~650, ~672 |
| `Messages → TodoProjects` | chat → learning | 🔴 | ✅ (x3 — bug) | ❌ | ❌ | ~639, ~661, ~683 |

**Stage hợp lệ (cùng chat DB, GIỮ NGUYÊN):**
- `Messages → RoomEvents` (helper, ~223)
- `Messages → Rooms` (~312)
- `Messages → RoomsUsersState` (~338)
- `Messages → Messages` (reply_doc, ~454)
- `Messages → MessageHides` (~475, ~534)
- `Messages → MessageReactions` (~495 — lookup base intra-DB; chỉ phần nested User cần bỏ)
- `Messages → MessageReads` (~554 — lookup base intra-DB; chỉ phần nested User cần bỏ)
- `Messages → CallHistories` (~598)

> ⚠️ **Bug phát hiện được khi audit**: Trong `buildMessageCorePipeline`, các stage `$lookup → Flashcards` và `$lookup → TodoProjects` **bị lặp lại 3 lần với config y hệt nhau** (line 628/650/672 cho Flashcards; line 639/661/683 cho TodoProjects). Vì cả 3 stage ghi đè cùng field `flashcardDoc` / `todoProjectDoc`, chỉ stage cuối cùng có tác dụng — 2 stage đầu hoàn toàn vô dụng và lãng phí tài nguyên. Khi refactor sang gRPC, **chỉ cần 1 batch call duy nhất** cho mỗi loại — coi như tự fix luôn bug này.

> ⚠️ **Bug phát hiện thứ 2**: `buildMessageDetailPipeline` và `buildMessagesDetailPipeline` thiếu lookup Flashcards/TodoProjects mặc dù `$project` cuối có dùng `buildFlashcardProjection()` và `buildTodoProjectProjection()`. Nghĩa là khi load detail message kiểu flashcard/todo, các field này sẽ trống. Cần verify lại logic — có thể là bug, hoặc do design ý đồ (detail không cần flashcard data). Khi refactor cần thống nhất behavior giữa 3 pipeline.

### B. `apps/chat/src/rooms/rooms.service.ts`

Pipeline lấy danh sách phòng — gọi khi user mở app.

| Stage | From → To | Loại cross-DB | Line refs |
|---|---|---|---|
| `Rooms → Users` (currentUserInfo) | chat → auth | 🔴 | ~236 |
| `Rooms → Users` (membersInfo) | chat → auth | 🔴 | ~251 |
| `Rooms → Users` (last_message_sender) | chat → auth | 🔴 | ~419 |

Stage hợp lệ (giữ nguyên):
- `Rooms → RoomsState`
- `Rooms → RoomEvents`
- `Rooms → Messages` (last_message, pin messages)
- `Rooms → RoomsUsersState`
- `Rooms → MessageReads`
- `Rooms → Friendships` (cùng chat DB)
- `Rooms → MessageHides`

### C. `apps/chat/src/social/aggregates/` + `social.service.ts`

3 file aggregate: `getFriends.ts`, `getFriendSuggestions.ts`, `contacts.ts`. Vấn đề đặc biệt:

**Pipeline bắt đầu từ `userModel.aggregate()` (auth DB) rồi `$lookup → Friendships` (chat DB)** → cross-DB **ngược chiều** so với getMsg/rooms.

#### C.1. `getFriends.ts` — 5 exported function, mỗi function 1 cross-DB lookup

| Function | Line | Cross-DB lookup | Sử dụng tại `social.service.ts` |
|---|---|---|---|
| `getFriendsBaseAggregate(userId, search)` | 1 | `Users → Friendships` (~13) — chỉ ACCEPTED friendships | helper cho `getFriendsAggregate` + count |
| `getFriendsAggregate(userId, page, limit, search)` | 60 | (reuse base) | `listFriends()` — paginated friends list |
| `getFriendsRequestAggregate(userId, type)` | 71 | `Users → Friendships` (~77) — PENDING + received/sent | `listFriendRequests()` |
| `searchUsersAggregate(search, page, limit, userId)` | 119 | `Users → Friendships` (~137) — tìm user chưa có quan hệ | `searchUsers()` (gợi ý add friend) |
| `getBlockedFriendsAggregate(userId)` | 169 | `Users → Friendships` (~172) — BLOCKED friendships | `listBlockedFriends()` |

#### C.2. `getFriendSuggestions.ts` — function `getFriendSuggestionsAggregate(userId, limit)`

Pipeline phức tạp nhất trong social (algorithm "friends of friends" mutual count). Có **5 cross-DB lookup**:

| Stage | Line | Lookup | Mục đích |
|---|---|---|---|
| 2 | ~33 | `Users → Friendships` (ACCEPTED edges của tôi) | Lấy danh sách friend của tôi |
| 3 | ~76 | `Users → Friendships` (ACCEPTED edges của friend) | Tìm friend của friend |
| 4 | ~121 | `Users → Friendships` (BLOCKED/PENDING/REJECTED) | Loại trừ relationship đã tồn tại |
| 8 | ~187 | `Friendships → Users` (candidate user info) | Hydrate suggestion user info |
| 9 | ~198 | `Friendships → Users` (mutual friend names) | Sample 3 mutual friend names |

#### C.3. `contacts.ts` — function `buildContactsPipeline(currentUsrId)`

| Line | Lookup | Mục đích |
|---|---|---|
| ~12 | `Users → Friendships` | Lấy friendship status của từng user còn lại trong hệ thống (cho danh bạ) |

### D. `apps/filesystem/src/documents/documents.service.ts`

Pipeline list/detail documents.

| Stage | From → To | Cross-DB | Line refs |
|---|---|---|---|
| `Documents → Users` (owner_info) | filesystem → auth | 🔴 | ~166 |
| `Documents → Rooms` (room_infos) | filesystem → chat | 🔴 | ~182 |
| `Documents → Users` (combined_shared.user_info) | filesystem → auth | 🔴 | ~239 |

---

## 2. Chiến lược chung: Application-Level Join Pattern

### Pattern 4 bước

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Aggregate pipeline ở DB owner (chỉ lookup trong cùng DB)  │
│    → Trả về documents chứa các foreign ID                    │
├──────────────────────────────────────────────────────────────┤
│ 2. Collect foreign IDs                                       │
│    Set<userId>, Set<attachmentId>, Set<quizId>, ...          │
├──────────────────────────────────────────────────────────────┤
│ 3. Batch gRPC calls song song (Promise.all)                  │
│    GetUsersByIds, GetAttachmentsByIds, GetQuizzesByIds, ...  │
│    → Build các Map<id, info>                                 │
├──────────────────────────────────────────────────────────────┤
│ 4. Merge ở app layer: map qua documents, thay ID bằng object │
└──────────────────────────────────────────────────────────────┘
```

### Nguyên tắc bắt buộc

1. **Pipeline aggregate không thay đổi structure output** — vẫn trả về document có shape giống trước (sender, reply_sender, reactions, …). Chỉ thay đổi **nguồn data**.
2. **Batch tuyệt đối** — không bao giờ loop gọi gRPC từng ID. Mọi method gRPC dùng để hydrate đều phải có dạng `GetXxxByIds(ids[])`.
3. **Parallel gRPC calls** — các batch call tới service khác nhau (auth, filesystem, ai, learning) chạy `Promise.all` để tận dụng parallelism.
4. **Defensive merge** — nếu gRPC fail hoặc thiếu data (user bị xoá, attachment bị xoá…), fallback `null` thay vì crash.

---

## 3. Refactor chi tiết từng pipeline

### 3.1. `getMsg.ts` (chat/handle-chat) — File phức tạp nhất

#### Bước 1: Pipeline mới (loại bỏ stage cross-DB)

Pipeline sau refactor chỉ còn các lookup cùng chat DB. Output document có shape:

```ts
{
  _id, msg_content, msg_sender, msg_roomId, msg_type, attachment_ids,
  reply_to, quiz_id, flashcard_id, todo_project_id, ...
  // Stage cùng DB vẫn giữ:
  roomEventDoc: { actor_id, targets, ... },        // RoomEvents (chat DB)
  roomDoc: { ... },                                 // Rooms (chat DB)
  reply_doc: { _id, msg_sender, msg_content, ... }, // Messages (chat DB)
  replyHiddenByDocs: [ { user_id } ],               // MessageHides
  reactions: [ { user_id, reaction_type, ... } ],   // MessageReactions (KHÔNG nested Users)
  reads: [ { user_id, readAt } ],                   // MessageReads (KHÔNG nested Users)
  hiddenByDocs: [ { user_id } ],                    // MessageHides
  callHistoryDoc: { ... },                          // CallHistories (chat DB)
  // Các field hydrate sau aggregate sẽ thêm ở bước 4
}
```

#### Bước 2: Collect IDs

```ts
const userIds = new Set<string>();
const attachmentIds = new Set<string>();
const quizIds = new Set<string>();
const flashcardIds = new Set<string>();
const todoProjectIds = new Set<string>();

for (const m of messages) {
  // Sender
  if (m.msg_sender) userIds.add(String(m.msg_sender));

  // Reply sender
  if (m.reply_doc?.msg_sender) userIds.add(String(m.reply_doc.msg_sender));

  // Reactions
  m.reactions?.forEach((r: any) => r.user_id && userIds.add(String(r.user_id)));

  // Reads
  m.reads?.forEach((r: any) => r.user_id && userIds.add(String(r.user_id)));

  // RoomEvent actor + targets
  if (m.roomEventDoc?.actor_id) userIds.add(String(m.roomEventDoc.actor_id));
  m.roomEventDoc?.targets?.forEach((t: any) => userIds.add(String(t)));

  // Cross-service IDs
  m.attachment_ids?.forEach((id: any) => attachmentIds.add(String(id)));
  if (m.quiz_id) quizIds.add(String(m.quiz_id));
  if (m.flashcard_id) flashcardIds.add(String(m.flashcard_id));
  if (m.todo_project_id) todoProjectIds.add(String(m.todo_project_id));
}
```

#### Bước 3: Batch gRPC song song

```ts
const [usersRes, attachmentsRes, quizzesRes, flashcardsRes, todoProjectsRes] = await Promise.all([
  userIds.size
    ? this.authGrpc.getUsersByIds({ userIds: [...userIds] })
    : Promise.resolve({ users: [] }),
  attachmentIds.size
    ? this.filesystemGrpc.getAttachmentsByIds({ attachmentIds: [...attachmentIds] })
    : Promise.resolve({ attachments: [] }),
  quizIds.size
    ? this.learningGrpc.getQuizzesByIds({ quizIds: [...quizIds] })
    : Promise.resolve({ quizzes: [] }),
  flashcardIds.size
    ? this.learningGrpc.getFlashcardsByIds({ flashcardIds: [...flashcardIds] })
    : Promise.resolve({ flashcards: [] }),
  todoProjectIds.size
    ? this.learningGrpc.getTodoProjectsByIds({ todoProjectIds: [...todoProjectIds] })
    : Promise.resolve({ todoProjects: [] }),
]);
```

Sau khi có `attachmentsRes`, tiếp tục batch thêm 1 round-trip nữa cho **AI embeddings của các attachment** (vì `getMsg` cũ có nested `Attachments → aiembeddings`):

```ts
const attachmentIdsForEmbedding = attachmentsRes.attachments
  .filter(a => a.requiresEmbedding) // hoặc gọi tất cả
  .map(a => a._id);

const { embeddings } = attachmentIdsForEmbedding.length
  ? await this.aiGrpc.getEmbeddingsByContextIds({ contextIds: attachmentIdsForEmbedding })
  : { embeddings: [] };
```

> **Tối ưu**: nếu attachment nào cũng cần embedding info → có thể merge thành 1 RPC `GetAttachmentsWithEmbeddings` ở filesystem service, để filesystem tự gọi ai. Cân nhắc khi benchmark.

#### Bước 4: Build maps + merge

```ts
const userMap = new Map(usersRes.users.map(u => [String(u._id), u]));
const attMap = new Map(attachmentsRes.attachments.map(a => [String(a._id), a]));
const quizMap = new Map(quizzesRes.quizzes.map(q => [String(q._id), q]));
const flashcardMap = new Map(flashcardsRes.flashcards.map(f => [String(f._id), f]));
const todoProjectMap = new Map(todoProjectsRes.todoProjects.map(t => [String(t._id), t]));
const embeddingMap = new Map<string, any[]>();
embeddings.forEach(e => {
  const k = String(e.contextId);
  if (!embeddingMap.has(k)) embeddingMap.set(k, []);
  embeddingMap.get(k)!.push(e);
});

const projectUser = (u: any) =>
  u ? { _id: u._id, usr_fullname: u.usr_fullname, usr_avatar: u.usr_avatar, usr_id: u.usr_id } : null;

return messages.map(m => ({
  ...m,
  sender: projectUser(userMap.get(String(m.msg_sender))),
  reply_sender: m.reply_doc?.msg_sender
    ? projectUser(userMap.get(String(m.reply_doc.msg_sender)))
    : null,
  reactions: m.reactions?.map((r: any) => ({
    ...r,
    user: projectUser(userMap.get(String(r.user_id))),
  })),
  reads: m.reads?.map((r: any) => ({
    ...r,
    user: projectUser(userMap.get(String(r.user_id))),
  })),
  roomEventActor: m.roomEventDoc?.actor_id
    ? projectUser(userMap.get(String(m.roomEventDoc.actor_id)))
    : null,
  roomEventTargets: m.roomEventDoc?.targets?.map((t: any) =>
    projectUser(userMap.get(String(t))),
  ),
  attachment_infos: m.attachment_ids?.map((id: any) => {
    const att = attMap.get(String(id));
    if (!att) return null;
    return { ...att, embeddings: embeddingMap.get(String(att._id)) ?? [] };
  }).filter(Boolean),
  quizDoc: m.quiz_id ? quizMap.get(String(m.quiz_id)) ?? null : null,
  flashcardDoc: m.flashcard_id ? flashcardMap.get(String(m.flashcard_id)) ?? null : null,
  todoProjectDoc: m.todo_project_id ? todoProjectMap.get(String(m.todo_project_id)) ?? null : null,
}));
```

#### Áp dụng cho cả 3 biến thể

Vì 3 biến thể (`getMsg`, `getOneMsg`, `search`) lặp lại cùng stages, nên **extract helper**:

- `buildBasePipeline()` — phần lookup cùng DB chung
- `collectForeignIds(messages)` — gom IDs từ kết quả aggregate
- `hydrateMessages(messages)` — batch gRPC + merge

3 hàm public chỉ khác nhau ở phần `$match` đầu pipeline và `$limit/$skip`, phần còn lại reuse.

---

### 3.2. `rooms.service.ts` (chat/rooms)

#### Pipeline mới
- Bỏ 3 stage `$lookup → Users` (currentUserInfo, membersInfo, last_message_sender)
- Giữ nguyên các lookup trong cùng chat DB

#### Collect IDs
```ts
const userIds = new Set<string>();
for (const r of rooms) {
  r.room_members?.forEach((m: any) => userIds.add(String(m.user_id)));
  if (r.last_message_doc?.msg_sender) userIds.add(String(r.last_message_doc.msg_sender));
  if (r.state?.last_message_snapshot?.sender_id)
    userIds.add(String(r.state.last_message_snapshot.sender_id));
}
```

#### Hydrate
```ts
const { users } = await this.authGrpc.getUsersByIds({ userIds: [...userIds] });
const userMap = new Map(users.map(u => [String(u._id), u]));

return rooms.map(r => ({
  ...r,
  currentUserInfo: r.room_members?.find(m => String(m.user_id) === String(uid))
    ? projectUser(userMap.get(String(uid)))
    : null,
  membersInfo: r.room_members?.map(m => projectUser(userMap.get(String(m.user_id)))),
  last_message_sender: projectUser(userMap.get(
    String(r.state?.last_message_snapshot?.sender_id ?? r.last_message_doc?.msg_sender)
  )),
}));
```

---

### 3.3. Social aggregates (8 pipelines total)

Toàn bộ social pipeline đều áp dụng cùng chiến lược: **đảo chiều entry point** từ `userModel` (auth DB) → `friendshipModel` (chat DB), sau đó batch gRPC hydrate user info.

#### 3.3.1. `getFriends.ts` — 5 functions

| Function | Strategy refactor |
|---|---|
| `getFriendsBaseAggregate` + `getFriendsAggregate` | Pipeline mới: `friendshipModel.aggregate([{ $match: { ACCEPTED + userId1\|userId2 = me } }, { $project: { otherUserId } }, sort, skip, limit])`. Sau aggregate: extract otherUserIds → batch `GetUsersByIds`. Search field (fullname/email/phone) → áp dụng filter ở app layer sau khi hydrate, HOẶC thêm cache user info có index search-friendly. |
| `getFriendsRequestAggregate` | Pipeline mới: `friendshipModel.find({ frp_status: 'PENDING', ...type filter })` → trả về list, batch hydrate user info. |
| `searchUsersAggregate` | **Khó nhất** — bản chất là "tìm user chưa có quan hệ với tôi". Approach: (a) batch gRPC `authGrpcClient.SearchUsers(query)` → trả về userIds match; (b) chat service `friendshipModel.find({ ... với những userIds đó })` để loại trừ user đã có relation; (c) batch hydrate full user info. Cần thêm RPC `SearchUsers(query, page, limit)` trong auth.proto. |
| `getBlockedFriendsAggregate` | Pipeline mới: `friendshipModel.find({ frp_status: 'BLOCKED', frp_actionUserId: me })` → batch hydrate user info. |

#### 3.3.2. `getFriendSuggestionsAggregate` (`getFriendSuggestions.ts`)

Pipeline phức tạp nhất nhưng logic chính (graph traversal) hoàn toàn nằm trong chat DB. Refactor:

1. **Pipeline mới chạy ở chat DB**, bắt đầu từ `friendshipModel`:
   - Stage 1: `$match { ACCEPTED, userId1|userId2 = me }` → lấy `myFriends`
   - Stage 2: `$lookup` (Friendship → Friendship intra-DB) để tìm friend của friend
   - Stage 3: `$lookup` (Friendship → Friendship intra-DB) để lấy excluded (BLOCKED/PENDING/REJECTED)
   - Stage 4-7: `$unwind`, `$match`, `$group`, `$sort`, `$limit` (giữ nguyên)
   - Output: `[{ _id: candidateUserId, mutualFriendsCount, mutualVia: [userIds] }]`
2. **Hydrate ở app layer**:
   - Collect tất cả `candidateUserId` + flatten `mutualVia` → batch `GetUsersByIds`
   - Map: candidate → full user info; mutualVia → mutual names (slice 3 đầu)

#### 3.3.3. `buildContactsPipeline` (`contacts.ts`)

Đảo chiều khác một chút — `contacts` muốn liệt kê **tất cả user trong hệ thống** (không chỉ friend), kèm friendship status. Refactor:

1. **Approach A (đơn giản)**: gRPC `authGrpcClient.ListUsers({ page, limit, exclude: me })` → lấy all users. Sau đó chat service query `friendshipModel.find({ userId1: me OR userId2: me, userId2|userId1 ∈ candidateIds })` để build status map. Merge ở app.
2. **Approach B (hiệu quả hơn nếu user đông)**: Áp dụng cursor-based pagination ở auth (chỉ trả userIds + slim fields). Chat tự build friendship status map cho batch nhỏ này.

---

### 3.4. `documents.service.ts` (filesystem)

#### Pipeline mới
- Bỏ 3 stage `$lookup → Users` (owner_info, combined_shared.user_info)
- Bỏ 1 stage `$lookup → Rooms` (room_infos)

#### Collect + Hydrate
```ts
const userIds = new Set<string>();
const roomIds = new Set<string>();

for (const d of docs) {
  if (d.ownerId) userIds.add(String(d.ownerId));
  d.combined_shared?.forEach((s: any) => s.userId && userIds.add(String(s.userId)));
  d.roomIds?.forEach((id: any) => roomIds.add(String(id)));
}

const [{ users }, { rooms }] = await Promise.all([
  userIds.size
    ? this.authGrpc.getUsersByIds({ userIds: [...userIds] })
    : Promise.resolve({ users: [] }),
  roomIds.size
    ? this.chatGrpc.getRoomsByIds({ roomIds: [...roomIds] })
    : Promise.resolve({ rooms: [] }),
]);

const userMap = new Map(users.map(u => [String(u._id), u]));
const roomMap = new Map(rooms.map(r => [String(r._id), r]));

return docs.map(d => ({
  ...d,
  owner_info: projectUser(userMap.get(String(d.ownerId))),
  room_infos: d.roomIds?.map(id => roomMap.get(String(id))).filter(Boolean),
  combined_shared: d.combined_shared?.map(s => ({
    ...s,
    user_info: projectUser(userMap.get(String(s.userId))),
  })),
}));
```

---

## 4. Proto methods cần thêm (chuyên cho hydration)

> Tất cả method dưới đây phục vụ cho việc thay thế `$lookup`. Xem chi tiết các method khác trong [`DATABASE_ISOLATION_PLAN.md` Phase 4](./DATABASE_ISOLATION_PLAN.md#phase-4-proto-files--thêm-grpc-methods-cần-thiết).

| Proto file | Method | Phục vụ stage `$lookup` / use case nào |
|---|---|---|
| `auth.proto` | `GetUsersByIds(userIds[]) → User[]` | Sender, reply_sender, reactions, reads, roomEvent actor/targets, room members, document owner/shared, social hydration |
| `auth.proto` | `SearchUsers(query, page, limit, excludeUserId) → User[]` | Cho `searchUsersAggregate` — tìm user theo fullname/email/phone |
| `auth.proto` | `ListUsers(page, limit, excludeUserId) → User[]` | Cho `buildContactsPipeline` — liệt kê toàn bộ user cho danh bạ |
| `chat.proto` | `GetRoomsByIds(roomIds[]) → Room[]` | Document `room_infos` |
| `chat.proto` | `GetFriendsOfUser(userId) → Friendship[]` | Optional — nếu service khác cần biết friends của 1 user |
| `filesystem.proto` | `GetAttachmentsByIds(attachmentIds[]) → Attachment[]` | `Messages → Attachments` |
| `ai.proto` | `GetEmbeddingsByContextIds(contextIds[]) → AIEmbedding[]` | `Attachments → aiembeddings` |
| `learning.proto` (hoặc tách proto) | `GetQuizzesByIds(quizIds[]) → Quiz[]` | `Messages → Quizzes` |
| `learning.proto` | `GetFlashcardsByIds(flashcardIds[]) → Flashcard[]` | `Messages → Flashcards` |
| `learning.proto` | `GetTodoProjectsByIds(todoProjectIds[]) → TodoProject[]` | `Messages → TodoProjects` |

---

## 5. Caching strategy (giảm tải gRPC sau refactor)

### Tại sao cần?
Pipeline `getMsg` thường trả về 30-50 message/lần và gọi liên tục mỗi vài giây khi user scroll. Nếu mỗi request đều round-trip gRPC tới auth để lấy 30+ user info → áp lực lớn lên auth service.

### Đề xuất 2 tầng cache

**Tầng 1 — In-memory LRU cache ở chat service**:
- Lib: `lru-cache` hoặc tự build với `Map`
- Key: `userId`, Value: `UserInfo`
- TTL: 30-60s
- Max size: 10k entries (đủ cho 1 instance phục vụ nhiều user cùng lúc)
- Pattern: trước khi batch gRPC, check cache → chỉ gửi sang gRPC những ID chưa có

```ts
async getUsersByIdsCached(userIds: string[]) {
  const missing: string[] = [];
  const fromCache = new Map<string, User>();
  for (const id of userIds) {
    const cached = this.userCache.get(id);
    if (cached) fromCache.set(id, cached);
    else missing.push(id);
  }
  if (missing.length) {
    const { users } = await this.authGrpc.getUsersByIds({ userIds: missing });
    users.forEach(u => {
      this.userCache.set(String(u._id), u);
      fromCache.set(String(u._id), u);
    });
  }
  return [...fromCache.values()];
}
```

**Tầng 2 — Redis cache shared**:
- Key: `USER_INFO:{userId}`, Value: JSON
- TTL: 5 phút
- Lợi: nhiều instance chat (horizontal scale) share cache, giảm gRPC tới auth
- Invalidation: khi auth update user → emit Kafka `user.updated` → mọi service subscribe + invalidate Redis key

### Cache invalidation strategy
- **User update profile** (avatar, fullname): auth emit Kafka `user.updated`. Chat, filesystem, ai subscribe → xóa key Redis tương ứng.
- **User delete**: emit Kafka `user.deleted` → invalidate cache + có thể trigger cleanup ở các service khác.

> **Lưu ý**: Caching không vi phạm Solution A vì cache chỉ là **read-through cache của gRPC call**, không phải duplicate data persistent. Source of truth vẫn là auth DB.

---

## 6. Order of implementation

Pipeline cross-DB là phần khó nhất trong toàn bộ migration. Đề xuất thứ tự:

1. **Trước tiên**: Thêm batch proto methods (`GetUsersByIds`, `GetRoomsByIds`, `GetAttachmentsByIds`, `GetEmbeddingsByContextIds`, `GetQuizzesByIds`, `GetFlashcardsByIds`, `GetTodoProjectsByIds`). Test gRPC server-side trả đúng data.
2. ✅ **Setup caching layer** ở chat service (LRU + optional Redis). (đã gắn vào `getMsg` hydrate path)
3. **Refactor pipeline đơn giản trước**: `documents.service.ts` (filesystem) — ít lookup, dễ test correctness.
4. **Refactor social aggregates**: đảo chiều pipeline, test với dataset có vài chục friendships.
5. **Refactor `rooms.service.ts`**: nhiều lookup nhưng pattern tương tự, có thể tái sử dụng helper từ social.
6. **Refactor `getMsg.ts`** (file phức tạp nhất):
   - Bước trung gian: chạy song song pipeline cũ + pipeline mới, so sánh output để verify correctness
   - Benchmark performance: target latency không tăng >50% so với cũ
   - Roll out behind feature flag, rollback nếu phát hiện regression

---

## 7. Verification

### Correctness
- [x] Build check: `yarn build:chat` pass sau khi refactor hydrate + cache integration
- [ ] Snapshot test: chạy `getMsg(roomId)` với fixture data — so sánh response JSON (cũ vs mới), phải bằng nhau (ngoại trừ field order)
- [ ] Test edge case: message của user đã bị xóa → `sender = null`, không crash
- [ ] Test edge case: attachment đã bị xóa → `attachment_infos` skip ID đó
- [ ] Test reply chain: A reply B, B reply C → reply_sender hiển thị đúng cho cả 2 cấp

### Performance
- [ ] Benchmark `getMsg(roomId, limit=50)` — đo p50, p95, p99 latency
- [ ] Target: p95 không tăng quá 50% so với baseline trước refactor
- [ ] Verify N+1: monitoring (Datadog/Grafana) hiển thị chỉ 1 gRPC call mỗi service đích cho 1 request
- [x] Cache instrumentation: `UserCacheService` đã có stats hit/miss (`getStats`, `resetStats`) để đo hit ratio khi benchmark
- [ ] Verify cache hit ratio: tầng LRU cache > 80% sau warm-up

### Manual
- [ ] Mở phòng chat có 100+ message → render đầy đủ sender, reaction users, read receipts
- [ ] Reply message → reply_sender hiển thị đúng
- [ ] Message có attachment + AI embedding → load đầy đủ
- [ ] Message gắn quiz/flashcard/todo → load đầy đủ
- [ ] Mở document chia sẻ với nhiều user → owner_info + room_infos + shared users hiện đúng
- [ ] Mở danh sách bạn bè / gợi ý kết bạn → user info đầy đủ, mutual count chính xác

### Benchmark runbook (thực thi nhanh)

> Mục tiêu: có số liệu thực để tick các mục Performance ở trên (`p50/p95/p99`, `N+1`, `cache hit ratio`).

1. **Chuẩn bị môi trường**
   - Start đủ service liên quan (`chat`, `auth`, `filesystem`, `ai`, `learning`, `redis`, `mongodb-*`).
   - Chọn 1 `roomId` có dữ liệu thực (>=100 messages, có reaction/read/attachment nếu có thể).
   - Dùng script benchmark:
     - `yarn bench:getmsg` (script: `libs/scripts/benchmark-getmsg.ts`)

   Ví dụ chạy chuẩn:

   ```bash
   BENCH_BASE_URL=http://localhost:5000 \
   BENCH_ROOM_ID=<room_id> \
   BENCH_TOKEN=<jwt_token> \
   BENCH_LIMIT=50 \
   BENCH_WARMUP=40 \
   BENCH_REQUESTS=300 \
   BENCH_CONCURRENCY=10 \
   yarn bench:getmsg
   ```

   Tuỳ chọn auth bằng cookie:

   ```bash
   BENCH_BASE_URL=http://localhost:5000 \
   BENCH_ROOM_ID=<room_id> \
   BENCH_COOKIE="accessToken=<token>" \
   yarn bench:getmsg
   ```

2. **Reset cache stats trước khi đo**
   - Dùng REPL / debug hook gọi `userCache.resetStats()` ở chat service.
   - Xác nhận stats về 0 trước warm-up.

3. **Warm-up**
   - Gọi endpoint/API `getMsg(roomId, limit=50)` khoảng 30-50 lần đầu để làm nóng cache.
   - Không ghi nhận số liệu giai đoạn này.

4. **Đo chính thức**
   - Gọi `getMsg(roomId, limit=50)` thêm 200-500 requests (tuỳ môi trường).
   - Thu latency từng request (ms) để tính `p50`, `p95`, `p99`.
   - Đồng thời đọc `userCache.getStats()` hoặc log định kỳ của `UserCacheService`.

5. **Đánh giá**
   - `p95` mới <= `1.5x` baseline cũ.
   - `hitRatio >= 0.8` sau warm-up.
   - Không thấy pattern N+1 (mỗi request chỉ 1 batch call / service đích).

6. **Cập nhật checklist**
   - Tick các mục Performance nếu đạt tiêu chí.
   - Nếu chưa đạt, ghi rõ nguyên nhân (cache miss cao, room data skew, network gRPC, ...).

---

## 8. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Refactor sai logic, lộ data của user khác | Snapshot test + code review kỹ, đặc biệt phần merge map |
| Performance regression (latency tăng nhiều) | Caching 2 tầng, benchmark trước rollout, feature flag để rollback nhanh |
| N+1 gRPC call ngầm (gọi single thay vì batch) | Code review enforce: cấm gọi `GetUserById` trong loop, ESLint rule custom nếu cần |
| User vừa update profile, cache stale | Kafka event invalidation, TTL ngắn (30-60s) |
| gRPC service đích down → toàn bộ getMsg fail | Circuit breaker + fallback: trả về message với `sender = { _id, usr_fullname: 'Unknown' }` thay vì 500 |
