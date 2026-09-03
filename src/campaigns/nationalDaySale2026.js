import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emojiAssetRoot = path.resolve(__dirname, '../../assets/emojis');

export const NATIONAL_DAY_SALE = Object.freeze({
  guildId: '1282637033340403754',
  promotionChannelId: '1515008584549797979',
  legacyAnnouncementChannelId: '1514598369597587546',
  supportChannelId: '1514607020098191393',
  priceChannelId: '1514606995842273280',
  storeUrl: 'https://cenarstore.xyz/products',
  marker: 'CENAR-NATIONAL-DAY-SALE-2026',
  anniversary: '81 năm Quốc khánh Việt Nam · 1945–2026',
});

export const NATIONAL_DAY_SALE_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_29_badge', fileName: 'cenar_29_badge.png' }),
  Object.freeze({ name: 'cenar_29_firework', fileName: 'cenar_29_firework.png' }),
  Object.freeze({ name: 'cenar_29_sale', fileName: 'cenar_29_sale.png' }),
]);

function asCustomEmoji(emoji) {
  return emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
}

export async function syncNationalDaySaleEmojis(guild) {
  await guild.emojis.fetch();
  const result = {};

  for (const asset of NATIONAL_DAY_SALE_EMOJIS) {
    let emoji = guild.emojis.cache.find((item) => item.name === asset.name);
    let status = 'reused';
    if (!emoji) {
      const assetPath = path.join(emojiAssetRoot, asset.fileName);
      if (!fs.existsSync(assetPath)) throw new Error(`Thiếu emoji 2/9: ${assetPath}`);
      const size = fs.statSync(assetPath).size;
      if (!size || size > 256 * 1024) {
        throw new Error(`${asset.name} có kích thước ${size} bytes, không hợp lệ với Discord.`);
      }
      emoji = await guild.emojis.create({
        attachment: assetPath,
        name: asset.name,
        reason: 'Cenar Store · Quốc khánh 2/9/2026 · custom campaign art',
      });
      status = 'created';
    }
    result[asset.name] = {
      status,
      text: asCustomEmoji(emoji),
      component: { id: emoji.id, name: emoji.name, animated: emoji.animated },
    };
  }

  return result;
}

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

function panel(color, sections, actionRow = null) {
  const container = new ContainerBuilder().setAccentColor(color);
  sections.forEach((section, index) => {
    if (index) container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
  });
  if (actionRow) container.addActionRowComponents(actionRow);
  return container;
}

function campaignIcon(customEmojis, name, fallback) {
  return customEmojis?.[name]?.text || fallback;
}

