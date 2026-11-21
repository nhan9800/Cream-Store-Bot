# Disaster Recovery Plan - Cenar Store Bot

## Mục tiêu

- Khôi phục bot trên VibeHost với source đã kiểm thử và hai bản SQLite đã xác minh.
- Không để source deployment ghi đè secret hoặc dữ liệu production.
- Khôi phục cấu trúc Discord và thành viên đã chủ động cấp quyền OAuth2 `guilds.join`.

## Dữ liệu nằm trong recovery backup

- Toàn bộ dữ liệu nghiệp vụ trong SQLite: hồ sơ khách, đơn hàng, ví, bảo hành, CTV/Partner và cấu hình bot.
- Recovery snapshot mới nhất của tên/nhận diện server, cài đặt cơ bản, vai trò, thứ tự vai trò, kênh, danh mục,
  permission overwrite, custom emoji và sticker. Asset icon/banner/role/sticker/emoji được lưu dạng base64 trong
  giới hạn kích thước an toàn để có thể khôi phục ngay cả khi CDN không còn trả URL cũ.
- Discord ID, tên hiển thị, danh sách vai trò và OAuth access/refresh token của người đã đồng ý. Token được mã hóa
  AES-256-GCM bằng `ENCRYPTION_KEY` trước khi ghi database.

Không backup mật khẩu Discord, DM hoặc toàn bộ lịch sử tin nhắn. Người chưa cấp `guilds.join`, đã thu hồi quyền
ứng dụng hoặc có refresh token không còn hợp lệ không thể được tự động thêm vào server dự phòng.

## Quy trình

1. Tạo hoặc làm sạch server VibeHost, xác nhận thư mục chạy là `/home/container` và allocation public là
   `20022`.
2. Upload source của commit tốt gần nhất vào `/home/container`.
3. Khôi phục `.env` và `.env.store2` từ kho secret an toàn, không lấy từ Git.
4. Khôi phục các database đã qua integrity check:
   - `/home/container/data/shopbot.sqlite`
   - `/home/container/data/shopbot-store2.sqlite`
5. Chạy `npm ci --omit=dev --no-audit --no-fund`.
6. Cấu hình Startup command là `npm start`, sau đó Start server từ panel.
7. Kiểm tra Console, trạng thái hai bot Discord và hai health endpoint qua cổng public `20022`.
8. Mời đúng bot (cùng Discord Application đã cấp OAuth) vào server Discord dự phòng và cấp `Manage Server`,
   `Manage Roles`, `Manage Channels`, `Manage Expressions` và `Create Invite`. Đặt role cao nhất của bot cao hơn
   các role cần khôi phục để Discord cho phép bot quản lý chúng.
9. Trong server nguồn, chạy `/khoi-phuc-server hanh_dong:Khôi phục guild_dich:<ID> xac_nhan:True` để tái tạo cấu
   trúc. Lệnh idempotent theo tên nên có thể chạy lại sau khi sửa quyền.
10. Chạy `/chuyen-server guild_id:<ID server dự phòng>` để thêm các thành viên còn OAuth hợp lệ và gán lại các vai
    trò trùng tên. Lệnh xử lý cả người đã có sẵn ở server đích, tự refresh token sắp hết hạn, retry theo
    `Retry-After` khi Discord trả 429 và báo riêng các role không thể gán do hierarchy/quyền.

Trước khi có sự cố, Owner có thể chạy `/khoi-phuc-server hanh_dong:Tạo snapshot ngay` để tạo điểm phục hồi thủ
công. Scheduler cũng tự chụp snapshot trước mỗi lần backup SQLite.

Mỗi lần scheduler sao lưu, bot tạo một tệp có timestamp riêng, sao chép nó sang vùng tạm, mở database vừa khôi
phục, chạy `PRAGMA integrity_check` và thử một giao dịch ghi có rollback. Chỉ sau khi bước này thành công hệ thống
mới dọn bản cũ và tải bản mới lên dịch vụ ngoài. Kết quả gần nhất nằm tại `backups/latest-status.json`, trong đó
`local`, `restoreVerification`, `telegram` và `googleDrive` có trạng thái độc lập:

