# Cenar Music — playlist YouTube

## Cách sử dụng

1. Vào phòng thoại đang dùng bot.
2. Dùng `/music link:<link playlist>` hoặc nút **Thêm bài / playlist** trên bảng điều khiển.
3. Bot đọc danh sách, thông báo tên playlist và số bài đã thêm. Các bài nối vào cuối hàng đợi theo thứ tự playlist; bài đang phát hoặc đang tạm dừng được giữ nguyên.
4. Có thể thêm playlist khác bằng cùng thao tác. Khi hàng đợi trống, bot bắt đầu phát.

Dashboard `/admin/music` dùng cùng luồng phát và thông báo kết quả. Link video riêng vẫn thêm một bài như trước.

## Phạm vi

- Nhận playlist công khai hoặc không công khai nhưng truy cập được qua link, từ YouTube và YouTube Music. Link video có tham số `list` được hiểu là toàn bộ playlist.
- Playlist riêng tư, rỗng hoặc không có bài truy cập được sẽ báo lỗi. Những bài bị xóa/ẩn mà YouTube không cung cấp không được tính vào số bài đã thêm.
- Danh sách Mix/radio tự sinh của YouTube (`RD…`) cần lưu thành playlist thông thường trước khi thêm. Không báo thành công cả playlist nếu nguồn chỉ trả một video.
- Tuân thủ giới hạn hàng đợi của máy chủ (tối đa 200 bài chờ). Nếu không đủ chỗ cho cả danh sách, bot từ chối lượt thêm và báo số chỗ còn lại.
- Chỉ thêm vào đúng phòng thoại đang phát. Không chuyển bot sang phòng khác khi thêm playlist.

## Kiểm tra khi vận hành

Giữ nguyên DAVE/MLS, PCM một lần, FFmpeg và chuyển âm lượng mượt của luồng nhạc hiện tại. Kiểm thử xác nhận thứ tự, nối thêm, trạng thái tạm dừng, giới hạn hàng đợi, yêu cầu đồng thời và lỗi nguồn. Probe metadata công khai không tham gia phòng thoại và không phát âm thanh; health/revision chỉ xác nhận triển khai. Việc nghe thực tế cần người dùng trong phòng thoại.
