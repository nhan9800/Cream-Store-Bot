# Rollback bot trên VibeHost

## Rollback source

1. Chọn commit tốt gần nhất đã qua GitHub Actions.
2. Backup hai database hiện tại.
3. Dừng server trong panel VibeHost.
4. Upload source của commit tốt bằng SFTP vào `/home/container`, không đè `.env*` và `data/`.
5. Chạy `npm ci --omit=dev --no-audit --no-fund` trong Console.
6. Start/Restart bằng panel và kiểm tra cả Store 1 lẫn Store 2.

## Khôi phục database

Rollback code không đồng nghĩa rollback dữ liệu. Chỉ khôi phục SQLite khi đã xác định sự cố thuộc dữ liệu:

1. Dừng server để không còn tiến trình ghi.
2. Tạo thêm một bản incident backup của database hiện tại.
3. Chạy `npm run verify:backup -- <backup.sqlite>` với bản cần khôi phục.
4. Chỉ thay đúng database bị ảnh hưởng trong `/home/container/data`.
5. Start server và kiểm tra health, đơn hàng, thanh toán và tồn kho.

Không thay file SQLite khi bot đang chạy.
