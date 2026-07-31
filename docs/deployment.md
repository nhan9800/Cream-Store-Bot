# Triển khai production Bot Cenar Store v2

Đường production duy nhất được hỗ trợ là `.github/workflows/deploy-production.yml`. Không dùng lại
HTTP deploy webhook, `.cpanel.yml` hoặc `cpanel-deploy.sh`.

Repository bot chỉ triển khai sang bot hosting. Workflow website không được gọi webhook deploy bot,
và workflow bot không được upload source sang web hosting. Mỗi lần merge `main` của repository này,
workflow kiểm tra đúng commit SHA rồi cập nhật `BOT_APP_ROOT` từ chính repository bot.

## Điều kiện an toàn

Giữ repository variable `PRODUCTION_DEPLOY_ENABLED=false` trong lúc chuẩn bị. Push `main` vẫn chạy
test nhưng không đổi host. Lần cutover đầu dùng `workflow_dispatch` từ branch `main`, nhập full SHA
và bật `confirm_production`; sau khi smoke test đạt mới đổi flag thành `true`.

Không triển khai trước khi:

- Xóa `read_logs.php` trên host và hoàn tất kiểm tra sự cố.
- Rotate credential đã lộ và cập nhật đồng bộ web/bot.
- Có backup đã qua SQLite `integrity_check` cho hai store.
- Workflow/script v2 đã được merge vào protected `main`.

## GitHub

Tạo Environment `bot-production`, chỉ cho branch `main`, và thêm Environment secrets:

- `BOT_SSH_HOST`
- `BOT_SSH_USER`
- `BOT_SSH_PRIVATE_KEY`
- `BOT_SSH_KNOWN_HOSTS`

Repository variables:

- `PRODUCTION_DEPLOY_ENABLED=false`
- `BOT_APP_ROOT` — đường dẫn tuyệt đối của Git clone production
- `BOT_HEALTH_URL` — HTTPS Store 1 `/api/health`
- `BOT_HEALTH_URL_STORE2` — HTTPS Store 2 `/store2/api/health`
- `BOT_SSH_PORT=22`
- `BOT_RUNTIME=pm2` hoặc `passenger`

Known-hosts phải được đối chiếu fingerprint qua kênh tin cậy. Port SSH khác 22 dùng entry
`[hostname]:port`.

## Cổng bot

Launcher dùng ba cổng riêng:

```dotenv
SERVER_PORT=2753
STORE1_HTTP_PORT=5000
STORE2_HTTP_PORT=8080
```

Ba cổng phải khác nhau. Reverse proxy public chỉ trỏ vào `SERVER_PORT`; không public hai cổng store
nội bộ.

## Bootstrap host

1. Cài Git, Node >= 22.12, npm, Bash, `flock`, `curl`, `jq` và runtime đã chọn.
2. Clone đúng repository vào `BOT_APP_ROOT`; origin có credential GitHub chỉ-đọc.
3. Tạo `.env`, `.env.store2` mode `0600`; giữ DB trong `data/`.
4. Chạy:

```bash
cd "$BOT_APP_ROOT"
npm ci --omit=dev --no-audit --no-fund
ENV_FILE=.env node scripts/check-env.js
ENV_FILE=.env.store2 node scripts/check-env.js
ENV_FILE=.env npm run verify:backup
ENV_FILE=.env.store2 npm run verify:backup
```

5. Với PM2, bootstrap bằng đúng deploy user:

```bash
DEPLOY_REVISION="$(git rev-parse HEAD)" \
  pm2 start ecosystem.config.cjs --only cenar-store-launcher --update-env
pm2 save
pm2 describe cenar-store-launcher
```

Workflow sẽ fail thay vì âm thầm đổi runtime nếu `BOT_RUNTIME` không khớp thực tế.

## Lần triển khai đầu

```bash
TARGET_SHA="$(git rev-parse origin/main)"
gh workflow run deploy-production.yml --ref main \
  -f sha="$TARGET_SHA" \
  -f confirm_production=true
gh run list --workflow deploy-production.yml --branch main --limit 5
gh run watch <RUN_ID> --exit-status
```

Workflow kiểm tra target thuộc `origin/main`, dùng control script từ revision workflow được bảo vệ,
SSH với known-host pinning, khóa `flock`, backup hai DB, reset exact SHA, cài dependency, kiểm tra env,
đăng ký command hai store, restart và bắt buộc hai health URL trả đúng SHA.

Sau smoke test thành công:

```bash
gh variable set PRODUCTION_DEPLOY_ENABLED --body "true"
```

Mỗi push/merge `main` sau đó sẽ tự deploy. Nếu Environment còn required reviewer, người vận hành vẫn
phải approve trước khi job nhận production secrets.

## Hạn chế còn lại

- Bot vẫn cập nhật trực tiếp trong live Git worktree, chưa phải immutable release.
- Rollback code không tự suy luận rollback schema DB.
- Manual target quá cũ phải còn tương thích với script/runtime v2.
- Không chỉnh source trực tiếp trên host vì deploy dùng exact `git reset --hard`.
