# Triển khai production bot

Production bot chạy trên VibeHost. Hướng dẫn chuẩn duy nhất nằm tại
[`VIBEHOST_DEPLOY_GUIDE.md`](./VIBEHOST_DEPLOY_GUIDE.md).

Repository bot và repository website triển khai độc lập. Push source bot chỉ chạy kiểm thử bot; source website
không được upload vào `/home/container` của bot.

Workflow `.github/workflows/deploy-production.yml` đang ở chế độ **verify-only**. Nó chạy `npm ci`, unit test và
smoke test trên mỗi push vào `main`, nhưng không ghi lên production. Việc upload/restart tự động chỉ được thêm
sau khi xác minh API restart chính thức của VibeHost và tạo GitHub Environment chứa SFTP credential mới.

Không đưa `.env`, `.env.store2`, `data/`, backup hoặc mật khẩu SFTP vào GitHub artifact.
