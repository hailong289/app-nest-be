# Notes

File dành để ghi chú tùy ý.

---

Mongo model summary (libs/db/src/mongo/model):

- Tổng cộng **17 collection** quản lý dữ liệu chat, người dùng và học tập.
- Danh sách & số cột chính (không tính timestamps/subdoc):
  1. Attachments – 12 trường.
  2. Flashcards – 17 trường.
  3. FlashcardDecks – 14 trường.
  4. Friendships – 5 trường.
  5. Keys – 4 trường.
  6. MessageHides – 5 trường.
  7. MessageReactions – 5 trường.
  8. MessageReads – 5 trường.
  9. Messages – 13 trường.
  10. Notifications – 11 trường.
  11. Otps – 6 trường.
  12. Quizzes – 16 trường.
  13. RoomEvents – 8 trường.
  14. Rooms – 9 trường.
  15. RoomsState – 3 trường.
  16. RoomsUsersState – 9 trường.
  17. Users – 10 trường.
- Chi tiết type/field xem nhanh trong mã nguồn `libs/db/src/mongo/model/*.ts`. File note này chỉ tóm tắt cho dễ nhớ.

Tổng kết: 17 collection đã được thống kê số trường như trên.

---

## Mục đích từng collection

- **Attachments**: lưu metadata file đính kèm của tin nhắn (loại, kích thước, URL, trạng thái xử lý).
- **Flashcards**: quản lý nội dung từng thẻ học, tiến độ học viên, mức độ khó và thống kê.
- **FlashcardDecks**: gom nhóm flashcards theo bộ chủ đề, phục vụ chia sẻ/học chung.
- **Friendships**: theo dõi yêu cầu, chấp nhận, từ chối, chặn giữa hai người dùng.
- **Keys**: lưu client token, FCM token và các JIT của user để phục vụ xác thực/thông báo.
- **MessageHides**: đánh dấu người dùng đã ẩn tin nhắn nào (clear history cá nhân).
- **MessageReactions**: lưu emoji reaction của từng user trên từng tin nhắn.
- **MessageReads**: track trạng thái đã đọc để hiển thị read receipt trong phòng.
- **Messages**: kho lưu trữ chính của tất cả tin nhắn (nội dung, loại, đính kèm, xoá/sửa).
- **Notifications**: thông báo push/in-app gửi cho user (kết bạn, tin nhắn, hệ thống).
- **Otps**: mã OTP dùng cho đăng ký/khôi phục mật khẩu với TTL tự xoá.
- **Quizzes**: cấu hình quiz trong phòng, câu hỏi/đáp án, lịch, kết quả người tham gia.
- **RoomEvents**: log sự kiện phòng (thành viên vào/ra, đổi vai trò, đổi tên…).
- **Rooms**: thông tin phòng chat (loại, tên, avatar, thành viên, tin ghim).
- **RoomsState**: snapshot tin nhắn cuối và nội dung preview để render danh sách phòng.
- **RoomsUsersState**: trạng thái phòng theo từng người dùng (đã đọc, mute, pin, unread).
- **Users**: hồ sơ người dùng (định danh, thông tin liên hệ, trạng thái hoạt động).
