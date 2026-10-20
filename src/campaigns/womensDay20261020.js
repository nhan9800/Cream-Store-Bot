import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';

// Deliberate operator publication only. Never import from bootstrap/schedulers.
// These are ticket quotations; regular catalog/checkout totals are untouched.
export const WOMENS_DAY = Object.freeze({
  guildId: '1282637033340403754', botId: '1382729296724099132',
  promotionChannelId: '1515008584549797979', announcementChannelId: '1514598369597587546',
  supportChannelId: '1514607020098191393', marker: 'CENAR-2010-20261020',
  boardIds: ['1558114533179138169', '1558114540988797069', '1558114546210832406'],
  noticeId: '1558116733095518302',
});
export const WOMENS_DAY_EMOJIS = Object.freeze([
  { key: 'flower', name: 'cenar_2010_tulips', file: 'flower.png',
    source: 'https://emoji.gg/emoji/13054-pinkflowers', creator: '☆ カリー ☆' },
  { key: 'ribbon', name: 'cenar_2010_heart_ribbon', file: 'ribbon.gif',
    source: 'https://emoji.gg/emoji/137936-heartribbon', creator: 'tikka ♡₊ ⊹' },
  { key: 'jewel', name: 'cenar_2010_jewel_bow', file: 'jewel.png',
    source: 'https://emoji.gg/emoji/383586-blackpinkheartjewelbow', creator: '𝓟𝓻𝓮𝓽𝓽𝔂𝓟𝓸𝓲𝓼𝓸𝓷' },
].map((asset) => Object.freeze({ ...asset,
  path: fileURLToPath(new URL(`../../assets/campaigns/womens-day-20261020/${asset.file}`, import.meta.url)),
})));

