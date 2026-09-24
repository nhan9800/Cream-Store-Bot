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

Mỗi push vào `main` chạy workflow `Bot Production - Verify and Promote`. Workflow cài dependency theo lockfile,
kiểm tra cú pháp supervisor, chạy unit test và smoke test trên đúng SHA. Chỉ khi toàn bộ bước xanh workflow mới
đẩy chính SHA đã kiểm thử lên nhánh `bot-production`.

Startup command production là `npm run start:vibehost`. Supervisor trên VibeHost poll `bot-production` mỗi 60
giây; trước khi cập nhật source, supervisor backup và kiểm tra integrity cả hai SQLite, kiểm tra `.env` và
`.env.store2`, cài dependency cần thiết rồi restart launcher. Nếu cài đặt hoặc kiểm tra runtime thất bại, source
được rollback về revision trước. Deploy thường ngày không cần upload SFTP hoặc restart thủ công từ panel.

SFTP/panel chỉ dùng cho bootstrap hoặc khôi phục khi supervisor không thể chạy. Quy trình chi tiết và các lệnh
khôi phục nằm trong [`VIBEHOST_DEPLOY_GUIDE.md`](./VIBEHOST_DEPLOY_GUIDE.md).

## Kiểm tra sau deploy

- Console không có vòng lặp crash/restart.
- Hai bot Discord đều ready và đúng guild.
- Revision đang chạy khớp SHA đã promote trên `bot-production`.
- Health Store 1 và Store 2 trả thành công qua launcher.
- Database không bị tạo nhầm ngoài `/home/container/data`.
- Website chỉ gọi URL bot hiện tại từ biến môi trường.
