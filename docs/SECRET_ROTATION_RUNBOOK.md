# Kế hoạch Luân chuyển (Rotation) Secret & Key

Tài liệu này hướng dẫn cách xoay vòng (rotate) các secret key nhạy cảm trên Production một cách an toàn mà không làm gián đoạn dịch vụ, đặc biệt là `ENCRYPTION_KEY` dùng để mã hóa credentials của khách hàng.

## 1. Phân loại Secret
Theo Phase 1, các secret đã được phân tách ranh giới rõ ràng:
- **`BOT_API_KEY`**: Dùng cho giao tiếp nội bộ giữa Website Backend (Next.js/PHP) và Discord Bot API.
- **`DEPLOY_SECRET`**: Dùng xác thực cho Github Actions khi gọi webhook deploy (nếu có).
- **`DASHBOARD_SESSION_SECRET`**: Dùng ký (sign) JWT hoặc Cookie Session cho giao diện Staff Dashboard.
- **`ENCRYPTION_KEY`**: Dùng mã hóa/giải mã các sản phẩm/tài khoản (credentials) khi lưu vào database và khi giao hàng. Dài đúng 32 bytes (AES-256).

## 2. Kế hoạch Re-encryption cho `ENCRYPTION_KEY` (Quy trình Dual-Key Transition)

Tuyệt đối **KHÔNG ĐƯỢC** tự đổi `ENCRYPTION_KEY` đột ngột trên file `.env` vì sẽ làm toàn bộ thông tin tài khoản cũ không thể giải mã được.

### Bước 1: Sao lưu (Backup)
1. Dừng tất cả mọi luồng ghi (maintenance mode hoặc vô hiệu hóa thanh toán).
2. Chạy script backup SQLite: `npm run backup`.
3. Kiểm tra file backup có mở được không bằng `sqlite3`.

### Bước 2: Cấu hình Dual-Key
1. Giữ nguyên `ENCRYPTION_KEY` hiện tại (đổi tên thành `OLD_ENCRYPTION_KEY` trong code hoặc thêm biến môi trường mới `NEW_ENCRYPTION_KEY`).
2. Sửa file `src/utils/encryption.js` (hoặc nơi mã hóa tương ứng) để:
   - Khi giải mã (Decrypt): Thử giải mã bằng `NEW_ENCRYPTION_KEY` trước, nếu thất bại (throw error padding) thì fallback về `OLD_ENCRYPTION_KEY`.
   - Khi mã hóa (Encrypt): Luôn dùng `NEW_ENCRYPTION_KEY`.

### Bước 3: Chạy Script Migration
1. Viết script `migrate-encryption.js`.
2. Truy vấn tất cả `credentials` đã mã hóa trong bảng `orders` hoặc `stock`.
3. Vòng lặp giải mã bằng `OLD_ENCRYPTION_KEY` và mã hóa lại ngay bằng `NEW_ENCRYPTION_KEY`, sau đó `UPDATE` vào DB.
4. Chạy script trên local/staging copy trước, sau đó chạy trên production.

### Bước 4: Clean up
1. Sau khi 100% dữ liệu đã được mã hóa bằng key mới, xóa `OLD_ENCRYPTION_KEY` khỏi `.env` và code.
2. Restart bot.
3. Test lại việc mua hàng và nhận hàng xem có mở khóa đúng tài khoản không.

## 3. Rollback Plan
- Nếu trong lúc Re-encryption xảy ra lỗi crash DB: Dừng ngay bot. Xóa file `.sqlite` bị hỏng, copy lại file `.sqlite` từ bước Backup đè lên. Khôi phục code dùng `OLD_ENCRYPTION_KEY` và bật lại server.

## 4. Xử lý khi bị lộ Secret VPS / Code
- Nếu lộ password VPS (`root: 9Dzsg...` như đã phát hiện):
  - Lập tức vào trang quản lý CloudFly hoặc dùng SSH key để vào đổi mật khẩu: `passwd root`.
  - Disable login bằng mật khẩu, chuyển sang chỉ dùng SSH Public Key Auth (`PasswordAuthentication no` trong `sshd_config`).
  - Xóa các file script `.bat`, `.py`, `.sh` chứa mật khẩu cleartext khỏi Repo. (Đã thực hiện trong commit Phase 1).
