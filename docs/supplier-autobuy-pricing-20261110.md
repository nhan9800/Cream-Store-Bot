# Chính sách giá Dopermind Autobuy · 10/11/2026

DONE — đã rà 101 khóa sản phẩm riêng biệt; đây là chính sách định giá, không phải bằng chứng mua/giao hàng trả phí.

31/101 SKU đủ điều kiện giá/điều khoản cho phép bán khi có tồn kho; 24 trong số đó có tồn kho ở snapshot riêng tư. Tồn kho thực tế phải đọc lại trước báo giá và mua.

## Công thức và mức lời

Giá bán = làm tròn lên 1.000đ của `(giá nguồn + mức lời + dự phòng xử lý) / 0,97`. Khoản 3% là dự phòng kinh doanh do shop đặt, không phải tuyên bố nhà thanh toán thu phí 3%. Lợi nhuận ròng sau cả hai dự phòng phải ít nhất 20.000đ; không bán bằng cách hy sinh mức lời tối thiểu để lọt trần giá.

| Bậc giá nguồn nội bộ | Mức lời | Dự phòng xử lý |
| --- | ---: | ---: |
| ≤50.000đ | 20.000đ | 3.000đ |
| ≤150.000đ | 30.000đ | 5.000đ |
| ≤300.000đ | 50.000đ | 10.000đ |
| ≤600.000đ | 100.000đ | 15.000đ |
| ≤1.000.000đ | 150.000đ | 25.000đ |
| >1.000.000đ | 250.000đ | lớn hơn giữa 50.000đ và 2,5% giá nguồn, làm tròn lên 1.000đ |

Mỗi SKU đã duyệt được cố định mức lời/dự phòng trong manifest; biến động giá nguồn làm báo giá thay đổi nhưng không tự đổi phân hạng hoặc mở một SKU chưa duyệt. Nếu cần đổi bậc khi giá nhập biến động lớn phải rà lại chính sách. Giới hạn chính thức là trần đóng bán: giá phải **nhỏ hơn** trần, không làm tròn trần lên để lách kiểm tra. Mốc tham chiếu hết hạn sau 30 ngày; phải kiểm tra lại trước khi tiếp tục mở bán.

## Ý nghĩa so sánh và điều khoản

Toàn bộ nguồn đối chiếu là `BENCHMARK`: chưa có bằng chứng rằng SKU nguồn trùng hình thức tài khoản, vùng, quyền lợi, điều kiện thanh toán và kỳ hạn với gói bán trực tiếp. Không gạch giá chính hãng thành giá gốc của cùng SKU, không tính phần trăm giảm và không gọi tài khoản được cấp là nâng cấp chính chủ. Mốc một tháng so với nguồn 3/7 ngày hoặc 2/3/6 tháng được ghi rõ khác kỳ hạn; không bịa giá chính hãng theo ngày bằng phép chia. Surfshark dùng toàn kỳ 27 tháng hiển thị công khai, không gọi 67,23 USD là giá tháng hoặc 7 ngày.

BHF chỉ được trích từ nhãn nguồn; BH2T/BH7D/BH24H được giữ đúng thời gian; KBH là không bảo hành. Tên không ghi BH được hiển thị không có cam kết BHF. Nhãn này không tự tạo điều kiện hoàn tiền hay quyền lợi chưa công bố. Proton 14–28 ngày chỉ dùng thời hạn tối thiểu 14 ngày trong xử lý hết hạn; không hứa đủ 28 ngày. Các gói trial/free/Edu không được mở chỉ nhờ tên nhà cung cấp.

Giá nguồn, lợi nhuận, số dư và khóa API không xuất ra kênh khách. File JSON này giữ tham số tính giá và nguồn công khai; dữ liệu giá nhập snapshot nằm ngoài repo.

## Tỷ giá và nguồn chính thức

