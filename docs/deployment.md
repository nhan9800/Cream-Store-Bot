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

Supervisor cài dependency trong một stage cô lập trước khi thay `node_modules`. Khi source có dependency dạng
`file:` (hiện tại là `vendor/discord-voip-7.2.0-cenar.1` để loại `tsup` khỏi production graph), supervisor phải
copy thư mục `vendor/` vào stage trước `npm ci`; nếu thiếu, staging sẽ lỗi và tự rollback dù CI đã xanh.

Chỉ dùng SFTP/panel cho bootstrap hoặc recovery. Sau một recovery thủ công, kiểm tra lại workflow, SHA của
`bot-production` và cả hai health endpoint trước khi bàn giao.

Không đưa `.env`, `.env.store2`, `data/`, backup hoặc mật khẩu SFTP vào GitHub artifact.

## Dependency audit mitigation · discord-voip

`discord-voip@7.2.0` upstream khai báo `tsup` và `typescript` trong `dependencies` dù
chúng chỉ được dùng để build package; kéo theo `tinyglobby`/`picomatch` vào production
dependency audit. Cenar giữ nguyên các file `dist` runtime và dùng bản vendor tại
`vendor/discord-voip-7.2.0-cenar.1/`, chuyển hai công cụ build sang `devDependencies`.

Không sửa `node_modules` thủ công. Khi thay vendor package, phải cập nhật
`package.json`/`package-lock.json`, chạy `npm ci`, `npm audit --omit=dev --audit-level=high`,
`npm run check:deps`, các suite music/Discord và full CI. Không hạ mức audit hoặc thêm
allowlist cho `GHSA-fc5q-39xc-vjpf` khi chưa có bằng chứng package runtime còn cần glob
parser đó.
