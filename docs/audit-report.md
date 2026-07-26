# Báo Cáo Kiểm Toán Toàn Diện Hệ Thống Cenar Store (Audit Report)

**Ngày thực hiện:** 26/07/2026  
**Thực hiện bởi:** Senior Full-stack, DevOps, UI/UX & Security Engineer Team  
**Đối tượng kiểm toán:**  
1. `Cream-Store-Bot-main` (Discord Bot, Reverse Proxy, Backend API, SQLite Database)  
2. `cenar-website-main` (Next.js 14 Web Frontend)  
**Phạm vi:** Kiểm tra công nghệ, mã nguồn repository, môi trường production, cơ sở dữ liệu và các rủi ro bảo mật/nghiệp vụ.

---

## I. KIỂM TRA CÔNG NGHỆ (TECHNOLOGY AUDIT)

### 1. Phân tích Stack Hiện Tại
* **Web Frontend (`cenar-website-main`):**
  * **Next.js:** v14.2.3 (sử dụng **App Router** kết hợp SSR, Static & Client Components).
  * **React / DOM:** v18.3.1.
  * **Package Manager:** `npm` / `pnpm` tương thích (sử dụng `package.json` chuẩn).
  * **Styling & UI:** Tailwind CSS v3.4.4, Framer Motion v11.2.10, Lucide React Icons v0.395.0.
  * **HTTP Client & State:** `axios` v1.7.2, `zustand` v5.0.14.
  * **Deployment Target:** Vercel / Linux VPS / Docker (đã hỗ trợ SSR & static export tùy cấu hình).
* **Bot Discord & API Backend (`Cream-Store-Bot-main`):**
  * **Runtime:** Node.js `>=22.12.0` (Native ESM `"type": "module"`).
  * **Discord Library:** `discord.js` v14.25.1.
  * **Database & Driver:** SQLite thông qua thư viện `better-sqlite3` v12.9.0 (C++ synchronous driver hiệu năng cao).
  * **Web/API Framework:** `express` v4.21.2.
  * **AI SDK:** `@google/genai` v1.50.1.
  * **Process / Deployment:** PM2 / Systemd / VibeHost trên Linux VPS.

### 2. Phân loại Phụ thuộc (Dependency Categorization)
* **An toàn cập nhật:** Cập nhật các bản vá bảo mật patch/minor cho `express`, `dotenv`, `qrcode`, `lucide-react`, `tailwind-merge`.
* **Cần kiểm thử trước:** `next` (giữ nguyên 14.x trong đợt refactor này để tránh breaking changes của Next 15), `better-sqlite3` (chỉ cập nhật khi node-gyp và ABI tương thích), `discord.js`.
* **Không nên cập nhật major version lúc này:** `@google/genai`, `@ai-sdk/google` (cần ổn định luồng AI Copilot đang chạy).

---

## II. KIỂM TRA REPOSITORY (CODEBASE & ARCHITECTURE AUDIT)

### 1. Cấu trúc Giao tiếp Web ↔ Bot
* **Cổng kết nối:** Website giao tiếp với Bot qua REST API HTTP (mặc định port `2753`, cấu hình qua biến `BOT_API_URL`).
* **Bảo mật API Key:** Các request từ SSR / API Route của Website gửi header `X-Bot-Api-Key: <BOT_API_KEY>`. Trên Client Component, request đi qua proxy `/api/bot/proxy` trên Next.js để ngăn rò rỉ `BOT_API_KEY` ra trình duyệt.
* **Đồng bộ Dữ liệu:** Database duy nhất là `shopbot.sqlite` nằm tại thư mục `data/` của repository Bot. Website đóng vai trò là API consumer và webhook forwarder (`/webhooks/payos` -> `http://localhost:2753/webhooks/payos`).

