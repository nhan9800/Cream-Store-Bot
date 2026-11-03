export const GEMINI_PRO_CDK_KEY = 'gemini-pro-cdk-6-months-activation-warranty';

export const GEMINI_PRO_CDK_WARRANTY = 'Chỉ bảo hành kích hoạt thành công · không bảo hành sau kích hoạt';
export const GEMINI_PRO_CDK_WARRANTY_EN = 'Successful activation only; no post-activation warranty';

export const GEMINI_PRO_CDK_DESCRIPTION = [
  'Gemini Pro 6 tháng, kích hoạt bằng CDK trên tài khoản Google của khách. Giá trọn gói 190.000đ, tương đương khoảng 31.667đ/tháng.',
  'QUYỀN LỢI ANTIGRAVITY: Shop đã kiểm tra có Gemini 4 Argon, Claude Opus 5.5 (Thinking) và Claude Sonnet 5.5 (Thinking). AI agent hỗ trợ lập kế hoạch, viết code, chạy công cụ và kiểm tra kết quả qua editor, terminal, trình duyệt; dùng Antigravity App/CLI và các tính năng được Google cấp cho gói Pro. Hạn mức Pro cao hơn, làm mới mỗi 5 giờ trong giới hạn tuần; không phải không giới hạn. Model, tính năng và hạn mức tuân theo Google tại thời điểm sử dụng.',
  'TRƯỚC KHI KÍCH HOẠT: Bắt buộc đóng hồ sơ thanh toán Google Payments tại https://payments.google.com/ và rời nhóm gia đình Google. Nếu đang có dịch vụ trả phí hoặc dữ liệu liên quan, liên hệ Admin kiểm tra ảnh hưởng trước khi thực hiện.',
  'BẢO HÀNH: Chỉ bảo hành việc kích hoạt gói đăng ký thành công. Nếu không kích hoạt được do lỗi CDK, liên hệ Admin để kiểm tra và hỗ trợ. Sau khi kích hoạt thành công, sản phẩm được xem là hoàn tất; không bảo hành các vấn đề phát sinh sau đó.',
  'YOUTUBE PREMIUM LITE: Có thể có hoặc không tùy tài khoản/điều kiện Google, không cam kết đi kèm. Lite không phải YouTube Premium đầy đủ; vẫn có thể có quảng cáo và không bao gồm YouTube Music Premium.',
].join('\n\n');

export const GEMINI_PRO_CDK_DESCRIPTION_EN = [
  'Gemini Pro for 6 months, activated with a CDK on your Google account. Total price: 190,000 VND, approximately 31,667 VND/month.',
  'ANTIGRAVITY: Shop-tested access to Gemini 4 Argon, Claude Opus 5.5 (Thinking) and Claude Sonnet 5.5 (Thinking). AI agents help plan, code, run tools and verify results across the editor, terminal and browser, with Antigravity App/CLI and Pro-enabled features. Higher Pro quotas refresh every 5 hours within weekly limits; usage is not unlimited. Models, features and limits follow Google availability at the time of use.',
  'BEFORE ACTIVATION: Close your Google Payments profile at https://payments.google.com/ and leave your Google family group. If you have paid services or related data, contact Admin to review the impact before proceeding.',
  'WARRANTY: Successful subscription activation only. If activation fails due to a faulty CDK, contact Admin for review and assistance. The product is fulfilled once activation succeeds; subsequent issues are not covered.',
  'YOUTUBE PREMIUM LITE: May or may not be included depending on your account and Google eligibility; inclusion is not guaranteed. Lite is not full YouTube Premium: ads may still appear and YouTube Music Premium is excluded.',
].join('\n\n');

export const GEMINI_PRO_CDK_PRODUCT = Object.freeze({
  product_key: GEMINI_PRO_CDK_KEY,
  name: 'Gemini Pro 6 Tháng (CDK · BH Kích Hoạt)',
  description: GEMINI_PRO_CDK_DESCRIPTION,
  warranty_policy: GEMINI_PRO_CDK_WARRANTY,
  price: 190000,
  duration_months: 6,
  service_type: 'AI',
  emoji: 'brand_gemini',
  original_price: 0,
  activation_method: 'OWN_ACCOUNT',
  login_required: 0,
  is_featured: 1,
  virtual_purchase_count: 0,
});
