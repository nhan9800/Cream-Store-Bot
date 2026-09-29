import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emojiAssetRoot = path.resolve(__dirname, '../../assets/emojis');

export const DAILY_COLOR_SALE = Object.freeze({
  guildId: '1282637033340403754',
  promotionChannelId: '1515008584549797979',
  supportChannelId: '1514607020098191393',
  priceChannelId: '1514606995842273280',
  memberRoleId: '1282638730812854345',
  storeUrl: 'https://cenarstore.xyz/products',
  marker: 'CENAR-STORY-FLASH-SALE-V1',
  dailyMarker: 'CENAR-DAILY-FLASH-SALE',
  campaignName: 'Cenar Chuyện Sale Mỗi Ngày',
  timeZone: 'Asia/Ho_Chi_Minh',
  publishHour: 9,
  retentionDays: 45,
});

export const DAILY_COLOR_SALE_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_daily_tag', fileName: 'cenar_daily_tag.png' }),
  Object.freeze({ name: 'cenar_daily_leaf', fileName: 'cenar_daily_leaf.png' }),
  Object.freeze({ name: 'cenar_daily_gift', fileName: 'cenar_daily_gift.png' }),
]);

const LEGACY_EVENT_EMOJI_NAMES = Object.freeze([
  'cenar_29_badge',
  'cenar_29_firework',
  'cenar_29_sale',
  'cenar_event_moon',
  'cenar_event_mooncake',
  'cenar_event_lantern',
]);

const currentEmojiNames = new Set(DAILY_COLOR_SALE_EMOJIS.map((asset) => asset.name));

export function isStaleDailyCampaignEmojiName(name) {
  const normalized = String(name || '').toLowerCase();
  return LEGACY_EVENT_EMOJI_NAMES.includes(normalized)
    || normalized.startsWith('cenar_event_')
    || normalized.startsWith('cenar_pubg_')
    || (normalized.startsWith('cenar_daily_') && !currentEmojiNames.has(normalized));
}

function assetPath(asset) {
  return path.join(emojiAssetRoot, asset.fileName);
}

function validateEmojiAssets() {
  for (const asset of DAILY_COLOR_SALE_EMOJIS) {
    const filePath = assetPath(asset);
    if (!fs.existsSync(filePath)) throw new Error(`Thiếu emoji Daily Color: ${filePath}`);
    const size = fs.statSync(filePath).size;
    if (!size || size > 256 * 1024) {
      throw new Error(`${asset.name} có kích thước ${size} bytes, không hợp lệ với Discord.`);
    }
  }
}

function asCustomEmoji(emoji) {
  return emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
}

export async function syncDailyColorSaleEmojis(guild) {
  validateEmojiAssets();
  await guild.emojis.fetch();

  const removed = [];
  for (const emoji of guild.emojis.cache.values()) {
    if (!isStaleDailyCampaignEmojiName(emoji.name)) continue;
    await guild.emojis.delete(emoji.id, 'Cenar Store · dọn emoji chiến dịch cũ trước Daily Color Sale 2026');
    removed.push({ id: emoji.id, name: emoji.name });
  }

  await guild.emojis.fetch();
  const emojis = {};
  for (const asset of DAILY_COLOR_SALE_EMOJIS) {
    let emoji = guild.emojis.cache.find((item) => item.name === asset.name);
    let status = 'reused';
    if (!emoji) {
      emoji = await guild.emojis.create({
        attachment: assetPath(asset),
        name: asset.name,
        reason: `Cenar Store · ${DAILY_COLOR_SALE.campaignName} · custom campaign art`,
      });
      status = 'created';
    }
    emojis[asset.name] = {
      status,
      text: asCustomEmoji(emoji),
      component: { id: emoji.id, name: emoji.name, animated: emoji.animated },
    };
  }
  return { emojis, removed };
}

