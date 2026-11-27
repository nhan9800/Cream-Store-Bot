# Sổ hoàn tiền (refund ledger) — 2026-11-28

Mỗi lần shop đã chuyển khoản hoàn tiền cho khách sẽ có đúng một dòng trong bảng `order_refunds`. Bảng này là nguồn số liệu duy nhất khi tính doanh thu sau hoàn tiền.

## Quy trình cho quản lý

1. `/quanly-don ma_don:… hanh_dong:Ghi nhận yêu cầu hoàn tiền`: đơn chuyển sang `REFUND_PENDING`, giao hàng và hoàn thành tạm dừng.
2. `/hoantien tinh ma_don:… ly_do:… [phi_phan_tram] [khau_tru_khac]`: ra bảng tính và đoạn giải thích để gửi khách. Bước này chưa ghi nhận gì.
3. Chuyển khoản cho khách ở ngoài bot.
4. `/hoantien ghi-nhan ma_don:… so_tien_hoan:… [ly_do] [phi_phan_tram] [ma_giao_dich] [ghi_chu]`: đơn chuyển sang `REFUNDED` và một dòng được ghi vào sổ. Hai việc này chạy trong cùng một transaction.
5. `/hoantien tra-cuu ma_don:…` để xem lại; `/hoantien thong-ke thoi_gian:…` để xem tổng hợp.

Lựa chọn `Xác nhận đã hoàn tiền bên ngoài bot` trong `/quanly-don` vẫn dùng được. Khi đó sổ ghi lý do `OTHER`, không tính phí, và toàn bộ phần chênh nằm ở mục khấu trừ khác. Hồ sơ hoàn tiền Gemini (`order_refund_cases`) dùng bảng tính khách đã đồng ý, với source `GEMINI_CASE`.

## Công thức

Số hoàn = Số đã trả − Tiền thời gian đã dùng − Phí % − Khấu trừ khác.

- **Tiền thời gian đã dùng** = số đã trả × (thời gian từ lúc giao đến lúc khách yêu cầu hoàn) / (tổng thời hạn gói).
  - Đơn chưa giao: không trừ khoản này.
  - Đơn không có `expiry_at`: lấy số ngày của gói, hoặc số tháng × 30 ngày.
- **Phí %**: quản lý tự chỉnh trong khoảng 0–50%. Nếu bỏ trống thì dùng mức mặc định theo lý do.
- Mọi khoản trừ đều làm tròn xuống đến đồng. Tổng các khoản trừ không bao giờ vượt quá số đã trả.
- Trong sổ, `other_deduction` là phần chênh giữa công thức và số thực chuyển. Số âm nghĩa là shop hỗ trợ thêm cho khách.

| Mã | Lý do | Phí mặc định |
|---|---|---|
| `CHANGE_OF_MIND` | Khách đổi ý sau khi đã giao hoặc kích hoạt | 50% |
| `SOURCE_COST_SPENT` | Shop đã mua nguồn, nhà cung cấp không hoàn | 40% |
| `PROVIDER_CHANGE` | Nhà cung cấp đổi chính sách hoặc ngừng dịch vụ | 30% |
| `SHOP_FAULT` | Lỗi từ shop | 0% |
| `OTHER` | Lý do khác (bắt buộc có ghi chú) | 40% |

Mỗi lý do kèm một đoạn giải thích cho khách (`REFUND_REASONS[*].explanation` trong `src/services/refundLedgerService.js`). Trần 50% khớp với chính sách hủy đơn ngày 22/11 (đơn mới hoặc đang xử lý được hoàn tối đa 50%).

## Doanh thu

- **Doanh thu gộp**: tổng `amount_paid` của các đơn `PAID` chưa bị hủy, tính theo ngày tạo đơn.
- **Đã hoàn**: tổng `refund_amount` của các dòng sổ còn hiệu lực, tính theo **ngày hoàn tiền**. Nhờ vậy số liệu của tháng đã chốt không bị thay đổi.
- **Doanh thu thực nhận** = gộp − đã hoàn. Phần shop giữ lại từ các đơn hoàn vẫn được tính vào doanh thu.
- Các chỗ dùng chung công thức này: `/thongke`, `/hoantien thong-ke`, `GET /api/bot/admin/stats` (`revenue` là số thực nhận; thêm `grossRevenue`, `refundedTotal`, `refundCount`, `retainedFromRefunds`), `GET /api/bot/admin/revenue-chart` (theo ngày gồm `gross`, `refunded`, `total`), `GET /api/bot/stats` và bảng điều khiển của guild.

## Tra cứu và đối soát

- `GET /api/bot/admin/refunds?from&to&q&reason&needsReview=1&includeVoided=1&limit&offset`: trả về danh sách, tổng hợp, doanh thu và danh mục lý do.
- `GET /api/bot/admin/refunds/:code`: thông tin đơn, dòng sổ còn hiệu lực, các dòng đã hủy và toàn bộ lịch sử trạng thái.
- `PUT /api/bot/admin/orders/:code/status` với `REFUNDED` bị từ chối (409). Ghi nhận hoàn tiền phải qua `/hoantien ghi-nhan` để luôn có số tiền và lý do.
- Mở lại một đơn đã hoàn qua `/quanly-don` sẽ đánh dấu dòng sổ là đã hủy (`voided_at`). Dòng sổ không bao giờ bị xóa.
- Khi khởi động, bot tự bổ sung các đơn `REFUNDED` cũ chưa có trong sổ:
  - Số tiền lấy từ lịch sử trạng thái của đơn.
  - Nếu lịch sử không ghi số tiền: tạm tính là hoàn toàn bộ, đặt `needs_review=1` và chờ đối soát.
- Sổ không lưu thông tin ngân hàng của khách. Thông tin này chỉ nằm trong hồ sơ Gemini đã được mã hóa.
