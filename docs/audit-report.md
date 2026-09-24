# Báo cáo hạ tầng hiện tại

Bot Discord/API đang chạy trên VibeHost, tách biệt với hosting website.

- Source bot: repository `Cream-Store-Bot`.
- Runtime root: `/home/container`.
- Public allocation: `hcm3.vibehost.vn:20022`.
- SFTP: `hcm3.vibehost.vn:2022`.
- Database: `/home/container/data/shopbot.sqlite` và `shopbot-store2.sqlite`.

Website giao tiếp với bot qua REST API server-to-server và đọc `BOT_API_URL`/`BOT_API_KEY` từ biến môi trường.
Không được hardcode địa chỉ hạ tầng vào source.

GitHub Actions của bot chạy workflow `Bot Production - Verify and Promote` trên mỗi push vào `main`. Workflow
kiểm tra dependency lock, cú pháp supervisor, unit test và smoke test; chỉ SHA vượt qua toàn bộ bước mới được
promote nguyên vẹn lên nhánh `bot-production`.

Startup command VibeHost là `npm run start:vibehost`. Supervisor poll nhánh `bot-production` mỗi 60 giây, backup
và kiểm tra integrity hai SQLite trước khi cập nhật, xác thực hai file môi trường, cài dependency và restart
launcher. Nếu revision mới không cài hoặc không chạy được, supervisor rollback về revision trước. SFTP và nút
Restart trên panel chỉ dành cho bootstrap hoặc khôi phục thủ công.
