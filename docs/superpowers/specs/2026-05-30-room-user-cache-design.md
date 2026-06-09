# Thiết kế: Cache 2 tầng cho Room & User (read-heavy, ít thay đổi)

- **Ngày:** 2026-05-30
- **Repo:** `app-nest-be` (NestJS monorepo, microservices)
- **Trạng thái:** Đã duyệt thiết kế (Hướng A) — chờ review spec

## 1. Bối cảnh & vấn đề

Hệ thống chat microservices dùng MongoDB (Mongoose) + Redis (ioredis, `RedisModule` `@Global`).

Trên hot-path xử lý tin nhắn/sự kiện, hầu như **mọi** thao tác trong
[handle-chat.service.ts](../../../apps/chat/src/handle-chat/handle-chat.service.ts)
đều lặp lại 2 truy vấn Mongo cho dữ liệu **ít thay đổi**:

- `roomModel.findOne({ room_id: { $in: [roomId, pairId] } })` — lấy room doc (members, type, name...).
- `roomService.getUserInfo(userId)` — lấy user doc (`_id`, `usr_id`, `usr_fullname`).

Khi load test **10.000 user**, DB bị treo vì số lượng query lặp cho dữ liệu gần như tĩnh quá lớn. Room/user đổi rất hiếm (đổi tên, avatar, thêm/xoá thành viên, role), nhưng bị đọc liên tục theo từng message/event.

**Mục tiêu:** loại bỏ phần lớn các query Mongo lặp lại cho room & user bằng một lớp cache, giữ tính đúng đắn khi dữ liệu thật sự thay đổi (kể cả khi thay đổi xảy ra ở service khác).

### Hạ tầng hiện có (tái sử dụng)
- `RedisService` ([redis.service.ts](../../../libs/db/src/redis/redis.service.ts)) — `getData`/`setData`/`delKey`/`mget`/pub-sub helpers; **nuốt lỗi**, không throw.
- `RedisModule` `@Global` export từ `libs/db/src` — dùng bởi `auth`, `chat`, `notification`, `api-gateway`, `socket`.
- `REDISKEY` + `REDIS_TTL` ([RedisKey.ts](../../../libs/constants/src/RedisKey.ts)) — đã có `ROOM_INFO` (chưa dùng) và `PUBSUB_ROOM_UPDATE` (chưa có subscriber).
- Ghi **user** profile/avatar nằm ở **service `auth`** (`updateProfile`, `updateAvatar`); ghi **room** nằm ở service `chat`. Hai service khác process nhưng **chung 1 Redis**.

## 2. Quyết định thiết kế (đã chốt với người dùng)

| Hạng mục | Quyết định |
|---|---|
| Tầng cache | **2 tầng: L1 (RAM in-process) + L2 (Redis shared) + pub/sub invalidation** |
| Phạm vi data | **Full document** (toàn bộ room doc / user doc) |
| Invalidation | **TTL dài + pub/sub** (broadcast drop L1 khi data đổi) |
| Phạm vi áp dụng | **Dùng chung cho cả `auth` và `chat`** |
| Cách hiện thực | **Hướng A — `EntityCacheService` tự viết trong `libs/db`**, không thêm dependency |

Lý do cần pub/sub: cache có L1 trong RAM mỗi instance. Vì L2 nằm trong Redis chia sẻ, một `delKey` đã đủ làm mọi instance thấy mới ở tầng L2; nhưng bản sao **L1** trong RAM của các instance khác phải được báo để xoá → cần pub/sub broadcast.

## 3. Kiến trúc

### 3.1 `EntityCacheService` (mới — `libs/db/src/cache/`)

Service generic 2 tầng, được provide trong `CacheModule` `@Global` (giống `RedisModule`) để inject ở mọi service.

**L1 — in-process:**
- `Map<string, { value: unknown; expiresAt: number }>` mỗi *namespace*.
- Giới hạn kích thước theo **LRU** (cấu hình, mặc định 5.000 entry/namespace) → bound RAM.
- **Soft TTL ngắn (mặc định 60s)** → tự lành nếu lỡ miss một message pub/sub.

**L2 — Redis (qua `RedisService`):**
- `setData(key, value, ttl)` / `getData(key)` (JSON).
- **TTL dài** — hằng số mới `REDIS_TTL.CACHE_ENTITY` (mặc định 1800s = 30 phút).

**Pub/sub invalidation:**
- 1 connection subscriber riêng = `redisClient.duplicate()` (không dùng chung connection request).
- Kênh cố định `cache:invalidate` (đặt tên có namespace tường minh — **lưu ý `keyPrefix` của ioredis KHÔNG áp vào tên kênh pub/sub**).
- Message: `{ ns: string; keys: string[] }`. Mọi instance (kể cả instance phát) nhận → xoá các key tương ứng khỏi L1.
- Khi subscriber **reconnect**: **flush sạch toàn bộ L1** (phòng đã miss invalidation lúc mất kết nối).

**API công khai:**
```ts
getOrLoad<T>(ns: string, key: string, loader: () => Promise<T | null>, opts?): Promise<T | null>
invalidate(ns: string, entityId: string): Promise<void>
set<T>(ns: string, key: string, value: T): Promise<void>   // tuỳ chọn write-through
```

`getOrLoad`: L1 hit → trả ngay · miss → L2 hit → nạp L1, trả · miss → gọi `loader` (Mongo) → ghi L2 + L1 → trả. Loader trả `null` → **không** cache (tránh nhiễm negative; có thể cache negative TTL ngắn ở bản sau nếu cần chống stampede).

### 3.2 Alias key (1 doc, nhiều khoá tra cứu)

