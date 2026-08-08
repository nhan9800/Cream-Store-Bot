# Cenar Store · Components V2 Style Guide

Quy tắc này áp dụng cho mọi panel mới và mọi panel được refresh từ bot.

## Bố cục

- Một `ContainerBuilder` dùng đúng một màu accent theo ngữ cảnh.
- Text đi theo thứ tự: `##` tiêu đề, một đoạn giới thiệu ngắn, nội dung chính, footer `-#`.
- Chỉ dùng separator giữa các phần lớn; không chèn separator giữa từng dòng.
- Mỗi TextDisplay giữ một ý chính. Không nhồi nhiều tiêu đề và nhiều dòng trống vào cùng một block.
- Tối đa một dòng trống giữa hai đoạn; không để dòng trống ở đầu hoặc cuối.

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