const MONTHLY_THEMES = Object.freeze([
  Object.freeze({ name: 'Khởi Động Rực Rỡ', tagline: 'Mở năm mới bằng những nâng cấp nhỏ nhưng đáng giá.', colors: [0xF9736B, 0xFBBF24, 0x8B5CF6] }),
  Object.freeze({ name: 'Kết Nối Có Gu', tagline: 'Chọn đúng dịch vụ để mỗi cuộc trò chuyện gần nhau hơn.', colors: [0xEC4899, 0xFB7185, 0x7C3AED] }),
  Object.freeze({ name: 'Bật Mood Sáng Tạo', tagline: 'Thêm công cụ tốt để ý tưởng đi xa hơn.', colors: [0x8B5CF6, 0x38BDF8, 0xF472B6] }),
  Object.freeze({ name: 'Trạm Mưa Tiện Ích', tagline: 'Một góc số đủ đầy cho ngày mưa vẫn chạy mượt.', colors: [0x0EA5E9, 0x2DD4BF, 0x6366F1] }),
  Object.freeze({ name: 'Nắng Lên, Deal Tới', tagline: 'Năng lượng mùa hè đi cùng những gói dùng thật lâu.', colors: [0xF59E0B, 0xF97316, 0x14B8A6] }),
  Object.freeze({ name: 'Rực Hè Không Gián Đoạn', tagline: 'Giải trí, sáng tạo và kết nối trong một nhịp hè.', colors: [0xFB7185, 0xFACC15, 0x06B6D4] }),
  Object.freeze({ name: 'Khoảng Trời Số', tagline: 'Gom đủ tiện ích cho những chuyến đi và ngày nghỉ.', colors: [0x38BDF8, 0x22C55E, 0xA855F7] }),
  Object.freeze({ name: 'Tựu Trường Thông Minh', tagline: 'Chuẩn bị bộ công cụ học tập và làm việc thật gọn.', colors: [0x4F46E5, 0x06B6D4, 0xF59E0B] }),
  Object.freeze({ name: 'Thành Phố Lên Đèn', tagline: 'Khi ngày bận rộn khép lại, trải nghiệm tốt mới bắt đầu.', colors: [0x7C3AED, 0xEC4899, 0x14B8A6] }),
  Object.freeze({ name: 'Đêm Hội Sắc Màu', tagline: 'Mỗi tối một điểm sáng, mỗi lựa chọn một niềm vui.', colors: [0xF97316, 0xA855F7, 0xFACC15] }),
  Object.freeze({ name: 'Gom Điều Hay', tagline: 'Chọn những quyền lợi thiết thực cho mùa cuối năm.', colors: [0xD97706, 0x84CC16, 0x8B5CF6] }),
  Object.freeze({ name: 'Kết Năm Thật Chill', tagline: 'Khép năm bằng trải nghiệm liền mạch và niềm vui dài lâu.', colors: [0xEF4444, 0x22C55E, 0xFBBF24] }),
]);

const WEEKLY_STORIES = Object.freeze([
  Object.freeze({ title: 'Chiếc Vé Qua Thành Phố Số', premise: 'Một chiếc vé nhỏ mở lần lượt bảy trạm tiện ích trong tuần.' }),
  Object.freeze({ title: 'Căn Phòng Bật Đèn Lúc 9 Giờ', premise: 'Mỗi sáng căn phòng mở thêm một món đồ số giúp ngày mới nhẹ hơn.' }),
  Object.freeze({ title: 'Bưu Kiện Gửi Từ Tương Lai', premise: 'Bảy món quà công nghệ được mở dần, mỗi ngày đúng một lựa chọn.' }),
  Object.freeze({ title: 'Chuyến Tàu 7 Ga Premium', premise: 'Con tàu Cenar ghé một ga mới mỗi ngày, từ kết nối đến giải trí.' }),
  Object.freeze({ title: 'Nhật Ký Của Một Tài Khoản Bận Rộn', premise: 'Một tuần làm việc, sáng tạo và thư giãn được kể qua bảy chương ngắn.' }),
]);