const offer = (label, price, terms = '') => Object.freeze({ label, price, terms });
const group = (key, emoji, title, offers, note = '') => Object.freeze({ key, emoji, title, offers, note });
export const WOMENS_DAY_GROUPS = Object.freeze([
  group('nitro', 'cenar_price_nitro', 'NITRO BOOST LOGIN', [
    offer('1 tháng', 85000), offer('2 tháng · chờ 1–3 ngày', 99000),
    offer('2 tháng · có liền', 120000), offer('4 tháng · có liền', 230000),
    offer('6 tháng · có liền', 330000), offer('8 tháng · có liền', 450000),
    offer('12 tháng · có liền · gia hạn auto', 550000),
    offer('12 tháng · mua thẳng 1 năm · có liền', 830000), offer('Trial Boost 3 tháng', 55000),
  ]),
  group('boost', 'cenar_boost', 'BOOST SERVER · NÂNG CẤP MÁY CHỦ', [
    offer('1 tháng', 110000), offer('3 tháng', 290000),
  ]),
  group('gemini', 'cenar_gemini', 'GEMINI PRO + GOOGLE ONE · 5 TB', [
    offer('12 tháng', 150000), offer('18 tháng', 200000),
  ]),
  group('office', 'cenar_office365', 'OFFICE 365 + ONEDRIVE · 1 TB', [offer('12 tháng', 200000)]),
  group('chatgpt', 'cenar_price_chatgpt', 'CHATGPT', [
    offer('1 tháng · MoMo Pay', 130000, 'Bảo hành 15 ngày'),
    offer('1 tháng · chính chủ', 480000, 'Bảo hành full'),
    offer('4 tháng', 650000, 'Bảo hành full'),
  ], 'MoMo Pay: tỷ lệ die theo shop ghi nhận khoảng 2%; bảo hành 15 ngày theo gói.'),
  group('capcut', 'cenar_capcut', 'CAPCUT PRO', [offer('1 tháng', 55000), offer('6 tháng', 350000)]),
  group('combo', 'cenar_gemini', 'GEMINI PRO + 5 TB + YOUTUBE PREMIUM', [
    offer('2 năm · không bảo hành', 320000), offer('2 năm · bảo hành full', 650000),
  ]),
  group('netflix', 'cenar_price_netflix', 'NETFLIX PREMIUM · 4K PRIVATE', [offer('1 tháng', 75000)]),
  group('spotify', 'cenar_spotify', 'SPOTIFY PREMIUM', [
    offer('3 tháng', 110000), offer('6 tháng', 190000), offer('12 tháng', 290000),
  ]),
  group('youtube', 'cenar_yt_logo', 'YOUTUBE PREMIUM · ỔN ĐỊNH', [
    offer('1 tháng', 58000), offer('3 tháng', 185000), offer('6 tháng', 295000), offer('12 tháng', 530000),
  ]),
]);
export const SILENT_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], replied_user: false });
export const campaignMessageUrl = (channel, message) => `https://discord.com/channels/${WOMENS_DAY.guildId}/${channel}/${message}`;
const text = (content) => new TextDisplayBuilder().setContent(content);
function panel(color, sections, footer, actions = []) {
  const container = new ContainerBuilder().setAccentColor(color);
  sections.forEach((section, index) => {
    if (index) container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(text(section));
  });
  if (actions.length) container.addActionRowComponents(new ActionRowBuilder().addComponents(actions));
  container.addTextDisplayComponents(text(`-# ${footer}`));
  return { components: [container.toJSON()], flags: Number(MessageFlags.IsComponentsV2), allowed_mentions: SILENT_MENTIONS };
}
function button(label, url, emoji) {
  return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link)
    .setEmoji({ id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated) });
}
export function buildWomensDayCampaign({ emojis }) {
  const E = (name) => {
    const e = emojis[name];
    if (!e?.id || !/^\d{15,22}$/.test(e.id) || !/^\w{2,32}$/.test(e.name)) throw new Error(`CAMPAIGN_EMOJI_MISSING:${name}`);
    return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
  };
  const flower = E('cenar_2010_tulips'), ribbon = E('cenar_2010_heart_ribbon'), jewel = E('cenar_2010_jewel_bow');
  const groups = Object.fromEntries(WOMENS_DAY_GROUPS.map((g) => [g.key, [
    `## ${E(g.emoji)} ${g.title}`,
    ...g.offers.map((row) => `- **${row.label}** — \`${new Intl.NumberFormat('vi-VN').format(row.price)}đ\`${row.terms ? ` · ${row.terms}` : ''}`),
    g.note ? `-# ${g.note}` : '',
  ].filter(Boolean).join('\n')]));
  const saleUrl = campaignMessageUrl(WOMENS_DAY.promotionChannelId, WOMENS_DAY.boardIds[0]);
  const supportUrl = campaignMessageUrl(WOMENS_DAY.supportChannelId, '').replace(/\/$/, '');
  const buyButton = () => button('Mở ticket chọn gói', supportUrl, emojis.cenar_2010_heart_ribbon);
  const boards = [
    panel(0xEAA1BD, [
      `# ${flower} CENAR · SALE 20/10\n## MỘT CHÚT CHIỀU CHUỘNG, CẢ NGÀY VUI\n> Một playlist yêu thích, một bộ phim để dành, một công cụ cho ý tưởng mới. Tự thưởng cho mình — hoặc gửi một lời quan tâm thật đúng gu.\n${ribbon} **Bảng giá riêng dịp 20/10 · chọn gói ở dưới, chốt đơn trong ticket.**`,
      groups.nitro, groups.boost,
    ], `${WOMENS_DAY.marker} · Kết nối · 1/3`),
    panel(0xC3B2ED, [
      `# ${jewel} CHO NHỮNG Ý TƯỞNG CỦA BẠN\n> Việc nhẹ hơn một chút, thời gian cho mình nhiều hơn một chút.`,
      groups.gemini, groups.office, groups.chatgpt, groups.capcut, groups.combo,
    ], `${WOMENS_DAY.marker} · Làm việc & sáng tạo · 2/3`),
    panel(0x89D8BB, [
      `# ${ribbon} TAN CA RỒI, TỚI GIỜ THƯỞNG MÌNH\n> Bật một bài nhạc, chọn một bộ phim. Phần còn lại, cứ từ từ.`,
      groups.netflix, groups.spotify, groups.youtube,
      `## ${flower} THÍCH GÓI NÀO, NHẮN CENAR NHÉ\n**Còn nhiều sản phẩm khác giá rất ưu đãi.**\nMở ticket → gửi tên gói + thời hạn → shop xác nhận giá sale, điều kiện và bảo hành → thanh toán theo hướng dẫn.\n-# BHF = bảo hành full thời hạn gói · KBH = không bảo hành. Giá sale được chốt trong ticket; kiểm tra giá trước khi thanh toán trên website.`,
    ], `${WOMENS_DAY.marker} · Giải trí · 3/3`, [buyButton()]),
  ];
  const notice = panel(0xEAA1BD, [
    `## ${flower} BẢNG SALE 20/10 ĐÃ CẬP NHẬT\n**Một chút chiều chuộng, cả ngày vui.**\nNitro, Boost, AI, Office, CapCut, Netflix, Spotify, YouTube và combo 2 năm — xem đủ **29 lựa chọn** trong 3 phần bên dưới.`,
  ], `${WOMENS_DAY.marker} · Bảng giá mới thay cho Weekly Drop 09/10`, [
    button('Xem bảng giá 20/10', saleUrl, emojis.cenar_2010_tulips), buyButton(),
  ]);
  const greeting = panel(0xEAA1BD, [
    `# ${flower} CHÚC MỪNG NGÀY PHỤ NỮ VIỆT NAM\n## 20/10 · GỬI BẠN MỘT CHÚT YÊU THƯƠNG\n> Gửi các chị em của Cenar: chúc bạn hôm nay thật vui, luôn được trân trọng và có thời gian cho những điều mình thích.`,
    `${ribbon} Mong bạn nhận được một lời chúc dễ thương, một cái ôm ấm áp — và đừng quên dành một chút chiều chuộng cho chính mình nữa nhé.\n\nCảm ơn bạn đã chọn Cenar cho những ngày làm việc, học tập và thư giãn. **Chúc bạn luôn tự tin, nhiều sức khỏe và thật hạnh phúc theo cách của riêng mình.**`,
    `${jewel} Cenar gửi kèm **bảng sale 20/10** ở kênh khuyến mãi. Chọn một món nâng cấp nhỏ cho mình, hoặc rủ người thương cùng xem nhé!\n**Thương mến, Cenar Store.**`,
  ], `${WOMENS_DAY.marker} · Lời chúc 20/10`, [button('Ghé bảng sale 20/10', saleUrl, emojis.cenar_2010_tulips)]);
  return { boards, notice, greeting, offerCount: WOMENS_DAY_GROUPS.reduce((n, g) => n + g.offers.length, 0) };
}

export function campaignText(message) {
  const parts = [message.content || ''];
  const visit = (c) => { if (typeof c.content === 'string') parts.push(c.content); for (const child of c.components || []) visit(child); };
  for (const c of message.components || []) visit(c);
  return parts.filter(Boolean).join('\n');
}

export function validateWomensDayPayload(payload) {
  let count = 0, length = 0;
  const visit = (c) => { count++; length += c.content?.length || 0; for (const child of c.components || []) visit(child); };
  payload.components.forEach(visit);
  const value = campaignText(payload);
  if (count > 40 || length > 4000 || !value.includes(WOMENS_DAY.marker)) throw new Error('CAMPAIGN_DISCORD_LIMIT');
  if (/@everyone|@here|<@|\p{Extended_Pictographic}/u.test(value)) throw new Error('CAMPAIGN_UNEXPECTED_MENTION_OR_UNICODE_EMOJI');
  if (JSON.stringify(payload.allowed_mentions) !== JSON.stringify(SILENT_MENTIONS)) throw new Error('CAMPAIGN_NOT_SILENT');
  return { components: count, textLength: length };
}
