# Admin ví và khóa tài khoản website

## Ví mua hàng

Admin đọc và điều chỉnh ví theo Discord ID được lưu của tài khoản và guild hiện tại, cùng ví website checkout/Discord. Tài khoản chưa liên kết Discord không được điều chỉnh ví mua hàng.

Ví lịch sử `WEB / web user ID` được giữ nguyên, hiện thành số dư/giao dịch riêng để đối soát. Không tự cộng sang ví hiện tại, không xóa lịch sử, không lấy giao dịch của cửa hàng khác. API users có `wallet_linked` và `legacy_wallet_balance`; giao dịch có `wallet_scope: CURRENT | LEGACY_WEB`.

Điều chỉnh cộng/trừ/đặt số dư được validate số nguyên, chống vượt số dư và thực hiện trong SQLite transaction cùng ledger. Đặt số dư về 0 hợp lệ. Sai danh tính không chuyển tiền sang người khác.

## Khóa tài khoản

Cờ `customer_flags('WEB', web user ID)` là khóa tài khoản website. Không tự đổi thành blacklist Discord. Password login, OAuth, đọc account, Admin và customer API đều kiểm tra cờ; trả HTTP 403 với `code: ACCOUNT_BANNED`.

Đổi trạng thái khóa/mở khóa thu hồi session version và email tokens một lần trong transaction. Mở khóa cho phép đăng nhập mới, không khôi phục phiên cũ. Website thu hồi JWT khi bot từ chối xác thực và không dùng lại Discord ID làm fallback cho lỗi 401/403/404. Mật khẩu sai vẫn nhận thông báo 401 chung.

Không tự khóa tài khoản đang dùng; giữ quyền Admin hiện có, validate boolean và tồn tại user. Khi triển khai, bot đi trước website để cung cấp contract ví mới.