const DAILY_CHAPTERS = Object.freeze([
  Object.freeze({ name: 'Mở cửa', copy: 'Cánh cửa đầu tuần bật sáng, ưu tiên một trải nghiệm kết nối gọn và rõ.', focus: 'Nitro Boost Login' }),
  Object.freeze({ name: 'Tăng tốc', copy: 'Câu chuyện đi nhanh hơn khi cộng đồng có đủ không gian để cùng nhau xuất hiện.', focus: 'Boost Server và Netflix 4K Private' }),
  Object.freeze({ name: 'Mở rộng', copy: 'Giữa tuần là lúc thêm sức mạnh cho học tập, lưu trữ và công việc hằng ngày.', focus: 'Gemini Pro, Google One và Office 365' }),
  Object.freeze({ name: 'Sáng tạo', copy: 'Một ý tưởng hay cần đúng công cụ để thành nội dung thật sự nổi bật.', focus: 'ChatGPT và CapCut Pro' }),
  Object.freeze({ name: 'Đổi nhịp', copy: 'Cuối ngày, một playlist đúng gu đủ để mọi việc nhẹ đi vài phần.', focus: 'Spotify Premium' }),
  Object.freeze({ name: 'Mở màn', copy: 'Cuối tuần bắt đầu bằng khung hình ổn định và những nội dung xem không gián đoạn.', focus: 'YouTube Premium ổn định' }),
  Object.freeze({ name: 'Chọn điều hợp mình', copy: 'Chương cuối dành cho việc xem lại nhu cầu và chọn đúng gói, đúng thời hạn.', focus: 'Toàn bộ bảng giá Flash Sale' }),
]);

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_COLOR_SALE.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDayInfo(date = new Date()) {
  const parts = zonedParts(date);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const serial = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const mondayOffset = (weekday + 6) % 7;
  const monday = new Date(serial - mondayOffset * 86_400_000);
  return { parts, weekday, mondayOffset, monday };
}

export function dailySaleTheme(date = new Date()) {
  const { parts } = localDayInfo(date);
  return MONTHLY_THEMES[Math.max(0, Number(parts.month) - 1)];
}

export function weeklySaleStory(date = new Date()) {
  const { monday, mondayOffset } = localDayInfo(date);
  const weekKey = monday.toISOString().slice(0, 10);
  const weekNumber = Math.floor(monday.getTime() / (7 * 86_400_000));
  return {
    ...WEEKLY_STORIES[Math.abs(weekNumber) % WEEKLY_STORIES.length],
    weekKey,
    chapter: DAILY_CHAPTERS[mondayOffset],
    dayIndex: mondayOffset,
  };
}

