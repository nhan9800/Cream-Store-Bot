# Cenar Store Bot - Production Hardening Baseline

## Hạ tầng

- Runtime: Node.js `>=22.12.0` trên VibeHost.
- Thư mục ứng dụng: `/home/container`.
- Startup process duy nhất: `npm start` chạy `src/index.js`.
- Public allocation: `20022`; Store 1 và Store 2 dùng các cổng loopback riêng.
- Database được giữ bền vững trong `/home/container/data`.

## Bắt buộc

- Không chạy hai launcher đồng thời.
- Không upload đè `.env*` hoặc `data/` khi cập nhật source.
- Không đưa token, API key, mật khẩu SFTP hoặc SQLite vào Git.
- Luôn có backup đã qua integrity check cho cả hai store trước khi deploy.
- Chỉ mở API cần thiết; endpoint nhạy cảm bắt buộc xác thực bằng `BOT_API_KEY`.
- Dùng custom domain HTTPS trước khi bật webhook thanh toán production.

## CI/CD

GitHub Actions hiện chỉ verify source bằng dependency lock, unit test và smoke test. Auto-upload và auto-restart
production chưa được bật cho đến khi xác minh API restart chính thức của VibeHost.

## Kiểm tra sau deploy

- Console không có vòng lặp crash/restart.
- Hai bot Discord đều ready và đúng guild.
- Health Store 1 và Store 2 trả thành công qua launcher.
- Database không bị tạo nhầm ngoài `/home/container/data`.
- Website chỉ gọi URL bot hiện tại từ biến môi trường.
