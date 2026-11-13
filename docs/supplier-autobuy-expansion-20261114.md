# Rà lại 70 SKU đã loại và 2 SKU mới Dopermind · 14/11/2026

Rà lại toàn bộ 70 dòng đã đóng và 2 khóa mới trong audit nguồn 103 SKU. Mở thêm 10 dòng cũ và duyệt 2 dòng mới, đưa tổng số duyệt chính sách lên 43/103; 60 dòng còn chờ hoặc được giữ ngừng. Đây không phải kết quả đạt giá/tồn kho hoặc bằng chứng mua/giao hàng. Audit chỉ có key, tên Việt/Anh, type, tồn kho và trạng thái khóa; không có mô tả hay điều kiện kích hoạt bổ sung.

Các thông số kinh doanh giữ nguyên: dự phòng 3%, lời ròng tối thiểu 20.000đ, làm tròn lên 1.000đ và markup/reserve cố định từng SKU. Giá phải nhỏ hơn trần; nguồn đổi tên, thiếu hàng, giá nhập vượt trần hoặc tham chiếu quá 30 ngày vẫn đóng lúc báo giá. Không sửa giá của đơn đang chờ/đã trả, quote, idempotency key, luồng ví hay nguồn thực hiện đơn.

Giữ nguyên `version` của công thức giá để phần mở thêm SKU không làm hết hiệu lực báo giá của 31 sản phẩm không đổi. `reviewRevision` ghi riêng lần rà này; các tham chiếu cũ giữ nguyên ngày kiểm tra và điều khoản.

## Mười hai dòng duyệt thêm

Tám dòng Grok có thời hạn rõ trong tên nguồn: Plus 1 tháng/12 tháng; Super 1 tháng; Super CDK 1 tháng/3 tháng; Ultra 1 tháng; SuperGrok 7 ngày/14 ngày. Thêm Norton VPN Ultimate 7 ngày và Prime Video 6 tháng. KBH, BH1T, BH7D, BH2D, BH24H và BHF vẫn giữ đúng nhãn nguồn; thời hạn gói không biến thành thời gian bảo hành.

