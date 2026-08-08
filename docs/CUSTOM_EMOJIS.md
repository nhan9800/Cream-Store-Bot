# Hướng dẫn dùng Custom Emoji với Bot Cream Store

Bot có sẵn lệnh `/emoji-setup` để admin set custom emoji cho các vị trí UI. Mỗi guild lưu cấu hình riêng trong DB.

## Bước 1: Upload emoji vào server

**Cách A — Application Emojis (KHUYẾN NGHỊ, dùng được trên mọi server):**
1. Vào https://discord.com/developers/applications
2. Chọn application của bot → tab **Emojis** trong sidebar
3. Click "New Emoji" → upload file PNG/GIF (max 256KB)
4. Đặt tên không dấu, vd: `cs_check`, `cs_warn`, `cs_money`

**Cách B — Server Emojis (cách cũ, chỉ server đó dùng được):**
1. Server Settings → Emoji → Upload Emoji
2. Bot phải là member của server có emoji
3. Sau khi upload, click vào emoji để xem thông tin

## Bước 2: Lấy chuỗi emoji

Trong Discord, gõ `\:tên_emoji:` (escape backslash) vào ô chat. Send message sẽ hiện ra **chuỗi raw** dạng:
```
<:cs_check:1234567890123456789>
```
hoặc với animated emoji:
```
<a:cs_loading:1234567890123456789>
```

Copy toàn bộ chuỗi này.

## Bước 3: Set emoji vào slot bằng lệnh `/emoji-setup`

```
/emoji-setup set slot:status_check emoji:<:cs_check:1234567890123456789>
```

Bot sẽ:
- Validate format emoji
- Lưu vào DB cho guild hiện tại
- Hiển thị preview

## Bước 4: Xem và quản lý

```
/emoji-setup list      # liệt kê tất cả slot và emoji hiện tại
/emoji-setup reset     # reset về emoji unicode mặc định (toàn bộ)
/emoji-setup reset slot:status_check  # reset 1 slot
```

## Danh sách 50 slot có sẵn

### Panel Ticket
- `panel_order` 🛍️ Mua Hàng
- `panel_support` 🆘 Hỗ Trợ
- `panel_complaint` ⚠️ Khiếu Nại
- `panel_partnership` 🤝 Hợp Tác
- `panel_warranty` 🛠️ Bảo Hành
- `panel_edit` ✏️ Sửa Panel (Admin)

### Đơn hàng
- `order_created` ✅ Đơn hàng tạo
- `order_queue` 📌 Hàng chờ
- `order_cancel` ❌ Hủy đơn
- `order_complete` 🎉 Đơn hoàn thành
- `order_processing` ⚙️ Đơn đang xử lý
- `order_pending` ⏳ Đơn chờ thanh toán
- `order_id` 🆔 Mã đơn
- `order_product` 📦 Sản phẩm

### Stock / Bảng giá
- `stock_header` 🛒 Header bảng giá

### Thanh toán
- `payment_payos` 💳 PayOS
- `payment_vietqr` 🏦 VietQR/Ngân hàng
- `payment_success` ✅ Thanh toán thành công
- `payment_qr` 📱 Mã QR
- `payment_money` 💰 Số tiền
- `payment_refund` ↩️ Hoàn tiền

### Ticket
- `ticket_close` 🔒 Đóng ticket
- `ticket_claim` 🛡️ Claim đơn
- `ticket_open` 🎫 Mở ticket
- `ticket_user` 👤 Khách hàng
- `ticket_staff` 🧑‍💼 Nhân viên

### Thời gian
- `icon_clock` ⏰ Đồng hồ
- `icon_calendar` 📅 Lịch
- `icon_expire` ⏱️ Hết hạn
- `icon_history` 📜 Lịch sử

### Trạng thái
- `status_check` ✅ Tích xanh
- `status_cross` ❌ Dấu X
- `status_warn` ⚠️ Cảnh báo
- `status_info` ℹ️ Thông tin
- `status_loading` ⏳ Đang tải

### Thương hiệu
- `brand_netflix` 🎬
- `brand_spotify` 🎵
- `brand_youtube` 📺
- `brand_chatgpt` 🤖
- `brand_discord` 💬

### Khác
- `icon_price` 💰
- `icon_duration` ⏱️
- `icon_store` 🏪
- `icon_star` ⭐
- `icon_fire` 🔥
- `icon_gem` 💎
- `icon_gift` 🎁
- `icon_sparkle` ✨
- `icon_crown` 👑
- `icon_chart` 📊
- `icon_id` 🆔
- `icon_location` 📍
- `icon_settings` ⚙️
- `icon_key` 🔑
- `icon_link` 🔗

## Ví dụ workflow

```
# 1. Upload emoji "cs_money" (custom đẹp) vào server
# 2. Gõ \:cs_money: trong Discord, copy chuỗi
# 3. Set vào slot:
/emoji-setup set slot:payment_money emoji:<:cs_money:1234567890>

# 4. Tất cả message hiển thị emoji 💰 sẽ tự động dùng cs_money
# 5. Kiểm tra:
/emoji-setup list
```

## Lưu ý

- Cấu hình emoji **lưu per-guild** (server nào set thì server đó áp dụng)
- Bot phải có quyền **dùng emoji** trên server đó (mặc định bot có)
- Reset chỉ bỏ cấu hình slot. Bot không dùng emoji Unicode mặc định trong UI.
- Dùng Application Emojis nếu muốn bot dùng emoji trên nhiều server không cần upload riêng từng server
