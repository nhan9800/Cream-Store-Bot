# Triển khai production bot

Production bot chạy trên VibeHost. Hướng dẫn chuẩn duy nhất nằm tại
[`VIBEHOST_DEPLOY_GUIDE.md`](./VIBEHOST_DEPLOY_GUIDE.md).

Repository bot và repository website triển khai độc lập. Push source bot vào nhánh làm việc chỉ chạy kiểm tra của
nhánh đó; khi merge/push vào `main`, workflow bot sẽ verify rồi promote revision đạt kiểm thử. Source website không
được upload vào `/home/container` của bot.

Workflow `.github/workflows/deploy-production.yml` chạy trên mỗi push vào `main`. Nó cài dependency theo lockfile,
kiểm tra cú pháp supervisor, chạy unit test và smoke test; khi tất cả thành công, job promote đẩy đúng SHA đã
kiểm thử lên nhánh `bot-production`.

VibeHost chạy `npm run start:vibehost`. Supervisor fetch `bot-production` định kỳ (mặc định 60 giây), backup và
kiểm tra integrity cả hai database, kiểm tra `.env`/`.env.store2`, cài dependency nếu manifest thay đổi rồi
restart launcher. Revision lỗi sẽ bị đánh dấu và rollback về source trước. Vì vậy deploy thường ngày không cần
GitHub Environment chứa SFTP credential hoặc thao tác upload/restart thủ công.

Chỉ dùng SFTP/panel cho bootstrap hoặc recovery. Sau một recovery thủ công, kiểm tra lại workflow, SHA của
`bot-production` và cả hai health endpoint trước khi bàn giao.

Không đưa `.env`, `.env.store2`, `data/`, backup hoặc mật khẩu SFTP vào GitHub artifact.
