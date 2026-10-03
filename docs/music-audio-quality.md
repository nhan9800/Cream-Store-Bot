# Cenar Music — chất lượng và độ ổn định âm thanh

## Luồng âm thanh

YouTube `bestaudio` → FFmpeg một lần → PCM 48 kHz stereo → gom frame 20 ms → volume thật → native Opus chế độ nhạc → Discord DAVE.

- Native bitrate được đặt trước khi mã hóa, theo bitrate của phòng thoại (8–384 kbps; không rõ phòng dùng 64 kbps). Dashboard báo cấu hình thực của encoder trong `state.audio`; đây không phải số đo chất lượng nguồn hay mạng.
- Giữ nguyên bài đang phát, playlist, thứ tự và âm lượng mặc định của máy chủ. Nút âm lượng áp dụng vào PCM; không khuếch đại quá 100%.
- Không bật EQ, reverb, compressor hay bass boost mặc định. Không giải mã/mã hóa Opus hai lần và không chạy FFmpeg lần hai.
- Gom đủ 3.840 byte/frame trước DSP để không mất mẫu khi nguồn chia chunk nhỏ hoặc chia giữa sample. Phần dư cuối bài được đệm tối đa một frame.
- Hủy nguồn nếu không có frame đầu sau 20 giây. Khi đã nhận frame đầu, tạm dừng hoặc backpressure không kích hoạt deadline này. Thiếu âm thanh ngắn được chịu tối đa 25 frame (500 ms) trước khi player kết thúc bài.
- DAVE thất bại, stop, disconnect và lỗi pipeline đóng ngược đến nguồn FFmpeg/yt-dlp; không giữ child process mồ côi.

Nguồn YouTube và cấu hình phòng thoại vẫn giới hạn chất lượng. Không thể phục hồi chi tiết nguồn đã mất hoặc hứa âm thanh lossless. Có thể tăng bitrate phòng nhạc trong Discord trong mức máy chủ cho phép; bot dùng mức đó cho bài tiếp theo.

## Lỗi đã khắc phục

`disableFilterer:true` trong Discord Player 7.2.0 bỏ toàn bộ DSP, kể cả volume, nên nút âm lượng trước đây không có tác dụng. Khi bật DSP, cần đưa preset tắt hiệu ứng một cách tường minh để thư viện không tự tạo compressor/reverb mặc định.

Generic `@discord-player/opus` 7.2.0 bỏ chunk nhỏ hơn một frame, và wrapper CTL không tương thích tên method của mediaplex. Cenar dùng native mediaplex đã có trong dependency graph, khai báo trực tiếp cùng version 1.0.0; buffer giữ mọi mẫu và cấu hình encoder trước khi pipe. Không sửa `node_modules`.

## Kiểm thử

Native synthetic PCM kiểm tra số frame/byte, odd chunk boundaries, decodable stereo, bitrate 64/96/128/256/384 kbps, cleanup và deadline. Kiểm tra qua StreamDispatcher/FiltersChain thật xác nhận tỷ lệ RMS của volume 80%/20% khoảng 4 lần và không có compressor/reverb hay encoder thứ hai. Các kiểm tra này không thay thế nghe thực tế trong phòng thoại.

Tham chiếu: [Discord voice format](https://github.com/discord/discord-api-docs/blob/main/developers/topics/voice-connections.mdx), [Opus encoder controls](https://opus-codec.org/docs/html_api-1.0.3/group__opus__encoderctls.html), [Node stream pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback).
