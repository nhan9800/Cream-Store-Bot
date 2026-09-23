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
  memberRoleId: '1282638730812854345',
  storeUrl: 'https://cenarstore.xyz/products',
  marker: 'CENAR-PUBG-TREND-SALE-2026',
  announcementMarker: 'CENAR-PUBG-TREND-SALE-2026-ANNOUNCEMENT',
  campaignName: 'PUBG TREND SALE · CENAR STORE',
});

export const MID_AUTUMN_SALE_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_pubg_cow', fileName: 'cenar_pubg_cow.png' }),
]);

// Public names for the active campaign. The legacy exports below remain
// available so older one-off scripts can be upgraded without breaking imports.
export const PUBG_DRAMA_SALE = MID_AUTUMN_SALE;
export const PUBG_DRAMA_SALE_EMOJIS = MID_AUTUMN_SALE_EMOJIS;

// Chỉ những emoji từng được tạo riêng cho một chiến dịch đã kết thúc mới nằm
// trong danh sách này. Emoji dùng chung cho ticket/panel không được đụng tới.
export const LEGACY_EVENT_EMOJI_NAMES = Object.freeze([
  'cenar_29_badge',
  'cenar_29_firework',
  'cenar_29_sale',
  'cenar_moonfest_rabbit',
  'cenar_moonfest_cake',
  'cenar_moonfest_lantern',
]);

const currentEmojiNames = new Set(MID_AUTUMN_SALE_EMOJIS.map((asset) => asset.name));

export function isStaleCampaignEmojiName(name) {
  const normalized = String(name || '').toLowerCase();
  return LEGACY_EVENT_EMOJI_NAMES.includes(normalized)
    || normalized.startsWith('cenar_daily_')
    || normalized.startsWith('cenar_event_')
    || (normalized.startsWith('cenar_moonfest_') && !currentEmojiNames.has(normalized))
    || (normalized.startsWith('cenar_pubg_') && !currentEmojiNames.has(normalized));
}

function assetPath(asset) {
  return path.join(emojiAssetRoot, asset.fileName);
}

