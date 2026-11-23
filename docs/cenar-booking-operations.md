# Vận hành Cenar Booking

Các lệnh booking được đăng ký cho Store 2. Mở `#dat-lich` để đặt lịch chơi game hoặc trò chuyện, xem lịch của mình và mở trợ giúp. Phiếu mới có lịch lưu trong SQLite. Staff dùng `/cenar-booking phan-host` khi host đồng ý, rồi dùng `/cenar-booking bao-gia` để chốt giá và tiền công theo giờ. Phiếu mở trước bản cập nhật tiếp tục dùng các nút trạng thái cũ.

## Phiên và thanh toán

- Quản lý dùng `/cenar-booking mo-ca` sau khi host có hồ sơ công khai và đồng ý về dịch vụ, thời gian, giá và lương. Nút **Đặt lịch tự động** hiện ca khả dụng theo giờ Việt Nam. Khách chọn ca và xem tổng tiền trước khi bấm **Xác nhận giữ chỗ**. Dùng `/cenar-booking dong-ca` với mã ca để dừng nhận lượt mới.
- `/cenar-booking quan-ly-ca` mở bảng riêng cho quản lý, mặc định 7 ngày theo giờ Việt Nam. Lọc bằng `ngay`, `host` hoặc dùng `trang` để duyệt. Bảng ghi mã ca, giờ, giá, tình trạng mở, giữ chỗ, đã đặt hoặc đã qua. Đóng ca dừng nhận lượt mới và các lượt đã giữ tiếp tục được theo dõi.
- **Lịch của bạn** xếp các phiên chưa đến hạn ở trước lịch sử và hiển thị trạng thái hóa đơn đã xác minh. Chủ phiếu mở được phiếu từ lịch, còn host có liên kết phòng của chính phiên đang diễn ra.
- Ca miễn phí xác nhận khi giữ chỗ. Ca có phí chỉ hiện khi PayOS Booking Store 2 sẵn sàng. Giữ chỗ tối đa 15 phút. QR nằm trong phiếu riêng. Nếu cần, chủ phiếu có thể bấm **Mở lại QR** trong thời hạn giữ chỗ. Chỉ xác nhận khi đối soát PayOS khớp đơn, link và tiền. Khoản nhận sau hạn chuyển sang quản lý rà soát.
- Báo giá 0đ và tiền công 0đ tạo phiên miễn phí. Khi đến giờ, bot cấp phòng voice riêng, gửi đường dẫn cho khách trong phiếu và nhắn host một lần. Host cũng xem được phòng trong Lịch của bạn. Bot cảnh báo trước khi hết và thu hồi phòng lúc kết thúc. Bot cần quyền quản lý kênh, quyền và di chuyển thành viên. [Kênh đặt lịch](https://discord.com/channels/1070676180103086132/1573607352555405365)
- Tối đa một lời nhắc riêng được gửi cho host trong 15 phút trước giờ bắt đầu nếu phiếu còn mở và giá gốc đã được đối soát hoặc miễn phí. Khi host đóng DM, bot giữ lịch trong mục Lịch của bạn.
- Phiên hết giờ khi bot chưa thấy cả hai người có mặt chuyển sang chờ staff kiểm tra. Staff xác nhận phiên đã thực sự diễn ra bằng `/cenar-booking ket-thuc` trong phiếu. Chỉ phiên hoàn thành mới tính vào bảng lương và nhận đánh giá.
- Khách bấm yêu cầu gia hạn trong phiếu. Staff xác nhận với host và dùng `/cenar-booking gia-han` để báo giá. Khoản gia hạn có phí chỉ kéo dài thời gian sau khi đối soát PayOS hợp lệ.
- Muốn bật hóa đơn có phí, kiểm tra đúng tài khoản PayOS của Store 2, callback và webhook đã ký rồi đặt `BOOKING_PAYOS_ENABLED=true` trên Store 2. `/cenar-booking kiem-tra-bill` tra đơn riêng theo chứng từ ngân hàng ghi trong cơ sở dữ liệu. Ảnh chuyển khoản chỉ dùng để staff trao đổi. Khoản đã nhận sau khi phiên hết hiệu lực cần quản lý kiểm tra trước khi hoàn hoặc đặt lịch mới.
- `/cenar-booking bao-cao` hiển thị doanh thu, tiền công và số phiên hoàn thành cho quản lý. Thời lượng dùng theo báo giá đã chốt. Báo cáo không chuyển tiền tự động.

## Hóa đơn và biên nhận

- Chủ phiếu hoặc quản lý mở `/cenar-booking hoa-don` để xem hóa đơn mới nhất. Nhập mã phiếu để tra lại sau khi đóng. Trạng thái đã đối soát lấy từ giao dịch PayOS đã xác minh. Hóa đơn có ảnh và phiên bản chữ.
- `/cenar-booking mau-hoa-don` cho quản lý xem mẫu Booking, Nạp tiền, Ủng hộ và Hoàn tiền. Mẫu hiển thị **BẢN MẪU**. Để phát hành biên nhận thực cho ba giao dịch ngoài Booking, Store 2 cần nguồn đối soát riêng và quy tắc áp dụng.

## Hồ sơ, đánh giá và cộng đồng

- `/cenar-ho-so` tạo bản nháp host, duyệt đúng phiên bản trước khi đăng thẻ và cập nhật lại bài cũ khi cần. Khách trong phiên hoàn thành được đánh giá 1–5 sao một lần và có thể đồng ý đăng nhận xét ẩn danh.
- Host đã tạo hồ sơ có thể gửi JPG, PNG hoặc WebP tối đa 3 MB bằng `/cenar-ho-so doi-anh` và đồng ý công khai. Xem trước riêng với `/cenar-ho-so xem-ban-nhap`. Quản lý dùng `duyet` với đúng phiên bản trước khi ảnh xuất hiện trên thẻ và diễn đàn. `go-anh` gỡ ảnh khỏi thẻ hiện tại. `an-ho-so` thu hồi cả hồ sơ. Bot resize ảnh về 192 × 192 px và giới hạn kho ảnh trong SQLite ở 16 MiB.
- Nút **Duyệt hồ sơ** ở Sảnh và Đặt lịch mở thẻ riêng chỉ gồm hồ sơ đã duyệt và đăng. Nút **Xem ca trống** lọc ca khả dụng của host đó và đưa khách đến bước xem giá trước khi xác nhận. Khách có thể chọn game hoặc voice để gửi giờ khác cho staff.
- `/cenar-cong-dong` có điểm danh, XP chat và voice cộng đồng, nhiệm vụ, bảng xếp hạng, vật phẩm, sáu trò chơi miễn phí, Nối từ, Đoán từ và hai chế độ Ô chữ. Điểm cộng đồng dùng trong bot và không quy đổi ra tiền. Kết nối, kết hôn và thú cưng chung cần hai bên đồng ý.
- Kênh **trò-chơi-cenar** mở riêng Ô chữ tiếng Việt và tiếng Anh, Điểm danh, Nhiệm vụ, Cửa hàng và Bảng xếp hạng. Ô chữ có năm chữ cái, sáu lượt và lưu tiến độ đến nửa đêm giờ Việt Nam. Kênh **sự-kiện-cenar** dành cho lịch cộng đồng và `/giveaway start` của quản trị viên. Voice công cộng có danh mục riêng, phiếu và phòng theo lịch vẫn ở khu vực riêng.
- `/cenar-booking hoi` hướng dẫn các thao tác và trả lời câu hỏi về báo cáo nếu người hỏi có quyền. Chỉ bài hướng dẫn công khai được gửi tới nhà cung cấp AI khi bật `BOOKING_AI_ENABLED=true` và đã cấu hình nhà cung cấp. Số liệu do bot tính từ báo cáo đã định nghĩa.
- Quản lý dùng `/cenar-booking nhap-icon` để thêm emoji hoặc sticker tĩnh từ tệp Discord được phép sử dụng. [Giới hạn sticker Discord](https://discord.com/blog/how-to-create-upload-your-own-stickers-on-discord)

## Đối chiếu phạm vi

Tài liệu tham khảo công khai mô tả tính năng theo nhóm. Cenar triển khai quy trình riêng. Các hạng mục còn khác gồm QR tài khoản nhận tiền riêng theo host, hình hóa đơn nạp/ủng hộ/hoàn và khu trò chơi cược. [Danh mục ChengBot](https://chengbot.io.vn/bot/booking)
