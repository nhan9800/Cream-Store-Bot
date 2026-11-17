# Bộ lọc giục đơn và tag spam

Bot quét tin nhắn mới của thành viên thường trong mọi kênh mà bot có quyền đọc. Bộ lọc chuẩn hóa tiếng Việt có dấu,
biến thể không dấu, tiếng Anh, ký tự lặp và dấu câu trước khi nhận diện các nhóm như `2 tuần chưa trả đơn`,
`bao giờ giao`, `rep/check đơn`, `hối/giục đơn`, `still waiting` và tag dồn dập.

Một câu hỏi hoặc phàn nàn đơn lẻ được giữ lại làm bằng chứng. Trạng thái được lưu theo `guild_id` và `user_id` trong
cửa sổ 30 phút; tin phù hợp lặp lại hoặc trùng nội dung trong 10 phút mới bị xóa. Cảnh cáo được gửi tối đa một lần
mỗi 15 phút, tự xóa sau 15 giây và tắt mọi mention để không tạo thêm spam. Staff, bot và các tin nhắn không có tín hiệu
delay/pressure không bị áp dụng.

Guard chỉ xử lý message mới qua `messageCreate`; không quét ngược hoặc bulk-delete lịch sử, không timeout/ban tự động,
không gọi AI cho từng tin. Mỗi lần xóa và cảnh cáo được ghi vào staff automation log với channel/message ID đã giới hạn,
không lưu nguyên văn nội dung khách hàng. Nếu bot thiếu quyền xóa, sự kiện được ghi là thất bại để Admin xử lý.