### 2. Phát hiện các điểm cần Khắc phục (Issue Register)
* **[P0] Lỗi 404 trên Trang chi tiết sản phẩm:** Route động `/products/[id]` sử dụng trộn lẫn giữa slug, ID nội bộ và tên sản phẩm, đồng thời thiếu chuẩn hóa mapping khi sản phẩm đổi tên hoặc có ký tự đặc biệt. Cần định nghĩa chuẩn schema sản phẩm: `id` (UUID), `sku` (mã quản trị), `slug` (URL công khai duy nhất).
* **[P0] Thiếu bộ máy Quản lý Trạng thái Đơn hàng (Order State Machine):** Trạng thái đơn hàng đang được chuỗi hóa tự do (`PENDING_PAYMENT`, `PAID`, ...), chưa có state machine ngăn chuyển đổi sai quy tắc (ví dụ `COMPLETED` -> `PENDING_PAYMENT`) và thiếu bảng audit log `order_status_history`.
* **[P0] An toàn Webhook PayOS:** Cần đảm bảo webhook PayOS thực thi idempotent trong Database Transaction atomic, chống xử lý trùng tham chiếu (`payment_reference`) gây trừ kho 2 lần hoặc giao hàng 2 lần.
* **[P1] Trang Tra cứu Đơn hàng (`/order/[code]`):** Cần bổ sung rate limiting, ẩn dữ liệu nhạy cảm của khách hàng và làm mờ các token/password tài khoản giao hàng.
* **[P1] Thống kê Công khai (Store Stats):** Số liệu trên Homepage và Product Catalog cần được ẩn danh hóa (không hiển thị email thật hay Discord ID) và bảo đảm đồng nhất từ một endpoint `/api/bot/stats/public`.
* **[P2] Hardcode IP & Fallback:** Một số file trong Website đang hardcode fallback IP `http://103.179.189.36` hoặc `http://localhost:5000` thay vì tuân thủ cấu hình biến môi trường chuẩn.
* **[P2] Thiếu Bộ Kiểm thử Tự động (Automated Testing):** Cả 2 repository chưa tích hợp framework unit test hay E2E test trong CI/CD.

---

## III. KIỂM TRA MÔI TRƯỜNG PRODUCTION & DATABASE

### 1. Môi trường Production
* **Cơ chế lưu trữ:** File SQLite (`data/shopbot.sqlite`) phải được đặt trên persistent volume hoặc thư mục bền vững bên ngoài container/build dir để tránh bị xóa hoặc ghi đè sau mỗi lần deploy.
* **Process Manager:** Chỉ vận hành đúng 1 instance Bot duy nhất trên PM2/systemd để tránh tranh chấp kết nối Discord Gateway hoặc file lock SQLite.

### 2. Kiểm tra Database SQLite
* **Chế độ WAL (Write-Ahead Logging):** Đã được cấu hình chuẩn (`journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`).
* **Sao lưu (Backup):** Đã xây dựng bộ script sao lưu trực tuyến nhất quán `scripts/backup-db.js`, `scripts/backup-database.sh`, `scripts/restore-database.sh` và `scripts/verify-backup.sh` sử dụng cơ chế backup an toàn của SQLite kèm nén gzip và chính sách lưu trữ 7 ngày.

---

## IV. KẾ HOẠCH HÀNH ĐỘNG (REMEDIATION PLAN)

1. **Phase 1-2:** Hoàn thiện báo cáo Audit và hệ thống Backup/Restore SQLite (Đã hoàn thành).
2. **Phase 3:** Tích hợp framework kiểm thử tự động `vitest` và `playwright` vào CI/CD.
3. **Phase 4:** Chuẩn hóa Product Schema (`id`, `sku`, `slug`), Order State Machine (`orderStateMachine.js`) và bảo mật Idempotency PayOS Webhook.
4. **Phase 5:** Bảo mật trang Tra cứu đơn hàng & Chuẩn hóa dịch vụ Thống kê Store Stats public.
5. **Phase 6:** Nâng cấp UI/UX, Typography tiếng Việt (Be Vietnam Pro + Space Grotesk) và Responsive 9 viền màn hình.
6. **Phase 7:** Tối ưu Core Web Vitals, SEO và tạo endpoint Health check `/api/health`.
7. **Phase 8:** Thiết lập GitHub Actions CI/CD workflows (`.github/workflows/*.yml`) và bộ tài liệu kỹ thuật hoàn chỉnh.
