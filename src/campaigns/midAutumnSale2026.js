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

export const MID_AUTUMN_SALE = Object.freeze({
  guildId: '1282637033340403754',
  promotionChannelId: '1515008584549797979',
  supportChannelId: '1514607020098191393',
  priceChannelId: '1514606995842273280',
  storeUrl: 'https://cenarstore.xyz/products',
  marker: 'CENAR-MID-AUTUMN-SALE-2026',
  eventDate: '25/09/2026',
  campaignName: 'Nguyệt Thỏ Du Hành',
});

export const MID_AUTUMN_SALE_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_event_moon', fileName: 'cenar_event_moon.png' }),
  Object.freeze({ name: 'cenar_event_mooncake', fileName: 'cenar_event_mooncake.png' }),
  Object.freeze({ name: 'cenar_event_lantern', fileName: 'cenar_event_lantern.png' }),
]);

// Chỉ những emoji từng được tạo riêng cho một chiến dịch đã kết thúc mới nằm
// trong danh sách này. Emoji dùng chung cho ticket/panel không được đụng tới.
export const LEGACY_EVENT_EMOJI_NAMES = Object.freeze([
  'cenar_29_badge',
  'cenar_29_firework',
  'cenar_29_sale',
]);

const currentEmojiNames = new Set(MID_AUTUMN_SALE_EMOJIS.map((asset) => asset.name));

export function isStaleCampaignEmojiName(name) {
  const normalized = String(name || '').toLowerCase();
  return LEGACY_EVENT_EMOJI_NAMES.includes(normalized)
    || (normalized.startsWith('cenar_event_') && !currentEmojiNames.has(normalized));
}

function assetPath(asset) {
  return path.join(emojiAssetRoot, asset.fileName);
}