export function dailySaleDateKey(date = new Date()) {
  const parts = zonedParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isDailyFlashSaleDue(date = new Date()) {
  return Number(zonedParts(date).hour) >= DAILY_COLOR_SALE.publishHour;
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

export function buildDailyColorSaleSections({
  guildId = DAILY_COLOR_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  now = new Date(),
} = {}) {
  const tag = campaignIcon(customEmojis, 'cenar_daily_tag', E('icon_price'));
  const leaf = campaignIcon(customEmojis, 'cenar_daily_leaf', E('cenar_verified'));
  const gift = campaignIcon(customEmojis, 'cenar_daily_gift', E('icon_gift'));
  const theme = dailySaleTheme(now);
  const story = weeklySaleStory(now);

  return {
    hero: [
      `# ${gift} ${DAILY_COLOR_SALE.campaignName.toUpperCase()}`,
      `## ${leaf} THÁNG NÀY · ${theme.name.toUpperCase()}`,
      `> ${theme.tagline}`,
      `${tag} **Chuyện tuần: ${story.title}** · ${story.premise}`,
      `${tag} **Giá gọn, quyền lợi rõ, mở ticket là có người hỗ trợ ngay.**`,
      `-# ${DAILY_COLOR_SALE.marker}-PART-1 · Áp dụng từ khi đăng đến khi shop công bố cập nhật mới hoặc hết số lượng từng gói.`,
    ].join('\n'),
    nitro: [
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      `${tag} \`01 tháng\` — **85.000đ**`,
      `${tag} \`02 tháng · có liền\` — **99.000đ**`,
      `${tag} \`02 tháng · có liền · Mail bất tử\` — **120.000đ**`,
      `${tag} \`04 tháng · có liền\` — **250.000đ**`,
      `${tag} \`06 tháng · có liền\` — **350.000đ**`,
      `${tag} \`08 tháng · có liền\` — **450.000đ**`,
      `${tag} \`12 tháng · có liền · gia hạn tự động\` — **680.000đ**`,
      `${tag} \`12 tháng · mua thẳng 01 năm · có liền\` — **830.000đ**`,
      `${gift} **Trial Boost** · \`03 tháng\` — **65.000đ**`,
      `-# ${E('status_info')} Hai lựa chọn Nitro 02 tháng khác nhau ở loại tài khoản/mail; shop xác nhận đúng gói tại ticket trước khi thanh toán.`,
    ].join('\n'),
    boost: [
      `## ${E('brand_boost')} BOOST SERVER · NÂNG CẤP MÁY CHỦ`,
      `${leaf} \`01 tháng\` — **110.000đ**`,
      `${leaf} \`03 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_netflix')} NETFLIX PREMIUM · 4K PRIVATE`,
      `${leaf} \`01 tháng\` — **75.000đ**`,
    ].join('\n'),
    productivityHeader: [
      `# ${tag} AI & CÔNG CỤ BẢN QUYỀN`,
      '> Chọn đúng thời hạn, xem rõ bảo hành và nhận tư vấn trước khi chốt đơn.',
      `-# ${DAILY_COLOR_SALE.marker}-PART-2`,
    ].join('\n'),
    geminiOffice: [
      `## ${E('brand_gemini')} GEMINI PRO + GOOGLE ONE 5 TB`,
      `${leaf} \`12 tháng\` — **120.000đ**`,
      `${leaf} \`18 tháng\` — **190.000đ**`,
      `-# ${E('status_check')} Có thể thêm tối đa **05 thành viên** vào gói Google One.`,
      '',
      `## ${E('brand_office')} OFFICE 365 + ONEDRIVE 1 TB`,
      `${leaf} \`12 tháng\` — **200.000đ**`,
    ].join('\n'),
    chatgptCapcut: [
      `## ${E('brand_chatgpt')} CHATGPT PLUS · MOMO PAY`,
      `${tag} \`01 tháng\` — **130.000đ** · **Bảo hành 02 ngày**`,
      `${tag} \`01 tháng · add Team chính chủ · BHF\` — **390.000đ**`,
      `${tag} \`Pro 5x · ghép Team 04 slot\` — **79.000đ/slot** · **file JSON + hướng dẫn**`,
      `${tag} \`Pro 5x · ghép Team 02 slot\` — **150.000đ/slot** · **file JSON + hướng dẫn**`,
      `${tag} \`Acc ChatGPT Pro 5x\` — **250.000đ** · **BH 60 phút · file JSON**`,
      `-# ${E('status_info')} Nguồn MoMo Pay có tỷ lệ lỗi shop ghi nhận khoảng 2%; đây là số liệu tham khảo, không phải cam kết tuyệt đối.`,
      '',
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${gift} \`01 tháng\` — **55.000đ**`,
      `${gift} \`06 tháng\` — **290.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${gift} GIẢI TRÍ PREMIUM · DÙNG DÀI, GIÁ ÊM`,
      '> Chọn một lần, tận hưởng nhiều tháng — mọi điều kiện đều được báo rõ trước khi thanh toán.',
      `-# ${DAILY_COLOR_SALE.marker}-PART-3`,
    ].join('\n'),
    spotifyYoutube: [
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      `${leaf} \`03 tháng\` — **110.000đ**`,
      `${leaf} \`06 tháng\` — **180.000đ**`,
      `${leaf} \`12 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_youtube')} YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH`,
      `${tag} \`01 tháng\` — **58.000đ**`,
      `${tag} \`03 tháng\` — **185.000đ**`,
      `${tag} \`06 tháng\` — **295.000đ**`,
      `${tag} \`12 tháng\` — **530.000đ**`,
    ].join('\n'),
    closing: [
      `## ${gift} CÒN NHIỀU SẢN PHẨM KHÁC GIÁ RẤT ƯU ĐÃI`,
      `${E('status_check')} Mở ticket để shop kiểm tra tồn kho, điều kiện tài khoản và thời gian xử lý thực tế.`,
      `${E('warranty_shield')} Chính sách bảo hành áp dụng đúng theo từng dòng sản phẩm ghi trong bài và trên đơn hàng.`,
      `${E('cenar_support')} Không gửi mật khẩu, OTP hoặc thông tin thanh toán tại kênh công khai.`,
      '',
      `> ${leaf} **Chạm màu hôm nay · chốt đúng gói · tận hưởng trọn vẹn cùng Cenar Store.**`,
    ].join('\n'),
  };
}

export function buildDailyColorSaleMessages({
  guildId = DAILY_COLOR_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  tagEveryone = true,
  tagMember = true,
  now = new Date(),
} = {}) {
  const sections = buildDailyColorSaleSections({ guildId, E, customEmojis, now });
  const theme = dailySaleTheme(now);
  const supportUrl = `https://discord.com/channels/${guildId}/${DAILY_COLOR_SALE.supportChannelId}`;
  const priceUrl = `https://discord.com/channels/${guildId}/${DAILY_COLOR_SALE.priceChannelId}`;
  const mentions = [
    tagEveryone ? '@everyone' : null,
    tagMember ? `<@&${DAILY_COLOR_SALE.memberRoleId}>` : null,
  ].filter(Boolean).join(' · ');

  const supportButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở Ticket Chốt Đơn').setURL(supportUrl),
    customEmojis?.cenar_daily_gift?.component,
    E.component?.('ticket_open'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Shop Cenar').setURL(DAILY_COLOR_SALE.storeUrl),
    customEmojis?.cenar_daily_leaf?.component,
    E.component?.('icon_store'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Bảng Giá Gốc').setURL(priceUrl),
    customEmojis?.cenar_daily_tag?.component,
    E.component?.('icon_price'),
  );
  const actions = new ActionRowBuilder().addComponents(supportButton, storeButton, priceButton);
  const silentMentions = { parse: [], roles: [], users: [], repliedUser: false };

  return [
    {
      components: [panel(theme.colors[0], [`${mentions ? `${mentions}\n` : ''}${sections.hero}`, sections.nitro, sections.boost])],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        parse: tagEveryone ? ['everyone'] : [],
        roles: tagMember ? [DAILY_COLOR_SALE.memberRoleId] : [],
        users: [],
        repliedUser: false,
      },
    },
    {
      components: [panel(theme.colors[1], [sections.productivityHeader, sections.geminiOffice, sections.chatgptCapcut])],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: silentMentions,
    },
    {
      components: [panel(theme.colors[2], [sections.entertainmentHeader, sections.spotifyYoutube, sections.closing], actions)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: silentMentions,
    },
  ];
}

export function dailyColorSalePart(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return null;
  const serialized = JSON.stringify(message.toJSON?.() || message);
  const match = serialized.match(new RegExp(`${DAILY_COLOR_SALE.marker}-PART-(\\d)`));
  return match ? Number(match[1]) : null;
}

function serializedMessage(message) {
  return JSON.stringify(message?.toJSON?.() || message || {});
}

export function dailyFlashSaleMarker(date = new Date()) {
  return `${DAILY_COLOR_SALE.dailyMarker}:${dailySaleDateKey(date)}`;
}

export function dailyFlashSaleDateFromMessage(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return null;
  const escaped = DAILY_COLOR_SALE.dailyMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = serializedMessage(message).match(new RegExp(`${escaped}:(\\d{4}-\\d{2}-\\d{2})`));
  return match?.[1] || null;
}

function retiredPromotionBoardMessage(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return false;
  const serialized = serializedMessage(message);
  return serialized.includes('CENAR-PUBG-TREND-SALE-2026')
    || serialized.includes('CENAR-DAILY-COLOR-SALE-2026-09');
}

async function fetchAllMessages(channel, limit = 5000) {
  const messages = [];
  let before;
  while (messages.length < limit) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, limit - messages.length),
      ...(before ? { before } : {}),
    });
    if (!page.size) break;
    const values = [...page.values()];
    messages.push(...values);
    before = values.at(-1)?.id;
    if (page.size < 100) break;
  }
  return messages;
}

