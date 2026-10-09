import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { resolveVerifiedCustomEmoji } from '../services/emojiService.js';
import { rebuildPromotionCampaign, PROMOTION_REBUILD_TARGET } from '../services/promotionRebuildService.js';

// Manual only: never import into bootstrap or a timer. Prices and commercial
// terms were supplied by the owner on 2026-10-09; checkout prices are separate.
export const WEEKLY_SALE_20261009 = Object.freeze({
  ...PROMOTION_REBUILD_TARGET, supportChannelId: '1514607020098191393',
  revision: 'CENAR-WEEKLY-SALE:WEEK-2026-10-09',
  marker: 'CENAR-WEEKLY-DROP-2026-10-09', name: 'Cenar Weekly Drop · Góc số mở đèn',
});
export const WEEKLY_SALE_EMOJIS = Object.freeze(['tag', 'spark', 'ticket'].map((key) => Object.freeze({
  key, name: `cenar_wdrop_202610_${key}`,
  path: fileURLToPath(new URL(`../../assets/campaigns/emojis/cenar_wdrop_202610_${key}.png`, import.meta.url)),
})));
const offer = (label, price, terms = '') => Object.freeze({ label, price, terms });
const group = (key, slot, title, offers, notes = '') => Object.freeze({ key, slot, title, offers: Object.freeze(offers), notes });
export const WEEKLY_SALE_GROUPS = Object.freeze([
  group('nitro', 'brand_nitro', 'NITRO BOOST LOGIN', [
    offer('1 tháng', 85000),
    offer('2 tháng · 1 ngày', 99000, 'Mail không bao giờ dead'),
    offer('2 tháng · có liền', 120000, 'Mail không bao giờ dead'),
    offer('4 tháng · có liền', 240000, 'Mail không bao giờ dead'),
    offer('6 tháng · có liền', 350000, 'Mail không bao giờ dead'),
    offer('8 tháng · có liền', 480000, 'Mail không bao giờ dead'),
    offer('12 tháng · có liền · gia hạn auto', 580000, 'Mail không bao giờ dead'),
    offer('12 tháng · mua thẳng 1 năm · có liền', 830000, 'Mail không bao giờ dead'),
    offer('Trial Boost 3 tháng', 65000),
  ], 'Điều kiện mail và Trial được shop xác nhận tại ticket trước thanh toán.'),
  group('boost', 'brand_boost', 'BOOST SERVER · NÂNG CẤP MÁY CHỦ', [offer('1 tháng', 100000), offer('3 tháng', 290000)]),
  group('gemini', 'brand_gemini', 'GEMINI PRO + GOOGLE ONE · 5 TB', [offer('12 tháng', 150000), offer('18 tháng', 200000)],
    'Claude Opus 5.5 & Sonnet 5.5 qua Google Antigravity: áp dụng Google AI Pro không phải bản dùng thử, theo quyền tài khoản thực tế.'),
  group('office', 'brand_office', 'OFFICE 365 + ONEDRIVE · 1 TB', [offer('12 tháng', 200000)]),
  group('chatgpt', 'brand_chatgpt', 'CHATGPT · MOMO PAY / TEAM / JSON', [
    offer('1 tháng · MoMo Pay', 130000, 'Bảo hành 10 ngày'),
    offer('1 tháng · add team chính chủ', 390000, 'Bảo hành full'),
    offer('Pro 5x team 4 slot', 79000, '/slot · file JSON có hướng dẫn'),
    offer('Pro 5x team 2 slot', 150000, '/slot · file JSON có hướng dẫn'),
    offer('Acc Pro 5x', 250000, 'BH 30 phút · file JSON'),
  ], 'MoMo Pay: tỷ lệ die shop ghi nhận khoảng 2%; đây là số liệu tham khảo, không phải cam kết. x5 là tên gói shop niêm yết; thời hạn gói JSON được xác nhận trong ticket.'),
  group('capcut', 'brand_capcut', 'CAPCUT PRO', [offer('1 tháng', 55000), offer('6 tháng', 350000)]),
  group('netflix', 'brand_netflix', 'NETFLIX PREMIUM · 4K PRIVATE', [offer('1 tháng', 75000)]),
  group('spotify', 'brand_spotify', 'SPOTIFY PREMIUM', [offer('3 tháng', 110000), offer('6 tháng', 190000), offer('12 tháng', 290000)]),
  group('youtube', 'brand_youtube', 'YOUTUBE PREMIUM · ỔN ĐỊNH', [offer('1 tháng', 35000), offer('3 tháng', 150000), offer('6 tháng', 220000), offer('12 tháng', 380000)]),
  group('duolingo', 'cenar_duolingo', 'SUPER DUOLINGO', [offer('12 tháng', 80000, 'Bảo hành 6 tháng')]),
]);
const SILENT_MENTIONS = Object.freeze({ parse: [], roles: [], users: [], repliedUser: false });
const formatPrice = (price) => `${new Intl.NumberFormat('vi-VN').format(price)}đ`;
const artwork = (custom, key, E, slot) => custom?.[key]?.text || E(slot);
function renderGroup(item, E, tag) {
  return [
    `## ${E(item.slot)} ${item.title}`,
    ...item.offers.map((row) => {
      const perSlot = row.terms.startsWith('/slot');
      const terms = perSlot ? row.terms.replace(/^\/slot\s*·\s*/, '') : row.terms;
      return `${tag} **${row.label}** · \`${formatPrice(row.price)}${perSlot ? '/slot' : ''}\`${terms ? ` · ${terms}` : ''}`;
    }), item.notes ? `-# ${item.notes}` : '',
  ].filter(Boolean).join('\n');
}
export function buildWeeklySalePayloads({ guildId = WEEKLY_SALE_20261009.guildId,
  E = createEmojiResolver(guildId), customEmojis = {} } = {}) {
  const campaign = WEEKLY_SALE_20261009;
  const spark = artwork(customEmojis, 'spark', E, 'icon_sparkle');
  const tag = artwork(customEmojis, 'tag', E, 'icon_price');
  const ticket = artwork(customEmojis, 'ticket', E, 'ticket_open');
  const groups = Object.fromEntries(WEEKLY_SALE_GROUPS.map((item) => [item.key, renderGroup(item, E, tag)]));
  const blocks = [
    { color: 0xE7AC68, sections: [[
      `# ${spark} CENAR WEEKLY DROP`, `## GÓC SỐ MỞ ĐÈN`,
      '> Hết một ngày bận rộn, bạn bật đèn góc bàn. Một playlist, một ý tưởng mới, một bộ phim để dành — tuần này, Cenar gom những nâng cấp nhỏ vào một bảng giá vừa đủ.',
      `${ticket} **Chọn gói hợp nhịp · xem rõ điều kiện · mở ticket để chốt giá sale.**`,
    ].join('\n'), groups.nitro, groups.boost] },
    { color: 0x9AA4ED, sections: [
      `# ${E('icon_brain')} LÀM VIỆC & SÁNG TẠO\n> Cho ý tưởng một công cụ tốt, cho tài liệu một chỗ riêng.`,
      groups.gemini, groups.office, groups.chatgpt, groups.capcut,
    ] },
    { color: 0x71BEA6, sections: [
      `# ${E('icon_book')} KHOẢNG NGHỈ & ĐIỀU MỚI\n> Nghe một bài quen, xem một tập mới, học thêm một chút mỗi ngày.`,
      groups.netflix, groups.spotify, groups.youtube, groups.duolingo,
      [ `## ${ticket} CHỌN GÓI · MỞ TICKET`,
        'Gửi tên gói/thời hạn → shop xác nhận giá sale, điều kiện mail và bảo hành → thanh toán theo hướng dẫn trong ticket.',
        '**Còn nhiều sản phẩm khác giá ưu đãi.** Khi mua trên website, kiểm tra giá ở bước đặt hàng.',
        `-# ${E('warranty_shield')} Bảo hành theo từng gói. Thông tin tài khoản chỉ gửi trong ticket riêng.`,
      ].join('\n'),
    ], actions: true },
  ];
  const boardPayloads = blocks.map((block, index) => {
    const container = new ContainerBuilder().setAccentColor(block.color);
    block.sections.forEach((section, sectionIndex) => {
      if (sectionIndex) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
    });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${campaign.marker} · ${index + 1}/3`));
    if (block.actions) {
      const support = withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở ticket mua sale')
        .setURL(`https://discord.com/channels/${guildId}/${campaign.supportChannelId}`), customEmojis.ticket?.component, E.component?.('ticket_open'));
      const web = withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Cenar Store')
        .setURL('https://cenarstore.xyz/products'), E.component?.('icon_store'));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(support, web));
    }
    return { flags: MessageFlags.IsComponentsV2, allowedMentions: SILENT_MENTIONS, components: [container] };
  });
  return { boardOnly: true, boardPayloads,
    saleData: WEEKLY_SALE_GROUPS.flatMap((item) => item.offers.map((row) => ({ group: item.key, ...row }))),
    emojiNames: WEEKLY_SALE_EMOJIS.map((asset) => asset.name) };
}
export async function syncWeeklySaleEmojis(client) {
  const manager = client.application?.emojis;
  if (!manager) throw new Error('WEEKLY_SALE_APPLICATION_REQUIRED');
  await manager.fetch();
  const customEmojis = {};
  for (const asset of WEEKLY_SALE_EMOJIS) {
    const bytes = fs.readFileSync(asset.path);
    if (!bytes.length || bytes.length > 256 * 1024) throw new Error('WEEKLY_SALE_EMOJI_ASSET_INVALID');
    const existing = manager.cache.find((emoji) => emoji.name === asset.name);
    const emoji = existing || await manager.create({ attachment: asset.path, name: asset.name });
    const text = resolveVerifiedCustomEmoji(WEEKLY_SALE_20261009.guildId, emoji.id, { client });
    if (!text) throw new Error('WEEKLY_SALE_EMOJI_NOT_VERIFIED');
    customEmojis[asset.key] = { text, component: { id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated) } };
  }
  return customEmojis;
}
export async function publishWeeklySale(client, { dbInstance } = {}) {
  // Production's closed REST boundary stays intact. The isolated operator
  // script alone deliberately publishes this owner-authorized campaign.
  return rebuildPromotionCampaign(client, {
    revision: WEEKLY_SALE_20261009.revision, dbInstance,
    prepare: async (guild) => {
      await guild.emojis.fetch();
      const customEmojis = await syncWeeklySaleEmojis(client);
      const E = createEmojiResolver(guild.id);
      for (const slot of [...WEEKLY_SALE_GROUPS.map((item) => item.slot), 'icon_brain', 'icon_book', 'warranty_shield', 'icon_store']) {
        if (!E(slot)) throw new Error(`WEEKLY_SALE_ICON_UNAVAILABLE:${slot}`);
      }
      return buildWeeklySalePayloads({ guildId: guild.id, E, customEmojis });
    },
  });
}