Tỷ giá bán [Vietcombank XML](https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx) lúc 23:11:09 ngày 10/11/2026: USD 25.790đ; EUR 29.506,30đ. XML được liên kết từ [trang tỷ giá Vietcombank](https://www.vietcombank.com.vn/vi-VN/KHCN/Cong-cu-Tien-ich/Ty-gia). Đây là quy đổi cố định của lần rà này, chưa gồm thuế, phí thẻ hoặc chênh lệch checkout.

| Mã | Giá/chu kỳ đã đọc | Khu vực và giới hạn | Nguồn |
| --- | --- | --- | --- |
| `capcut_pro_month` | 19.99 USD / 1 tháng | Trang giá USD; khu vực thanh toán có thể khác Việt Nam. 19,99 USD/tháng; bảng giá chỉ tham khảo theo khu vực. Gói nguồn 7 ngày/3 tháng/6 tháng có kỳ hạn khác; không suy ra giá chính hãng theo ngày. | [CapCut Pro monthly](https://www.capcut.com/pricing) |
| `capcut_pro_year` | 179.99 USD / 12 tháng | Trang giá USD; khu vực thanh toán có thể khác Việt Nam. 179,99 USD/năm. Hình thức cấp tài khoản và quyền sở hữu của nguồn chưa được xác nhận tương đương mua trực tiếp. | [CapCut Pro annual](https://www.capcut.com/pricing) |
| `chatgpt_plus_month` | 20 USD / 1 tháng | Giá niêm yết USD của OpenAI; chưa gồm chênh lệch thuế/khu vực. Giá gói cá nhân mua trực tiếp là mốc tham chiếu. Hàng cấp Acc/GGPay từ nguồn không được quảng cáo là cùng hình thức sở hữu hay cùng điều kiện mua trực tiếp; không bao gồm API credit. | [ChatGPT Plus monthly](https://learn.chatgpt.com/docs/pricing) |
| `chatgpt_pro100_month` | 100 USD / 1 tháng | Giá niêm yết USD của OpenAI; chưa gồm chênh lệch thuế/khu vực. Giá gói cá nhân mua trực tiếp là mốc tham chiếu. Hàng cấp Acc/GGPay từ nguồn không được quảng cáo là cùng hình thức sở hữu hay cùng điều kiện mua trực tiếp; không bao gồm API credit. | [ChatGPT Pro 100 monthly](https://learn.chatgpt.com/docs/pricing) |
| `chatgpt_pro200_month` | 200 USD / 1 tháng | Giá niêm yết USD của OpenAI; chưa gồm chênh lệch thuế/khu vực. Giá gói cá nhân mua trực tiếp là mốc tham chiếu. Hàng cấp Acc/GGPay từ nguồn không được quảng cáo là cùng hình thức sở hữu hay cùng điều kiện mua trực tiếp; không bao gồm API credit. | [ChatGPT Pro 200 monthly](https://learn.chatgpt.com/docs/pricing) |
| `adobe_cc_pro_monthly_fee_annual` | 69.99 USD / 1 tháng | Bắc Mỹ, hợp đồng năm trả theo tháng. Adobe nêu phí chuẩn 69,99 USD/tháng trong ví dụ hợp đồng năm. Đây không phải gói độc lập 4 tháng; nguồn All Apps chưa xác định loại tài khoản, danh sách app hay AI credit tương đương Creative Cloud Pro. | [Creative Cloud Pro standard monthly fee under annual contract](https://helpx.adobe.com/account/individual/terms-policies-and-regulations/adobe-subscription-terms.html) |
| `adobe_express_year_ios_vn` | 1,299,000 VND / 12 tháng | App Store Việt Nam; nhà phát hành Adobe. Danh sách IAP có nhiều biến thể Yearly 1.299.000đ/2.299.000đ và Premium Annual 2.499.000đ. Dùng mức Yearly thấp nhất 1.299.000đ làm trần tham chiếu thận trọng; không khẳng định gói nguồn có cùng quyền lợi Premium. | [Adobe Express yearly — publisher App Store Vietnam](https://apps.apple.com/vn/app/adobe-express-create-anything/id1051937863) |
| `zoom_pro_month` | 16.99 USD / 1 tháng | USD, mỗi người dùng, trả tháng. 16,99 USD/người dùng/tháng. Acc nguồn 2/3/6 tháng khác hình thức mua trực tiếp một seat và khác kỳ hạn mốc một tháng; không đổi thành giá chính hãng 2/3/6 tháng. | [Zoom Workplace Pro monthly](https://zoom.us/pricing) |
| `zoom_pro_year` | 169.92 USD / 12 tháng | USD, mỗi người dùng, trả năm. Trang hiển thị 14,16 USD/người dùng/tháng khi trả năm. 169,92 USD là phép nhân 14,16×12 từ số đã làm tròn trên trang, không phải cam kết số tiền checkout năm chính xác. Acc cấp từ nguồn có thể khác seat mua trực tiếp. | [Zoom Workplace Pro annual equivalent](https://zoom.us/pricing) |
| `ilovepdf_premium_year` | 60 USD / 12 tháng | Trang niêm yết USD. 5 USD/tháng, 60 USD thanh toán theo năm. Nguồn ghi KBH và chưa xác định hình thức tài khoản; không suy ra cùng quyền sở hữu với đăng ký trực tiếp. | [iLovePDF Premium annual](https://www.ilovepdf.com/pricing) |
| `spotify_individual_month_vn` | 65,000 VND / 1 tháng | Việt Nam, Individual. 65.000đ/tháng là mức thường; không dùng ưu đãi người mới 2 tháng để tạo giá so sánh. Nguồn cấp Acc, chưa xác định thị trường/khả năng đổi thông tin nên chỉ dùng làm benchmark, không phải cùng hàng chính chủ. | [Spotify Premium Individual regular monthly Vietnam](https://www.spotify.com/vn-vi/premium/) |
| `nordvpn_basic_month` | 14.99 USD / 1 tháng | USD, trả tháng. Basic trả tháng 14,99 USD. Nguồn không ghi cấp Basic/Plus/Complete; 3 ngày và 3 tháng khác kỳ hạn mốc. Không cam kết mọi quyền lợi của Basic hay giá ngày prorate từ nguồn này. | [NordVPN Basic monthly](https://nordvpn.com/pricing/) |
| `expressvpn_week_ios_us` | 9.99 USD / 7 ngày | App Store Mỹ; nhà phát hành Express VPN. IAP chính thức 1-Week Subscription 9,99 USD. Hàng nguồn chỉ 3 ngày, chưa xác định account form/tier; không trình bày đây là giá chính hãng 3 ngày. | [ExpressVPN 1-week publisher subscription](https://apps.apple.com/us/app/expressvpn-secure-fast-vpn/id886492891) |
| `ipvanish_week_ios_us` | 4.99 USD / 7 ngày | App Store Mỹ; nhà phát hành IPVanish. IAP chính thức 1 Week Subscription 4,99 USD. Kỳ hạn 7 ngày khớp tên nguồn nhưng hình thức truy cập, thị trường và quyền sở hữu chưa được xác nhận tương đương. | [IPVanish 1-week publisher subscription](https://apps.apple.com/us/app/ipvanish-vpn-fast-secure/id763638165) |
| `adguard_month_ios_us` | 5.99 USD / 1 tháng | App Store Mỹ; nhà phát hành Adguard Software Limited. IAP có mức 12,99 và 5,99 USD/1 tháng. Dùng mức thấp hơn 5,99 USD làm trần benchmark; hàng nguồn 7 ngày khác thời hạn, không gắn với trial miễn phí hay cam kết cùng quyền sở hữu. | [AdGuard VPN monthly publisher subscription — lower listed variant](https://apps.apple.com/us/app/adguard-vpn-free-your-privacy/id1525373602?platform=vision) |
| `hma_month` | 11.99 USD / 1 tháng | Trang niêm yết USD, trả một tháng. Trang chính thức hiển thị 1 month plan 11,99 USD billed at once. Nguồn ghi 30 ngày BHF; hình thức và số thiết bị chưa xác minh nên chỉ benchmark. | [HMA VPN regular one-month plan](https://www.hidemyass.com/index) |
| `hotspotshield_month` | 12.99 USD / 1 tháng | Trang niêm yết USD, tự gia hạn tháng. 12,99 USD/tháng trong thông tin gia hạn. Hàng nguồn 7 ngày khác kỳ hạn; không chuyển giá này thành một gói 7 ngày chính hãng. | [Hotspot Shield monthly auto-renewing subscription](https://www.hotspotshield.com/thankyou) |
| `pia_month` | 11.95 USD / 1 tháng | Trang niêm yết USD, trả tháng. 1 month 11,95 USD. Hàng nguồn 7 ngày khác kỳ hạn, hình thức bàn giao chưa được xác nhận cùng tài khoản riêng. | [Private Internet Access one-month subscription](https://www.privateinternetaccess.com/buy-vpn-online) |
| `purevpn_month` | 12.95 USD / 1 tháng | Trang niêm yết USD; mức thường tháng. Trang hiển thị 12,95 USD/tháng cạnh ưu đãi trả dài hạn. Không lấy giá 1,49 USD/tháng của cam kết dài hạn làm giá trả một tháng. Hàng nguồn 7 ngày khác kỳ hạn và hình thức. | [PureVPN regular monthly price](https://www.purevpn.com/) |
| `surfshark_one_intro_27months` | 67.23 USD / 27 tháng | USD, ưu đãi kỳ đầu 27 tháng. One 2,49 USD/tháng, thu 67,23 USD cho 27 tháng đầu. Đây là tổng kỳ trả dài hạn, không phải giá 1 tháng hay 7 ngày. Hàng nguồn 7 ngày chỉ dùng mốc này làm tham chiếu thị trường, không được hiển thị là giá gốc của cùng SKU. | [Surfshark One introductory 27-month billing period](https://surfshark.com/pricing) |
| `protonvpn_plus_month` | 9.99 USD / 1 tháng | USD, billing=1. Trang signup chính thức được lập chỉ mục với VPN Plus 9,99 USD/tháng; trang pricing cũng hiển thị mức thường 9,99 USD trước ưu đãi 24 tháng. Nguồn ghi 14–28 ngày; chỉ cam kết tối thiểu 14 ngày theo tên nguồn, không hứa đủ 28 ngày. | [Proton VPN Plus monthly signup](https://account.protonvpn.com/signup?billing=1&coupon=VPNPLUSINTRO&plan=vpn2024) |
| `notion_business_eu_month_unit` | 19.5 EUR / 1 tháng | European Union, EUR; màn hình mặc định có tùy chọn trả năm/tháng. Business hiển thị 19,50 EUR/member/month. Chu kỳ cam kết của màn hình SSR không xác định nên không gọi đây là gói tháng độc lập. Link 3 tháng từ nguồn khác seat mua trực tiếp; không cam kết đủ mọi tính năng AI chỉ từ tên sản phẩm. | [Notion Business EU per-member monthly display](https://www.notion.com/pricing) |
| `perplexity_pro_month` | 20 USD / 1 tháng | Trang FAQ niêm yết USD. FAQ chính thức nêu Pro 20 USD/tháng hoặc 200 USD/năm. Nguồn 1 tháng chưa xác định cách cấp/tài khoản; chỉ là mốc tham chiếu, không khẳng định cùng điều kiện mua trực tiếp. | [Perplexity Pro monthly FAQ](https://www.perplexity.ai/hub) |

## Quyết định từng SKU

Giá dưới đây là ví dụ theo snapshot, chỉ có giá bán; báo giá live được tính lại từ kho và có thể đóng khi nguồn đổi tên/giá/tồn kho. Trạng thái ĐỦ ĐIỀU KIỆN không bảo đảm hiện còn hàng. Cùng tên nhưng khác khóa vẫn là quyết định riêng.

| # | Khóa SKU | Tên nguồn | Quyết định | Giá bán minh họa | Tham chiếu / lý do |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `desc_bb1eb346-b99a-460f-bab3-029c2241f5f0` | 100$ API Claude 30D (BHF) | ĐÓNG | — | `OWNER_RETIRED_CLAUDE_API` — Chủ shop đã yêu cầu ngừng toàn bộ Claude API/Gateway; yêu cầu autobuy hiện tại không mở lại sản phẩm này. |
| 2 | `desc_8b19f48b-1594-49ac-8a55-b44ac7945f70` | 100M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 3 | `desc_2b112db7-e852-41a0-8593-d674f3bf1efa` | 100M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 4 | `desc_8052c21b-11e9-45a8-80bf-6b11ee48a017` | 100M Token 3 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 5 | `desc_decb8e3a-7dea-4e21-abd7-f2e71beb9d8b` | 100M Token 3 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 6 | `desc_2f38f0dd-bb7f-46b5-92e9-1727b1264585` | 100M Token 3 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 7 | `desc_596db8ad-76ab-4456-b90e-db25f7d41a2f` | 100M Token 3 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 8 | `desc_306ad185-c078-4275-abcf-9e6263b97fa6` | 100M Token 3 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 9 | `desc_5b40fe21-6fc3-487b-9c6a-d128d038ee5b` | 10M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 10 | `desc_2409d6d3-859f-4e9d-96dd-cb6fad27e245` | 10M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 11 | `desc_732c3336-332b-42a6-8b1e-950d0abefedf` | 10M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 12 | `desc_ebc791bf-2b70-44f5-b287-485827760cc3` | 10M Token 1 Ngày (BHF)- | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 13 | `desc_d113cff2-ce76-425a-9ef0-437dadf4a0bb` | 10M Token 1 Ngày (BHF)- | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 14 | `desc_7bfb6258-b28c-458f-bf4d-2454397c8665` | 200M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 15 | `desc_df5baa07-e137-4692-9ecb-7751b4c09600` | 200M Token 7 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 16 | `desc_23072ad8-9549-4847-aa57-81cb91b4bdee` | 300M Token 15 Ngày (BH7D) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 17 | `desc_f4f41af5-c6b5-4530-b6f9-01729804778c` | 500$ API Claude 30D (BHF) | ĐÓNG | — | `OWNER_RETIRED_CLAUDE_API` — Chủ shop đã yêu cầu ngừng toàn bộ Claude API/Gateway; yêu cầu autobuy hiện tại không mở lại sản phẩm này. |
| 18 | `desc_a8a49620-8d65-40ff-aa3a-a437b0176b98` | 500M Token 30 Ngày (BH7D) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 19 | `desc_f4ffe12b-9e03-4a6d-b1c3-e1c5fdb826e9` | 500M Token 6 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 20 | `desc_be741cdd-b31d-4dd8-923e-5c2aa5d82043` | 500M Token 6 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 21 | `desc_96fc8c79-dbc9-44b9-aa8e-30927717bea6` | 500M Token 6 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 22 | `desc_ef8303c6-c0bb-48dd-bc16-4be7b27847d6` | 500M Token 7 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 23 | `desc_bb971c4f-bffd-402a-b966-57cfae3493a9` | 50M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 24 | `desc_13fc4004-e7a0-48d4-b4f9-7c46727cc4cb` | 50M Token 1 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 25 | `desc_40491bde-0c8b-4ecc-967e-dd8dde92e5df` | 50M Token 2 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 26 | `desc_73bc45de-1976-4a3f-8224-172e5032cfa1` | 50M Token 2 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 27 | `desc_bf85530e-9d8c-4d7f-af2e-332751e69ffa` | 50M Token 2 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 28 | `desc_4eee68c0-8fcb-4a34-b235-d0e24b2a125b` | 50M Token 2 Ngày (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 29 | `desc_9bf3d8ee-5ec2-44de-b5c1-df46c2340377` | Adguard VPN 7 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 48,000đ | `adguard_month_ios_us`; 7 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 30 | `desc_385c0479-6c33-4800-81dc-a9b5bcd9f222` | Adobe All Apps 4T (BH2T) | ĐỦ ĐIỀU KIỆN | 820,000đ | `adobe_cc_pro_monthly_fee_annual`; 4 tháng; Bảo hành 2 tháng theo công bố nguồn. |
| 31 | `desc_7cfc3be2-f48c-43b2-a017-14111595906f` | Adobe All Apps 4T (BHF) | ĐỦ ĐIỀU KIỆN | 1,068,000đ | `adobe_cc_pro_monthly_fee_annual`; 4 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 32 | `desc_d6c7148e-1ac7-4339-947e-f24728564f0c` | Adobe Express 12 Tháng | ĐỦ ĐIỀU KIỆN | 50,000đ | `adobe_express_year_ios_vn`; 12 tháng; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 33 | `desc_bcd608e6-12a0-4c10-9099-ef8b540d5562` | AppleTV Link Active 1 Năm | ĐÓNG | — | `ACTIVATION_ELIGIBILITY_UNVERIFIED` — Link/CDK chưa công bố điều kiện người nhận, loại quyền lợi hoặc thời hạn chắc chắn; không suy ra từ tên hàng. |
| 34 | `desc_5b938bc3-944b-4706-9749-dbfca8eb7c64` | Autodesk Admin 3000 Invite | ĐÓNG | — | `LICENSE_UNVERIFIED` — Tên Admin/All Apps chưa xác định giấy phép cá nhân, giáo dục hay tổ chức và quyền chuyển nhượng hợp lệ. |
| 35 | `desc_c993444d-3c1c-47b4-86ff-11448ae5eca1` | Autodesk All Apps 1 Năm | ĐÓNG | — | `LICENSE_UNVERIFIED` — Tên Admin/All Apps chưa xác định giấy phép cá nhân, giáo dục hay tổ chức và quyền chuyển nhượng hợp lệ. |
| 36 | `desc_8386c2db-d7e6-4eeb-88c4-376dcc8cae03` | Capcut Pro 1 Năm (BHF) | ĐỦ ĐIỀU KIỆN | 903,000đ | `capcut_pro_year`; 12 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 37 | `desc_98a08e99-a3c2-4a55-8703-13582d78aa47` | Capcut Pro 3 Tháng (BHF) | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 176,000đ | `capcut_pro_month`; 3 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 38 | `desc_231c4979-1634-485a-86d4-39af57b59547` | Capcut Pro 30 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 61,000đ | `capcut_pro_month`; 30 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 39 | `desc_52e250be-d5c5-4f46-a211-d41415d90fd8` | Capcut Pro 6 Tháng (BHF) | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 464,000đ | `capcut_pro_month`; 6 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 40 | `desc_3d272a1f-2c66-49be-93bb-8d3e45986368` | Capcut Pro 7 Ngày (BHF) | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 35,000đ | `capcut_pro_month`; 7 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 41 | `desc_b5d6f7df-fecf-4a54-988e-924f16759523` | ChatGPT Plus Acc 1T (BHF) | ĐỦ ĐIỀU KIỆN | 258,000đ | `chatgpt_plus_month`; 1 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 42 | `desc_a79c65ce-0a94-4129-af16-ab41d3d1e345` | ChatGPT Plus GGPay 1 Tháng | ĐỦ ĐIỀU KIỆN | 171,000đ | `chatgpt_plus_month`; 1 tháng; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 43 | `desc_2e80f86f-35d1-48ad-9c7c-740c682fabb1` | Coursera + Udemy 12 Tháng | ĐÓNG | — | `BUNDLE_ENTITLEMENTS_UNVERIFIED` — Gói ghép Coursera/Udemy chưa công bố loại quyền truy cập mỗi dịch vụ, hình thức tài khoản và điều khoản đủ để mua tự động. |
| 44 | `desc_1cc0d7c4-3466-4911-be5b-147f517de0db` | Coursera + Udemy 6 Tháng | ĐÓNG | — | `BUNDLE_ENTITLEMENTS_UNVERIFIED` — Gói ghép Coursera/Udemy chưa công bố loại quyền truy cập mỗi dịch vụ, hình thức tài khoản và điều khoản đủ để mua tự động. |
| 45 | `desc_8e78d999-0e30-4e7c-a063-a2f82ce56d77` | ElevenLabs API 131K Credit | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 46 | `desc_ffad3c15-50f7-4188-9ccf-a32fd617b4c0` | ElevenLabs Free 10k Cre | ĐÓNG | — | `FREE_ACCOUNT_NOT_PAID_PLAN` — Nguồn ghi Free; không bán như một gói thuê bao trả phí khi chưa rõ quyền lợi trả phí. |
| 47 | `desc_715313de-785d-4e41-b65a-536fef2040b4` | Express VPN 3 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 38,000đ | `expressvpn_week_ios_us`; 3 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 48 | `desc_5c360c8c-9de1-4058-b4ba-923db31d6e25` | Full Source AutoSpam | ĐÓNG | — | `SOURCE_LICENSE_UNVERIFIED` — Chưa xác minh giấy phép phân phối, nội dung bàn giao và phạm vi hỗ trợ source; không tự mở bán mã tự động spam. |
| 49 | `desc_6fc42cff-1151-4d06-b9d9-e7c9bb17c77d` | Full Source Bot + AutoSpam | ĐÓNG | — | `SOURCE_LICENSE_UNVERIFIED` — Chưa xác minh giấy phép phân phối, nội dung bàn giao và phạm vi hỗ trợ source; không tự mở bán mã tự động spam. |
| 50 | `desc_319fa051-c5f2-4435-9dde-59960ea851a2` | Full Source Bot Telegram | ĐÓNG | — | `SOURCE_LICENSE_UNVERIFIED` — Chưa xác minh giấy phép phân phối, nội dung bàn giao và phạm vi hỗ trợ source; không tự mở bán mã tự động spam. |
| 51 | `desc_97943b81-e77c-42af-8297-c48cf6c9cdf7` | Gemini Pro Link 18 Tháng | ĐÓNG | — | `OWNER_RETIRED_GEMINI_18M` — Gemini 18 tháng đã được chủ shop loại khỏi danh mục; không tự mở lại qua nguồn autobuy. |
| 52 | `desc_a310d757-157a-4114-95d3-4e0166335361` | Gmail 2k6-2k16 Qua Trial YT | ĐÓNG | — | `ACCOUNT_PROVISIONING_UNVERIFIED` — Hàng Gmail/tài khoản dùng thử chưa có quyền sở hữu, nguồn gốc hoặc điều kiện sử dụng được xác nhận. |
| 53 | `desc_de8b93da-9e97-4710-b8f8-22d4ec965b91` | Gmail Trâu Qua YT Ver Số | ĐÓNG | — | `ACCOUNT_PROVISIONING_UNVERIFIED` — Hàng Gmail/tài khoản dùng thử chưa có quyền sở hữu, nguồn gốc hoặc điều kiện sử dụng được xác nhận. |
| 54 | `desc_391434d2-69c1-479d-8170-a60352dc33be` | Google Ultra Admin 20x 1y | ĐÓNG | — | `LICENSE_UNVERIFIED` — Tên Admin/All Apps chưa xác định giấy phép cá nhân, giáo dục hay tổ chức và quyền chuyển nhượng hợp lệ. |
| 55 | `desc_46fce8b1-ad63-431f-bf4c-803f23889db2` | GPT Pro 100 Acc 1T (BHF) | ĐỦ ĐIỀU KIỆN | 2,372,000đ | `chatgpt_pro100_month`; 1 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 56 | `desc_3da5b189-fb5a-407d-8a48-c3da7924fbbc` | GPT Pro 200 Acc 1T (BHF) | ĐỦ ĐIỀU KIỆN | 4,485,000đ | `chatgpt_pro200_month`; 1 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 57 | `desc_68ae0ca6-596d-4dc7-9c9c-6e32b983a60c` | Grok Plus 1 Tháng (KBH) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 58 | `desc_7c96ab6a-184b-4ea6-b9b1-821a253e8b13` | Grok Plus 12 Tháng (BH1T) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 59 | `desc_a2c215b0-1b30-455a-91f7-b7f9f6027f27` | Grok Super 1 Tháng (BH7D) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 60 | `desc_4154d58a-5a6c-4212-871c-cefc80cd3e9d` | Grok Super CDK 1T (BHF) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 61 | `desc_e83df1d3-c1ad-4208-84a3-50de267d9372` | Grok Super CDK 3T (BHF) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 62 | `desc_81154520-794e-4b0d-8844-63cc18cead5a` | Grok Ultra 1 Tháng (BH2D) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 63 | `desc_a6d82ced-7a73-4c01-abc2-f4b17f104174` | Grok+Cursor Pre 14 Ngày | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 64 | `desc_13c634ff-193f-442e-af49-a41e69b41ef3` | HMA VPN 30 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 50,000đ | `hma_month`; 30 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 65 | `desc_5ab9f96a-6fd2-40be-802c-4a3fee3512b9` | Hotspot Shield VPN 7 Ngày | ĐỦ ĐIỀU KIỆN | 38,000đ | `hotspotshield_month`; 7 ngày; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 66 | `desc_91ec1cc0-fa95-4c45-b9ba-b91ed7a7266f` | iCloud 400GB Chính Chủ 12T | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 67 | `desc_f6b0ee23-6f7f-41a7-bb69-49148103d84b` | iLovePdf Pre 1 Năm (KBH) | ĐỦ ĐIỀU KIỆN | 58,000đ | `ilovepdf_premium_year`; 12 tháng; Không bảo hành (nguồn ghi KBH). |
| 68 | `desc_613822b0-01bf-40e8-86f9-f32f9b948f4b` | IPVanish VPN 7 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 38,000đ | `ipvanish_week_ios_us`; 7 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 69 | `desc_c98339b6-d93f-4dd4-8f78-6c2bac329866` | MS Office 365 Plus 1 Năm | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 70 | `desc_b9bf47ce-f60e-4fcc-9db2-1a48e035a441` | Muse- Acc 1 Tỷ Token (KBH) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 71 | `desc_11d5933d-30e6-411f-afa8-d97020f5ae45` | Muse- Acc 31 Tỷ Token (KBH) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 72 | `desc_5172a9f3-b7ef-45fc-993e-e54f0ab8066e` | NordVPN 3 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 38,000đ | `nordvpn_basic_month`; 3 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 73 | `desc_05f8de79-9c51-4561-8be9-009a295c1829` | NordVPN Chính Chủ 3 Tháng | ĐỦ ĐIỀU KIỆN | 150,000đ | `nordvpn_basic_month`; 3 tháng; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 74 | `desc_f8903574-9797-4a84-842b-24937f7e717a` | NortonVPN Ultimate 7D (BHF) | ĐÓNG | — | `RETAIL_REFERENCE_UNVERIFIED` — Chưa xác minh được giá tham chiếu chính thức đúng cấp gói và kỳ hạn đủ tin cậy cho quyết định tự động. |
| 75 | `desc_7bc35dc4-3467-4fe8-88d4-dfbb1e4cd4d8` | Notion Business Link 3T | ĐỦ ĐIỀU KIỆN | 104,000đ | `notion_business_eu_month_unit`; 3 tháng; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 76 | `desc_2f17b9be-d791-4b33-b834-caa66f154067` | Perplexity CDK Max (KBH) | ĐÓNG | — | `ACTIVATION_ELIGIBILITY_UNVERIFIED` — Link/CDK chưa công bố điều kiện người nhận, loại quyền lợi hoặc thời hạn chắc chắn; không suy ra từ tên hàng. |
| 77 | `desc_2a5fc9bc-afd1-4619-b900-5d61a974f927` | Perplexity Pro 1 Tháng | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 248,000đ | `perplexity_pro_month`; 1 tháng; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 78 | `desc_8d8602f6-f939-4717-95bd-66cb467f6736` | PIA VPN 7 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 38,000đ | `pia_month`; 7 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 79 | `desc_9476530e-e339-4025-9eba-56a94934635d` | Prime Video 6 Tháng | ĐÓNG | — | `REGION_ENTITLEMENT_UNVERIFIED` — Chưa xác minh vùng sử dụng và quyền truy cập dịch vụ phù hợp với khách; giữ đóng thay vì hứa sử dụng được. |
| 80 | `desc_869c7d25-238f-4011-a56e-f89c2138f6ed` | Proton VPN 14-28 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 50,000đ | `protonvpn_plus_month`; 14–28 ngày (chỉ cam kết tối thiểu 14 ngày); Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 81 | `desc_0a23be32-7f10-482b-810b-a8be84c07d1c` | Proxy Xoay Premium | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 82 | `desc_a1bbb01a-0bc4-4ccf-8c5e-be5fbe5ebf18` | PureVPN 7 Ngày (BHF) | ĐỦ ĐIỀU KIỆN | 38,000đ | `purevpn_month`; 7 ngày; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 83 | `desc_97c249ed-fc43-4b7f-ac74-74281511d5fa` | Redeem 1M Credits (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 84 | `desc_0ffbcb7d-6063-4d69-986f-133e02984d67` | Redeem 300k Credits (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 85 | `desc_e2616537-473f-4645-81fb-ecfee99bd8bd` | Redeem 3M Credits (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 86 | `desc_6ee7b7f8-3d76-4f19-a406-52923b5d9466` | Redeem 7M Credits (BHF) | ĐÓNG | — | `OPAQUE_TOKEN_PLAN` — Tên token/credit chưa xác định được dịch vụ, model, hạn mức và quyền sử dụng để định giá hoặc giao đúng quyền lợi. |
| 87 | `desc_cac91c75-6ffd-4e16-b965-89b22860f767` | SCRIBD Trial 1 Tháng (BHF) | ĐÓNG | — | `ACTIVATION_ELIGIBILITY_UNVERIFIED` — Link/CDK chưa công bố điều kiện người nhận, loại quyền lợi hoặc thời hạn chắc chắn; không suy ra từ tên hàng. |
| 88 | `desc_5337258b-66aa-45bd-8315-7d0eea969324` | Spotify Pre Acc 1 Tháng | ĐỦ ĐIỀU KIỆN | 59,000đ | `spotify_individual_month_vn`; 1 tháng; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 89 | `desc_561aadb7-f4f9-4cf9-9abb-0d496deddb44` | Spotify Pre Link 3 Tháng | ĐÓNG | — | `OWNER_RETIRED_SPOTIFY_3M` — Spotify 3 tháng đã được chủ shop loại khỏi danh mục; không tự mở lại qua nguồn autobuy. |
| 90 | `desc_f9bbf6bc-9d80-405f-90b1-c5fb6e622b96` | Super Duolingo Link 1 Năm | ĐÓNG | — | `ACTIVATION_ELIGIBILITY_UNVERIFIED` — Link/CDK chưa công bố điều kiện người nhận, loại quyền lợi hoặc thời hạn chắc chắn; không suy ra từ tên hàng. |
| 91 | `desc_4e63d5ac-b3d4-425e-8a0d-48c34bd42da7` | Super Duolingo Slot 1 Năm | ĐÓNG | — | `SHARED_SLOT_TERMS_UNVERIFIED` — Slot gia đình chưa rõ số ghế, chủ sở hữu, thị trường và điều kiện thành viên; không so với giá gói cá nhân đầy đủ. |
| 92 | `desc_d85f4ecb-e00f-4718-99bd-2eb18606902a` | Super Grok 14 Ngày (BH24H) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 93 | `desc_a6081eef-4730-4e2d-8705-e0f1ce5adba4` | Super Grok 7 Ngày (BHF) | ĐÓNG | — | `PLAN_IDENTITY_UNVERIFIED` — Chưa khớp tên gói nguồn với gói/quyền lợi và phương thức kích hoạt chính thức; cần nguồn xác nhận trước khi bán. |
| 94 | `desc_e6c6a6d6-dfd9-4c55-b3f7-3c33fcb205b6` | Surfshark VPN One 7 Ngày | ĐỦ ĐIỀU KIỆN | 38,000đ | `surfshark_one_intro_27months`; 7 ngày; Nguồn chưa công bố bảo hành; không cam kết BHF. |
| 95 | `desc_6c849352-0ebf-4319-bd02-4fa09d2b525c` | Udemy + Coursera 12 Tháng | ĐÓNG | — | `BUNDLE_ENTITLEMENTS_UNVERIFIED` — Gói ghép Coursera/Udemy chưa công bố loại quyền truy cập mỗi dịch vụ, hình thức tài khoản và điều khoản đủ để mua tự động. |
| 96 | `desc_2bb88755-933e-48d8-93d0-6c79f5a6b68b` | Udemy + Coursera 6 Tháng | ĐÓNG | — | `BUNDLE_ENTITLEMENTS_UNVERIFIED` — Gói ghép Coursera/Udemy chưa công bố loại quyền truy cập mỗi dịch vụ, hình thức tài khoản và điều khoản đủ để mua tự động. |
| 97 | `desc_e0e495ed-1da8-404e-9e32-bc3058f65dca` | Wispr Flow Edu 12 Tháng | ĐÓNG | — | `EDUCATION_ELIGIBILITY_UNVERIFIED` — Gói Edu cần xác minh điều kiện học sinh/sinh viên và quyền cấp cho khách trước khi bán tự động. |
| 98 | `desc_5f243a96-7014-46e4-95c1-5a8189484998` | Zoom Pro Acc 1 Năm (BHF) | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 635,000đ | `zoom_pro_year`; 12 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 99 | `desc_d71a8a66-487a-449d-9c2a-a0d9f0ea981e` | Zoom Pro Acc 2 Tháng (BHF) | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 129,000đ | `zoom_pro_month`; 2 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 100 | `desc_a8480ca0-a03b-4ea9-b0be-c95cf6d74802` | Zoom Pro Acc 3 Tháng (BHF) | ĐỦ ĐIỀU KIỆN · hết hàng snapshot | 171,000đ | `zoom_pro_month`; 3 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |
| 101 | `desc_ba54c36d-22e2-4244-8534-d15eb39684d6` | Zoom Pro Acc 6 Tháng (BHF) | ĐỦ ĐIỀU KIỆN | 330,000đ | `zoom_pro_month`; 6 tháng; Bảo hành đủ thời hạn gói theo công bố nguồn. |

## Kiểm tra và giới hạn

Đã kiểm tra đủ 101 khóa, không trùng khóa; mỗi SKU bật có mốc HTTPS, ngày rà, thời hạn, bảo hành, hình thức bàn giao và giá minh họa có lãi sau dự phòng ≥20.000đ, thấp hơn trần tham chiếu. Quyết định loại Claude API, Gemini 18 tháng và Spotify 3 tháng giữ nguyên yêu cầu chủ shop. Các mục chưa đủ điều kiện được đóng có lý do cụ thể; không tự biến thành hàng đặt thủ công hay thêm vào danh mục cũ.

Chưa thực hiện mua trả phí, không chứng minh nguồn bàn giao đúng quyền lợi chỉ bằng nhãn sản phẩm. Phần worker/idempotency/thanh toán/giao hàng và bật trên hosting được kiểm tra bởi luồng triển khai riêng.