let boardPublishPromise = null;
let dailyPublishPromise = null;

async function publishDailyColorSaleInternal(client, { tagEveryone = true, tagMember = true, now = new Date() } = {}) {
  const guild = client.guilds.cache.get(DAILY_COLOR_SALE.guildId)
    || await client.guilds.fetch(DAILY_COLOR_SALE.guildId);
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const channel = await guild.channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
  if (!channel?.isTextBased?.() || channel.isThread?.() || !channel.messages
    || !/khuyến-mãi|khuyen-mai/i.test(channel.name)) {
    throw new Error('Kênh khuyến mãi không hợp lệ hoặc không thể gửi tin nhắn.');
  }
  if (tagMember && !guild.roles.cache.has(DAILY_COLOR_SALE.memberRoleId)) {
    throw new Error(`Không tìm thấy role Cenar Member ${DAILY_COLOR_SALE.memberRoleId}.`);
  }

  const member = guild.members.me || await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageGuildExpressions,
  ];
  if (tagEveryone || tagMember) required.push(PermissionFlagsBits.MentionEveryone);
  if (!channel.permissionsFor(member)?.has(required)) {
    throw new Error('Bot thiếu quyền gửi, quản lý bài/emoji hoặc tag tại kênh khuyến mãi.');
  }

  const { emojis, removed } = await syncDailyColorSaleEmojis(guild);
  // Bài sale có thể đã trôi khỏi 100 tin gần nhất. Tìm trên toàn bộ lịch sử
  // trước khi gửi để một lần restart/deploy không tạo thêm một bộ bảng giá.
  const allMessages = await fetchAllMessages(channel);
  const existingParts = new Map();
  for (const message of allMessages) {
    const part = dailyColorSalePart(message, client.user.id);
    if (part && !existingParts.has(part)) existingParts.set(part, message);
  }

  const payloadsWithMention = buildDailyColorSaleMessages({
    guildId: guild.id,
    customEmojis: emojis,
    tagEveryone,
    tagMember,
    now,
  });
  const payloadsSilent = buildDailyColorSaleMessages({
    guildId: guild.id,
    customEmojis: emojis,
    tagEveryone: false,
    tagMember: false,
    now,
  });
  const results = [];
  const activeMessageIds = new Set();
  for (let index = 0; index < payloadsSilent.length; index += 1) {
    const part = index + 1;
    const existing = existingParts.get(part);
    const payload = !existing && part === 1 ? payloadsWithMention[index] : payloadsSilent[index];
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    activeMessageIds.add(message.id);
    results.push({
      part,
      action: existing ? 'updated' : 'created',
      messageId: message.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
      mentionEveryone: message.mentions.everyone,
      mentionedMemberRole: message.mentions.roles.has(DAILY_COLOR_SALE.memberRoleId),
    });
  }

  let deletedOldMessages = 0;
  let preservedMemberMessages = 0;
  for (const message of allMessages) {
    if (message.author?.id !== client.user.id) {
      preservedMemberMessages += 1;
      continue;
    }
    if (activeMessageIds.has(message.id)) continue;
    if (!dailyColorSalePart(message, client.user.id)
      && !retiredPromotionBoardMessage(message, client.user.id)) continue;
    await message.delete();
    deletedOldMessages += 1;
  }

  return {
    status: 'active',
    channelId: channel.id,
    theme: dailySaleTheme(now),
    emojis,
    removedEventEmojis: removed,
    messages: results,
    deletedOldMessages,
    preservedMemberMessages,
  };
}

