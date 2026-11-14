# Hướng dẫn quản lý gia hạn theo kỳ

## Nguyên tắc hoạt động

- Khi dùng `/giaohang`, bot tự tạo hồ sơ gia hạn từ Gmail, khách hàng, mã đơn và tổng số tháng đã mua.
- Lần giao hàng đầu tiên được tính là đã cấp **một kỳ**, giới hạn trong tổng thời hạn khách mua.
- Hồ sơ `auto_cycle` của Nitro mặc định **2 tháng/lần** (gói ngắn hơn dùng phần thời hạn còn lại); các dịch vụ khác mặc định **1 tháng/lần**. Luôn đối chiếu chu kỳ đang lưu và điều kiện gói trước khi xác nhận.
- Gói Nitro 12 tháng gia hạn 2 tháng/lần có tổng cộng **6 kỳ**. Hồ sơ cấp trọn gói không dùng lịch gia hạn theo kỳ.
- Khi đã cấp đủ `X/Y tháng`, tác vụ kế tiếp tự đổi từ **Gia hạn** sang **Ngắt gói** vào ngày hết hạn.
- Mỗi lần tạo, gia hạn, sửa tiến độ và ngắt gói đều có lịch sử kèm Admin thực hiện.

## Các lệnh Admin thường dùng

### Tìm hồ sơ theo Gmail hoặc mã đơn

```text
/subscription find tu_khoa:customer@gmail.com
/subscription find tu_khoa:CR_123456
```

Kết quả hiển thị ID hồ sơ, khách hàng, mã đơn, tiến độ `đã cấp X/Y tháng` và việc cần làm tiếp theo.

### Xác nhận đã cấp thêm một kỳ

```text
/subscription renew id:123
```

Chỉ dùng sau khi đã thao tác gia hạn thật trên nguồn. Bot cộng theo chu kỳ hồ sơ, giới hạn ở tổng thời hạn đã bán, lưu lịch sử và tính kỳ tiếp theo.

### Nhập lại tiến độ của đơn cũ

```text
/subscription progress id:123 da_cap_thang:5 ghi_chu:Đã đối soát Gmail và đơn gốc
```

Ví dụ hồ sơ chu kỳ 1 tháng, khách mua 12 tháng và thực tế đã được cấp 5 tháng: nhập `5`. Với Nitro chu kỳ 2 tháng, tiến độ giữa gói phải khớp kỳ như `2`, `4`, `6` tháng; không nhập `5` nếu chưa có dữ liệu gói phù hợp.

### Xem lịch sử thao tác

```text
/subscription history id:123
```

Lịch sử cho biết thời điểm tạo hồ sơ, từng lần cấp thêm, lần điều chỉnh tiến độ, Admin thực hiện và lần ngắt gói.

### Xác nhận đã ngắt gói

```text
/subscription disconnect id:123 ghi_chu:Đã gỡ khỏi nguồn đúng hạn
```

Lệnh chỉ hoạt động khi hồ sơ đã cấp đủ toàn bộ số tháng, giúp tránh ngắt nhầm đơn còn thời hạn.

### Kiểm tra hàng chờ

```text
/subscription check so_ngay:7
/subscription list
/subscription overview
```

Bot cũng tự gửi thẻ nhắc vào kênh Admin. Thẻ có nút nhận xử lý, nhắc lại, xác nhận đã gia hạn hoặc xác nhận đã ngắt gói tùy đúng trạng thái.

## Xử lý dữ liệu cũ sau khi cập nhật

1. Dùng `/subscription find` để tìm Gmail.
2. Nếu kết quả có cảnh báo **cần xác minh**, đối chiếu đơn gốc và tài khoản nguồn.
3. Dùng `/subscription progress` để nhập số tháng đã cấp thực tế.
4. Từ đó bot tự bật lịch nhắc theo chu kỳ đúng của hồ sơ.

Không đoán tiến độ của đơn cũ. Nếu chưa chắc khách đã được cấp mấy tháng, giữ hồ sơ ở trạng thái cần xác minh để bot không nhắc sai.