Nguồn giá chính thức đọc lúc 2026-11-13T17:57:17.610Z: [X pricing](https://x.ai/pricing), [X Subscription pricing](https://docs.x.ai/x-subscription/pricing), [Norton VPN](https://us.norton.com/products/norton-vpn), [Amazon Prime Video-only](https://www.aboutamazon.com/news/retail/amazon-orders-savings-discounts-shopping). Tất cả là BENCHMARK cùng thương hiệu, không phải hàng tương đương. Không cam kết model/quota/API credit, bộ quyền lợi X/Cursor, giấy phép cá nhân, vùng phim, không quảng cáo, số thiết bị hay nâng cấp tài khoản riêng chỉ từ tên nguồn.

| Mốc áp dụng | Giá niêm yết làm cơ sở | Trần nội bộ VND | Cách hiểu |
| --- | --- | ---: | --- |
| Grok Plus 1 tháng | X Plus 8 USD/tháng | 206.320 | Chọn mốc thấp; không khẳng định cùng X Plus/SuperGrok Plus |
| Grok Plus 12 tháng | X Plus 80 USD/năm | 2.063.200 | Gói nguồn bảo hành 1 tháng, không hứa bảo hành cả năm |
| Grok Super/CDK 1 tháng | X Premium 30 USD/tháng | 773.700 | Không quảng cáo là gói Super mới 100 USD/tháng |
| Grok Super CDK 3 tháng | 3 lần X Premium 30 USD/tháng | 2.321.100 | Phép so sánh shop, không phải gói quý chính thức |
| Grok Ultra 1 tháng | X Ultra 200 USD/tháng | 5.158.000 | Không xác nhận cùng tier/quota với Ultra trực tiếp |
| SuperGrok 7 ngày | 7/30 của X Premium 30 USD | 180.530 | Phân bổ nội bộ, không phải giá chính hãng 7 ngày |
| SuperGrok 14 ngày | 14/30 của X Premium 30 USD | 361.060 | Phân bổ nội bộ; bảo hành nguồn chỉ 24 giờ |
| Norton Ultimate 7 ngày | 7/365 của giá gia hạn 129,99 USD/năm | 64.293 | Không dùng trial miễn phí làm quyền trả phí; trang còn có ưu đãi 59,99 USD năm đầu |
| Prime Video 6 tháng | 6 lần giá Prime Video-only 8,99 USD/tháng | 1.391.112 | Không phải gói 6 tháng chính thức; không bao gồm lợi ích shopping/add-on |

Quy đổi dùng tỷ giá bán Vietcombank đã ghi ngày 10/11 trong manifest: 25.790đ/USD. Đây là mốc cố định của lần rà; không khẳng định là tỷ giá thanh toán hiện tại. Trần ngày và nhiều tháng là phép tính của shop được công bố rõ, không tạo một SKU hay giá gốc chính thức mới. Các 31 dòng đã duyệt trước giữ nguyên tham chiếu/điều khoản trong tài liệu 10/11.

## Hai khóa mới: ChatGPT Plus có Codex

[OpenAI Docs](https://learn.chatgpt.com/docs/pricing) xác nhận Plus 20 USD/tháng đã gồm Codex; API tính phí riêng. Không tạo một loại thuê bao Codex riêng, không hứa quota/model cố định hay sử dụng không giới hạn. Dùng lại trần Plus 515.800đ, dự phòng 3% và template markup/reserve Plus hiện có, không thay đổi 31 dòng đã duyệt.

| Khóa mới | Tên nguồn / nameEn | Thời hạn, bảo hành | Quyết định |
| --- | --- | --- | --- |
| `desc_d7feeccc-3ec3-4ba1-b1fd-3618205a82ba` | ChatGPT Plus Codex 1T (BHF) / ChatGPT Plus Codex 1M (FW) | 1 tháng; BHF theo nhãn nguồn | DUYỆT CHÍNH SÁCH; giá/tồn kho live vẫn được kiểm tra |
| `desc_27578cf9-c3fe-4873-8877-6e1bd49d7b37` | ChatGPT Plus GGPay Codex 1T / ChatGPT Plus GGPay Codex 1M | 1 tháng; nguồn không ghi bảo hành, không thêm BHF | DUYỆT CHÍNH SÁCH; giá/tồn kho live vẫn được kiểm tra |

Cả hai là type product, không khóa, snapshot còn 55 đơn vị mỗi khóa. Đây chỉ là quan sát tại audit, không phải số hàng cam kết cho lần thanh toán tiếp theo. Cách cấp theo nguồn/GGPay không được quảng cáo là nâng cấp tài khoản riêng.

## Các nhóm vẫn chờ và quyết định kinh doanh

Giữ 4 dòng từng được chủ shop ngừng rõ ràng: 2 Claude API, Gemini 18 tháng và Spotify 3 tháng. Có 33 dòng token/credit vẫn thiếu định danh quyền lợi. Những dòng còn lại được giữ vì thiếu thông tin thực tế cụ thể trong bảng dưới; không lấy nhãn LICENSE_UNVERIFIED làm bằng chứng có lệnh cấm bán lại chung. Google Ultra Admin 20x 1y và Grok+Cursor Pre 14 ngày đã có nameEn/type product nhưng không có mô tả; các nhãn này không làm rõ điều kiện quản trị hay phạm vi bundle. Tiếp tục giữ chờ, không tự đổi 99,99 USD của một tier Google khác thành giá 20x. Link family/Edu/trial chờ điều kiện người nhận, không mở chỉ nhờ có thương hiệu.

Duolingo có [mô tả family chính thức](https://blog.duolingo.com/plus-family-plan/) cho sáu tài khoản và nhóm bất kỳ. Điều này sửa cách giải thích quá mức về cùng hộ gia đình, nhưng chưa cung cấp giá/chu kỳ cụ thể của seat nguồn; không lấy giá toàn bộ family làm trần cho một slot.

## Ma trận quyết định 70 dòng

| # | Khóa nguồn | Tên nguồn | Quyết định | Căn cứ / thông tin còn thiếu |
| ---: | --- | --- | --- | --- |
| 1 | `desc_bb1eb346-b99a-460f-bab3-029c2241f5f0` | 100$ API Claude 30D (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OWNER_RETIRED_CLAUDE_API` · Quyết định ngừng Claude API trước đây của chủ shop vẫn còn hiệu lực; rà lại catalog không tự mở lại. |
| 2 | `desc_8b19f48b-1594-49ac-8a55-b44ac7945f70` | 100M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 3 | `desc_2b112db7-e852-41a0-8593-d674f3bf1efa` | 100M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 4 | `desc_8052c21b-11e9-45a8-80bf-6b11ee48a017` | 100M Token 3 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 5 | `desc_decb8e3a-7dea-4e21-abd7-f2e71beb9d8b` | 100M Token 3 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 6 | `desc_2f38f0dd-bb7f-46b5-92e9-1727b1264585` | 100M Token 3 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 7 | `desc_596db8ad-76ab-4456-b90e-db25f7d41a2f` | 100M Token 4 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 8 | `desc_306ad185-c078-4275-abcf-9e6263b97fa6` | Mix 100M Token 3 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 9 | `desc_5b40fe21-6fc3-487b-9c6a-d128d038ee5b` | 10M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 10 | `desc_2409d6d3-859f-4e9d-96dd-cb6fad27e245` | 10M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 11 | `desc_732c3336-332b-42a6-8b1e-950d0abefedf` | Mix 10M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 12 | `desc_ebc791bf-2b70-44f5-b287-485827760cc3` | 10M Token 1 Ngày (BHF)- | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 13 | `desc_d113cff2-ce76-425a-9ef0-437dadf4a0bb` | 10M Token 1 Ngày (BHF)- | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 14 | `desc_7bfb6258-b28c-458f-bf4d-2454397c8665` | 200M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 15 | `desc_df5baa07-e137-4692-9ecb-7751b4c09600` | 200M Token 7 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 16 | `desc_23072ad8-9549-4847-aa57-81cb91b4bdee` | 300M Token 15 Ngày (BH7D) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 17 | `desc_f4f41af5-c6b5-4530-b6f9-01729804778c` | 500$ API Claude 30D (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OWNER_RETIRED_CLAUDE_API` · Quyết định ngừng Claude API trước đây của chủ shop vẫn còn hiệu lực; rà lại catalog không tự mở lại. |
| 18 | `desc_a8a49620-8d65-40ff-aa3a-a437b0176b98` | 500M Token 30 Ngày (BH7D) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 19 | `desc_f4ffe12b-9e03-4a6d-b1c3-e1c5fdb826e9` | 500M Token 6 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 20 | `desc_be741cdd-b31d-4dd8-923e-5c2aa5d82043` | 500M Token 6 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 21 | `desc_96fc8c79-dbc9-44b9-aa8e-30927717bea6` | Mix 500M Token 6 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 22 | `desc_ef8303c6-c0bb-48dd-bc16-4be7b27847d6` | 500M Token 7 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 23 | `desc_bb971c4f-bffd-402a-b966-57cfae3493a9` | 50M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 24 | `desc_13fc4004-e7a0-48d4-b4f9-7c46727cc4cb` | 50M Token 1 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 25 | `desc_40491bde-0c8b-4ecc-967e-dd8dde92e5df` | 50M Token 2 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 26 | `desc_73bc45de-1976-4a3f-8224-172e5032cfa1` | 50M Token 2 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 27 | `desc_bf85530e-9d8c-4d7f-af2e-332751e69ffa` | 50M Token 2 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 28 | `desc_4eee68c0-8fcb-4a34-b235-d0e24b2a125b` | Mix 50M Token 2 Ngày (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 29 | `desc_bcd608e6-12a0-4c10-9099-ef8b540d5562` | AppleTV Link Active 1 Năm | CHỜ BỔ SUNG / GIỮ NGỪNG | `ACTIVATION_ELIGIBILITY_UNVERIFIED` · Chưa có điều kiện người nhận/kích hoạt của link, mã hoặc trial; tên gói và bảng giá trả phí không chứng minh link dùng được. |
| 30 | `desc_5b938bc3-944b-4706-9749-dbfca8eb7c64` | Autodesk Admin 3000 Invite | CHỜ BỔ SUNG / GIỮ NGỪNG | `LICENSE_UNVERIFIED` · Chưa rõ edition, loại tài khoản/giấy phép hoặc quyền quản trị thực tế được bàn giao; không kết luận rằng mọi hình thức bán lại đều bị cấm. |
| 31 | `desc_c993444d-3c1c-47b4-86ff-11448ae5eca1` | Autodesk All Apps 1 Năm | CHỜ BỔ SUNG / GIỮ NGỪNG | `LICENSE_UNVERIFIED` · Chưa rõ edition, loại tài khoản/giấy phép hoặc quyền quản trị thực tế được bàn giao; không kết luận rằng mọi hình thức bán lại đều bị cấm. |
| 32 | `desc_2e80f86f-35d1-48ad-9c7c-740c682fabb1` | Coursera + Udemy 12 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `BUNDLE_ENTITLEMENTS_UNVERIFIED` · Chưa rõ danh mục khóa học, tổ chức quản lý và quyền lợi của từng phần trong bundle; không hứa toàn bộ catalog của hai dịch vụ. |
| 33 | `desc_1cc0d7c4-3466-4911-be5b-147f517de0db` | Coursera + Udemy 6 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `BUNDLE_ENTITLEMENTS_UNVERIFIED` · Chưa rõ danh mục khóa học, tổ chức quản lý và quyền lợi của từng phần trong bundle; không hứa toàn bộ catalog của hai dịch vụ. |
| 34 | `desc_8e78d999-0e30-4e7c-a063-a2f82ce56d77` | ElevenLabs API 131K Credit | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 35 | `desc_ffad3c15-50f7-4188-9ccf-a32fd617b4c0` | ElevenLabs Free 10k Cre | CHỜ BỔ SUNG / GIỮ NGỪNG | `FREE_ACCOUNT_NOT_PAID_PLAN` · Nguồn ghi Free10k; chưa chứng minh có quyền lợi trả phí để đối chiếu. Không biến quota miễn phí thành gói chính hãng trả tiền. |
| 36 | `desc_5c360c8c-9de1-4058-b4ba-923db31d6e25` | Full Source AutoSpam | CHỜ BỔ SUNG / GIỮ NGỪNG | `SOURCE_LICENSE_UNVERIFIED` · Thiếu tác giả/phiên bản mã nguồn, phạm vi bàn giao và điều kiện cấp phép/hỗ trợ; chưa có sản phẩm chính thức tương ứng để định giá. |
| 37 | `desc_6fc42cff-1151-4d06-b9d9-e7c9bb17c77d` | Full Source Bot + AutoSpam | CHỜ BỔ SUNG / GIỮ NGỪNG | `SOURCE_LICENSE_UNVERIFIED` · Thiếu tác giả/phiên bản mã nguồn, phạm vi bàn giao và điều kiện cấp phép/hỗ trợ; chưa có sản phẩm chính thức tương ứng để định giá. |
| 38 | `desc_319fa051-c5f2-4435-9dde-59960ea851a2` | Full Source Bot Telegram | CHỜ BỔ SUNG / GIỮ NGỪNG | `SOURCE_LICENSE_UNVERIFIED` · Thiếu tác giả/phiên bản mã nguồn, phạm vi bàn giao và điều kiện cấp phép/hỗ trợ; chưa có sản phẩm chính thức tương ứng để định giá. |
| 39 | `desc_97943b81-e77c-42af-8297-c48cf6c9cdf7` | Gemini Pro Link 18 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `OWNER_RETIRED_GEMINI_18M` · Giữ quyết định ngừng Gemini link18 tháng trước đây; chưa có chỉ dẫn mở lại riêng SKU. |
| 40 | `desc_a310d757-157a-4114-95d3-4e0166335361` | Gmail 2k6-2k16 Qua Trial YT | CHỜ BỔ SUNG / GIỮ NGỪNG | `ACCOUNT_PROVISIONING_UNVERIFIED` · Chưa rõ cách cấp tài khoản, quyền kiểm soát, điều kiện sử dụng và thời hạn; không coi tên tài khoản hoặc trial cũ là gói thuê bao. |
| 41 | `desc_de8b93da-9e97-4710-b8f8-22d4ec965b91` | Gmail Trâu Qua YT Ver Số | CHỜ BỔ SUNG / GIỮ NGỪNG | `ACCOUNT_PROVISIONING_UNVERIFIED` · Chưa rõ cách cấp tài khoản, quyền kiểm soát, điều kiện sử dụng và thời hạn; không coi tên tài khoản hoặc trial cũ là gói thuê bao. |
| 42 | `desc_391434d2-69c1-479d-8170-a60352dc33be` | Google Ultra Admin 20x 1y | CHỜ BỔ SUNG / GIỮ NGỪNG | `LICENSE_UNVERIFIED` · Chưa rõ edition, loại tài khoản/giấy phép hoặc quyền quản trị thực tế được bàn giao; không kết luận rằng mọi hình thức bán lại đều bị cấm. |
| 43 | `desc_68ae0ca6-596d-4dc7-9c9c-6e32b983a60c` | Grok Plus 1 Tháng (KBH) | DUYỆT CHÍNH SÁCH · trần 206.320đ | `x_plus_month_us` · giá/tồn kho live vẫn phải đạt guard |
| 44 | `desc_7c96ab6a-184b-4ea6-b9b1-821a253e8b13` | Grok Plus 12 Tháng (BH1T) | DUYỆT CHÍNH SÁCH · trần 2.063.200đ | `x_plus_year_us` · giá/tồn kho live vẫn phải đạt guard |
| 45 | `desc_a2c215b0-1b30-455a-91f7-b7f9f6027f27` | Grok Super 1 Tháng (BH7D) | DUYỆT CHÍNH SÁCH · trần 773.700đ | `x_premium_month_us` · giá/tồn kho live vẫn phải đạt guard |
| 46 | `desc_4154d58a-5a6c-4212-871c-cefc80cd3e9d` | Grok Super CDK 1T (BHF) | DUYỆT CHÍNH SÁCH · trần 773.700đ | `x_premium_month_us` · giá/tồn kho live vẫn phải đạt guard |
| 47 | `desc_e83df1d3-c1ad-4208-84a3-50de267d9372` | Grok Super CDK 3T (BHF) | DUYỆT CHÍNH SÁCH · trần 2.321.100đ | `x_premium_three_month_shop_comparison` · giá/tồn kho live vẫn phải đạt guard |
| 48 | `desc_81154520-794e-4b0d-8844-63cc18cead5a` | Grok Ultra 1 Tháng (BH2D) | DUYỆT CHÍNH SÁCH · trần 5.158.000đ | `x_ultra_month_us` · giá/tồn kho live vẫn phải đạt guard |
| 49 | `desc_a6d82ced-7a73-4c01-abc2-f4b17f104174` | Grok+Cursor Pre 14 Ngày | CHỜ BỔ SUNG / GIỮ NGỪNG | `PLAN_IDENTITY_UNVERIFIED` · Chưa xác định đủ tier/cấu hình/hình thức nhận và thời hạn. Grok+Cursor 14 ngày có type product/nameEn nhưng chưa đủ điều kiện bundle; iCloud400GB/Office365Plus/Proxy không tự ánh xạ sang gói khác. |
| 50 | `desc_91ec1cc0-fa95-4c45-b9ba-b91ed7a7266f` | iCloud 400GB Chính Chủ 12T | CHỜ BỔ SUNG / GIỮ NGỪNG | `PLAN_IDENTITY_UNVERIFIED` · Chưa xác định đủ tier/cấu hình/hình thức nhận và thời hạn. Grok+Cursor14 ngày tạm chờ loại hàng/nameEn live để xác định bundle; iCloud400GB/Office365Plus/Proxy không tự ánh xạ sang gói khác. |
| 51 | `desc_c98339b6-d93f-4dd4-8f78-6c2bac329866` | MS Office 365 Plus 1 Năm | CHỜ BỔ SUNG / GIỮ NGỪNG | `PLAN_IDENTITY_UNVERIFIED` · Chưa xác định đủ tier/cấu hình/hình thức nhận và thời hạn. Grok+Cursor14 ngày tạm chờ loại hàng/nameEn live để xác định bundle; iCloud400GB/Office365Plus/Proxy không tự ánh xạ sang gói khác. |
| 52 | `desc_b9bf47ce-f60e-4fcc-9db2-1a48e035a441` | Muse- Acc 1 Tỷ Token (KBH) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 53 | `desc_11d5933d-30e6-411f-afa8-d97020f5ae45` | Muse- Acc 31 Tỷ Token (KBH) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 54 | `desc_f8903574-9797-4a84-842b-24937f7e717a` | NortonVPN Ultimate 7D (BHF) | DUYỆT CHÍNH SÁCH · trần 64.293đ | `norton_ultimate_7days_shop_comparison` · giá/tồn kho live vẫn phải đạt guard |
| 55 | `desc_2f17b9be-d791-4b33-b834-caa66f154067` | Perplexity CDK Max (KBH) | CHỜ BỔ SUNG / GIỮ NGỪNG | `ACTIVATION_ELIGIBILITY_UNVERIFIED` · Chưa có điều kiện người nhận/kích hoạt của link, mã hoặc trial; tên gói và bảng giá trả phí không chứng minh link dùng được. |
| 56 | `desc_9476530e-e339-4025-9eba-56a94934635d` | Prime Video 6 Tháng | DUYỆT CHÍNH SÁCH · trần 1.391.112đ | `primevideo_sixmonths_shop_comparison` · giá/tồn kho live vẫn phải đạt guard |
| 57 | `desc_0a23be32-7f10-482b-810b-a8be84c07d1c` | Proxy Xoay Premium | CHỜ BỔ SUNG / GIỮ NGỪNG | `PLAN_IDENTITY_UNVERIFIED` · Chưa xác định đủ tier/cấu hình/hình thức nhận và thời hạn. Grok+Cursor14 ngày tạm chờ loại hàng/nameEn live để xác định bundle; iCloud400GB/Office365Plus/Proxy không tự ánh xạ sang gói khác. |
| 58 | `desc_97c249ed-fc43-4b7f-ac74-74281511d5fa` | Redeem 1M Credits (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 59 | `desc_0ffbcb7d-6063-4d69-986f-133e02984d67` | Redeem 300k Credits (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 60 | `desc_e2616537-473f-4645-81fb-ecfee99bd8bd` | Redeem 3M Credits (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 61 | `desc_6ee7b7f8-3d76-4f19-a406-52923b5d9466` | Redeem 7M Credits (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `OPAQUE_TOKEN_PLAN` · Thiếu định danh dịch vụ/model, cách tính token/credit, hạn mức và nội dung bàn giao; không quy đổi thành API credit chính hãng. |
| 62 | `desc_cac91c75-6ffd-4e16-b965-89b22860f767` | SCRIBD Trial 1 Tháng (BHF) | CHỜ BỔ SUNG / GIỮ NGỪNG | `ACTIVATION_ELIGIBILITY_UNVERIFIED` · Chưa có điều kiện người nhận/kích hoạt của link, mã hoặc trial; tên gói và bảng giá trả phí không chứng minh link dùng được. |
| 63 | `desc_561aadb7-f4f9-4cf9-9abb-0d496deddb44` | Spotify Pre Link 3 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `OWNER_RETIRED_SPOTIFY_3M` · Giữ quyết định ngừng Spotify link3 tháng trước đây; chưa có chỉ dẫn mở lại riêng SKU. |
| 64 | `desc_f9bbf6bc-9d80-405f-90b1-c5fb6e622b96` | Super Duolingo Link 1 Năm | CHỜ BỔ SUNG / GIỮ NGỪNG | `ACTIVATION_ELIGIBILITY_UNVERIFIED` · Chưa có điều kiện người nhận/kích hoạt của link, mã hoặc trial; tên gói và bảng giá trả phí không chứng minh link dùng được. |
| 65 | `desc_4e63d5ac-b3d4-425e-8a0d-48c34bd42da7` | Super Duolingo Slot 1 Năm | CHỜ BỔ SUNG / GIỮ NGỪNG | `SHARED_SLOT_TERMS_UNVERIFIED` · Duolingo xác nhận family có sáu tài khoản và cho phép nhóm bất kỳ; chưa xác định giá/chu kỳ seat và điều kiện quản lý của slot nguồn, không viện cớ bắt buộc cùng hộ gia đình. |
| 66 | `desc_d85f4ecb-e00f-4718-99bd-2eb18606902a` | Super Grok 14 Ngày (BH24H) | DUYỆT CHÍNH SÁCH · trần 361.060đ | `x_premium_14days_shop_comparison` · giá/tồn kho live vẫn phải đạt guard |
| 67 | `desc_a6081eef-4730-4e2d-8705-e0f1ce5adba4` | Super Grok 7 Ngày (BHF) | DUYỆT CHÍNH SÁCH · trần 180.530đ | `x_premium_7days_shop_comparison` · giá/tồn kho live vẫn phải đạt guard |
| 68 | `desc_6c849352-0ebf-4319-bd02-4fa09d2b525c` | Udemy + Coursera 12 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `BUNDLE_ENTITLEMENTS_UNVERIFIED` · Chưa rõ danh mục khóa học, tổ chức quản lý và quyền lợi của từng phần trong bundle; không hứa toàn bộ catalog của hai dịch vụ. |
| 69 | `desc_2bb88755-933e-48d8-93d0-6c79f5a6b68b` | Udemy + Coursera 6 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `BUNDLE_ENTITLEMENTS_UNVERIFIED` · Chưa rõ danh mục khóa học, tổ chức quản lý và quyền lợi của từng phần trong bundle; không hứa toàn bộ catalog của hai dịch vụ. |
| 70 | `desc_e0e495ed-1da8-404e-9e32-bc3058f65dca` | Wispr Flow Edu 12 Tháng | CHỜ BỔ SUNG / GIỮ NGỪNG | `EDUCATION_ELIGIBILITY_UNVERIFIED` · Nhãn Edu cần điều kiện người học/tài khoản nhận rõ trước thanh toán; không gán gói giáo dục cho mọi khách. |

## Đối chiếu metadata live

Audit `DOPERMIND-CATALOG-REVIEW-20261114-1` có 72 dòng sản phẩm bị loại hoặc mới. Tất cả đã được đối chiếu riêng; toàn manifest có 103 khóa không trùng nhau. Có 5 nhãn token đổi tên: một dòng 100M đổi từ 3 sang 4 ngày và bốn dòng thêm tiền tố Mix. Tên/thời hạn được cập nhật theo nguồn nhưng cả 5 vẫn đóng vì không rõ dịch vụ/model/quyền lợi. NameEn của các gói còn lại không bổ sung điều kiện kích hoạt; type product chỉ mô tả loại hàng trong API, không phải xác nhận cấp phép.

Chưa có hành động mua trả phí, gửi Discord hoặc deploy từ lần rà này. Tính giá/tồn kho live sau cập nhật manifest vẫn cần để phân biệt đã duyệt chính sách, đạt giá, còn hàng và đang hiển thị.
