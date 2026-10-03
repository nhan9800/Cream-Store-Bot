# Cenar Music — playlist và Mix/Radio YouTube

## Cách sử dụng

1. Vào phòng thoại đang dùng bot.
2. Dùng `/music link:<link playlist>` hoặc nút **Thêm bài / playlist** trên bảng điều khiển.
3. Bot đọc danh sách, thông báo tên playlist và số bài đã thêm. Các bài nối vào cuối hàng đợi theo thứ tự playlist; bài đang phát hoặc đang tạm dừng được giữ nguyên.
4. Có thể thêm playlist khác bằng cùng thao tác. Khi hàng đợi trống, bot bắt đầu phát.

Dashboard `/admin/music` dùng cùng luồng phát và nhận được cùng số bài đã thêm. Link video riêng vẫn thêm một bài như trước. Link Mix/Radio được nhận ở `/music`, nút **Thêm bài / playlist / Mix** và dashboard.

## Phạm vi

- Nhận playlist công khai hoặc không công khai nhưng truy cập được qua link, từ YouTube và YouTube Music. Link video có tham số `list` được hiểu là toàn bộ playlist.
- Playlist riêng tư, rỗng hoặc không có bài truy cập được sẽ báo lỗi. Những bài bị xóa/ẩn mà YouTube không cung cấp không được tính vào số bài đã thêm.
- Danh sách Mix/Radio tự sinh (`RD…`, gồm My Mix và YouTube Music) lấy tối đa **50 vị trí đầu tại thời điểm thêm**, loại bài trùng hoặc không khả dụng và báo đúng số bài được thêm. Đây là một lượt danh sách hữu hạn, không tự phát vô tận hoặc tải các gợi ý tiếp theo.
- Gửi link `watch?v=VIDEO_ID&list=RD…` hoặc link `youtu.be/VIDEO_ID?list=RD…`. Bot giữ video đang được chia sẻ làm bài mở đầu và bỏ `index`/mốc thời gian vì thứ tự Mix thay đổi theo YouTube. Link chỉ có mã `RD` + video ID (hoặc `RDMM`/`RDAMVM` + video ID) được bổ sung video mở đầu; các mã Mix không suy ra được video có thể cần link chia sẻ đầy đủ.
- Mix riêng tư/cá nhân hóa yêu cầu tài khoản có thể không truy cập được. Bot báo lỗi rõ ràng, không đổi Mix thành một video và không tự dùng tài khoản của khách.
- Tuân thủ giới hạn hàng đợi của máy chủ (tối đa 200 bài chờ). Nếu không đủ chỗ cho cả danh sách, bot từ chối lượt thêm và báo số chỗ còn lại.
- Chỉ thêm vào đúng phòng thoại đang phát. Không chuyển bot sang phòng khác khi thêm playlist.

## Kiểm tra khi vận hành

Giữ nguyên DAVE/MLS, PCM một lần, FFmpeg và chuyển âm lượng mượt của luồng nhạc hiện tại. Kiểm thử xác nhận thứ tự, nối thêm, trạng thái tạm dừng, giới hạn hàng đợi, yêu cầu đồng thời và lỗi nguồn. Probe metadata công khai không tham gia phòng thoại và không phát âm thanh; health/revision chỉ xác nhận triển khai. Việc nghe thực tế cần người dùng trong phòng thoại.

`src/services/youtubeMixSource.js` chạy yt-dlp đã được xác minh checksum với flat metadata, `--playlist-items 1:50`, không tải media. Deadline 20 giây bao gồm chuẩn bị runtime và đọc dữ liệu; hủy cả process group trên Linux hoặc cây tiến trình trên Windows. Giới hạn output 8 MiB, số lần thử hữu hạn. Chỉ tạo Track mới với URL video YouTube hợp lệ và extractor PCM hiện có; không đưa raw subprocess error, cookie path hoặc proxy credentials vào Discord/API. Website hiện có nhận response playlist nên không cần thay đổi frontend để phát Mix.

Tham chiếu chính: [yt-dlp playlist selection](https://github.com/yt-dlp/yt-dlp#video-selection), [extractor Mix behavior](https://github.com/dfxphoenix/discord-player-youtubedlp#notes).
