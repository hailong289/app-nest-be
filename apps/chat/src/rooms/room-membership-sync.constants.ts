/**
 * Bull queue cho việc bulk-add USER_ROOMS membership vào Redis sau khi tạo
 * room hoặc add nhiều thành viên cùng lúc. Tách khỏi luồng request chính để
 * tránh fan-out N parallel sAdd làm quá tải mongoose pool / connection (khi
 * N≈1000, response time vượt timeout gRPC 20s và trả 503).
 *
 * Tách constants khỏi processor để không tạo circular import nếu sau này
 * có module/service nào khác cần enqueue job vào queue này.
 */

export const ROOM_MEMBERSHIP_SYNC_QUEUE = 'room-membership-sync';

export const ROOM_MEMBERSHIP_SYNC_CHUNK = 50;

export interface RoomMembershipSyncJobData {
  /** room_id dạng custom string (không phải ObjectId) — value lưu vào set USER_ROOMS */
  roomCustomId: string;
  /** Danh sách User._id (ObjectId string) cần sync USER_ROOMS({userId}) ← roomCustomId */
  memberIds: string[];
}
