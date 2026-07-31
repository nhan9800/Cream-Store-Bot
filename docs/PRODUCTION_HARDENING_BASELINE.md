# CENAR STORE BOT - PRODUCTION HARDENING BASELINE

## 1. Kiến trúc hiện tại
- **Core:** Node.js Native ESM (yêu cầu Node.js >= 22.12.0 theo `package.json`, hiện hành chạy trên v24.16.0 cục bộ).
- **Packages:** `discord.js@14.25.1`, `express@4.21.2`, `better-sqlite3@12.9.0`, `@google/genai`.
- **Thành phần chính:**
  - Bot Command Registry & Event Listeners (`interactionCreate.js`).
  - Express Server cho Dashboard, Webhooks, API (`webhookServer.js`, `dashboardMiniServer.js`, `botApiRoutes.js`).
  - Database Services (`db.js`, `orderService.js`, `paymentService.js`).
- **Nguồn cấp trạng thái:** SQLite local database.

## 2. Process Topology
- `ecosystem.config.cjs` hiện chỉ khai báo một PM2 process tên `cenar-store-bot` chạy `src/index.js`.
- Không thấy cấu hình PM2 rõ ràng cho `cenar-store1`, `cenar-store2`, và `cenar-launcher`. Điều này cho thấy kiến trúc 2 store và launcher chưa được phản ánh qua file config chuẩn trong kho lưu trữ, hoặc tồn tại ở file untracked.

## 3. Port Mapping
- Dựa trên codebase, các port dự kiến theo yêu cầu nhưng chưa được map cứng thông qua `ecosystem.config.cjs` cho từng process riêng biệt. Cần cấu trúc lại:
  - `LAUNCHER_PORT`: 20022
  - `STORE1_HTTP_PORT`: 2753
  - `STORE2_HTTP_PORT`: 8080

## 4. Deployment Flow hiện tại
- Không có thư mục `.github/workflows` được track trong Git branch `main` hoặc `origin/main`. Các workflow `deploy.yml` và `deploy-production.yml` có thể đang tồn tại dưới dạng untracked trên production hoặc chưa từng được push lên remote repo.
- Có thư mục `.npm/` và `backups/` nằm trong repository nhưng chưa bị `.gitignore` chặn triệt để (hiện trạng `git status` cho thấy `backups/` đang untracked).

## 5. Database Paths
- Mặc định: `data/shopbot.sqlite` (cần kiểm tra lại chi tiết trong `src/database/db.js`).
- Database thứ hai (store 2): `data/shopbot-store2.sqlite`.

## 6. Danh sách P0 / P1 / P2

**P0 (Critical Security & Data Integrity):**
- Deployment endpoint lộ không cần xác thực đủ mạnh / không atomic / dùng HTTP.
- Tranh chấp Payment / Auto-delivery khi webhook nhận song song hoặc discord DM hỏng.
- Lộ token, password nếu `DEBUG_ENDPOINTS_ENABLED` đang mở hoặc qua `public order lookup`.

**P1 (Stability & Architecture):**
- State machine không chặt chẽ, các bước "PAYMENT", "PROCESSING", "COMPLETED" được trigger tùy tiện.
- Cấu trúc file quá lớn: `interactionCreate.js`, `db.js`.
- Không có CI chuẩn, test coverage = 0 (script test không tồn tại).

**P2 (Maintainability):**
- Logging dùng `console.log` rời rạc.
- Hardcode port / nhầm lẫn biến môi trường khi chạy multi-store.

## 7. Baseline Test Result
- Node Version: `v24.16.0` (Đạt yêu cầu >= 22.12.0)
- NPM Version: `11.13.0`
- Npm Install (`npm ci`): Thành công, có cảnh báo về outdated dependencies.
- Syntax Check: Đã quét toàn bộ `src/**/*.js` qua `node --check`, tất cả file JS đạt chuẩn cú pháp.
- Smoke/Unit tests: Chưa có script test.

## 8. Những điều chưa thể xác minh
- PM2 processes trên production VPS hiện đang chạy script và branch nào chính xác (có thể đang chạy untracked scripts).
- Trạng thái thực của `.github/workflows` trên Github UI (bị ẩn hoặc thuộc branch khác chưa fetch được hết).
- Khóa mã hóa `ENCRYPTION_KEY` và các biến `.env` production không được truy cập.
