# /chuyen-ticket: chuyển ticket mở nhầm mục (2026-11-28)

Dùng khi khách mở ticket sai mục, ví dụ mở **Hỗ trợ** trong khi đã có mã đơn và cần bảo hành. Staff gõ lệnh trong chính ticket đó:

`/chuyen-ticket loai:<Bảo hành|Đơn hàng|Hỗ trợ|Khiếu nại|Hợp tác> [ma_don] [ghi_chu]`

- **Tìm mã đơn.** Bỏ trống `ma_don` thì bot đọc 100 tin gần nhất trong ticket, nhận các dạng `CN_123456`, `cn-123456`, `CN 123456`, và chỉ giữ đơn của đúng khách trong shop này.
  - Thấy đúng 1 đơn: bot dùng đơn đó.
  - Thấy nhiều đơn: bot yêu cầu chọn bằng `ma_don`.
  - Không thấy đơn nào: Bảo hành bắt buộc nhập `ma_don`; các mục khác giữ nguyên đơn đang gắn.
- **Kiểm tra trước khi chuyển.** Ticket phải đang mở. Ticket website, Booking và kháng nghị không chuyển được. Đơn phải thuộc khách của ticket. Riêng Bảo hành:
  - đơn phải ở trạng thái `COMPLETED` hoặc `WARRANTY_OPEN`;
  - đơn chưa có ticket bảo hành khác đang mở.
- **Việc bot làm:**
  - Chuyển kênh sang danh mục của loại mới (`getTicketCategoryId`) và giữ nguyên quyền riêng của ticket.
  - Đổi tên kênh. Bảo hành → `bao-hanh-<số đơn>`. Kênh `ticket-…`/`bao-hanh-…` → `ticket-<mã ticket>`. Tên theo sản phẩm (`nitro-…`, `gpt-…`) giữ nguyên.
  - Cập nhật `tickets.ticket_type`, `related_order_code` và `support_source`.
  - Gửi thẻ thông báo trong ticket (không ping), kèm `ghi_chu` nếu có.
  - Ghi staff log `TICKET_MOVED`.
- **Chuyển sang Bảo hành** (`attachWarrantyToTicket`) làm đủ các bước như khi khách tự mở bảo hành:
  - đơn sang `WARRANTY_OPEN`;
  - gửi panel bảo hành vào ticket và ghi log vào kênh log bảo hành;
  - đồng bộ hub;
  - tạo form YouTube nếu là đơn YouTube.
- **Chuyển ra khỏi Bảo hành:** đơn đang `WARRANTY_OPEN` được trả về `COMPLETED`, giống khi đóng ticket bảo hành.
