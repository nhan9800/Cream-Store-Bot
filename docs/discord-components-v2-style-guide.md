# Cenar Store · Components V2 Style Guide

Quy tắc này áp dụng cho mọi panel mới và mọi panel được refresh từ bot.

## Bố cục

- Một `ContainerBuilder` dùng đúng một màu accent theo ngữ cảnh.
- Text đi theo thứ tự: `##` tiêu đề, một đoạn giới thiệu ngắn, nội dung chính, footer `-#`.
- Dùng `SeparatorBuilder` với `SeparatorSpacingSize.Large` giữa các phần lớn; footer dùng `Small`. Không dùng chuỗi `───` thay separator, không chèn separator giữa từng dòng dữ liệu.
- Giữ mỗi nhóm nút liền nhau; khoảng đệm không kẻ đường (`divider: false`) phù hợp trước nhóm thao tác và quanh ảnh/QR.
- Mỗi TextDisplay giữ một ý chính. Không nhồi nhiều tiêu đề và nhiều dòng trống vào cùng một block.
- Tối đa một dòng trống giữa hai đoạn; không để dòng trống ở đầu hoặc cuối.
- Markdown: `##` cho tiêu đề chính, `###` cho phần phụ, `**nhãn**` cho dữ liệu, danh sách đánh số cho các bước. Chỉ dùng `>` cho trích dẫn/lưu ý; không biến toàn bộ nội dung thành một khối trích dẫn dài. Dùng `-#` cho ghi chú phụ, không cho giá hoặc trạng thái quan trọng.

## Chuẩn hóa chung khi gửi

- `src/utils/discordLayout.js` / `normalizeDiscordV2Layout()` áp dụng nhịp cách ở biên REST cho tin nhắn V2, kể cả send/edit, interaction reply/update và webhook follow-up/edit. Không áp dụng cho modal hay embed cũ.
- Bộ chuẩn hóa chỉ thêm separator hợp lệ hoặc tăng đệm separator đang hiển thị. Giữ nguyên mọi chữ, Markdown, ý kiến khách, mã đơn, số tiền, media/QR, attachment, ID/nút/menu và quyền mention. Các spacer `divider: false` được renderer chỉ định sẽ giữ nguyên.
- Tối đa **40 component trên toàn tin nhắn**, tính cả container, section, accessory, action row và control con. Nếu không còn chỗ, bỏ phần đệm bổ sung; không bỏ nội dung hay nút. Không thêm separator vào trong Section/ActionRow, không lồng Container.
- Chạy lại chuẩn hóa phải cho cùng kết quả. Payload embed/legacy, topology chưa hỗ trợ hoặc quá giới hạn giữ nguyên để caller xử lý, không tự chuyển đổi hay cắt dữ liệu.
- Nội dung một TextDisplay vẫn do renderer chịu trách nhiệm chia nhóm. Boundary không phân tích lại lời khách hoặc đoạn code thành tiêu đề mới.
- Với feature cũ được lựa chọn rõ trong source, `buildLegacyFeatureCard()` ở `src/utils/featureCard.js` chuyển payload embed riêng của renderer sang V2 có tiêu đề/field/footer/ảnh/nút. Đây là opt-in, không đặt ở boundary và không dùng để đổi hàng loạt lịch sử. Giữ nguyên giá trị field/description; payload chưa hỗ trợ, vượt 4.000 ký tự hoặc 40 component quay về embed gốc, không cắt chữ.
- Các command được chọn: `coupon`, `referral`, `subscription`, `thongke`, `kpi`, `dsbaohanh`, `ytbaohanh`. Với danh sách dài còn fallback, cần chia trang ở renderer trước khi mở rộng V2; không ép bỏ bớt thông tin để vừa khung. Với file đính kèm chưa được tham chiếu trực tiếp trong component, helper giữ payload cũ để tránh làm ẩn file.
- Mention trong embed cũ chỉ là hiển thị; khi chuyển sang TextDisplay không được tự tạo ping. Helper mặc định `allowedMentions: { parse: [] }`. Giữ nguyên policy đã chỉ định; trường hợp policy có thể kích hoạt mention vốn chỉ nằm trong embed hoặc chưa rõ người nhận từ content thì giữ payload cũ.

Nguồn: [Discord Components Reference](https://docs.discord.com/developers/components/reference#separator), [Discord Components Overview](https://docs.discord.com/developers/components/overview), [Discord.js SeparatorBuilder](https://discord.js.org/docs/packages/discord.js/14.28.0/SeparatorBuilder:Class). Dự án hiện ghim Discord.js 14.27.0, đã có các API separator dùng ở đây; không cần nâng dependency chỉ để đổi bố cục.

## Emoji và nút

- Chỉ dùng emoji custom qua `createEmojiResolver()` và `E.component()`.
- Không dùng emoji Unicode làm fallback, không gắn emoji vào label nút.
- Mỗi dòng nội dung chỉ nên có một emoji dẫn đầu để mắt quét nhanh.
- Label nút dùng tiếng Việt có dấu, ngắn và bắt đầu bằng động từ: `Mua Hàng`, `Hỗ Trợ`, `Mở Ticket`.
- Một ActionRow không quá bốn nút cho các panel nhiều lựa chọn; nút quản trị để ở hàng riêng.

## Kiểm tra trước khi gửi

1. Chạy `npm test`.
2. Kiểm tra payload có `MessageFlags.IsComponentsV2`.
3. Chạy dry-run của script nếu panel được gửi bằng script.
4. Sau khi deploy, refresh panel thay vì tạo thêm bản sao trong kênh.