export function publishDailyColorSale(client, options = {}) {
  if (boardPublishPromise) return boardPublishPromise;
  boardPublishPromise = publishDailyColorSaleInternal(client, options)
    .finally(() => { boardPublishPromise = null; });
  return boardPublishPromise;
}

export function buildDailyFlashSaleMessage({
  guildId = DAILY_COLOR_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  boardMessageId,
  tagMember = true,
  now = new Date(),
} = {}) {
  if (!/^\d{15,22}$/.test(String(boardMessageId || ''))) {
    throw new Error('Thiếu ID bảng giá Flash Sale để tạo bài hằng ngày.');
  }
  const tag = campaignIcon(customEmojis, 'cenar_daily_tag', E('icon_price'));
  const leaf = campaignIcon(customEmojis, 'cenar_daily_leaf', E('cenar_verified'));
  const gift = campaignIcon(customEmojis, 'cenar_daily_gift', E('icon_gift'));
  const theme = dailySaleTheme(now);
  const story = weeklySaleStory(now);
  const dateKey = dailySaleDateKey(now);
  const boardUrl = `https://discord.com/channels/${guildId}/${DAILY_COLOR_SALE.promotionChannelId}/${boardMessageId}`;
  const supportUrl = `https://discord.com/channels/${guildId}/${DAILY_COLOR_SALE.supportChannelId}`;
  const dateLabel = new Intl.DateTimeFormat('vi-VN', {
    timeZone: DAILY_COLOR_SALE.timeZone,
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(now);

  const storyText = [
    tagMember ? `<@&${DAILY_COLOR_SALE.memberRoleId}>` : null,
    `# ${gift} FLASH SALE 09:00 · ${theme.name.toUpperCase()}`,
    `## ${leaf} ${story.title} · Chương ${story.dayIndex + 1}/7`,
    `> **${story.chapter.name}:** ${story.chapter.copy}`,
    `${tag} **Điểm dừng hôm nay:** ${story.chapter.focus}`,
    `${leaf} ${theme.tagline}`,
    '',
    `${E('status_check')} Giá, thời hạn và bảo hành được ghi rõ trong **[bảng giá Flash Sale](${boardUrl})**.`,
    `${E('cenar_support')} Mở ticket để shop kiểm tra tồn kho và điều kiện tài khoản trước khi thanh toán.`,
    `-# ${DAILY_COLOR_SALE.dailyMarker}:${dateKey} · STORY-WEEK:${story.weekKey} · ${dateLabel}`,
  ].filter(Boolean).join('\n');

  const orderButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở Ticket Chốt Đơn').setURL(supportUrl),
    customEmojis?.cenar_daily_gift?.component,
    E.component?.('ticket_open'),
  );
  const boardButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Bảng Giá Sale').setURL(boardUrl),
    customEmojis?.cenar_daily_tag?.component,
    E.component?.('icon_price'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Website').setURL(DAILY_COLOR_SALE.storeUrl),
    customEmojis?.cenar_daily_leaf?.component,
    E.component?.('icon_store'),
  );

  return {
    components: [panel(theme.colors[story.dayIndex % theme.colors.length], [storyText],
      new ActionRowBuilder().addComponents(orderButton, boardButton, storeButton))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: [],
      roles: tagMember ? [DAILY_COLOR_SALE.memberRoleId] : [],
      users: [],
      repliedUser: false,
    },
  };
}

async function publishDailyFlashSaleInternal(client, {
  now = new Date(),
  force = false,
  tagMember = true,
} = {}) {
  if (!force && !isDailyFlashSaleDue(now)) {
    return { status: 'not_due', dateKey: dailySaleDateKey(now), publishHour: DAILY_COLOR_SALE.publishHour };
  }
  if (boardPublishPromise) await boardPublishPromise;

  const guild = client.guilds.cache.get(DAILY_COLOR_SALE.guildId)
    || await client.guilds.fetch(DAILY_COLOR_SALE.guildId);
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const channel = await guild.channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
  if (!channel?.isTextBased?.() || channel.isThread?.() || !channel.messages
    || !/khuyến-mãi|khuyen-mai/i.test(channel.name)) {
    throw new Error('Kênh khuyến mãi không hợp lệ hoặc không thể gửi bài Flash Sale hằng ngày.');
  }
  if (tagMember && !guild.roles.cache.has(DAILY_COLOR_SALE.memberRoleId)) {
    throw new Error(`Không tìm thấy role Cenar Member ${DAILY_COLOR_SALE.memberRoleId}.`);
  }
  const member = guild.members.me || await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageGuildExpressions,
  ];
  if (tagMember) required.push(PermissionFlagsBits.MentionEveryone);
  if (!channel.permissionsFor(member)?.has(required)) {
    throw new Error('Bot thiếu quyền gửi bài, quản lý bảng giá, đồng bộ emoji hoặc tag role tại kênh khuyến mãi.');
  }

  const dateKey = dailySaleDateKey(now);
  let recentMessages = await fetchAllMessages(channel, 500);
  const existing = recentMessages.find((message) =>
    dailyFlashSaleDateFromMessage(message, client.user.id) === dateKey);
  if (existing) {
    return {
      status: 'already_posted',
      dateKey,
      messageId: existing.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${existing.id}`,
    };
  }

  // Làm mới bảng giá trước bài hằng ngày để tên/màu chiến dịch đổi đúng tháng,
  // tiêu đề câu chuyện đổi đúng tuần và bài mới luôn trỏ đến giá hiện hành.
  const board = await publishDailyColorSale(client, {
    tagEveryone: false,
    tagMember: false,
    now,
  });
  const boardMessage = { id: board.messages[0].messageId };
  const emojiResult = { emojis: board.emojis };
  recentMessages = await fetchAllMessages(channel, 500);

  const payload = buildDailyFlashSaleMessage({
    guildId: guild.id,
    customEmojis: emojiResult.emojis,
    boardMessageId: boardMessage.id,
    tagMember,
    now,
  });
  const message = await channel.send(payload);

  const todaySerial = Date.parse(`${dateKey}T00:00:00Z`);
  const retentionMs = DAILY_COLOR_SALE.retentionDays * 86_400_000;
  let removedExpired = 0;
  for (const oldMessage of recentMessages) {
    const oldDate = dailyFlashSaleDateFromMessage(oldMessage, client.user.id);
    if (!oldDate || oldDate === dateKey) continue;
    if (todaySerial - Date.parse(`${oldDate}T00:00:00Z`) <= retentionMs) continue;
    if (await oldMessage.delete().then(() => true).catch(() => false)) removedExpired += 1;
  }

  return {
    status: 'posted',
    dateKey,
    weekKey: weeklySaleStory(now).weekKey,
    messageId: message.id,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    removedExpired,
  };
}

export function publishDailyFlashSale(client, options = {}) {
  if (dailyPublishPromise) return dailyPublishPromise;
  dailyPublishPromise = publishDailyFlashSaleInternal(client, options)
    .finally(() => { dailyPublishPromise = null; });
  return dailyPublishPromise;
}
