import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { PROMOTION_CATALOG_ROWS, PROMOTION_CATALOG_SECTIONS } from './promotionCatalog202610.js';
import { rebuildPromotionCampaign } from '../services/promotionRebuildService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emojiAssetRoot = path.resolve(__dirname, '../../assets/campaigns/emojis');
const campaignBannerName = 'cenar-autumn-atelier-202610.png';
const campaignBannerPath = path.resolve(__dirname, '../../assets/campaigns', campaignBannerName);

export const DAILY_COLOR_SALE = Object.freeze({
  guildId: '1282637033340403754',
  promotionChannelId: '1515008584549797979',
  supportChannelId: '1514607020098191393',
  priceChannelId: '1514606995842273280',
  memberRoleId: '1282638730812854345',
  storeUrl: 'https://cenarstore.xyz/products',
  marker: 'CENAR-STORY-FLASH-SALE-V1',
  dailyMarker: 'CENAR-DAILY-FLASH-SALE',
  revision: 'CENAR-SALE-REVISION:AUTUMN-ATELIER-20261002',
  campaignName: 'Cenar Atelier · Trạm Thu Dịu',
  timeZone: 'Asia/Ho_Chi_Minh',
  publishHour: 9,
  retentionDays: 45,
});

export const DAILY_COLOR_SALE_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_autumn_202610_ticket', fileName: 'cenar_autumn_202610_ticket.png' }),
  Object.freeze({ name: 'cenar_autumn_202610_cup', fileName: 'cenar_autumn_202610_cup.png' }),
  Object.freeze({ name: 'cenar_autumn_202610_spark', fileName: 'cenar_autumn_202610_spark.png' }),
  Object.freeze({ name: 'cenar_autumn_202610_leaves', fileName: 'cenar_autumn_202610_leaves.png' }),
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
    || (normalized.startsWith('cenar_daily_') && !currentEmojiNames.has(normalized))
    || (normalized.startsWith('cenar_autumn_') && !currentEmojiNames.has(normalized));
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
  // The prepared replacement must exist before any historic message or artwork
  // is removed. Retired emoji cleanup runs only after the durable cutover.
  const removed = [];
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
  Object.freeze({ name: 'Trạm Thu Dịu', tagline: 'Để ngày bận rộn có một khoảng thảnh thơi.', colors: [0xBA7045, 0xBA7045, 0xBA7045, 0xBA7045] }),
  Object.freeze({ name: 'Gom Điều Hay', tagline: 'Chọn những quyền lợi thiết thực cho mùa cuối năm.', colors: [0xD97706, 0x84CC16, 0x8B5CF6] }),
  Object.freeze({ name: 'Kết Năm Thật Chill', tagline: 'Khép năm bằng trải nghiệm liền mạch và niềm vui dài lâu.', colors: [0xEF4444, 0x22C55E, 0xFBBF24] }),
]);

