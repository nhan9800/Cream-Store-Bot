# Rollback Bot Cenar Store v2

Workflow tự rollback khi deploy hoặc exact-SHA health thất bại. Metadata rollback gắn với failed SHA,
nên lỗi SSH trước activation không thể kéo một bản production khỏe lùi thêm phiên bản.

Rollback còn đăng ký lại slash commands từ previous SHA, restart đúng runtime đã khai báo và kiểm tra
cả Store 1 lẫn Store 2.

## Rollback thủ công

Tạm đóng băng merge/push, chọn full SHA tốt đã thuộc `main`, rồi chạy workflow từ branch `main`:

```bash
GOOD_SHA=<KNOWN_GOOD_FULL_40_CHARACTER_SHA>
git fetch origin main
git merge-base --is-ancestor "$GOOD_SHA" origin/main

gh workflow run deploy-production.yml --ref main \
  -f sha="$GOOD_SHA" \
  -f confirm_production=true
gh run list --workflow deploy-production.yml --branch main --limit 5
gh run watch <RUN_ID> --exit-status
```

Sau rollback, hai health URL phải trả HTTP 200, `ok: true`, `discordReady: true` và cùng
`commitSha` mong đợi.

Không gọi trực tiếp `scripts/rollback-production.sh` nếu không xử lý đúng file
`.deployments/<failed-sha>.previous`.

## Restore database

Code rollback không tự restore SQLite. Nếu incident liên quan migration/dữ liệu:

1. Tắt auto-deploy.
2. Dừng launcher để cả hai bot ngừng ghi.
3. Tạo thêm bản incident backup của DB hiện tại.
4. Chạy `npm run verify:backup -- <backup.sqlite>`.
5. Chỉ thay đúng DB của store bị ảnh hưởng.
6. Start bot và kiểm tra health/nghiệp vụ.

Tuyệt đối không thay file SQLite khi process đang ghi.
