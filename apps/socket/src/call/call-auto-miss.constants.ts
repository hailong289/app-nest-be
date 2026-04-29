/**
 * Constants + types cho auto-miss queue. Tách riêng khỏi processor để
 * tránh circular import giữa `call.gateway.ts` ↔ `call-auto-miss.processor.ts`:
 *   - gateway dùng tên queue + payload type (để enqueue)
 *   - processor dùng tên queue (decorator) + payload type + gateway (DI)
 * Nếu để chung file với processor, gateway phải import processor file →
 * processor file đã import gateway → cycle. Tách constants ra → cả hai chỉ
 * import file này, không cần biết nhau.
 */

export const CALL_AUTO_MISS_QUEUE = 'call-auto-miss';

export interface AutoMissJobData {
  calleeId: string;
  callId: string;
  roomId: string;
}