const WEEKLY_STORIES = Object.freeze([
  Object.freeze({
    title: 'Tấm Thiệp Dưới Tán Cây',
    premise: 'Mai muốn gửi hội bạn một tấm thiệp mùa thu. Mỗi ngày, tấm thiệp có thêm một điều để nhớ.',
    chapters: Object.freeze([
      { name: 'Một lời hẹn', copy: 'Mai viết lời hẹn đầu tiên. Bản nháp còn vụng, nhưng nghe đúng giọng của mình là cô giữ lại.', focus: 'ChatGPT chính chủ Plus 485k hoặc 500k · xem riêng mức bảo hành' },
      { name: 'Gọi hội bạn', copy: 'Tấm thiệp cần một ngày hẹn. Hội bạn vào phòng trò chuyện, người chọn giờ, người chọn chỗ ngồi.', focus: 'Nitro Boost Login từ 85k · Boost Server từ 110k' },
      { name: 'Những ảnh chưa gửi', copy: 'Mai lục lại ảnh chuyến đi cũ. Cả nhóm gom vào một thư mục chung để không ai bị bỏ quên trên tấm thiệp.', focus: 'Gemini Pro + Google One 5 TB từ 120k · Office 365 200k' },
      { name: 'Chiếc lá bên lề', copy: 'Mai đặt một chiếc lá cạnh trang giấy, sửa màu ảnh rồi ghép đoạn video nhỏ. Tấm thiệp bắt đầu có không khí mùa thu.', focus: 'Adobe từ 140k · CapCut từ 55k · Claude Pro x5 từ 1,9 triệu' },
      { name: 'Bài hát của cả nhóm', copy: 'Có người gửi lại bài hát nghe trên chuyến đi. Mai bật playlist, thêm tên bài vào góc thiệp rồi mỉm cười.', focus: 'Spotify Premium từ 110k · chọn thời hạn theo nhịp nghe' },
      { name: 'Buổi tối trước cuộc hẹn', copy: 'Thiệp đã gửi, Mai tạm cất điện thoại. Một bộ phim quen làm buổi tối bớt vội trước ngày gặp bạn.', focus: 'Netflix 4K Private 75k · YouTube Premium từ 58k' },
      { name: 'Chỗ ngồi được giữ lại', copy: 'Tấm thiệp nằm giữa bàn, người nào cũng có một câu chuyện. Mai giữ lại bức ảnh cuối buổi cho lời hẹn tiếp theo.', focus: 'Xem toàn bộ bảng giá · nhờ shop kiểm tra đúng gói trước khi mua' },
    ]),
  }),
  Object.freeze({
    title: 'Một Góc Cho Ngày Mưa',
    premise: 'An sửa lại góc đọc sách trước mùa mưa. Bảy ngày, từ chiếc kệ trống đến một nơi muốn trở về.',
    chapters: Object.freeze([
      { name: 'Chiếc kệ còn trống', copy: 'An ghi những thứ cần sửa trước khi mua thêm gì mới. Một bản nháp rõ ràng giúp góc nhỏ bớt chật.', focus: 'ChatGPT chính chủ hoặc cấp acc · chọn theo nhu cầu và bảo hành' },
      { name: 'Cuộc gọi lúc trời mưa', copy: 'Bạn gọi để góp ý vị trí chiếc kệ. An xoay camera, cùng bạn thử vài cách sắp xếp trước khi dời đồ.', focus: 'Nitro Boost Login · Boost Server' },
      { name: 'Ngăn kéo cho ý tưởng', copy: 'Sách lên kệ, tài liệu về đúng thư mục. An lưu những ghi chú cũ để mai có thể đọc tiếp từ đoạn đang dở.', focus: 'Google One 5 TB · Office 365 + OneDrive 1 TB' },
      { name: 'Tấm ảnh bên cửa sổ', copy: 'Ánh sáng vừa đẹp, An chụp góc đọc sách mới rồi thử một bản dựng ngắn. Không cần hoàn hảo ngay từ lần đầu.', focus: 'Adobe · CapCut Pro · Claude Pro x5' },
      { name: 'Tiếng mưa và playlist', copy: 'An đặt cốc nước xuống cạnh sách. Một playlist vừa đủ nhỏ, tiếng mưa ngoài cửa sổ nghe rõ hơn.', focus: 'Spotify Premium · 3 / 6 / 12 tháng' },
      { name: 'Một tập phim nữa', copy: 'Sách đã có dấu trang. An chuyển sang xem tập phim để dành, góc nhỏ vẫn là nơi nghỉ sau ngày dài.', focus: 'Netflix Premium · YouTube Premium' },
      { name: 'Để mai đọc tiếp', copy: 'An gấp chăn, đặt sách về kệ và tắt đèn. Góc đọc đã xong, chỉ còn một trang hẹn cho ngày mai.', focus: 'Giá và điều kiện từng gói có trong bảng Trạm Thu Dịu' },
    ]),
  }),
  Object.freeze({
    title: 'Cuốn Sổ Đi Qua Mùa Thu',
    premise: 'Linh dành một tuần ghi lại những điều nhỏ. Cuối tuần, cuốn sổ có đủ một chuyến đi không vội.',
    chapters: Object.freeze([
      { name: 'Trang đầu không vội', copy: 'Linh mở cuốn sổ, ghi một nơi muốn đến và ba điều muốn nhớ. Bản kế hoạch chỉ cần vừa với một tuần.', focus: 'ChatGPT Plus · chính chủ hoặc cấp acc, bảo hành ghi riêng' },
      { name: 'Thêm một người bạn', copy: 'Linh gửi lịch hẹn cho bạn rồi cùng chọn đường đi. Chuyến đi vui hơn khi cả hai biết mình muốn gì.', focus: 'Nitro Boost Login · Boost Server' },
      { name: 'Nhặt những mẩu ghi chú', copy: 'Một tấm ảnh, một địa chỉ, một dòng nhắn được xếp vào thư mục. Linh để cuốn sổ giấy và sổ số cùng kể một chuyện.', focus: 'Gemini Pro + Google One 5 TB · Office 365' },
      { name: 'Màu của một buổi chiều', copy: 'Linh sửa lại tấm ảnh chiều hôm trước rồi ghép vài khung hình. Cuốn sổ giờ có cả hình lẫn lời.', focus: 'Adobe · CapCut Pro · Claude Pro x5' },
      { name: 'Bài hát trên đường', copy: 'Bạn gửi một playlist cho chuyến đi. Linh nghe thử, giữ lại ba bài và ghi tên vào trang còn trống.', focus: 'Spotify Premium · chọn gói nghe phù hợp' },
      { name: 'Tối về nhà', copy: 'Chuyến đi khép lại bằng một tối xem phim. Linh cất cuốn sổ, để những đoạn video đợi đến ngày mai.', focus: 'Netflix 4K Private · YouTube Premium ổn định' },
      { name: 'Trang để dành', copy: 'Linh dán tấm ảnh cuối vào sổ. Trang kế bên được để trống, vừa đủ chỗ cho lời hẹn của tuần tới.', focus: 'Bảng giá đủ nhóm sản phẩm · mở ticket để chọn đúng gói' },
    ]),
  }),
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
  const story = WEEKLY_STORIES[Math.abs(weekNumber) % WEEKLY_STORIES.length];
  return {
    title: story.title,
    premise: story.premise,
    weekKey,
    chapter: story.chapters[mondayOffset],
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

function campaignArtwork(customEmojis = {}) {
  const get = (name, fallback) => campaignIcon(customEmojis, `cenar_autumn_202610_${name}`, fallback);
  return { ticket: get('ticket', '🎟️'), cup: get('cup', '☕'), spark: get('spark', '✦'), leaves: get('leaves', '🍂') };
}

function hasCurrentCampaignBanner(now) {
  const { year, month } = zonedParts(now);
  return year === '2026' && month === '10';
}

function renderPromotionRow(row, icon) {
  let price = row.formattedPrice || `${new Intl.NumberFormat('vi-VN').format(row.price)}đ`;
  if (row.priceUnit === 'slot' && !price.endsWith('/slot')) price += '/slot';
  if (row.priceUnit === 'ngày đầu') price += ' / ngày đầu';
  if (row.priceUnit === 'khởi điểm') price = `Từ ${price}`;
  const details = [row.duration, row.account, row.warranty].filter(Boolean);
  const notes = [row.dailyPricingNote, ...(Array.isArray(row.notes) ? row.notes : [row.notes])].filter(Boolean).join(' ');
  return [
    `${icon} **${row.label}** · **${price}**`,
    details.length ? `-# ${details.join(' · ')}` : null,
    notes ? `-# ${notes}` : null,
  ].filter(Boolean).join('\n');
}

// Preserve complete rows and source labels while splitting a long category.
// This prevents a growing catalog from silently dropping products or exceeding
// the Components V2 4,000-character limit. The remaining budget is reserved for
// campaign titles, controls and the durable rebuild's cutover marker.
function promotionSectionChunks(customEmojis) {
  const art = campaignArtwork(customEmojis);
  const chunks = [];
  for (const section of PROMOTION_CATALOG_SECTIONS) {
    const rows = PROMOTION_CATALOG_ROWS.filter((row) => row.section === section.key);
    if (!rows.length) continue;
    let lines = [`## ${art.leaves} ${section.title}`, section.subtitle ? `> ${section.subtitle}` : null].filter(Boolean);
    let source = null;
    let index = 1;
    const flush = () => {
      chunks.push({ key: `${section.key}-${index++}`, text: lines.join('\n') });
      lines = [`## ${art.leaves} ${section.title} · tiếp`];
      source = null;
    };
    for (const row of rows) {
      const sourceLabel = row.source === 'SALE' ? '**Giá khuyến mãi shop đã công bố**' : '**Giá niêm yết hiện hành**';
      const text = renderPromotionRow(row, row.source === 'SALE' ? art.ticket : art.spark);
      const add = [...(source !== row.source ? [`\n${sourceLabel}`] : []), text];
      if ([...lines, ...add].join('\n\n').length > 2700 && source !== null) flush();
      if (source !== row.source) lines.push(`\n${sourceLabel}`);
      lines.push(text);
      source = row.source;
      if (lines.join('\n\n').length > 2700) {
        throw new Error(`Dòng giá quá dài để đăng lên Discord: ${row.key}`);
      }
    }
    chunks.push({ key: `${section.key}-${index}`, text: lines.join('\n\n') });
  }
  return chunks;
}

export function buildDailyColorSaleSections({
  customEmojis = {},
  now = new Date(),
} = {}) {
  const art = campaignArtwork(customEmojis);
  const theme = dailySaleTheme(now);
  const story = weeklySaleStory(now);
  return {
    hero: [
      `# ${art.cup} CENAR ATELIER`,
      `## ${art.leaves} ${theme.name.toUpperCase()} · BẢNG GIÁ THÁNG ${zonedParts(now).month}`,
      `> ${theme.tagline}`,
      `${art.spark} **Chuyện tuần này: ${story.title}**`,
      `-# ${story.premise}`,
      `-# Giá sale và giá niêm yết được ghi riêng. Mở ticket để chốt đúng gói, thời hạn và bảo hành.`,
    ].join('\n'),
    ...Object.fromEntries(promotionSectionChunks(customEmojis).map((section) => [section.key, section.text])),
    closing: [
      `## ${art.cup} CHỌN VỪA ĐỦ. DÙNG THẬT VUI.`,
      `${art.ticket} Mua giá chương trình: mở ticket chọn gói, nhận QR sau khi shop xác nhận.`,
      `-# Website áp dụng giá hiển thị lúc chốt đơn. Shop kiểm tra tồn kho, tài khoản và thời gian xử lý tại ticket.`,
      `${art.leaves} KBH: không bảo hành. BHF/FBH: bảo hành full theo thời hạn ghi trên gói. Bảo hành gói và tài khoản là hai quyền lợi khác nhau.`,
      `-# Giá có hiệu lực đến lần cập nhật tiếp theo. Không gửi mật khẩu hay OTP tại kênh công khai.`,
    ].join('\n'),
  };
}

export function buildDailyColorSaleMessages({
  guildId = DAILY_COLOR_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  tagEveryone = false,
  tagMember = false,
  now = new Date(),
} = {}) {
  const sections = buildDailyColorSaleSections({ customEmojis, now });
  const theme = dailySaleTheme(now);
  const supportUrl = `https://discord.com/channels/${guildId}/${DAILY_COLOR_SALE.supportChannelId}`;
  const priceUrl = `https://discord.com/channels/${guildId}/${DAILY_COLOR_SALE.priceChannelId}`;
  const mentions = [tagEveryone ? '@everyone' : null, tagMember ? `<@&${DAILY_COLOR_SALE.memberRoleId}>` : null].filter(Boolean).join(' · ');
  const buttons = new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Chọn Gói Qua Ticket').setURL(supportUrl),
      customEmojis?.cenar_autumn_202610_ticket?.component, E.component?.('ticket_open')),
    withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Website').setURL(DAILY_COLOR_SALE.storeUrl),
      customEmojis?.cenar_autumn_202610_cup?.component, E.component?.('icon_store')),
    withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Bảng Giá Niêm Yết').setURL(priceUrl),
      customEmojis?.cenar_autumn_202610_spark?.component, E.component?.('icon_price')),
  );
  const chunks = Object.entries(sections).filter(([key]) => !['hero', 'closing'].includes(key)).map(([, text]) => text);
  const pages = chunks.map((text, index) => [index ? `# ${campaignArtwork(customEmojis).cup} Cenar Atelier · ${theme.name}` : `${mentions ? `${mentions}\n` : ''}${sections.hero}`, text]);
  if (!pages.length) throw new Error('Bảng giá khuyến mãi đang trống.');
  if ([...pages.at(-1), sections.closing].join('\n').length <= 3500) pages.at(-1).push(sections.closing);
  else pages.push([sections.closing]);
  const silentMentions = { parse: [], roles: [], users: [], repliedUser: false };
  return pages.map((content, index) => {
    content.push(`-# ${DAILY_COLOR_SALE.marker}-PART-${index + 1} · ${DAILY_COLOR_SALE.revision}`);
    if (content.join('\n').length > 3500) throw new Error(`Phần bảng giá ${index + 1} vượt giới hạn an toàn Discord.`);
    const container = panel(theme.colors[0], content, index === pages.length - 1 ? buttons : null);
    if (!index && hasCurrentCampaignBanner(now)) {
      container.spliceComponents(1, 0, new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${campaignBannerName}`)
          .setDescription('Cenar Atelier · Trạm Thu Dịu, bộ sưu tập tiện ích số tháng 10 trong sắc đồng, kem và xanh trà.'),
      ));
    }
    return {
      components: [container], flags: MessageFlags.IsComponentsV2,
      ...(index ? {} : { attachments: [], ...(hasCurrentCampaignBanner(now) ? { files: [{ attachment: campaignBannerPath, name: campaignBannerName }] } : {}) }),
      allowedMentions: index ? silentMentions : {
        parse: tagEveryone ? ['everyone'] : [], roles: tagMember ? [DAILY_COLOR_SALE.memberRoleId] : [], users: [], repliedUser: false,
      },
    };
  });
}

export async function preparePromotionRebuild(guild, { now = new Date() } = {}) {
  validateEmojiAssets();
  if (hasCurrentCampaignBanner(now) && (!fs.existsSync(campaignBannerPath) || !fs.statSync(campaignBannerPath).size)) {
    throw new Error(`Thiếu banner Trạm Thu Dịu: ${campaignBannerPath}`);
  }
  const { emojis } = await syncDailyColorSaleEmojis(guild);
  return {
    revision: DAILY_COLOR_SALE.revision,
    boardPayloads: buildDailyColorSaleMessages({ guildId: guild.id, customEmojis: emojis, tagEveryone: false, tagMember: false, now }),
    buildDailyPayload: (boardId) => buildDailyFlashSaleMessage({ guildId: guild.id, customEmojis: emojis, boardMessageId: boardId, tagEveryone: false, tagMember: false, now }),
    saleData: { campaign: DAILY_COLOR_SALE.campaignName, revision: DAILY_COLOR_SALE.revision, rows: PROMOTION_CATALOG_ROWS },
    emojiNames: DAILY_COLOR_SALE_EMOJIS.map((asset) => asset.name),
  };
}

export function dailyColorSalePart(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return null;
  const serialized = JSON.stringify(message.toJSON?.() || message);
  const match = serialized.match(new RegExp(`${DAILY_COLOR_SALE.marker}-PART-(\\d+)`));
  return match ? Number(match[1]) : null;
}

function serializedMessage(message) {
  return JSON.stringify(message?.toJSON?.() || message || {});
}

export function dailyFlashSaleMarker(date = new Date()) {
  return `${DAILY_COLOR_SALE.dailyMarker}:${dailySaleDateKey(date)}`;
}

export function dailyFlashSaleNonce(guildId, date = new Date()) {
  const nonce = `cs${BigInt(guildId).toString(36)}-${dailySaleDateKey(date).replaceAll('-', '')}`;
  if (nonce.length > 25) throw new Error('Nonce Flash Sale vượt giới hạn Discord.');
  return nonce;
}

export function dailyFlashSaleDateFromMessage(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return null;
  const escaped = DAILY_COLOR_SALE.dailyMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = serializedMessage(message).match(new RegExp(`${escaped}:(\\d{4}-\\d{2}-\\d{2})`));
  return match?.[1] || null;
}

function chooseDailyFlashSaleMessage(messages, dateKey, botId) {
  return messages
    .filter((message) => dailyFlashSaleDateFromMessage(message, botId) === dateKey)
    .sort((left, right) => {
      const leftCurrent = serializedMessage(left).includes(DAILY_COLOR_SALE.revision);
      const rightCurrent = serializedMessage(right).includes(DAILY_COLOR_SALE.revision);
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
      // Discord snowflakes are integers stored as strings. Prefer the older
      // ID among equally current candidates to keep the canonical link stable.
      const leftId = String(left.id || '');
      const rightId = String(right.id || '');
      return leftId.length - rightId.length || leftId.localeCompare(rightId);
    })[0] || null;
}

async function removeDuplicateDailyFlashSaleMessages(messages, canonical, dateKey, botId) {
  let removed = 0;
  for (const message of messages) {
    if (String(message.id) === String(canonical.id)
      || dailyFlashSaleDateFromMessage(message, botId) !== dateKey) continue;
    try {
      await message.delete();
      removed += 1;
    } catch (error) {
      if (Number(error?.code) === 10008) { // Already removed on Discord.
        removed += 1;
        continue;
      }
      // Reject instead of reporting the day complete, so the minute scheduler
      // retries cleanup while preserving the successfully published chapter.
      const cleanupError = new Error('Chưa xoá được bài Flash Sale trùng hôm nay; sẽ thử lại sau.');
      cleanupError.code = 'DAILY_DUPLICATE_CLEANUP_FAILED';
      throw cleanupError;
    }
  }
  return removed;
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

async function publishDailyColorSaleInternal(client, { tagEveryone = false, tagMember = false, now = new Date() } = {}) {
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
    revision: DAILY_COLOR_SALE.revision,
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
  boardPublishPromise = (async () => {
    const now = options.now || new Date();
    await rebuildPromotionCampaign(client, {
      revision: DAILY_COLOR_SALE.revision,
      prepare: (guild) => preparePromotionRebuild(guild, { now }),
      now,
    });
    return publishDailyColorSaleInternal(client, options);
  })()
    .finally(() => { boardPublishPromise = null; });
  return boardPublishPromise;
}

export function buildDailyFlashSaleMessage({
  guildId = DAILY_COLOR_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  boardMessageId,
  tagEveryone = true,
  tagMember = false,
  now = new Date(),
} = {}) {
  if (!/^\d{15,22}$/.test(String(boardMessageId || ''))) {
    throw new Error('Thiếu ID bảng giá Flash Sale để tạo bài hằng ngày.');
  }
  const { ticket: tag, leaves: leaf, cup: gift } = campaignArtwork(customEmojis);
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
    tagEveryone ? '@everyone' : null,
    tagMember ? `<@&${DAILY_COLOR_SALE.memberRoleId}>` : null,
    `# ${gift} CENAR ATELIER · ${hasCurrentCampaignBanner(now) ? 'CHUYỆN MÙA THU' : 'CHUYỆN THÁNG MỚI'}`,
    `-# THÁNG ${zonedParts(now).month} · ${theme.name.toUpperCase()} · ${dateLabel}`,
    `## ${leaf} ${story.title} · Chương ${story.dayIndex + 1}/7`,
    `> **${story.chapter.name}:** ${story.chapter.copy}`,
    `${tag} **Gợi ý cho ngày hôm nay:** ${story.chapter.focus}`,
    `${leaf} ${theme.tagline}`,
    '',
    `${leaf} Giá, thời hạn và bảo hành có trong **[bảng giá Trạm Thu Dịu](${boardUrl})**.`,
    `${tag} Mở ticket để shop kiểm tra tồn kho và điều kiện tài khoản trước khi thanh toán.`,
    `-# ${DAILY_COLOR_SALE.dailyMarker}:${dateKey} · STORY-WEEK:${story.weekKey} · ${DAILY_COLOR_SALE.revision}`,
  ].filter(Boolean).join('\n');

  const orderButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Chọn Gói Qua Ticket').setURL(supportUrl),
    customEmojis?.cenar_autumn_202610_ticket?.component,
    E.component?.('ticket_open'),
  );
  const boardButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Bảng Giá Trạm Thu Dịu').setURL(boardUrl),
    customEmojis?.cenar_autumn_202610_leaves?.component,
    E.component?.('icon_price'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Website').setURL(DAILY_COLOR_SALE.storeUrl),
    customEmojis?.cenar_autumn_202610_cup?.component,
    E.component?.('icon_store'),
  );

  return {
    components: [panel(theme.colors[story.dayIndex % theme.colors.length], [storyText],
      new ActionRowBuilder().addComponents(orderButton, boardButton, storeButton))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: tagEveryone ? ['everyone'] : [],
      roles: tagMember ? [DAILY_COLOR_SALE.memberRoleId] : [],
      users: [],
      repliedUser: false,
    },
  };
}

async function publishDailyFlashSaleInternal(client, {
  now = new Date(),
  force = false,
  tagEveryone = true,
  tagMember = false,
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
  const member = guild.members.me || await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageGuildExpressions,
  ];
  if (!channel.permissionsFor(member)?.has(required)) {
    throw new Error('Bot thiếu quyền gửi bài, quản lý bảng giá, đồng bộ emoji hoặc tag role tại kênh khuyến mãi.');
  }

  const dateKey = dailySaleDateKey(now);
  let recentMessages = await fetchAllMessages(channel);
  let existing = chooseDailyFlashSaleMessage(recentMessages, dateKey, client.user.id);
  if (existing && serializedMessage(existing).includes(DAILY_COLOR_SALE.revision)) {
    const removedDuplicates = await removeDuplicateDailyFlashSaleMessages(recentMessages, existing, dateKey, client.user.id);
    return {
      status: 'already_posted',
      action: removedDuplicates ? 'deduplicated' : 'current',
      revision: DAILY_COLOR_SALE.revision,
      removedDuplicates,
      dateKey,
      messageId: existing.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${existing.id}`,
    };
  }

  // Only a new daily post can notify. Silent content recovery must keep
  // working even if the mention permission or old member role changes.
  if (!existing && (tagEveryone || tagMember)
    && !channel.permissionsFor(member)?.has(PermissionFlagsBits.MentionEveryone)) {
    throw new Error('Bot thiếu quyền Mention Everyone để thông báo tại kênh khuyến mãi.');
  }
  if (!existing && tagMember && !guild.roles.cache.has(DAILY_COLOR_SALE.memberRoleId)) {
    throw new Error(`Không tìm thấy role Cenar Member ${DAILY_COLOR_SALE.memberRoleId}.`);
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
  recentMessages = await fetchAllMessages(channel);
  // Refreshing a complete board takes time. A separate publisher may have
  // posted today's chapter meanwhile; recover it instead of sending/pinging.
  existing = chooseDailyFlashSaleMessage(recentMessages, dateKey, client.user.id);
  if (existing && serializedMessage(existing).includes(DAILY_COLOR_SALE.revision)) {
    const removedDuplicates = await removeDuplicateDailyFlashSaleMessages(recentMessages, existing, dateKey, client.user.id);
    return {
      status: 'already_posted',
      action: removedDuplicates ? 'deduplicated' : 'current',
      revision: DAILY_COLOR_SALE.revision,
      removedDuplicates,
      dateKey,
      messageId: existing.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${existing.id}`,
    };
  }

  const payload = buildDailyFlashSaleMessage({
    guildId: guild.id,
    customEmojis: emojiResult.emojis,
    boardMessageId: boardMessage.id,
    // A content revision updates today's existing message without sending
    // another notification to members or creating a second daily chapter.
    tagEveryone: existing ? false : tagEveryone,
    tagMember: existing ? false : tagMember,
    now,
  });
  // The shared guild/date nonce also protects the smaller cross-process race
  // between the final history read and Discord accepting the create request.
  // Edits deliberately omit create-only nonce fields.
  const message = existing ? await existing.edit(payload) : await channel.send({
    ...payload,
    nonce: dailyFlashSaleNonce(guild.id, now),
    enforceNonce: true,
  });
  const removedDuplicates = await removeDuplicateDailyFlashSaleMessages(recentMessages, message, dateKey, client.user.id);

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
    status: existing ? 'already_posted' : 'posted',
    action: existing ? 'updated' : 'created',
    revision: DAILY_COLOR_SALE.revision,
    removedDuplicates,
    dateKey,
    weekKey: weeklySaleStory(now).weekKey,
    messageId: message.id,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    removedExpired,
  };
}

export function publishDailyFlashSale(client, options = {}) {
  if (dailyPublishPromise) return dailyPublishPromise;
  dailyPublishPromise = (async () => {
    const now = options.now || new Date();
    await rebuildPromotionCampaign(client, {
      revision: DAILY_COLOR_SALE.revision,
      prepare: (guild) => preparePromotionRebuild(guild, { now }),
      now,
    });
    return publishDailyFlashSaleInternal(client, options);
  })()
    .finally(() => { dailyPublishPromise = null; });
  return dailyPublishPromise;
}
