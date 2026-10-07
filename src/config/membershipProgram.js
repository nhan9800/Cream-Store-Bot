// Stable commerce keys and IDs: names/artwork can change without moving tiers.
export const MEMBERSHIP_REVISION = 'CENAR-MEMBERSHIP-20261007';
export const MEMBER_ROLES = Object.freeze([
  {key:'ruby', id:'1282637775291551776', label:'Cenar Sovereign', minSpent:8_000_000, symbol:'♛', fallback:'👑', slot:'icon_crown', tagline:'Dấu ấn cao nhất của hành trình Cenar', perks:['Đơn mới được xếp hàng ưu tiên cao nhất theo hạng thành viên.', 'Được tư vấn riêng khi chọn gói dài hạn, gia hạn hoặc nhiều dịch vụ.', 'Nhận xét duyệt ưu đãi tri ân theo chương trình đang mở.']},
  {key:'diamond', id:'1282637814571466808', label:'Cenar Prestige', minSpent:5_000_000, symbol:'◇', fallback:'💎', slot:'icon_gem', tagline:'Đặc quyền dành cho khách hàng gắn bó', perks:['Đơn mới được xếp hàng ưu tiên ở hạng Prestige.', 'Được tư vấn gói phù hợp với lịch sử mua hàng.', 'Có thể yêu cầu mã tri ân; staff xác nhận điều kiện trước khi lên đơn.']},
  {key:'elite', id:'1282637470139420694', label:'Cenar Signature', minSpent:3_000_000, symbol:'✧', fallback:'✨', slot:'icon_sparkle', tagline:'Phong cách riêng, chăm sóc tận tâm', perks:['Đơn mới được xếp hàng ưu tiên ở hạng Signature.', 'Tư vấn chuyển gói và gia hạn theo nhu cầu thực tế.', 'Có thể yêu cầu ưu đãi thành viên trong chiến dịch đang áp dụng.']},
  {key:'vip', id:'1282637168149532724', label:'Cenar Select', minSpent:1_000_000, symbol:'✦', fallback:'🌟', slot:'icon_star', tagline:'Bắt đầu hành trình thành viên ưu tiên', perks:['Nhận huy hiệu Select và ưu tiên xếp hàng đơn mới theo hạng.', 'Được tư vấn lựa chọn gói và điều kiện bảo hành trước khi mua.', 'Sử dụng mã ưu đãi thành viên khi shop có chương trình phù hợp.']},
  {key:'active', id:'1282637103045279820', label:'Cenar Patron', minSpent:0, requireActivity:true, symbol:'❖', fallback:'🛍️', slot:'customer_patron', tagline:'Mỗi lần ủng hộ đều được ghi nhận', perks:['Tự nhận role sau đơn thanh toán đủ hoặc hoạt động dịch vụ hợp lệ.', 'Tích 1 điểm / 10.000đ ở đơn hoàn thành; xem bằng /loyalty points.', 'Đánh giá đơn đã giao và xem lại lịch sử, bảo hành, transcript trên web.']},
  {key:'explorer', id:'1282638730812854345', label:'Cenar Explorer', minSpent:0, symbol:'⌘', fallback:'🧭', slot:'icon_search', tagline:'Khám phá Cenar theo cách của bạn', perks:['Xem sản phẩm, bảng giá và chương trình khuyến mãi.', 'Mở ticket mua hàng hoặc hỗ trợ; tham gia thảo luận theo quyền kênh.', 'Liên kết Discord với website để đồng bộ hồ sơ và role mua hàng.']},
].map(role => Object.freeze({...role, perks:Object.freeze(role.perks)})));
export const BUYER_TIERS = Object.freeze(MEMBER_ROLES.filter(role => role.key !== 'explorer'));
export const PROGRESS_TIERS = Object.freeze([...BUYER_TIERS].reverse().map(role => Object.freeze({
  key:role.key, label:role.label, minSpent:role.minSpent, ...(role.requireActivity ? {requireOrder:true} : {}),
})));
export function membershipTierForSpend(spent) {
  return BUYER_TIERS.find(role => Number(spent) >= role.minSpent) || BUYER_TIERS.at(-1);
}
export function membershipPriorityForSpend(spent) {
  const tier=membershipTierForSpend(spent);
  return tier.minSpent > 0 ? (4-BUYER_TIERS.indexOf(tier))*100 : 0;
}