- `success`: bước đã hoàn tất.
- `skipped` với `not_configured`: dịch vụ ngoài chưa được cấu hình.
- `failed`: cấu hình thiếu hoặc thao tác thất bại; bản sao cục bộ đã xác minh vẫn được giữ nếu có.
- `overallStatus: local_only`: bản cục bộ và phép thử khôi phục thành công nhưng chưa cấu hình nơi lưu từ xa.

## Bản sao lưu ngoài host (mã hóa)

- Bản gửi lên Telegram/Google Drive là file `*.sqlite.gz.cenc`: SQLite nén gzip rồi mã hóa AES-256-GCM, khóa
  dẫn xuất bằng scrypt từ `BACKUP_ENCRYPTION_KEY` (>= 32 ký tự). Thiếu hoặc khóa yếu thì trạng thái từ xa là
  `failed` với `encryption_key_missing`/`encryption_key_too_short` và **không có file nào được gửi**.
- Telegram: tạo bot bằng @BotFather, cho bot vào một kênh/nhóm riêng tư, đặt `TELEGRAM_BACKUP_TOKEN` và
  `TELEGRAM_BACKUP_CHAT_ID`. Bot gửi tối đa một bản mỗi ngày; bản mã hóa vượt 50 MB bị đánh dấu `file_too_large`.
- Dọn bản cũ: sau mỗi lần gửi thành công, bot giữ `BACKUP_REMOTE_KEEP` bản mới nhất (mặc định 1) và xóa phần còn lại.
  Telegram chỉ cho bot xóa tin nhắn gửi trong vòng 48 giờ, nên message_id được lưu ở
  `backups/remote-state-<store>.json`; nếu bot tắt quá 48 giờ, bản cũ hơn phải xóa tay trong kênh. Google Drive xóa các
  file `.cenc` cùng store trong thư mục đích mà chính ứng dụng đã tạo. Bản cục bộ vẫn giữ theo `BACKUP_RETENTION`.
- Google Drive: service account không có dung lượng My Drive, nên `GD_FOLDER_ID` phải nằm trong Shared Drive.
- Khôi phục từ bản ngoài host: tải file `.cenc`, chạy
  `BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.js <file.cenc> data/restored.sqlite`; script từ chối ghi đè
  file có sẵn và chạy `PRAGMA integrity_check`. Chỉ đưa bản đã kiểm tra vào `/home/container/data/` khi bot đã dừng.
- Lưu `BACKUP_ENCRYPTION_KEY` cùng `ENCRYPTION_KEY` trong kho secret ngoài hosting. Mất khóa thì không mở được bản sao.

## Cấu hình OAuth bắt buộc

- `CLIENT_SECRET`: secret của đúng Discord Application đang chạy bot.
- `ENCRYPTION_KEY`: khóa mã hóa dùng chung với database cần khôi phục; mất khóa đồng nghĩa không giải mã được token.
- `OAUTH_STATE_SECRET`: khóa HMAC riêng; nếu để trống hệ thống dùng `ENCRYPTION_KEY`.
- `PUBLIC_BASE_URL`: domain HTTPS public. Trong Discord Developer Portal phải đăng ký chính xác
  `<PUBLIC_BASE_URL>/oauth/callback` ở OAuth2 Redirects.

Discord chỉ cho phép Add Guild Member bằng access token có scope `guilds.join`; bot cùng application phải có mặt ở
server đích và có quyền `Create Invite`. Trường `roles` cần `Manage Roles`, và bot chỉ quản lý được role thấp hơn
role cao nhất của bot. Tham khảo [Discord Guild Resource](https://docs.discord.com/developers/resources/guild#add-guild-member),
[Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Discord Permissions](https://docs.discord.com/developers/topics/permissions)
và [Discord Rate Limits](https://docs.discord.com/developers/topics/rate-limits).

Nếu SFTP credential hoặc secret có khả năng bị lộ, phải rotate trước khi khôi phục production.
