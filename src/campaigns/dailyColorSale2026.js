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
  revision: 'CENAR-SALE-REVISION:AI-WORKBENCH-20261002',
  campaignName: 'Cenar Studio · Bàn Làm Việc Có Gu',
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
  Object.freeze({ name: 'Bàn Làm Việc Có Gu', tagline: 'Gói đúng việc. Giá rõ ràng. Một góc làm việc mang dấu ấn của bạn.', colors: [0x76E0B6, 0xFF8B78, 0xB6A3F3, 0xE8C77D] }),
  Object.freeze({ name: 'Gom Điều Hay', tagline: 'Chọn những quyền lợi thiết thực cho mùa cuối năm.', colors: [0xD97706, 0x84CC16, 0x8B5CF6] }),
  Object.freeze({ name: 'Kết Năm Thật Chill', tagline: 'Khép năm bằng trải nghiệm liền mạch và niềm vui dài lâu.', colors: [0xEF4444, 0x22C55E, 0xFBBF24] }),
]);

const WEEKLY_STORIES = Object.freeze([
  Object.freeze({
    title: 'Chiếc Bàn Còn Một Góc Trống',
    premise: 'Mai nhận một dự án mới. Bảy ngày để biến góc bàn trống thành góc làm việc của riêng mình.',
    chapters: Object.freeze([
      { name: 'Tờ giấy đầu tiên', copy: 'Mai đặt bản brief lên chiếc bàn trống, viết ra ba việc cần làm rồi chọn công cụ AI theo đúng nhu cầu.', focus: 'ChatGPT Plus chính chủ từ 485.000đ' },
      { name: 'Cuộc hẹn của nhóm', copy: 'Tờ giấy có thêm tên đồng đội. Mai mở phòng trao đổi, ghi lại ý kiến và chọn gói kết nối cho cả nhóm.', focus: 'Nitro Boost Login từ 85.000đ · Boost Server từ 110.000đ' },
      { name: 'Chiếc ngăn kéo số', copy: 'Tài liệu đã đầy mặt bàn. Mai xếp chúng vào từng thư mục để ngày mai không phải đi tìm lại từ đầu.', focus: 'Gemini Pro + Google One 5 TB từ 120.000đ · Office 365 200.000đ' },
      { name: 'Bản nháp có hình hài', copy: 'Mai đặt bản nháp cạnh bản brief. Cô chọn gói ChatGPT hoặc Claude, rồi dùng CapCut để thử nhịp kể cho ý tưởng.', focus: 'ChatGPT · Claude Pro x5 · CapCut Pro từ 55.000đ' },
      { name: 'Giai điệu ở góc bàn', copy: 'Bản nháp vừa xong, Mai kéo ghế ra một chút. Một playlist bật lên, chiếc bàn bận rộn cũng có khoảng nghỉ.', focus: 'Spotify Premium từ 110.000đ · AI chính chủ hoặc cấp acc, bảo hành ghi rõ' },
      { name: 'Màn hình sau giờ làm', copy: 'Mai gửi bản nháp cho nhóm rồi đóng tài liệu. Góc bàn chuyển sang một bộ phim và những nội dung cô đã để dành.', focus: 'Netflix 4K Private 75.000đ · YouTube Premium từ 58.000đ' },
      { name: 'Góc bàn của riêng mình', copy: 'Dự án đầu tiên khép lại. Mai giữ những công cụ mình thực sự dùng và ghi chú rõ gói, thời hạn, bảo hành cho lần sau.', focus: 'Xem đủ bảng giá · chọn đúng tài khoản và quyền lợi' },
    ]),
  }),
  Object.freeze({
    title: 'Quán Nhỏ Sáng Đèn Lúc 9 Giờ',
    premise: 'An chuẩn bị mở một quán nhỏ. Từ trang giấy đến buổi tối đầu tiên, mỗi ngày thêm một mảnh ghép.',
    chapters: Object.freeze([
      { name: 'Tên quán trên giấy', copy: 'An viết tên quán lên giấy, liệt kê câu hỏi và chọn gói AI phù hợp để cùng làm bản nháp đầu tiên.', focus: 'ChatGPT Plus chính chủ · chọn bảo hành gói hoặc bảo hành full' },
      { name: 'Nhóm cộng sự', copy: 'Tên quán đã có, An mời nhóm cộng sự vào phòng trò chuyện. Mỗi người nhận một phần việc cho ngày khai trương.', focus: 'Nitro Boost Login · Boost Server' },
      { name: 'Hộp hồ sơ của quán', copy: 'Menu, ảnh và bảng chi phí cần một chỗ lưu chung. An sắp xếp hồ sơ trước khi bắt tay vào nội dung.', focus: 'Google One 5 TB · Office 365 + OneDrive 1 TB' },
      { name: 'Tấm menu đầu tiên', copy: 'An đọc lại nội dung menu, thử vài cách kể rồi ghép thành đoạn video giới thiệu ngắn cho quán.', focus: 'ChatGPT · Claude Pro x5 · CapCut Pro' },
      { name: 'Khoảng nghỉ trước giờ mở', copy: 'Menu đã đặt lên bàn. An ngồi xuống kiểm tra từng quyền lợi của gói AI, một playlist riêng đang chạy trong tai nghe.', focus: 'Spotify Premium · xem rõ KBH, bảo hành gói và bảo hành full' },
      { name: 'Buổi tối đầu tiên', copy: 'Quán vừa đóng cửa sau ngày đầu. An cất điện thoại, chọn một bộ phim để thưởng cho mình một tối chậm rãi.', focus: 'Netflix Premium · YouTube Premium ổn định' },
      { name: 'Trang sổ mới', copy: 'An mở sổ của tuần tiếp theo, giữ lại những công cụ hữu ích và ghi rõ những khoản cần gia hạn.', focus: 'Toàn bộ bảng giá Cenar Studio' },
    ]),
  }),
  Object.freeze({
    title: 'Bưu Kiện Gửi Cho Tuần Mới',
    premise: 'Linh nhận một hộp đồ cho dự án cá nhân. Bảy ngày mở hộp, thử việc và chọn thứ đáng giữ lại.',
    chapters: Object.freeze([
      { name: 'Chiếc hộp đầu tuần', copy: 'Linh mở hộp, đặt tờ kế hoạch lên bàn. Công cụ đầu tiên được chọn theo việc cần làm và kiểu tài khoản mong muốn.', focus: 'ChatGPT Plus · chính chủ hoặc cấp acc' },
      { name: 'Lời mời trong hộp', copy: 'Mảnh giấy thứ hai là lời mời bạn bè cùng góp ý. Linh chuẩn bị chỗ trò chuyện để ý tưởng được nghe rõ hơn.', focus: 'Nitro Boost Login · Boost Server' },
      { name: 'Chỗ cho tài liệu', copy: 'Ảnh và tài liệu đã nhiều hơn dự tính. Linh dành một buổi sắp xếp để chiếc hộp số có chỗ cho phần việc tiếp theo.', focus: 'Gemini Pro + Google One 5 TB · Office 365' },
      { name: 'Thử một bản dựng', copy: 'Một tờ storyboard được lấy ra khỏi hộp. Linh thử ChatGPT hoặc Claude cho bản nháp rồi dựng thử bằng CapCut.', focus: 'ChatGPT Pro · Claude Pro x5 · CapCut Pro' },
      { name: 'Mảnh ghép nghe được', copy: 'Bản dựng có hình, chiếc hộp có thêm âm nhạc. Linh nghỉ một nhịp rồi đọc kỹ điều kiện bảo hành trước khi chọn gói tiếp theo.', focus: 'Spotify Premium · quyền lợi AI ghi riêng từng gói' },
      { name: 'Một tối mở màn', copy: 'Linh gửi bản dựng cho bạn bè. Hộp đồ tạm khép lại, một buổi xem phim mở ra để cuối tuần có thời gian nghỉ.', focus: 'Netflix 4K Private · YouTube Premium ổn định' },
      { name: 'Giữ thứ hợp mình', copy: 'Linh xếp lại chiếc hộp. Những công cụ đúng nhu cầu được giữ lại, kèm một ghi chú về giá, thời hạn và bảo hành.', focus: 'Xem bảng giá · mở ticket để được tư vấn đúng gói' },
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
      `## ${leaf} BẢNG GIÁ SALE · THÁNG ${zonedParts(now).month}`,
      `> ${theme.tagline}`,
      `${tag} **Một tuần, một câu chuyện:** ${story.title}`,
      `-# ${story.premise}`,
      `${leaf} **01 / KẾT NỐI** · AI và công cụ ở phần tiếp theo; giải trí ở phần cuối.`,
      `-# ${DAILY_COLOR_SALE.marker}-PART-1 · ${DAILY_COLOR_SALE.revision} · Giá hiện hành đến khi shop công bố cập nhật mới.`,
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
    aiHeader: [
      `# ${tag} 02 / AI · CHỌN GÓI ĐÚNG VIỆC`,
      '> Giữ tài khoản của mình hay nhận tài khoản từ shop? Chọn cách mua trước, rồi xem quyền lợi bảo hành.',
      `-# Các gói AI dưới đây đều có thời hạn **01 tháng**. Pro 100 / 200 / 500 và x5 là tên gói shop niêm yết; không phải cam kết về hạn mức dùng.`,
      `-# ${DAILY_COLOR_SALE.marker}-PART-2 · ${DAILY_COLOR_SALE.revision}`,
    ].join('\n'),
    chatgptOwn: [
      `## ${E('brand_chatgpt')} CHATGPT · TÀI KHOẢN CHÍNH CHỦ`,
      `${tag} \`Plus · bảo hành gói\` — **485.000đ** · Không bảo hành tài khoản`,
      `${tag} \`Plus · bảo hành full\` — **500.000đ**`,
      `${tag} \`Pro 100 · bảo hành gói\` — **2.650.000đ**`,
      `${tag} \`Pro 200\` — **4.800.000đ**`,
      `${tag} \`Pro 500\` — **12.700.000đ**`,
      `-# ${E('status_info')} Pro 200 và Pro 500: xác nhận chính sách bảo hành với shop tại ticket trước khi thanh toán.`,
    ].join('\n'),
    chatgptSuppliedClaude: [
      `## ${E('brand_chatgpt')} CHATGPT · SHOP CẤP TÀI KHOẢN`,
      `${leaf} \`Pro 100 · KBH\` — **1.900.000đ** · Không bảo hành`,
      `${leaf} \`Pro 100 · BHF\` — **2.300.000đ** · Bảo hành full`,
      `${leaf} \`Cấp acc · bảo hành 02 ngày\` — **120.000đ**`,
      `-# Gói 120k: bảo hành ngắn để phản ánh rủi ro. Thực tế có thể dùng lâu hơn tùy cách sử dụng; không cam kết thời gian dùng vượt quá bảo hành. Shop xác nhận loại gói tại ticket.`,
      '',
      `## ${E('brand_claude')} CLAUDE PRO x5 · SHOP CẤP TÀI KHOẢN`,
      `${gift} \`01 tháng · KBH\` — **1.900.000đ** · Không bảo hành`,
      `${gift} \`01 tháng · BHF\` — **2.500.000đ** · Bảo hành full`,
    ].join('\n'),
    productivityHeader: [
      `# ${tag} 03 / SÁNG TẠO & LƯU TRỮ`,
      '> Một chỗ cho tài liệu. Một công cụ cho ý tưởng. Chọn đủ những gì bạn thực sự dùng.',
      `-# ${DAILY_COLOR_SALE.marker}-PART-3 · ${DAILY_COLOR_SALE.revision}`,
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
    capcut: [
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${gift} \`01 tháng\` — **55.000đ**`,
      `${gift} \`06 tháng\` — **290.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${gift} 04 / TAN CA · BẬT GU RIÊNG`,
      '> Một playlist cho mình, một tối xem thật thư thả. Chọn gói theo nhịp dùng của bạn.',
      `-# ${DAILY_COLOR_SALE.marker}-PART-4 · ${DAILY_COLOR_SALE.revision}`,
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
      `> ${leaf} **Gói đúng việc. Giá rõ ràng. Cenar cùng bạn chọn.**`,
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
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Các Gói Khác').setURL(priceUrl),
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
      components: [panel(theme.colors[1], [sections.aiHeader, sections.chatgptOwn, sections.chatgptSuppliedClaude])],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: silentMentions,
    },
    {
      components: [panel(theme.colors[2], [sections.productivityHeader, sections.geminiOffice, sections.capcut])],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: silentMentions,
    },
    {
      components: [panel(theme.colors[3] ?? theme.colors[0], [sections.entertainmentHeader, sections.spotifyYoutube, sections.closing], actions)],
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
    `# ${gift} CENAR STUDIO · SALE 09:00`,
    `-# THÁNG ${zonedParts(now).month} · ${theme.name.toUpperCase()} · ${dateLabel}`,
    `## ${leaf} ${story.title} · Chương ${story.dayIndex + 1}/7`,
    `> **${story.chapter.name}:** ${story.chapter.copy}`,
    `${tag} **Gói trên bàn hôm nay:** ${story.chapter.focus}`,
    `${leaf} ${theme.tagline}`,
    '',
    `${E('status_check')} Giá, thời hạn và bảo hành được ghi rõ trong **[bảng giá Flash Sale](${boardUrl})**.`,
    `${E('cenar_support')} Mở ticket để shop kiểm tra tồn kho và điều kiện tài khoản trước khi thanh toán.`,
    `-# ${DAILY_COLOR_SALE.dailyMarker}:${dateKey} · STORY-WEEK:${story.weekKey} · ${DAILY_COLOR_SALE.revision}`,
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
  if (existing && serializedMessage(existing).includes(DAILY_COLOR_SALE.revision)) {
    return {
      status: 'already_posted',
      action: 'current',
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
    // A content revision updates today's existing message without sending
    // another notification to members or creating a second daily chapter.
    tagMember: existing ? false : tagMember,
    now,
  });
  const message = existing ? await existing.edit(payload) : await channel.send(payload);

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