function validateEmojiAssets() {
  for (const asset of MID_AUTUMN_SALE_EMOJIS) {
    const filePath = assetPath(asset);
    if (!fs.existsSync(filePath)) throw new Error(`Thiếu emoji Trung Thu: ${filePath}`);
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

export async function syncMidAutumnSaleEmojis(guild) {
  validateEmojiAssets();
  await guild.emojis.fetch();

  const removed = [];
  for (const emoji of guild.emojis.cache.values()) {
    if (!isStaleCampaignEmojiName(emoji.name)) continue;
    await guild.emojis.delete(emoji.id, 'Cenar Store · dọn emoji chiến dịch cũ trước sự kiện Trung Thu 2026');
    removed.push({ id: emoji.id, name: emoji.name });
  }

  await guild.emojis.fetch();
  const emojis = {};
  for (const asset of MID_AUTUMN_SALE_EMOJIS) {
    let emoji = guild.emojis.cache.find((item) => item.name === asset.name);
    let status = 'reused';
    if (!emoji) {
      emoji = await guild.emojis.create({
        attachment: assetPath(asset),
        name: asset.name,
        reason: `Cenar Store · ${MID_AUTUMN_SALE.campaignName} · custom campaign art`,
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

export function buildMidAutumnSaleSections({
  guildId = MID_AUTUMN_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
} = {}) {
  const moon = campaignIcon(customEmojis, 'cenar_event_moon', E('cenar_verified'));
  const mooncake = campaignIcon(customEmojis, 'cenar_event_mooncake', E('icon_price'));
  const lantern = campaignIcon(customEmojis, 'cenar_event_lantern', E('cenar_announce'));

  return {
    hero: [
      `# ${moon} ${MID_AUTUMN_SALE.campaignName.toUpperCase()}`,
      `## ${lantern} MID-AUTUMN SALE · ${MID_AUTUMN_SALE.eventDate}`,
      '> Khi ánh trăng lên, một mùa ưu đãi mới cũng vừa cập bến Cenar Store.',
      '> Lấy cảm hứng từ những bộ sưu tập giới hạn theo mùa, Cenar ra mắt bộ nhận diện **Thỏ Ngọc · Bánh Trăng · Lồng Đèn** dành riêng cho đêm hội năm nay.',
      '',
      `${mooncake} **Mở hội trăng · chạm giá tốt · chọn đúng gói cho nhu cầu của bạn.**`,
      `-# ${MID_AUTUMN_SALE.marker}-PART-1 · Áp dụng từ khi đăng đến khi shop công bố kết thúc hoặc hết số lượng từng gói.`,
    ].join('\n'),
    nitro: [
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      `${mooncake} \`01 tháng\` — **85.000đ**`,
      `${mooncake} \`02 tháng · xử lý 4–5 ngày\` — **99.000đ**`,
      `${mooncake} \`02 tháng · có liền\` — **115.000đ**`,
      `${mooncake} \`04 tháng · có liền\` — **210.000đ**`,
      `${mooncake} \`06 tháng · có liền\` — **310.000đ**`,
      `${mooncake} \`08 tháng · có liền\` — **450.000đ**`,
      `${mooncake} \`12 tháng · có liền · gia hạn tự động\` — **550.000đ**`,
      `${mooncake} \`12 tháng · mua thẳng 01 năm · có liền\` — **800.000đ**`,
      `${moon} **Nitro Trial Boost** · \`03 tháng\` — **55.000đ**`,
      `-# ${E('status_info')} Nitro Trial cần được shop kiểm tra điều kiện tài khoản trước khi nhận thanh toán.`,
    ].join('\n'),
    boostNetflix: [
      `## ${E('brand_boost')} BOOST SERVER · NÂNG CẤP MÁY CHỦ`,
      `${lantern} \`01 tháng\` — **100.000đ**`,
      `${lantern} \`03 tháng\` — **250.000đ**`,
      '',
      `## ${E('brand_netflix')} NETFLIX PREMIUM · 4K PRIVATE`,
      `${lantern} \`01 tháng\` — **30.000đ**`,
      `${lantern} \`02 tháng\` — **50.000đ**`,
      `-# ${E('status_info')} Số lượng và hình thức bàn giao Netflix được xác nhận tại ticket trước khi thanh toán.`,
    ].join('\n'),
    productivityHeader: [
      `# ${mooncake} TIỆC TRĂNG · AI & CÔNG CỤ BẢN QUYỀN`,
      '> Chọn đúng thời hạn, nắm rõ chính sách hỗ trợ và nhận tư vấn trước khi chốt đơn.',
      `-# ${MID_AUTUMN_SALE.marker}-PART-2`,
    ].join('\n'),
    geminiOffice: [
      `## ${E('brand_gemini')} GEMINI PRO + GOOGLE ONE 5 TB`,
      `${mooncake} \`12 tháng\` — **200.000đ** · **Full bảo hành**`,
      `${mooncake} \`18 tháng\` — **250.000đ** · **Full bảo hành**`,
      '',
      `## ${E('brand_office')} OFFICE 365 + ONEDRIVE 1 TB`,
      `${mooncake} \`12 tháng\` — **190.000đ**`,
    ].join('\n'),
    chatgptCapcut: [
      `## ${E('brand_chatgpt')} CHATGPT PLUS · THANH TOÁN MOMO`,
      `${lantern} \`01 tháng\` — **150.000đ** · **Bảo hành 02 ngày**`,
      `${lantern} \`Add Team chính chủ · không bảo hành\` — **390.000đ**`,
      `-# ${E('status_info')} Tỷ lệ lỗi nguồn MoMo Pay shop ghi nhận ở mức khoảng 2%; đây là số liệu tham khảo, không phải cam kết tuyệt đối.`,
      '',
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${lantern} \`01 tháng\` — **55.000đ**`,
      `${lantern} \`06 tháng\` — **305.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${moon} ĐÊM TRĂNG GIẢI TRÍ · ƯU ĐÃI DÀI HẠN`,
      '> Một lần chọn gói, nhiều tháng tận hưởng — mọi điều kiện đều được báo rõ trước khi thanh toán.',
      `-# ${MID_AUTUMN_SALE.marker}-PART-3`,
    ].join('\n'),
    spotifyYoutube: [
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      `${mooncake} \`03 tháng\` — **95.000đ**`,
      `${mooncake} \`06 tháng\` — **180.000đ**`,
      `${mooncake} \`12 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_youtube')} YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH`,
      `${lantern} \`01 tháng\` — **65.000đ**`,
      `${lantern} \`03 tháng\` — **185.000đ**`,
      `${lantern} \`06 tháng\` — **295.000đ**`,
      `${lantern} \`12 tháng\` — **530.000đ**`,
    ].join('\n'),
    canvaClosing: [
      `## ${E('brand_canva') || E('icon_art')} CANVA PRO`,
      `${mooncake} \`12 tháng · không bảo hành\` — **150.000đ**`,
      '',
      `## ${lantern} CÒN NHIỀU SẢN PHẨM KHÁC ĐANG CÓ GIÁ ƯU ĐÃI`,
      `${E('status_check')} Mở ticket để shop kiểm tra tồn kho, điều kiện tài khoản và thời gian xử lý thực tế.`,
      `${E('warranty_shield')} Chính sách bảo hành áp dụng đúng theo từng dòng sản phẩm ghi trong bài và trên đơn hàng.`,
      `${E('cenar_support')} Không gửi mật khẩu, mã OTP hoặc thông tin thanh toán tại kênh công khai.`,
      '',
      `> ${moon} **Cenar Store chúc mọi người một mùa Trung Thu đủ đầy, ấm áp và luôn có người đồng hành dưới ánh trăng.**`,
    ].join('\n'),
  };
}

export function buildMidAutumnSaleMessages({
  guildId = MID_AUTUMN_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  tagEveryone = true,
} = {}) {
  const sections = buildMidAutumnSaleSections({ guildId, E, customEmojis });
  const supportUrl = `https://discord.com/channels/${guildId}/${MID_AUTUMN_SALE.supportChannelId}`;
  const priceUrl = `https://discord.com/channels/${guildId}/${MID_AUTUMN_SALE.priceChannelId}`;
  const moonButtonEmoji = customEmojis?.cenar_event_moon?.component;
  const cakeButtonEmoji = customEmojis?.cenar_event_mooncake?.component;
  const lanternButtonEmoji = customEmojis?.cenar_event_lantern?.component;

  const supportButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở Ticket Chốt Sale').setURL(supportUrl),
    moonButtonEmoji,
    E.component?.('ticket_open'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Thêm Sản Phẩm').setURL(MID_AUTUMN_SALE.storeUrl),
    cakeButtonEmoji,
    E.component?.('icon_store'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Bảng Giá Gốc').setURL(priceUrl),
    lanternButtonEmoji,
    E.component?.('icon_price'),
  );
  const actions = new ActionRowBuilder().addComponents(supportButton, storeButton, priceButton);
  const silentMentions = { parse: [], roles: [], users: [], repliedUser: false };
  const common = {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: silentMentions,
  };

  return [
    {
      ...common,
      components: [panel(0x6d3fd3, [
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
      components: [panel(0xf2b84b, [sections.productivityHeader, sections.geminiOffice, sections.chatgptCapcut])],
    },
    {
      ...common,
      components: [panel(0xde5f67, [sections.entertainmentHeader, sections.spotifyYoutube, sections.canvaClosing], actions)],
    },
  ];
}

export function midAutumnSalePart(message, botId = null) {
  if (!message || (botId && message.author?.id !== botId)) return null;
  const serialized = JSON.stringify(message.toJSON?.() || message);
  const match = serialized.match(new RegExp(`${MID_AUTUMN_SALE.marker}-PART-(\\d)`));
  return match ? Number(match[1]) : null;
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

export async function publishMidAutumnSale(client, { tagEveryone = true } = {}) {
  const guild = client.guilds.cache.get(MID_AUTUMN_SALE.guildId)
    || await client.guilds.fetch(MID_AUTUMN_SALE.guildId);
  await guild.channels.fetch();
  const channel = await guild.channels.fetch(MID_AUTUMN_SALE.promotionChannelId);
  if (!channel?.isTextBased?.() || channel.isThread?.() || !channel.messages
    || !/khuyến-mãi|khuyen-mai/i.test(channel.name)) {
    throw new Error('Kênh khuyến mãi không hợp lệ hoặc không thể gửi tin nhắn.');
  }

  const member = guild.members.me || await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  if (tagEveryone) required.push(PermissionFlagsBits.MentionEveryone);
  if (!channel.permissionsFor(member)?.has(required)) {
    throw new Error('Bot thiếu quyền xem, gửi, đọc lịch sử hoặc tag everyone tại kênh khuyến mãi.');
  }

  const { emojis, removed } = await syncMidAutumnSaleEmojis(guild);
  global.discordClient = client;
  const recent = await channel.messages.fetch({ limit: 100 });
  const existingParts = new Map();
  for (const message of recent.values()) {
    const part = midAutumnSalePart(message, client.user.id);
    if (part && !existingParts.has(part)) existingParts.set(part, message);
  }

  const payloadsWithMention = buildMidAutumnSaleMessages({ guildId: guild.id, customEmojis: emojis, tagEveryone });
  const payloadsSilent = buildMidAutumnSaleMessages({ guildId: guild.id, customEmojis: emojis, tagEveryone: false });
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
    });
  }

  // Sau khi cả ba phần mới đã tồn tại an toàn, xoá mọi bài cũ của bot trong
  // kênh khuyến mãi. Tin nhắn do thành viên gửi luôn được giữ nguyên.
  const allMessages = await fetchAllMessages(channel);
  let deletedOldMessages = 0;
  let preservedMemberMessages = 0;
  for (const message of allMessages) {
    if (message.author?.id !== client.user.id) {
      preservedMemberMessages += 1;
      continue;
    }
    if (activeMessageIds.has(message.id)) continue;
    await message.delete();
    deletedOldMessages += 1;
  }

  return {
    status: 'active',
    channelId: channel.id,
    emojis,
    removedEventEmojis: removed,
    messages: results,
    deletedOldMessages,
    preservedMemberMessages,
  };
}