export function buildNationalDaySaleSections({
  guildId = NATIONAL_DAY_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
} = {}) {
  const badge = campaignIcon(customEmojis, 'cenar_29_badge', E('cenar_verified'));
  const firework = campaignIcon(customEmojis, 'cenar_29_firework', E('cenar_announce'));
  const sale = campaignIcon(customEmojis, 'cenar_29_sale', E('icon_price'));

  return {
    hero: [
      `# ${firework} ĐẠI TIỆC SALE QUỐC KHÁNH 2/9`,
      `> ${badge} **${NATIONAL_DAY_SALE.anniversary}**`,
      '> Hòa chung không khí ngày Độc lập, Cenar Store gửi lời tri ân đến cộng đồng bằng bảng giá ưu đãi dành cho các dịch vụ số được quan tâm nhất.',
      '',
      `${sale} **Giá tốt theo từng nhu cầu · nhiều gói có liền · hỗ trợ rõ ràng trước khi thanh toán.**`,
      `-# ${NATIONAL_DAY_SALE.marker}-PART-1 · Chương trình áp dụng từ khi đăng thông báo đến khi shop công bố kết thúc hoặc hết số lượng.`,
    ].join('\n'),
    nitro: [
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      `${sale} \`01 tháng\` — **85.000đ**`,
      `${sale} \`02 tháng · xử lý 4–5 ngày\` — **99.000đ**`,
      `${sale} \`02 tháng · có liền\` — **115.000đ**`,
      `${sale} \`04 tháng · có liền\` — **210.000đ**`,
      `${sale} \`06 tháng · có liền\` — **310.000đ**`,
      `${sale} \`08 tháng · có liền\` — **450.000đ**`,
      `${sale} \`12 tháng · có liền · gia hạn tự động\` — **550.000đ**`,
      `${sale} \`12 tháng · mua thẳng 01 năm · có liền\` — **800.000đ**`,
      `${E('brand_nitro')} **Nitro Trial Boost** · \`03 tháng\` — **55.000đ**`,
      `-# ${E('status_info')} Nitro Trial cần được shop kiểm tra điều kiện tài khoản trước khi nhận thanh toán.`,
    ].join('\n'),
    boostNetflix: [
      `## ${E('brand_boost')} BOOST SERVER · NÂNG CẤP MÁY CHỦ`,
      `${sale} \`01 tháng\` — **90.000đ**`,
      `${sale} \`03 tháng\` — **230.000đ**`,
      '',
      `## ${E('brand_netflix')} NETFLIX PREMIUM · 4K PRIVATE`,
      `${sale} \`01 tháng\` — **30.000đ**`,
      `${sale} \`02 tháng\` — **50.000đ**`,
    ].join('\n'),
    productivityHeader: [
      `# ${sale} SALE 2/9 · AI & CÔNG CỤ BẢN QUYỀN`,
      '> Chọn đúng thời hạn, đúng nhu cầu và biết rõ chính sách hỗ trợ trước khi mua.',
      `-# ${NATIONAL_DAY_SALE.marker}-PART-2`,
    ].join('\n'),
    geminiOffice: [
      `## ${E('brand_gemini')} GEMINI PRO + GOOGLE ONE 5 TB`,
      `${sale} \`12 tháng\` — **250.000đ** · **Full bảo hành**`,
      `${sale} \`18 tháng\` — **280.000đ** · **Full bảo hành**`,
      `-# ${E('status_info')} Giá mới áp dụng từ 03/09/2026 do phương thức triển khai cũ không còn khả dụng sau thay đổi từ Google.`,
      '',
      `## ${E('brand_office')} OFFICE 365 + ONEDRIVE 1 TB`,
      `${sale} \`12 tháng\` — **180.000đ**`,
    ].join('\n'),
    chatgptCapcut: [
      `## ${E('brand_chatgpt')} CHATGPT PLUS · MOMO PAY`,
      `${sale} \`01 tháng\` — **130.000đ** · **Bảo hành 02 ngày**`,
      `${sale} \`Add Team chính chủ · BHF\` — **390.000đ**`,
      `-# ${E('status_info')} Tỷ lệ lỗi nguồn MoMo Pay shop ghi nhận dao động quanh 2%; đây là số liệu vận hành tham khảo, không phải cam kết tuyệt đối.`,
      '',
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${sale} \`01 tháng\` — **55.000đ**`,
      `${sale} \`06 tháng\` — **295.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${badge} SALE 2/9 · GIẢI TRÍ ỔN ĐỊNH`,
      '> Tối ưu chi phí theo tháng, đồng thời giữ đầy đủ thời hạn và chính sách hỗ trợ của từng dòng sản phẩm.',
      `-# ${NATIONAL_DAY_SALE.marker}-PART-3`,
    ].join('\n'),
    spotifyYoutube: [
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      `${sale} \`03 tháng\` — **90.000đ**`,
      `${sale} \`06 tháng\` — **180.000đ**`,
      `${sale} \`12 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_youtube')} YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH`,
      `${sale} \`01 tháng\` — **65.000đ**`,
      `${sale} \`03 tháng\` — **185.000đ**`,
      `${sale} \`06 tháng\` — **295.000đ**`,
      `${sale} \`12 tháng\` — **530.000đ**`,
    ].join('\n'),
    closing: [
      `## ${firework} CÒN NHIỀU SẢN PHẨM KHÁC ĐANG CÓ GIÁ ƯU ĐÃI`,
      `${E('status_check')} Mở website hoặc ticket để shop kiểm tra tồn kho, điều kiện tài khoản và thời gian xử lý thực tế.`,
      `${E('warranty_shield')} Chính sách bảo hành áp dụng theo đúng dòng sản phẩm ghi trên đơn; mọi phần chênh lệch hoặc điều kiện đặc biệt sẽ được báo trước khi thanh toán.`,
      `${E('cenar_support')} Không gửi mật khẩu, mã OTP hoặc thông tin thanh toán tại kênh công khai.`,
      '',
      `> ${badge} **Cenar Store trân trọng cảm ơn mọi người đã tin tưởng và đồng hành. Chúc cộng đồng một kỳ nghỉ Quốc khánh vui vẻ, an toàn và nhiều trải nghiệm đáng nhớ.**`,
    ].join('\n'),
  };
}

export function buildNationalDaySaleMessages({
  guildId = NATIONAL_DAY_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  tagEveryone = true,
} = {}) {
  const sections = buildNationalDaySaleSections({ guildId, E, customEmojis });
  const supportUrl = `https://discord.com/channels/${guildId}/${NATIONAL_DAY_SALE.supportChannelId}`;
  const priceUrl = `https://discord.com/channels/${guildId}/${NATIONAL_DAY_SALE.priceChannelId}`;
  const saleButtonEmoji = customEmojis?.cenar_29_sale?.component;
  const badgeButtonEmoji = customEmojis?.cenar_29_badge?.component;
  const fireworkButtonEmoji = customEmojis?.cenar_29_firework?.component;

  const supportButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở Ticket Chốt Sale').setURL(supportUrl),
    badgeButtonEmoji,
    E.component?.('ticket_open'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Sản Phẩm').setURL(NATIONAL_DAY_SALE.storeUrl),
    saleButtonEmoji,
    E.component?.('icon_store'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Kênh Bảng Giá').setURL(priceUrl),
    fireworkButtonEmoji,
    E.component?.('icon_price'),
  );
  const actions = new ActionRowBuilder().addComponents(supportButton, storeButton, priceButton);
  const common = {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], roles: [], users: [], repliedUser: false },
  };

  return [
    {
      ...common,
      components: [panel(0xda251d, [
        `${tagEveryone ? '@everyone\n' : ''}${sections.hero}`,
        sections.nitro,
        sections.boostNetflix,
      ])],
      allowedMentions: {
        parse: tagEveryone ? ['everyone'] : [],
        roles: [],
        users: [],
        repliedUser: false,
      },
    },
    {
      ...common,
      components: [panel(0xf2b705, [sections.productivityHeader, sections.geminiOffice, sections.chatgptCapcut])],
    },
    {
      ...common,
      components: [panel(0xd71920, [sections.entertainmentHeader, sections.spotifyYoutube, sections.closing], actions)],
    },
  ];
}

export function nationalDaySalePart(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return null;
  const serialized = JSON.stringify(message.toJSON?.() || message);
  const match = serialized.match(new RegExp(`${NATIONAL_DAY_SALE.marker}-PART-(\\d)`));
  return match ? Number(match[1]) : null;
}
