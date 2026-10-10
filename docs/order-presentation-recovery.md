# Đồng bộ đơn sau `/sua-don`

## Cách xử lý

- SQLite vẫn là dữ liệu gốc. Sửa đơn cập nhật thẻ hoàn thành, log, nhãn sản phẩm trong feedback trên website và bài feedback Discord.
- Đọc ID thẻ đã lưu trước; thẻ cũ chưa có ID được tìm trong tối đa 500 tin. Nhận diện đúng bot, mã đơn, nút hoặc tiêu đề hoàn thành; không nhầm bài review hay mã đơn có cùng tiền tố.
- Nếu đã đọc hết lịch sử và thẻ bị mất, tạo lại một thẻ trong ticket còn mở. Lưu ID và tuần tự hóa thao tác của cùng đơn để lần đồng bộ sau sửa cùng thẻ.
- Nếu ticket đã đóng/kênh bị xóa, thiếu liên kết ticket hoặc tìm hết 500 tin vẫn chưa xác định được: tạo/cập nhật một DM riêng cho đúng khách Discord. Không mở lại ticket, không sửa transcript lịch sử, không đăng thẻ vào kênh staff đang chạy lệnh.
- Các lỗi thiếu quyền, mất truy cập, timeout không được xem là thẻ bị xóa. Bot báo lỗi và giữ nguyên dữ liệu để staff thử lại. DM bị chặn cũng không được báo thành công.
- Feedback đã gửi giữ nguyên số sao, nhận xét, tác giả và trạng thái hiển thị. Thẻ được phục hồi không mở lại nút đánh giá. Tất cả thao tác phục hồi/đồng bộ đều tắt mention.
- Hai cột `orders.completion_update_dm_channel_id/message_id` được thêm vào SQLite, không thay thế dữ liệu cũ; ID giao tài khoản/credential DM được giữ riêng.

## Thử lại không sửa dữ liệu

Manager dùng `/sua-don ma_don:CN_XXXXXX dong_bo:true`. Không cần nhập giá/sản phẩm/thời hạn và không chạy thanh toán, giao hàng, cấp role hoặc đóng ticket.

Backend có hai route dùng cùng bảo vệ API key/current account role/session version/MFA policy hiện hành và giới hạn guild:

- `GET /api/bot/admin/orders/:code/presentation`: đọc trạng thái thẻ/DM đã lưu; không trả credential, danh tính hoặc dữ liệu ngân hàng.
- `POST /api/bot/admin/orders/:code/presentation`: chủ động phục hồi một đơn hoàn thành/bảo hành và đồng bộ feedback; ghi audit. Không có timer hoặc quét gửi hàng loạt.

Kiểm thử: `npm test -- test/orderEditPresentationSync.test.js test/feedbackDiscordSync.test.js tests/web-api-authorization.test.js tests/order-duration.test.js`.
