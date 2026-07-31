# Disaster Recovery Plan - Cenar Store Bot

## Mục tiêu

- Khôi phục bot trên VibeHost với source đã kiểm thử và hai bản SQLite đã xác minh.
- Không để source deployment ghi đè secret hoặc dữ liệu production.

## Quy trình

1. Tạo hoặc làm sạch server VibeHost, xác nhận thư mục chạy là `/home/container` và allocation public là
   `20022`.
2. Upload source của commit tốt gần nhất vào `/home/container`.
3. Khôi phục `.env` và `.env.store2` từ kho secret an toàn, không lấy từ Git.
4. Khôi phục các database đã qua integrity check:
   - `/home/container/data/shopbot.sqlite`
   - `/home/container/data/shopbot-store2.sqlite`
5. Chạy `npm ci --omit=dev --no-audit --no-fund`.
6. Cấu hình Startup command là `npm start`, sau đó Start server từ panel.
7. Kiểm tra Console, trạng thái hai bot Discord và hai health endpoint qua cổng public `20022`.

Nếu SFTP credential hoặc secret có khả năng bị lộ, phải rotate trước khi khôi phục production.
