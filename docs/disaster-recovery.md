# Disaster Recovery Plan - Cenar Store Bot

## Mục tiêu

- Khôi phục bot trên VibeHost với source đã kiểm thử và hai bản SQLite đã xác minh.
- Không để source deployment ghi đè secret hoặc dữ liệu production.
- Khôi phục cấu trúc Discord và thành viên đã chủ động cấp quyền OAuth2 `guilds.join`.

## Dữ liệu nằm trong recovery backup

- Toàn bộ dữ liệu nghiệp vụ trong SQLite: hồ sơ khách, đơn hàng, ví, bảo hành, CTV/Partner và cấu hình bot.
- Recovery snapshot mới nhất của vai trò, kênh, danh mục, permission overwrite và custom emoji. Asset emoji được
  lưu dạng base64 tối đa 256 KB mỗi file để không phụ thuộc hoàn toàn vào Discord CDN.
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
8. Mời đúng bot vào server Discord dự phòng và cấp `Manage Roles`, `Manage Channels`, `Manage Expressions` và
   `Create Invite`.
9. Trong server nguồn, chạy `/khoi-phuc-server hanh_dong:Khôi phục guild_dich:<ID> xac_nhan:True` để tái tạo cấu
   trúc. Lệnh idempotent theo tên nên có thể chạy lại sau khi sửa quyền.
10. Chạy `/chuyen-server guild_id:<ID server dự phòng>` để thêm các thành viên còn OAuth hợp lệ và gán lại các vai
    trò trùng tên.

Trước khi có sự cố, Owner có thể chạy `/khoi-phuc-server hanh_dong:Tạo snapshot ngay` để tạo điểm phục hồi thủ
công. Scheduler cũng tự chụp snapshot trước mỗi lần backup SQLite.

## Cấu hình OAuth bắt buộc

- `CLIENT_SECRET`: secret của đúng Discord Application đang chạy bot.
- `ENCRYPTION_KEY`: khóa mã hóa dùng chung với database cần khôi phục; mất khóa đồng nghĩa không giải mã được token.
- `OAUTH_STATE_SECRET`: khóa HMAC riêng; nếu để trống hệ thống dùng `ENCRYPTION_KEY`.
- `PUBLIC_BASE_URL`: domain HTTPS public. Trong Discord Developer Portal phải đăng ký chính xác
  `<PUBLIC_BASE_URL>/oauth/callback` ở OAuth2 Redirects.

Discord chỉ cho phép Add Guild Member bằng access token có scope `guilds.join`; bot cùng application phải có mặt ở
server đích và có quyền `Create Invite`. Tham khảo [Discord Guild Resource](https://docs.discord.com/developers/resources/guild#add-guild-member)
và [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).

Nếu SFTP credential hoặc secret có khả năng bị lộ, phải rotate trước khi khôi phục production.