- Room tra bằng `room_id` (chuỗi), `pairId` (cho phòng private), `_id`.
- User tra bằng `_id`, `usr_id`.

Mỗi giá trị tra cứu là một cache key riêng. Để invalidate xoá **mọi** alias của một entity:

- Khi `getOrLoad` ghi một entity, ghi thêm vào **reverse-index** trong Redis: `cache:<ns>:idx:<entityId>` (Redis SET) chứa toàn bộ cache key đang trỏ tới entity đó.
- `invalidate(ns, entityId)`:
  1. `SMEMBERS cache:<ns>:idx:<entityId>` → danh sách key.
  2. `DEL` các key đó ở L2 + `DEL` chính reverse-index.
  3. `publish cache:invalidate { ns, keys }` → mọi instance drop L1 các key đó.

`entityId` canonical: room dùng `_id` (chuỗi), user dùng `_id` (chuỗi).

### 3.3 `RoomCacheRepository` (module `chat`)

Wrap `EntityCacheService`, ns = `room`:
- `getByRoomId(roomId)`, `getByPairOrRoomId(roomId, pairId)`, `getById(_id)` → loader gọi `roomModel`.
- Mọi điểm **ghi room** gọi `invalidate('room', room._id)`:
  - `rooms.service.ts`: `create`, `addMemberInRoom`, `removeMemberByAdmin`, `leavedRoom`, `changeLinkAvatarRoom`, đổi tên, và `writeLogRoom`-liên-quan (line ~151/1308/1380/1473/1594/1744/1793).
  - `handle-chat.service.ts`: ghim tin nhắn (`roomModel.findOneAndUpdate` line ~761).

### 3.4 `UserCacheRepository` (`libs/db`, dùng chung)

Wrap `EntityCacheService`, ns = `user`. Là provider inject `@InjectModel(User.name)` — mỗi service đã đăng ký User feature nên dùng được ở cả `auth` và `chat`.
- `getById(_id)`, `getByUsrId(usr_id)` → loader gọi `userModel`. Trả full user doc (lean).
- Điểm **ghi user** gọi `invalidate('user', user._id)`:
  - `auth.service.ts`: `updateProfile`, `updateAvatar` (và đổi `usr_status` nếu có).
- `chat` thay `roomService.getUserInfo(userId)` → đọc qua `UserCacheRepository.getById` (chỉ lấy field cần từ full doc đã cache).

## 4. Luồng dữ liệu

**Đọc (hot-path chat):**
```
getUserInfo(userId) → UserCacheRepository.getById(userId)
  → L1 hit? trả : L2 hit? nạp L1 + trả : Mongo findOne → ghi L2+L1+idx → trả
```

**Ghi/invalidate (vd auth đổi avatar):**
```
auth.updateAvatar → lưu DB
  → UserCacheRepository.invalidate('user', userId)
     → DEL L2 keys (qua reverse-index) + publish cache:invalidate
  → subscriber ở instance chat nhận → drop L1
  → lần đọc kế tiếp ở chat nạp lại bản fresh
```
Cross-service hoạt động vì chung 1 Redis.

## 5. Xử lý lỗi & độ bền

- **Redis lỗi/timeout:** `RedisService` đã nuốt lỗi trả `null` → `getOrLoad` fallback gọi loader Mongo. Cache **không bao giờ throw** → degrade về đúng hành vi hiện tại.
- **Lỡ message pub/sub:** L1 soft TTL 60s tự hết hạn → tự lành. L2 vẫn đúng vì đã `delKey` trực tiếp.
- **Subscriber reconnect:** flush sạch L1.
- **Stampede (nhiều miss đồng thời lúc khởi động):** chấp nhận ở v1 (loader vẫn chạy song song vài lần); ghi chú là điểm cải tiến tương lai (single-flight/lock) — `log()` rõ nếu thêm giới hạn.

## 6. Cấu hình (hằng số mới)

- `REDIS_TTL.CACHE_ENTITY = 1800` (30 phút) — TTL L2.
- `EntityCache` defaults: `l1MaxSize = 5000`, `l1TtlMs = 60_000`. Có thể override qua options khi tạo repository.
- Tên kênh pub/sub: `cache:invalidate` (hằng số trong `REDISKEY`, ví dụ `CACHE_INVALIDATE_CHANNEL`).
- Mẫu key: `cache:<ns>:<field>:<value>` (vd `cache:user:_id:<oid>`, `cache:user:usr_id:<ulid>`, `cache:room:room_id:<rid>`). Reverse-index: `cache:<ns>:idx:<entityId>`.

## 7. Kế hoạch test

- **Unit `EntityCacheService`** (mock `RedisService`): L1 hit/miss, L2 hit/miss → nạp L1, loader chỉ gọi 1 lần khi cache nóng, L1 TTL hết hạn → reload, LRU evict khi vượt size, `invalidate` xoá đúng L2 keys + publish, handler pub/sub drop đúng L1 keys, reconnect flush L1.
- **Unit alias/reverse-index:** ghi 2 alias → `invalidate` xoá cả hai.
- **Integration 2 instance** (2 `EntityCacheService` chung 1 Redis mock/thật): invalidate ở A → L1 ở B bị drop ở lần đọc kế.
- **Repository:** `RoomCacheRepository`/`UserCacheRepository` gọi đúng loader & invalidate ở các điểm ghi.

## 8. Ngoài phạm vi (YAGNI)

- Cache entity khác (friendship, message) — chưa làm.
- Negative caching / single-flight chống stampede — ghi chú tương lai.
- Cache warming chủ động khi khởi động — dựa vào lazy-load là đủ cho mục tiêu hiện tại.
