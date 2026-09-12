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
  marker: 'CENAR-DAILY-COLOR-SALE-2026-09',
  campaignName: 'Cenar Mỗi Ngày Một Màu',
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

const DAILY_THEMES = Object.freeze([
  Object.freeze({ name: 'Coral Năng Lượng', colors: [0xF9736B, 0xFDBA74, 0xA855F7] }),
  Object.freeze({ name: 'Mint Tươi Mới', colors: [0x34D399, 0x86EFAC, 0x7C3AED] }),
  Object.freeze({ name: 'Tím Mộng Mơ', colors: [0x8B5CF6, 0xC084FC, 0xFB7185] }),
  Object.freeze({ name: 'Cam Rực Rỡ', colors: [0xFB923C, 0xFBBF24, 0xEC4899] }),
  Object.freeze({ name: 'Hồng Ngọt Ngào', colors: [0xF472B6, 0xFDA4AF, 0x6366F1] }),
  Object.freeze({ name: 'Xanh Trong Trẻo', colors: [0x38BDF8, 0x22D3EE, 0x8B5CF6] }),
  Object.freeze({ name: 'Vàng Cuối Tuần', colors: [0xFACC15, 0xFB7185, 0x10B981] }),
]);

export function dailySaleTheme(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
  }).format(date);
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  return DAILY_THEMES[index < 0 ? 0 : index];
}

export function dailySaleDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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

  return {
    hero: [
      `# ${gift} ${DAILY_COLOR_SALE.campaignName.toUpperCase()}`,
      `## ${leaf} HÔM NAY · ${theme.name.toUpperCase()}`,
      '> Bảng giá mới đã lên sóng — chọn gói hợp nhu cầu, shop kiểm tra điều kiện và chốt đúng giá trước khi thanh toán.',
      `${tag} **Giá gọn, quyền lợi rõ, mở ticket là có người hỗ trợ ngay.**`,
      `-# ${DAILY_COLOR_SALE.marker}-PART-1 · Áp dụng từ khi đăng đến khi shop công bố cập nhật mới hoặc hết số lượng từng gói.`,
    ].join('\n'),
    nitro: [
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      `${tag} \`01 tháng\` — **85.000đ**`,
      `${tag} \`02 tháng · có liền\` — **99.000đ / 115.000đ**`,
      `${tag} \`04 tháng · có liền\` — **210.000đ**`,
      `${tag} \`06 tháng · có liền\` — **310.000đ**`,
      `${tag} \`08 tháng · có liền\` — **450.000đ**`,
      `${tag} \`12 tháng · có liền · gia hạn tự động\` — **550.000đ**`,
      `${tag} \`12 tháng · mua thẳng 01 năm · có liền\` — **800.000đ**`,
      `${gift} **Trial Boost** · \`03 tháng\` — **55.000đ**`,
      `-# ${E('status_info')} Hai lựa chọn Nitro 02 tháng được shop xác nhận đúng loại tại ticket trước khi thanh toán.`,
    ].join('\n'),
    boostNetflix: [
      `## ${E('brand_boost')} BOOST SERVER · NÂNG CẤP MÁY CHỦ`,
      `${leaf} \`01 tháng\` — **90.000đ**`,
      `${leaf} \`03 tháng\` — **230.000đ**`,
      '',
      `## ${E('brand_netflix')} NETFLIX PREMIUM · 4K PRIVATE`,
      `${leaf} \`01 tháng\` — **30.000đ**`,
      `${leaf} \`02 tháng\` — **50.000đ**`,
    ].join('\n'),
    productivityHeader: [
      `# ${tag} AI & CÔNG CỤ BẢN QUYỀN`,
      '> Chọn đúng thời hạn, xem rõ bảo hành và nhận tư vấn trước khi chốt đơn.',
      `-# ${DAILY_COLOR_SALE.marker}-PART-2`,
    ].join('\n'),
    geminiOffice: [
      `## ${E('brand_gemini')} GEMINI PRO + GOOGLE ONE 5 TB`,
      `${leaf} \`12 tháng\` — **119.000đ**`,
      `${leaf} \`18 tháng\` — **150.000đ**`,
      '',
      `## ${E('brand_office')} OFFICE 365 + ONEDRIVE 1 TB`,
      `${leaf} \`12 tháng\` — **180.000đ**`,
    ].join('\n'),
    chatgptCapcut: [
      `## ${E('brand_chatgpt')} CHATGPT PLUS · MOMO PAY`,
      `${tag} \`01 tháng\` — **150.000đ** · **Bảo hành 02 ngày**`,
      `${tag} \`01 tháng · add Team chính chủ\` — **390.000đ** · **Không bảo hành**`,
      `${tag} \`12 tháng Plus · cấp tài khoản\` — **1.900.000đ**`,
      `-# ${E('status_info')} Nguồn MoMo Pay có tỷ lệ lỗi shop ghi nhận khoảng 2%; đây là số liệu tham khảo, không phải cam kết tuyệt đối.`,
      '',
      `## ${E('brand_capcut')} CAPCUT PRO`,
      `${gift} \`01 tháng\` — **55.000đ**`,
      `${gift} \`06 tháng\` — **295.000đ**`,
    ].join('\n'),
    entertainmentHeader: [
      `# ${gift} GIẢI TRÍ PREMIUM · DÙNG DÀI, GIÁ ÊM`,
      '> Chọn một lần, tận hưởng nhiều tháng — mọi điều kiện đều được báo rõ trước khi thanh toán.',
      `-# ${DAILY_COLOR_SALE.marker}-PART-3`,
    ].join('\n'),
    spotifyYoutube: [
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      `${leaf} \`03 tháng\` — **90.000đ**`,
      `${leaf} \`06 tháng\` — **180.000đ**`,
      `${leaf} \`12 tháng\` — **280.000đ**`,
      '',
      `## ${E('brand_youtube')} YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH`,
      `${tag} \`01 tháng\` — **65.000đ**`,
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
      components: [panel(theme.colors[0], [`${mentions ? `${mentions}\n` : ''}${sections.hero}`, sections.nitro, sections.boostNetflix])],
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

export async function publishDailyColorSale(client, { tagEveryone = true, tagMember = true, now = new Date() } = {}) {
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
  const recent = await channel.messages.fetch({ limit: 100 });
  const existingParts = new Map();
  for (const message of recent.values()) {
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
    theme: dailySaleTheme(now),
    emojis,
    removedEventEmojis: removed,
    messages: results,
    deletedOldMessages,
    preservedMemberMessages,
  };
}
