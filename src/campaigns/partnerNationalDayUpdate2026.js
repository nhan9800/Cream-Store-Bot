import { buildAnnouncementMessageV2 } from '../services/announcementService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const PARTNER_NATIONAL_DAY_UPDATE = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  marker: 'CENAR PARTNER OPEN CALL · QUỐC KHÁNH 2/9',
});

export function buildPartnerNationalDayContent(guildId = PARTNER_NATIONAL_DAY_UPDATE.guildId) {
  const E = createEmojiResolver(guildId);
  return [
    `## ${E('cenar_partner')} ${PARTNER_NATIONAL_DAY_UPDATE.marker}`,
    `> ${E('cenar_announce')} Cenar Store chính thức mở thêm cơ hội hợp tác với các cộng đồng Discord có hoạt động thật, tương tác tốt và mong muốn phát triển lâu dài cùng shop.`,
    '',
    `### ${E('partner_rules')} TIÊU CHÍ XÉT DUYỆT PARTNER`,
    `${E('status_check')} Server từ **1.000 thành viên** trở lên.`,
    `${E('status_check')} Cộng đồng có tương tác tốt; ưu tiên server có lượt mua hàng hoặc hoạt động ổn định tại Cenar Store.`,
    `${E('status_check')} Có role Partner riêng và kênh đăng bài/truyền thông dành cho đối tác.`,
    '',
    `### ${E('icon_gift')} QUYỀN LỢI DÀNH CHO PARTNER`,
    `${E('cenar_verified')} Được cấp **role Partner** tại Cenar Store và quyền truy cập khu vực truyền thông riêng.`,
    `${E('payment_money')} Được áp dụng **giá ưu đãi** cùng các chương trình hỗ trợ hấp dẫn theo hiệu quả hợp tác.`,
    `${E('brand_boost')} Partner duy trì tương tác và doanh số tốt sẽ được shop **xét hỗ trợ nâng cấp máy chủ khi gói hiện tại hết hạn**.`,
    '',
    `### ${E('brand_netflix')} FLASH SLOT NETFLIX`,
    `${E('promo_discount')} Shop chỉ còn **4 slot Netflix 4K Private** · **35.000đ / 1 tháng**.`,
    `${E('cenar_cooldown')} Số lượng giới hạn; ưu tiên khách chốt sớm và hoàn tất thanh toán trước.`,
    '',
    `### ${E('icon_star')} HẸN GẶP TỐI NAY`,
    `${E('cenar_announce')} **Bảng giá Sale Quốc khánh 2/9** sẽ được công bố tối nay, dự kiến có nhiều sản phẩm giảm sâu. Hãy theo dõi kênh thông báo để không bỏ lỡ.`,
    '',
    `-# ${E('verify_shield')} Cenar Store · Hợp tác minh bạch · Quyền lợi xét theo chất lượng hoạt động thực tế`,
  ].join('\n');
}

export function buildPartnerNationalDayAnnouncement(guildId = PARTNER_NATIONAL_DAY_UPDATE.guildId) {
  return buildAnnouncementMessageV2({
    guildId,
    content: buildPartnerNationalDayContent(guildId),
    tagEveryone: true,
  });
}

export function isPartnerNationalDayAnnouncement(message, botUserId = null) {
  if (!message || (botUserId && message.author?.id !== botUserId)) return false;
  const serialized = JSON.stringify((message.components || []).map((component) => component.toJSON?.() || component));
  return serialized.includes(PARTNER_NATIONAL_DAY_UPDATE.marker);
}
