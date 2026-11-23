# Vận hành Cenar Booking

Các lệnh booking được đăng ký cho Store 2. Mở `#dat-lich` để đặt lịch chơi game hoặc trò chuyện, xem lịch của mình và mở trợ giúp. Phiếu mới có lịch lưu trong SQLite. Staff dùng `/cenar-booking phan-host` khi host đồng ý, rồi dùng `/cenar-booking bao-gia` để chốt giá và tiền công theo giờ. Phiếu mở trước bản cập nhật tiếp tục dùng các nút trạng thái cũ.

## Phiên và thanh toán

- Báo giá 0đ và tiền công 0đ tạo phiên miễn phí. Khi đến giờ, bot cấp phòng voice riêng cho khách và host, nhắc host một lần trong phiếu, cảnh báo trước khi hết và thu hồi phòng khi kết thúc. Bot cần quyền quản lý kênh, quyền và di chuyển thành viên. [Kênh đặt lịch](https://discord.com/channels/1070676180103086132/1573607352555405365)
- Khách bấm yêu cầu gia hạn trong phiếu. Staff xác nhận với host và dùng `/cenar-booking gia-han` để báo giá. Khoản gia hạn có phí chỉ kéo dài thời gian sau khi đối soát PayOS hợp lệ.
- Muốn bật hóa đơn có phí, kiểm tra đúng tài khoản PayOS của Store 2, callback và webhook đã ký rồi đặt `BOOKING_PAYOS_ENABLED=true` trên Store 2. `/cenar-booking kiem-tra-bill` tra đơn riêng theo chứng từ ngân hàng ghi trong cơ sở dữ liệu. Ảnh chuyển khoản chỉ dùng để staff trao đổi. Khoản đã nhận sau khi phiên hết hiệu lực cần quản lý kiểm tra trước khi hoàn hoặc đặt lịch mới.
- `/cenar-booking bao-cao` hiển thị doanh thu, tiền công và số phiên hoàn thành cho quản lý. Thời lượng dùng theo báo giá đã chốt. Báo cáo không chuyển tiền tự động.

## Hồ sơ, đánh giá và cộng đồng

- `/cenar-ho-so` tạo bản nháp host, duyệt đúng phiên bản trước khi đăng thẻ và cập nhật lại bài cũ khi cần. Khách trong phiên hoàn thành được đánh giá 1–5 sao một lần và có thể đồng ý đăng nhận xét ẩn danh.
- `/cenar-cong-dong` có điểm danh, XP chat và voice cộng đồng, nhiệm vụ, bảng xếp hạng, vật phẩm, sáu trò chơi miễn phí và hai trò chơi chữ. Điểm cộng đồng dùng trong bot và không quy đổi ra tiền. Kết nối, kết hôn và thú cưng chung cần hai bên đồng ý.
- `/cenar-booking hoi` hướng dẫn các thao tác và trả lời câu hỏi về báo cáo nếu người hỏi có quyền. Chỉ bài hướng dẫn công khai được gửi tới nhà cung cấp AI khi bật `BOOKING_AI_ENABLED=true` và đã cấu hình nhà cung cấp. Số liệu do bot tính từ báo cáo đã định nghĩa.
- Quản lý dùng `/cenar-booking nhap-icon` để thêm emoji hoặc sticker tĩnh từ tệp Discord được phép sử dụng. [Giới hạn sticker Discord](https://discord.com/blog/how-to-create-upload-your-own-stickers-on-discord)

## Đối chiếu phạm vi

Tài liệu tham khảo công khai mô tả tính năng theo nhóm. Cenar triển khai quy trình riêng. Các hạng mục còn khác gồm QR tài khoản nhận tiền riêng theo host, hình hóa đơn nạp/ủng hộ/hoàn và khu trò chơi cược. [Danh mục ChengBot](https://chengbot.io.vn/bot/booking)