function validateEmojiAssets() {
  for (const asset of MID_AUTUMN_SALE_EMOJIS) {
    const filePath = assetPath(asset);
    if (!fs.existsSync(filePath)) throw new Error(`Thiếu emoji PUBG sale: ${filePath}`);
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
    await guild.emojis.delete(emoji.id, 'Cenar Store · dọn emoji chiến dịch cũ trước PUBG Trend Sale 2026');
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
  const cow = campaignIcon(customEmojis, 'cenar_pubg_cow', E('icon_price'));

  return {
    hero: [
      `# ${cow} ${MID_AUTUMN_SALE.campaignName}`,
      `## ${cow} DRAMA NGOÀI KIA · GIÁ SALE TRONG NÀY :))`,
      '> Cenar Store không liên quan đến bất kỳ sự kiện, đơn vị hay bên thứ ba nào được nhắc trong trend PUBG tại Việt Nam.',
      '> Shop chỉ mượn không khí meme để gửi ưu đãi cho cộng đồng — giá và điều kiện được xác nhận tại ticket trước khi thanh toán.',
      `${cow} **Chọn gói ưng ý · mở ticket · shop kiểm tra tồn và điều kiện · chốt đơn rõ ràng.**`,
      `-# ${MID_AUTUMN_SALE.marker}-PART-1 · Bảng giá meme sale áp dụng đến khi shop công bố cập nhật hoặc hết số lượng từng gói.`,
    ].join('\n'),
    nitro: [
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      `${cow} \`01 tháng\` — **85.000đ**`,
      `${cow} \`02 tháng · xử lý 1–3 ngày\` — **99.000đ**`,
      `${cow} \`02 tháng · có liền\` — **120.000đ**`,
      `${cow} \`04 tháng · có liền\` — **240.000đ**`,
      `${cow} \`06 tháng · có liền\` — **350.000đ**`,
      `${cow} \`08 tháng · có liền\` — **480.000đ**`,
      `${cow} \`12 tháng · có liền · gia hạn tự động\` — **580.000đ**`,
      `${cow} \`12 tháng · mua thẳng 01 năm · có liền\` — **830.000đ**`,
      `${cow} **Trial Boost** · \`03 tháng\` — **55.000đ**`,
      `-# ${E('status_info')} Gói 02 tháng và điều kiện Trial được shop xác nhận tại ticket trước khi thanh toán.`,
    ].join('\n'),
    boost: [
      `## ${E('brand_boost')} BOOST SERVER · NÂNG CẤP MÁY CHỦ`,
      `${cow} \`01 tháng\` — **120.000đ**`,
      `${cow} \`03 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_netflix')} NETFLIX PREMIUM · 4K PRIVATE`,
      `${cow} \`01 tháng\` — **75.000đ**`,
    ].join('\n'),
    productivityHeader: [
      `# ${cow} PUBG MEME SALE · AI & CÔNG CỤ BẢN QUYỀN`,
      '> Công cụ học tập, làm việc và sáng tạo — chọn đúng thời hạn, xem rõ bảo hành trước khi chốt.',
      `-# ${MID_AUTUMN_SALE.marker}-PART-2`,
    ].join('\n'),
    geminiOffice: [
      `## ${E('brand_gemini')} GEMINI PRO + GOOGLE ONE 5 TB`,
      `${cow} \`12 tháng\` — **150.000đ**`,
      `${cow} \`18 tháng\` — **200.000đ**`,
      '',
      `## ${E('brand_office')} OFFICE 365 + ONEDRIVE 1 TB`,
      `${cow} \`12 tháng\` — **200.000đ**`,
    ].join('\n'),
    chatgptCapcut: [
      `## ${E('brand_chatgpt')} CHATGPT PLUS · MOMO PAY`,
      `${cow} \`01 tháng · MoMo Pay\` — **130.000đ** · **Bảo hành 02 ngày**`,
      `${cow} \`01 tháng · add team chính chủ · BHF\` — **390.000đ**`,
      `${cow} \`Pro 5x · team 04 slot\` — **79.000đ/slot** · **file JSON + hướng dẫn**`,
      `${cow} \`Pro 5x · team 02 slot\` — **150.000đ/slot** · **file JSON + hướng dẫn**`,
      `${cow} \`Acc ChatGPT Pro 5x\` — **250.000đ** · **BH 30 phút · file JSON**`,
      `-# ${E('status_info')} Tỷ lệ lỗi/die của gói MoMo Pay shop ghi nhận khoảng 2%; đây là số liệu tham khảo, không phải cam kết tuyệt đối.`,
      '',
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${cow} \`01 tháng\` — **55.000đ**`,
      `${cow} \`06 tháng\` — **350.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${cow} GIẢI TRÍ PREMIUM · GIÁ SALE THEO TREND`,
      '> Drama có thể đổi trend, quyền lợi và điều kiện từng gói vẫn được shop ghi rõ.',
      `-# ${MID_AUTUMN_SALE.marker}-PART-3`,
    ].join('\n'),
    spotifyYoutube: [
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      `${cow} \`03 tháng\` — **110.000đ**`,
      `${cow} \`06 tháng\` — **190.000đ**`,
      `${cow} \`12 tháng\` — **290.000đ**`,
      '',
      `## ${E('brand_youtube')} YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH`,
      `${cow} \`01 tháng\` — **58.000đ**`,
      `${cow} \`03 tháng\` — **185.000đ**`,
      `${cow} \`06 tháng\` — **295.000đ**`,
      `${cow} \`12 tháng\` — **530.000đ**`,
    ].join('\n'),
    extrasClosing: [
      `## ${cow} CÒN NHIỀU SẢN PHẨM KHÁC GIÁ RẤT ƯU ĐÃI`,
      `${cow} Mở ticket để shop xác nhận tồn kho, điều kiện tài khoản và thời gian xử lý thực tế.`,
      `${E('warranty_shield')} Chính sách bảo hành áp dụng đúng theo từng gói; BHF và thời lượng bảo hành sẽ được giải thích rõ tại ticket.`,
      `${E('cenar_support')} Không gửi mật khẩu, OTP hoặc thông tin thanh toán tại kênh công khai.`,
      '',
      `> ${cow} **Bật khiên chống drama: chọn gói → mở ticket → shop kiểm tra → chốt sale.**`,
    ].join('\n'),
  };
}

export function buildMidAutumnSaleMessages({
  guildId = MID_AUTUMN_SALE.guildId,
  E = createEmojiResolver(guildId),
  customEmojis = {},
  tagEveryone = true,
  tagMember = true,
} = {}) {
  const sections = buildMidAutumnSaleSections({ guildId, E, customEmojis });
  const supportUrl = `https://discord.com/channels/${guildId}/${MID_AUTUMN_SALE.supportChannelId}`;
  const priceUrl = `https://discord.com/channels/${guildId}/${MID_AUTUMN_SALE.priceChannelId}`;
  const cowButtonEmoji = customEmojis?.cenar_pubg_cow?.component;

  const supportButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở Ticket Chốt Đơn').setURL(supportUrl),
    cowButtonEmoji,
    E.component?.('ticket_open'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Shop Cenar').setURL(MID_AUTUMN_SALE.storeUrl),
    cowButtonEmoji,
    E.component?.('icon_store'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Bảng Giá Cenar').setURL(priceUrl),
    cowButtonEmoji,
    E.component?.('icon_price'),
  );
  const actions = new ActionRowBuilder().addComponents(supportButton, storeButton, priceButton);
  const silentMentions = { parse: [], roles: [], users: [], repliedUser: false };
  const mentions = [
    tagEveryone ? '@everyone' : null,
    tagMember ? `<@&${MID_AUTUMN_SALE.memberRoleId}>` : null,
  ].filter(Boolean).join(' · ');
  const common = {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: silentMentions,
  };

  return [
    {
      ...common,
      components: [panel(0x1D6B63, [
        `${mentions ? `${mentions}\n` : ''}${sections.hero}`,
        sections.nitro,
        sections.boost,
      ])],
      allowedMentions: {
        parse: tagEveryone ? ['everyone'] : [],
        roles: tagMember ? [MID_AUTUMN_SALE.memberRoleId] : [],
        users: [],
        repliedUser: false,
      },
    },
    {
      ...common,
      components: [panel(0xD5A64E, [sections.productivityHeader, sections.geminiOffice, sections.chatgptCapcut])],
    },
    {
      ...common,
      components: [panel(0xC96265, [sections.entertainmentHeader, sections.spotifyYoutube, sections.extrasClosing], actions)],
    },
  ];
}

export function buildMidAutumnSaleAnnouncement({
  guildId = MID_AUTUMN_SALE.guildId,
  priceBoardMessageId,
  customEmojis = {},
} = {}) {
  if (!/^\d{15,22}$/.test(String(priceBoardMessageId || ''))) {
    throw new Error('Thiếu ID bài bảng giá PUBG sale để gắn vào thông báo.');
  }
  const cow = campaignIcon(customEmojis, 'cenar_pubg_cow', '');
  const boardUrl = `https://discord.com/channels/${guildId}/${MID_AUTUMN_SALE.promotionChannelId}/${priceBoardMessageId}`;
  return {
    content: [
      `@everyone · <@&${MID_AUTUMN_SALE.memberRoleId}>`,
      `${cow} **PUBG TREND SALE CENAR ĐÃ MỞ — BẢNG GIÁ MEME MỚI ĐÃ LÊN SÓNG!** ${cow}`,
      `Nitro, Boost Server, AI và các gói giải trí đều có trong [bảng giá sale](${boardUrl}). Mở ticket để shop tư vấn đúng gói trước khi thanh toán.`,
      `-# ${MID_AUTUMN_SALE.announcementMarker}`,
    ].join('\n'),
    allowedMentions: {
      parse: ['everyone'],
      roles: [MID_AUTUMN_SALE.memberRoleId],
      users: [],
      repliedUser: false,
    },
  };
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

export async function publishMidAutumnSale(client, { tagEveryone = true, tagMember = true } = {}) {
  const guild = client.guilds.cache.get(MID_AUTUMN_SALE.guildId)
    || await client.guilds.fetch(MID_AUTUMN_SALE.guildId);
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const channel = await guild.channels.fetch(MID_AUTUMN_SALE.promotionChannelId);
  if (!channel?.isTextBased?.() || channel.isThread?.() || !channel.messages
    || !/khuyến-mãi|khuyen-mai/i.test(channel.name)) {
    throw new Error('Kênh khuyến mãi không hợp lệ hoặc không thể gửi tin nhắn.');
  }
  if (tagMember && !guild.roles.cache.has(MID_AUTUMN_SALE.memberRoleId)) {
    throw new Error(`Không tìm thấy role Cenar Member ${MID_AUTUMN_SALE.memberRoleId}.`);
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

  const { emojis, removed } = await syncMidAutumnSaleEmojis(guild);
  global.discordClient = client;
  const allMessages = await fetchAllMessages(channel);
  const existingParts = new Map();
  for (const message of allMessages) {
    const part = midAutumnSalePart(message, client.user.id);
    if (part && !existingParts.has(part)) existingParts.set(part, message);
  }

  const payloadsWithMention = buildMidAutumnSaleMessages({ guildId: guild.id, customEmojis: emojis, tagEveryone, tagMember });
  const payloadsSilent = buildMidAutumnSaleMessages({ guildId: guild.id, customEmojis: emojis, tagEveryone: false, tagMember: false });
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
      mentionedMemberRole: message.mentions.roles.has(MID_AUTUMN_SALE.memberRoleId),
    });
  }

  const priorAnnouncement = allMessages.find((message) =>
    message.author?.id === client.user.id
    && String(message.content || '').includes(MID_AUTUMN_SALE.announcementMarker)
  );
  let announcement = priorAnnouncement;
  if (!announcement && tagEveryone && tagMember) {
    announcement = await channel.send(buildMidAutumnSaleAnnouncement({
      guildId: guild.id,
      priceBoardMessageId: results[0].messageId,
      customEmojis: emojis,
    }));
  }
  if (announcement) activeMessageIds.add(announcement.id);

  // Sau khi cả ba phần mới đã tồn tại an toàn, xoá mọi bài cũ của bot trong
  // kênh khuyến mãi. Tin nhắn do thành viên gửi luôn được giữ nguyên.
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
    announcement: announcement ? {
      action: priorAnnouncement ? 'reused' : 'created',
      messageId: announcement.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${announcement.id}`,
      mentionEveryone: announcement.mentions.everyone,
      mentionedMemberRole: announcement.mentions.roles.has(MID_AUTUMN_SALE.memberRoleId),
    } : null,
    deletedOldMessages,
    preservedMemberMessages,
  };
}

// Stable names for the active campaign. Keep the legacy function names above
// for compatibility with scripts that were created for the previous event.
export const buildPubgDramaSaleSections = buildMidAutumnSaleSections;
export const buildPubgDramaSaleMessages = buildMidAutumnSaleMessages;
export const buildPubgDramaSaleAnnouncement = buildMidAutumnSaleAnnouncement;
export const pubgDramaSalePart = midAutumnSalePart;
export const syncPubgDramaSaleEmojis = syncMidAutumnSaleEmojis;
export const publishPubgDramaSale = publishMidAutumnSale;
