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
`file:` (gói tarball `discord-voip` trong `vendor/` để loại `tsup` khỏi production graph), supervisor phải
copy thư mục `vendor/` vào stage trước `npm ci`; nếu thiếu, staging sẽ lỗi và tự rollback dù CI đã xanh.

### VibeHost Startup không được sửa dependency

VibeHost tái tạo wrapper **Startup Command** sau khi lưu, nhưng lưu được **Startup Script**.
Tắt **Auto Pull on Startup** để supervisor quản lý cập nhật và backup theo thứ tự. Đặt **Startup Script** thành:

```bash
cd /home/container && git restore --source=HEAD --worktree -- package.json package-lock.json && exec bash scripts/vibehost-supervisor.sh
```

Wrapper tự quét import ở cả script lẫn test. Trước đây nó thêm `file-type@latest` trực tiếp, xung đột
với override đã khóa. npm12 hiển thị EUSAGE về lockfile và ghi nguyên nhân thực trong log debug.
Kiểm tra tương thích nay tra `file-type` qua resolver của extractor. Test khai báo rõ equalizer trong devDependencies.
Startup Script khôi phục hai manifest từ bản Git đang chạy, sau đó supervisor xác minh và áp dụng revision.
Giữ `npm ci` và lockfile khi xử lý EUSAGE.
Khi recovery, phải dừng container, lưu cấu hình cũ, backup/integrity cả hai SQLite, khôi phục **chỉ source
tracked** về đúng SHA đã qua production gate rồi chạy supervisor. Không reset env/data/backups hoặc marker
để giả mạo revision đã cài. Kiểm tra cả hai health endpoint khớp SHA trước khi kết luận release live.

Chỉ dùng SFTP/panel cho bootstrap hoặc recovery. Sau một recovery thủ công, kiểm tra lại workflow, SHA của
`bot-production` và cả hai health endpoint trước khi bàn giao.

Không đưa `.env`, `.env.store2`, `data/`, backup hoặc mật khẩu SFTP vào GitHub artifact.

## Dependency audit mitigation · discord-voip

`discord-voip@7.2.0` upstream khai báo `tsup` và `typescript` trong `dependencies` dù
chúng chỉ được dùng để build package; kéo theo `tinyglobby`/`picomatch` vào production
dependency audit. Cenar giữ nguyên các file `dist` runtime và dùng bản vendor tại
`vendor/discord-voip-7.2.0-cenar.1/`, chuyển hai công cụ build sang `devDependencies`.
Dependency production dùng tarball từ source vendor này, với integrity trong lockfile, thay vì symlink thư mục.
Như vậy `node_modules` vẫn tự đủ sau khi được promote từ stage sang thư mục chạy và phù hợp runtime checker.

Không sửa `node_modules` thủ công. Khi thay vendor package, phải cập nhật
`package.json`/`package-lock.json`, chạy `npm ci`, `npm audit --omit=dev --audit-level=high`,
`npm run check:deps`, các suite music/Discord và full CI. Không hạ mức audit hoặc thêm
allowlist cho `GHSA-fc5q-39xc-vjpf` khi chưa có bằng chứng package runtime còn cần glob
parser đó.
