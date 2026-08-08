# Thiết lập callback Card2K

## URL production hiện tại

```text
http://hcm3.vibehost.vn:20022/api/public/cardswap/callback
```

Nhập chính xác URL trên tại **API Partner → Chỉnh sửa kết nối API → Callback URL → Cập nhật**.
Không thêm dấu `/` ở cuối và không tự thêm query string.

## Callback làm gì?

Card2K gọi URL này sau khi kiểm tra thẻ. Bot sẽ:

1. tìm `request_id` trong database Store 1 và Store 2 để chuyển callback tới đúng bot;
2. xác minh `callback_sign` bằng Partner Key;
3. khóa trạng thái đơn theo cơ chế idempotent để callback lặp không cộng ví hai lần;
4. cộng số dư theo giá trị thực tế/biểu phí đã chốt;
5. đồng bộ role Cenar Patron, gửi DM khách và Components V2 vào kênh staff log.

Mở URL không có tham số sẽ trả `CENAR_CARD_CALLBACK_READY`, dùng để kiểm tra endpoint trước khi lưu.

## Bảo mật

- Partner Key chỉ đặt trong `.env` và `.env.store2`; không ghi vào Git hoặc Discord log.
- URL hiện tại chạy trực tiếp qua allocation HTTP của VibeHost. Khi có reverse proxy HTTPS riêng,
  đổi Callback URL sang domain HTTPS nhưng giữ nguyên path `/api/public/cardswap/callback`.
- Nếu Partner Key hoặc mật khẩu SFTP từng xuất hiện trong ảnh/tin nhắn, nên xoay khóa sau khi cấu hình xong.
