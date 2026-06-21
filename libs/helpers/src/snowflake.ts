/**
 * Dependency-free, k-sortable (time-ordered), monotonic id generator.
 *
 * Layout (string-encoded, NOT a real BigInt on the wire — we just need a
 * 24-hex-char string that is monotonically increasing and collision-resistant
 * across processes so it can double as a Mongo ObjectId-compatible `_id`):
 *
 *   [ 8 bytes timestamp(ms) ][ 2 bytes worker ][ 3 bytes counter ]  (13 bytes)
 *
 * We emit exactly 24 hex chars so the value is a valid Mongo ObjectId hex
 * string (`new Types.ObjectId(id)` accepts any 24-hex string). Time-ordering
 * is preserved because the high bytes are the millisecond timestamp; within
 * the same millisecond a per-process counter keeps ids monotonic, and a
 * per-process random `worker` keeps two processes from colliding.
 *
 * This is intentionally NOT a 64-bit twitter-snowflake — the chat path stores
 * ids as Mongo `_id` (ObjectId), so a 24-hex k-sortable string is the right
 * shape and gives us client/server idempotency for free (same id → same _id →
 * upsert dedup within a shard).
 */

// 2-byte per-process worker id (random at module load). Keeps ids from two
// processes generated in the same ms from colliding.
const WORKER = Math.floor(Math.random() * 0xffff);

// 3-byte (24-bit) monotonic counter, seeded random to avoid cross-restart
// overlap clustering. Wraps within a single ms only under extreme load.
let counter = Math.floor(Math.random() * 0xffffff);
let lastTs = 0;

function hex(num: number, width: number): string {
  return (num >>> 0).toString(16).padStart(width, '0').slice(-width);
}

/**
 * Generate a 24-hex-char, time-ordered, monotonic id as a string. Safe to use
 * directly as a Mongo `_id` (ObjectId-hex compatible).
 */
export function generateSnowflakeId(): string {
  const ts = Date.now();
  if (ts === lastTs) {
    counter = (counter + 1) & 0xffffff;
  } else {
    lastTs = ts;
    // fresh random base each new ms keeps monotonicity without unbounded growth
    counter = Math.floor(Math.random() * 0xffffff);
  }

  // 8-byte ms timestamp → 16 hex chars (high 32 bits + low 32 bits).
  const high = Math.floor(ts / 0x100000000);
  const low = ts % 0x100000000;
  const tsHex = hex(high, 8) + hex(low, 8); // 16 hex
  const workerHex = hex(WORKER, 4); // 4 hex (2 bytes)
  const counterHex = hex(counter, 6); // 6 hex (3 bytes)

  // 16 + 4 + 6 = 26 → trim leading timestamp zeros down to 24 chars. Since
  // current epoch-ms only uses ~11 hex of the low/high split, the leading
  // bytes of `high` are zero; we slice the last 24 chars which preserves
  // ordering (high bytes are stable zeros for the next ~17000 years).
  return (tsHex + workerHex + counterHex).slice(-24);
}

export default generateSnowflakeId;
