# Cenar Music — chất lượng và độ ổn định âm thanh

## Luồng âm thanh

YouTube `bestaudio` → FFmpeg một lần → PCM 48 kHz stereo → gom frame 20 ms → volume thật → hiệu ứng live → native Opus chế độ nhạc → Discord DAVE.

- Native bitrate được đặt trước khi mã hóa, theo bitrate của phòng thoại (8–384 kbps; không rõ phòng dùng 64 kbps). Dashboard báo cấu hình thực của encoder trong `state.audio`; đây không phải số đo chất lượng nguồn hay mạng.
- Giữ nguyên bài đang phát, playlist, thứ tự và âm lượng mặc định của máy chủ. Nút âm lượng áp dụng vào PCM; không khuếch đại quá 100%.
- Chế độ Nguyên bản giữ PCM nguyên vẹn, không EQ/vang/bass. Hiệu ứng được chọn xử lý trong bộ DSP riêng; không bật hiệu ứng mặc định của Discord Player. Không giải mã/mã hóa Opus hai lần và không chạy FFmpeg lần hai.
- Gom đủ 3.840 byte/frame trước DSP để không mất mẫu khi nguồn chia chunk nhỏ hoặc chia giữa sample. Phần dư cuối bài được đệm tối đa một frame.
- Hủy nguồn nếu không có frame đầu sau 20 giây. Khi đã nhận frame đầu, tạm dừng hoặc backpressure không kích hoạt deadline này. Thiếu âm thanh ngắn được chịu tối đa 25 frame (500 ms) trước khi player kết thúc bài.
- DAVE thất bại, stop, disconnect và lỗi pipeline đóng ngược đến nguồn FFmpeg/yt-dlp; không giữ child process mồ côi.

Nguồn YouTube và cấu hình phòng thoại vẫn giới hạn chất lượng. Không thể phục hồi chi tiết nguồn đã mất hoặc hứa âm thanh lossless. Có thể tăng bitrate phòng nhạc trong Discord trong mức máy chủ cho phép; bot dùng mức đó cho bài tiếp theo.

## Âm thanh và hiệu ứng live

Mở `/music`, chọn menu âm thanh hoặc nhấn **Chỉnh âm live**. `/admin/music` có cùng tám preset và thêm các thanh chỉnh trực tiếp. Thay đổi áp dụng lên PCM đang phát, chuyển mượt khoảng 80 ms; không thay resource, không tìm lại nguồn, không chuyển bài và không đặt lại tiến độ. Độ trễ nghe thêm phụ thuộc buffer Discord/mạng. Khi tạm dừng, cấu hình lưu vào luồng hiện tại và nghe được khi tiếp tục.

| Chế độ | Cách xử lý |
| --- | --- |
| Nguyên bản | Không hiệu ứng; PCM nguyên vẹn để so sánh |
| Studio | Bass ấm, treble sáng, stereo và vang nhẹ |
| Bass sâu | Nhấn dải trầm, giữ cao độ/tốc độ |
| Giọng hát | Giảm trầm đục, làm sáng dải cao |
| Lo-fi | Treble dịu, stereo gọn, vang/echo nhẹ |
| Sân khấu | Stereo rộng và vang phòng |
| Karaoke | Giảm tín hiệu ở giữa stereo; không phải AI tách giọng và có thể làm giảm nhạc cụ ở giữa |
| Không gian | Dịch vị trí trái/phải chậm, hợp nghe tai nghe; không phải âm thanh binaural được đo cho từng người |

Chỉnh bass/treble -6 đến +6 dB, stereo 0–150%, reverb 0–35%, echo 0–25%, không gian 0–100% và Karaoke bật/tắt. Dải âm tăng được dành headroom và qua limiter mềm để tránh clipping; hiệu ứng không được quảng cáo là tự làm nguồn chi tiết hơn hoặc chỉ tăng âm lượng.

Preset/cấu hình lưu riêng theo guild trong bảng SQLite bổ sung `music_sound_settings`. Không có phiên nhạc vẫn lưu được cấu hình cho bài kế tiếp. `state.sound.live` chỉ đúng khi DSP thực đang nhận PCM; stream đã đóng không được báo đang áp dụng live. Nhấn **Về Bản gốc** để tắt hiệu ứng. Quyền Discord cùng phòng/DJ/Quản lý máy chủ và quyền Admin/MFA/API hiện có vẫn được kiểm tra trước thay đổi.

Mã: `src/services/musicSoundEffects.js` (DSP), `src/services/musicSoundService.js` (lưu/apply), `musicPlayerService.js` (Opus hook và Discord controls). Test dùng tín hiệu PCM thực để kiểm tra dải tần, stereo, vang, Karaoke, chuyển đổi liên tục, clipping và lifecycle; test qua codec/native resource giữ 48k stereo và không có encoder thứ hai. Các kiểm tra này chưa thay thế việc nghe trong phòng thoại production.

## Lỗi đã khắc phục

`disableFilterer:true` trong Discord Player 7.2.0 bỏ toàn bộ DSP, kể cả volume, nên nút âm lượng trước đây không có tác dụng. Khi bật DSP, cần đưa preset tắt hiệu ứng một cách tường minh để thư viện không tự tạo compressor/reverb mặc định.

Generic `@discord-player/opus` 7.2.0 bỏ chunk nhỏ hơn một frame, và wrapper CTL không tương thích tên method của mediaplex. Cenar dùng native mediaplex đã có trong dependency graph, khai báo trực tiếp cùng version 1.0.0; buffer giữ mọi mẫu và cấu hình encoder trước khi pipe. Không sửa `node_modules`.

## Kiểm thử

Native synthetic PCM kiểm tra số frame/byte, odd chunk boundaries, decodable stereo, bitrate 64/96/128/256/384 kbps, cleanup và deadline. Kiểm tra qua StreamDispatcher/FiltersChain thật xác nhận tỷ lệ RMS của volume 80%/20% khoảng 4 lần và không có compressor/reverb hay encoder thứ hai. Các kiểm tra này không thay thế nghe thực tế trong phòng thoại.

Tham chiếu: [Discord voice format](https://github.com/discord/discord-api-docs/blob/main/developers/topics/voice-connections.mdx), [Opus encoder controls](https://opus-codec.org/docs/html_api-1.0.3/group__opus__encoderctls.html), [Node stream pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback).
