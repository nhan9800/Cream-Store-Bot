# Secret Rotation Runbook

## Thứ tự ưu tiên

1. Discord bot token của cả hai store.
2. SFTP credential VibeHost.
3. `BOT_API_KEY` dùng giữa website và bot.
4. PayOS client/API/checksum keys.
5. `ENCRYPTION_KEY`, OAuth secret, AI keys và các integration token khác.

## Quy trình chung

1. Thu hồi hoặc reset secret cũ tại nhà cung cấp.
2. Cập nhật `.env` hoặc `.env.store2` trực tiếp trong `/home/container`; không gửi secret qua Git.
3. Cập nhật secret tương ứng trên hosting website nếu hai hệ thống dùng chung.
4. Restart bot bằng panel VibeHost.
5. Kiểm tra Discord login, health endpoint, website API, webhook và thanh toán.
6. Xóa secret cũ khỏi máy cá nhân, lịch sử terminal, ảnh chụp và GitHub Actions.

## Mật khẩu SFTP xuất hiện trong ảnh chụp

Mật khẩu hiển thị một lần trong panel phải được coi là đã lộ nếu ảnh đã được chia sẻ. Hãy tạo lại mật khẩu trong
VibeHost trước khi kết nối hoặc lưu vào GitHub Environment. Không sử dụng lại mật khẩu đó cho dịch vụ khác.

## `ENCRYPTION_KEY`

Không đổi khóa mã hóa tùy tiện vì dữ liệu credential đã lưu có thể không giải mã được. Trước khi rotate:

1. Backup và verify cả hai SQLite.
2. Dừng bot.
3. Chạy quy trình re-encryption đã kiểm thử trên bản sao dữ liệu.
4. Chỉ cập nhật production khi đã xác nhận có thể đọc lại toàn bộ dữ liệu.
