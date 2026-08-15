# Hướng dẫn quản lý gia hạn theo tháng

## Nguyên tắc hoạt động

- Khi dùng `/giaohang`, bot tự tạo hồ sơ gia hạn từ Gmail, khách hàng, mã đơn và tổng số tháng đã mua.
- Lần giao hàng đầu tiên được tính là **đã cấp tháng 1**.
- Gói trên 1 tháng luôn được vận hành theo chu kỳ **1 tháng/lần**, kể cả khách đã thanh toán trước gói 12 tháng.
- Khi đã cấp đủ `X/Y tháng`, tác vụ kế tiếp tự đổi từ **Gia hạn** sang **Ngắt gói** vào ngày hết hạn.
- Mỗi lần tạo, gia hạn, sửa tiến độ và ngắt gói đều có lịch sử kèm Admin thực hiện.

## Các lệnh Admin thường dùng

### Tìm hồ sơ theo Gmail hoặc mã đơn

```text
/subscription find tu_khoa:customer@gmail.com
/subscription find tu_khoa:CR_123456
```

Kết quả hiển thị ID hồ sơ, khách hàng, mã đơn, tiến độ `đã cấp X/Y tháng` và việc cần làm tiếp theo.

### Xác nhận đã cấp thêm một tháng

```text
/subscription renew id:123
```

Chỉ dùng sau khi đã thao tác gia hạn thật trên nguồn. Bot tăng đúng một tháng, lưu lịch sử và tính kỳ tiếp theo.

### Nhập lại tiến độ của đơn cũ

```text
/subscription progress id:123 da_cap_thang:5 ghi_chu:Đã đối soát Gmail và đơn gốc
```

Ví dụ khách mua 12 tháng và thực tế đã được cấp 5 tháng: nhập `5`. Bot sẽ đặt tiến độ thành `5/12`, kỳ kế tiếp là tháng `6/12`.

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
4. Từ đó bot tự bật lịch nhắc theo tháng.

Không đoán tiến độ của đơn cũ. Nếu chưa chắc khách đã được cấp mấy tháng, giữ hồ sơ ở trạng thái cần xác minh để bot không nhắc sai.
