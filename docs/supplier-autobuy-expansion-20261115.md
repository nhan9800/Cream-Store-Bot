# Chín mã mới Dopermind · 15/11/2026

Rà theo snapshot hosting lúc 00:55 ngày 15/11/2026 (Asia/Saigon): nguồn 111 mã, 9 khóa chưa duyệt. Một khóa của lần rà trước không còn trong nguồn, nên chênh lệch tổng là 8; vẫn giữ quyết định cũ của cả 103 khóa để bảo toàn đơn/báo giá đang tồn tại.

Duyệt chính sách thêm 6 mã, giữ 3 mã chờ thông tin. Bật bán thực tế còn phụ thuộc giá live, tồn kho, trạng thái khóa và hạn tham chiếu. Không tạo giao dịch mua nguồn hoặc thanh toán thử trong lần rà này. Phần chiếu metadata tạm thời ra console đã tắt sau khi thu đủ dữ liệu.

| Mã nguồn | Gói | Quyết định và điều kiện |
| --- | --- | --- |
| `desc_af41da59-622c-428d-8bf5-00e4e3e622ca` | ChatGPT Go 3 Tháng (BH24H) | Duyệt 3 tháng; chỉ bảo hành 24 giờ theo nhãn nguồn. Mốc 618.960đ là phép so sánh 3 × 8 USD/tháng, không phải gói trả trước ba tháng chính thức. |
| `desc_e64dc5c4-8fce-45ae-8c14-dae666b6dacd` | ChatGPT Pro 100 1T (BH2D) | Duyệt 1 tháng; bảo hành 2 ngày. Trần tham chiếu 2.579.000đ. |
| `desc_52c8a2ad-7b1b-4305-b8e2-02006933c77f` | ChatGPT Pro 100 1T (BH7D) | Duyệt 1 tháng; bảo hành 7 ngày. Trần tham chiếu 2.579.000đ. |
| `desc_ced04ccd-c32f-4f19-bd0e-0d851e9d815c` | ChatGPT Pro 200 1T (KBH) | Duyệt 1 tháng; không bảo hành. Trần tham chiếu 5.158.000đ. |
| `desc_c281864c-9266-4a6d-908b-f9b2e70250b5` | ChatGPT Pro 500 1T (BH2D) | Duyệt 1 tháng; bảo hành 2 ngày. Trần tham chiếu 12.895.000đ. Không cam kết quota/model cố định, quyền sở hữu hoặc quyền lợi ngoài nội dung nguồn bàn giao. |
| `desc_b60308e8-9a29-4893-9d99-f32bbfc6f33a` | Grok+Cursor Plus 1 Tháng | Duyệt 1 tháng, trần 206.320đ. Nguồn chưa công bố bảo hành. Tham chiếu Plus hiện hành chỉ có model Grok; không quảng cáo là Cursor Pro/Pro+, gói model bên thứ ba hoặc API credit. |
| `desc_7fe12942-fe76-4b28-b4fa-0b09a3a09a1e` | CursorPro+Grok+X Pre 1Y BHF | Chờ xác định chính xác các tier/quyền lợi, cách bàn giao và quyền quản lý tài khoản; không tự ánh xạ tên Pro/Pre sang Plus/Premium hiện tại. |
| `desc_ad25d2d3-40f2-48aa-ae25-086f2a029b8a` | Gemini Pro 24T + Youtu Copy | Chờ rõ quyền lợi YouTube Premium/Lite, vùng, cách bàn giao và kỳ hạn của từng phần. Không quy "Youtu Copy" thành thuê bao YouTube Premium đầy đủ. |
| `desc_eeb81979-033c-41ef-a1b7-548a01d80f39` | GG AI Pro 5TB Acc Edu US | Chờ thời hạn, điều kiện học sinh/sinh viên, phạm vi quản lý tài khoản và bảo hành. Google AI Pro 5TB là quyền lợi có thật; lý do giữ là dữ liệu nguồn thiếu điều kiện, không phải dung lượng 5TB không tồn tại. |

Giá giữ đúng [quy tắc đã chốt](supplier-autobuy-pricing-20261110.md): làm tròn lên 1.000đ sau dự phòng 3%, mức lời/dự phòng cố định theo bậc giá nguồn khi rà, lời ròng ít nhất 20.000đ và giá phải nhỏ hơn trần. Không giảm lời tối thiểu để ép gói qua trần. Tỷ giá 25.790đ/USD là mốc cố định của chính sách trước, không được gọi là tỷ giá live.

Các tham chiếu mới được kiểm tra ngày 15/11/2026 và là `BENCHMARK`, không chứng minh SKU nguồn tương đương mua trực tiếp. Giữ nguyên version giá, toàn bộ 103 quyết định cũ, các tham chiếu cũ và fingerprint của 43 gói đã duyệt. Chỉ thêm quyết định mới và nâng revision rà soát.

Nguồn đối chiếu chính thức:

- [OpenAI: ChatGPT Go, giá Mỹ 8 USD/tháng](https://openai.com/index/introducing-chatgpt-go/), [điều kiện kỳ hạn Go](https://help.openai.com/en/articles/11989085-what-is-chatgpt-go): không có trả trước nhiều tháng chính thức.
- [OpenAI: Pro 100/200/500](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers): 100/200/500 USD mỗi tháng; dùng làm trần tham chiếu, không thêm lời hứa về quyền truy cập/quota của tài khoản nguồn.
- [Cursor: Plus hiện hành](https://cursor.com/en-US/pricing): 8 USD/tháng, Grok và Cursor dùng chung hạn mức; Plus chỉ có model Grok và API tính riêng.
- [Google AI plans](https://one.google.com/about/google-ai-plans/?gl=US), [điều kiện Google One student](https://support.google.com/googleone/answer/17422238): AI Pro có 5TB; ưu đãi học sinh/sinh viên có điều kiện riêng, trial US không tự bao gồm YouTube Premium/Lite.

Kết quả kiểm thử và trạng thái mở bán live cần được xác nhận sau CI/triển khai; số gói còn hàng không được suy ra chỉ từ quyết định chính sách.
