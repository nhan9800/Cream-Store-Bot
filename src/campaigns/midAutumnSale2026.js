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
  marker: 'CENAR-MID-AUTUMN-SALE-2026',
  campaignName: 'Hội Trăng Cenar',
});

export const MID_AUTUMN_SALE_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_moonfest_rabbit', fileName: 'cenar_moonfest_rabbit.png' }),
  Object.freeze({ name: 'cenar_moonfest_cake', fileName: 'cenar_moonfest_cake.png' }),
  Object.freeze({ name: 'cenar_moonfest_lantern', fileName: 'cenar_moonfest_lantern.png' }),
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
    || normalized.startsWith('cenar_daily_')
    || normalized.startsWith('cenar_event_')
    || (normalized.startsWith('cenar_moonfest_') && !currentEmojiNames.has(normalized));
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
  const rabbit = campaignIcon(customEmojis, 'cenar_moonfest_rabbit', E('cenar_verified'));
  const mooncake = campaignIcon(customEmojis, 'cenar_moonfest_cake', E('icon_price'));
  const lantern = campaignIcon(customEmojis, 'cenar_moonfest_lantern', E('cenar_announce'));

  return {
    hero: [
      `# ${rabbit} ${MID_AUTUMN_SALE.campaignName.toUpperCase()}`,
      `## ${lantern} TRĂNG LÊN · GIÁ XUỐNG`,
      '> Cenar khoác sắc ngọc, thắp đèn vàng và mở mâm ưu đãi công nghệ mùa Trung Thu.',
      `${mooncake} **Chọn gói ưng ý · xem rõ giá và bảo hành · mở ticket để shop chốt đơn.**`,
      `-# ${MID_AUTUMN_SALE.marker}-PART-1 · Bảng giá sự kiện Trung Thu 2026; áp dụng đến khi shop công bố cập nhật hoặc hết số lượng.`,
    ].join('\n'),
    nitro: [
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      `${mooncake} \`01 tháng\` — **85.000đ**`,
      `${mooncake} \`02 tháng · có liền\` — **99.000đ / 115.000đ**`,
      `${mooncake} \`04 tháng · có liền\` — **220.000đ**`,
      `${mooncake} \`06 tháng · có liền\` — **350.000đ**`,
      `${mooncake} \`08 tháng · có liền\` — **450.000đ**`,
      `${mooncake} \`12 tháng · có liền · gia hạn tự động\` — **550.000đ**`,
      `${mooncake} \`12 tháng · mua thẳng 01 năm · có liền\` — **800.000đ**`,
      `${rabbit} **Trial Boost** · \`03 tháng\` — **55.000đ**`,
      `-# ${lantern} Hai mức giá gói 02 tháng và điều kiện Trial được shop xác nhận tại ticket trước khi thanh toán.`,
    ].join('\n'),
    boost: [
      `## ${E('brand_boost')} BOOST SERVER · NÂNG CẤP MÁY CHỦ`,
      `${lantern} \`01 tháng\` — **100.000đ**`,
      `${lantern} \`03 tháng\` — **250.000đ**`,
    ].join('\n'),
    productivityHeader: [
      `# ${mooncake} MÂM TRĂNG 02 · AI & CÔNG CỤ BẢN QUYỀN`,
      '> Làm việc và sáng tạo trọn mùa trăng — chọn đúng thời hạn, xem rõ bảo hành.',
      `-# ${MID_AUTUMN_SALE.marker}-PART-2`,
    ].join('\n'),
    geminiOffice: [
      `## ${E('brand_gemini')} GEMINI PRO + GOOGLE ONE 5 TB`,
      `${mooncake} \`12 tháng\` — **119.000đ**`,
      `${mooncake} \`18 tháng\` — **150.000đ**`,
      '',
      `## ${E('brand_office')} OFFICE 365 + ONEDRIVE 1 TB`,
      `${mooncake} \`12 tháng\` — **180.000đ**`,
    ].join('\n'),
    chatgptCapcut: [
      `## ${E('brand_chatgpt')} CHATGPT PLUS · MOMO PAY`,
      `${lantern} \`01 tháng\` — **150.000đ** · **Bảo hành 02 ngày**`,
      `${lantern} \`01 tháng · add Team chính chủ\` — **390.000đ** · **Không bảo hành**`,
      `${lantern} \`12 tháng Plus · cấp tài khoản\` — **1.900.000đ**`,
      `-# ${lantern} Nguồn MoMo Pay có tỷ lệ lỗi shop ghi nhận khoảng 2%; số liệu tham khảo, không phải cam kết tuyệt đối.`,
      '',
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${lantern} \`01 tháng\` — **55.000đ**`,
      `${lantern} \`06 tháng\` — **295.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${rabbit} MÂM TRĂNG 03 · GIẢI TRÍ & HỌC TẬP`,
      '> Một mùa hội, nhiều lựa chọn — giá gọn, điều kiện rõ, có người tư vấn.',
      `-# ${MID_AUTUMN_SALE.marker}-PART-3`,
    ].join('\n'),
    spotifyYoutube: [
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      `${mooncake} \`03 tháng\` — **90.000đ**`,
      `${mooncake} \`06 tháng\` — **180.000đ**`,
      `${mooncake} \`12 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_youtube')} YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH`,
      `${lantern} \`01 tháng\` — **56.000đ**`,
      `${lantern} \`03 tháng\` — **180.000đ**`,
      `${lantern} \`06 tháng\` — **285.000đ**`,
      `${lantern} \`12 tháng\` — **500.000đ**`,
    ].join('\n'),
    extrasClosing: [
      `## ${mooncake} MEITU · CHỈNH ẢNH MÙA TRĂNG`,
      `${mooncake} **Meitu SVIP** · \`07 ngày\` — **35.000đ**`,
      `${mooncake} **Meitu VIP** · \`07 ngày\` — **20.000đ**`,
      '',
      `## ${rabbit} DUOLINGO SUPER · LINK`,
      `${rabbit} \`12 tháng\` — **85.000đ** · **Bảo hành 06 tháng**`,
      '',
      `## ${lantern} CÒN NHIỀU SẢN PHẨM KHÁC GIÁ ƯU ĐÃI`,
      `${mooncake} Mở ticket để shop xác nhận tồn kho, điều kiện tài khoản và thời gian xử lý.`,
      `${lantern} Chính sách bảo hành theo đúng từng gói; không gửi mật khẩu hoặc OTP tại kênh công khai.`,
      '',
      `> ${rabbit} **Rước trăng cùng Cenar · chọn đúng gói · vui trọn mùa hội.**`,
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
  const rabbitButtonEmoji = customEmojis?.cenar_moonfest_rabbit?.component;
  const cakeButtonEmoji = customEmojis?.cenar_moonfest_cake?.component;
  const lanternButtonEmoji = customEmojis?.cenar_moonfest_lantern?.component;

  const supportButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở Ticket Chốt Đơn').setURL(supportUrl),
    rabbitButtonEmoji,
    E.component?.('ticket_open'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Shop Cenar').setURL(MID_AUTUMN_SALE.storeUrl),
    cakeButtonEmoji,
    E.component?.('icon_store'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Bảng Giá Gốc').setURL(priceUrl),
    lanternButtonEmoji,
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
    deletedOldMessages,
    preservedMemberMessages,
  };
}
