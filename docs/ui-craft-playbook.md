# Cenar UI craft playbook (bot) · dành cho Codex và mọi agent

Tài liệu này bổ sung cho [Components V2 style guide](discord-components-v2-style-guide.md). Style guide quy định khung kỹ thuật; tài liệu này mô tả cách làm cho một panel trông chuyên nghiệp, dễ đọc và đáng tin. Hai ví dụ mẫu đang chạy thật:
- Thẻ hoàn tiền: `src/services/refundPresentation.js` và `src/services/refundManagerCards.js`.
- Bảng giá: `src/services/autoSetupPriceBoardService.js`.

## 1. Nguyên tắc
- **Một thẻ, một nhiệm vụ.** Trước khi viết code, trả lời: người đọc là ai (khách / staff / manager) và họ cần làm gì tiếp theo. Mọi dòng không giúp việc đó thì bỏ.
- **Số tiền và trạng thái là nhân vật chính.** Kết quả cuối (số tiền hoàn, giá, trạng thái đơn) đặt ở `##` hoặc `###`. Phép tính dẫn tới kết quả trình bày từng dòng: nhãn **đậm**, rồi ` · `, rồi giá trị.
- **Minh bạch tạo niềm tin.** Có khấu trừ thì luôn ghi cả lý do (`REFUND_REASONS[*].explanation`) và cách tính (số ngày đã dùng/tổng, % phí). Không để khách tự đoán.
- **Xem trước rồi mới cam kết.** Mọi dữ liệu khách nhập có hậu quả tài chính (STK, số tiền, lựa chọn) phải qua một bước xem trước riêng tư, có nút xác nhận và nút sửa lại. Mẫu chuẩn: `buildRefundPreview` → `refund:confirm`.
- **Riêng tư mặc định.** Thông tin ngân hàng, mã đơn kèm số tiền và thao tác quản lý luôn ở dạng ephemeral hoặc nằm trong ticket riêng (`isPrivateRefundTicket`). Không bao giờ đưa vào kênh công khai hay log.

## 2. Giải phẫu một thẻ giao dịch (Components V2)
1. **Container đầu** (accent theo ngữ cảnh): gồm
   - `# <emoji> TIÊU ĐỀ VIẾT HOA NGẮN`;
   - dòng nhận diện: mã đơn · sản phẩm · khách;
   - một separator;
   - phần thời gian/bối cảnh.
2. **Container số liệu:** các dòng phép tính, `## <emoji> Kết quả`, rồi một dòng `-#` giải thích cách làm tròn.
3. **Container hành động:** gồm
   - bước tiếp theo, viết thành câu mệnh lệnh;
   - lưu ý bảo mật;
   - nút (động từ đứng đầu, kèm emoji custom qua `withButtonEmoji`);
   - footer `-#` ghi phiên bản bảng tính / thương hiệu.

Bảng màu accent đang dùng:

| Màu | Dùng cho |
|---|---|
| `0x8796cb` | Thông tin, bảng tính |
| `0x79d4bd` | Hoàn tất, sẵn sàng |
| `0xe8b977` | Cần chú ý, đề xuất, xem trước |
| `0x5f6d87` | Hướng dẫn, thống kê |
| `0x5865F2` | Nitro / Discord |

Một container chỉ dùng một màu.

## 3. Emoji custom 100%
- Chỉ lấy emoji qua `createEmojiResolver(guildId)`. Không dùng emoji Unicode và không tự gõ ID.
- **Không lặp emoji trong một tin nhắn.** Khai báo các slot ứng viên rồi lấy ID chưa dùng, giống `refundDecorations()`. Test bắt buộc: thu thập mọi `<:name:id>` cùng emoji của nút, rồi kiểm tra `new Set(ids).size === ids.length`.
- Mỗi dòng chỉ có một emoji, đặt ở đầu dòng. Emoji phải đúng nghĩa: tiền → `payment_money`, ngân hàng → `cenar_ui27_bank`, QR → `payment_qr`, thời gian → `icon_clock`, cảnh báo → `guide_warning`.
- Thiếu slot thì bổ sung vào pack emoji (xem `docs/bot-ui-emoji-recovery.md`), không thay bằng ký tự.

## 4. Thông báo / bài công bố
Bố cục chuẩn (xem `recovery-backups/*/prepare.mjs` của các đợt gần nhất):
1. **Hero:** tiêu đề nêu thay đổi chính, một câu tóm tắt "điều gì thay đổi và từ khi nào".
2. **Chi tiết:** mỗi gói hoặc chính sách là một khối, gồm giá (`**115.000đ**`), lợi ích cụ thể có số đo được (ví dụ "xong trong 20–30 phút") và điều kiện áp dụng.
3. **Ai bị ảnh hưởng và cần làm gì:** khách cũ, khách mới, đơn đang chờ.
4. **CTA:** nút mở ticket hoặc link kênh bảng giá. Kết thúc bằng một câu cảm ơn ngắn, không sáo rỗng.
5. **Footer `-#`:** thời điểm áp dụng, thương hiệu.

Ping (`@everyone`), đăng bài và sửa bài đều cần chủ shop duyệt đúng nội dung. Mặc định `allowedMentions: { parse: [] }`. Đăng xong phải đọc lại qua API rồi lưu ledger/verified JSON.

## 5. Văn phong
- Tiếng Việt có dấu, ngắn, xưng "bạn" với khách và "shop" cho Cenar. Mỗi câu tối đa khoảng 25 từ.
- Không hứa điều code chưa làm được. Ví dụ: chỉ viết "bot tự kiểm tra" khi thực sự có kiểm tra trong code và test.
- Không dùng chữ "ngay lập tức" hay "100%" khi không đo được. Viết theo con số thật: "20–30 phút sau khi nhận đơn".
- Thông báo lỗi nói rõ lý do và việc khách cần làm tiếp. Không lộ stack trace hay dữ liệu khách nhập.

## 6. Checklist trước khi mở PR
- [ ] Payload có `MessageFlags.IsComponentsV2` và không có `embeds`/`content` thừa. Tối đa 40 component.
- [ ] Test serialize thẻ: đủ nội dung chính, emoji không trùng, đúng `custom_id`, `allowedMentions` đúng phạm vi.
- [ ] Không rò dữ liệu nhạy cảm: test tìm STK, token, chuỗi mã hóa trong payload và log.
- [ ] Luồng có tiền: phải có bước xem trước, kiểm tra phiên bản bảng tính, và từ chối khi dữ liệu đã đổi.
- [ ] QR chuyển khoản: chỉ dựng bằng `buildVerifiedRefundVietQR` (tự đọc lại CRC/BIN/STK/số tiền), render cục bộ, không gọi dịch vụ ảnh bên ngoài.
- [ ] Sau khi deploy: refresh panel hiện có thay vì gửi bản sao, đọc lại qua REST và ghi bằng chứng.
