import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder,
  MessageFlags, PermissionFlagsBits as P, Routes, SeparatorBuilder, TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { getGuildConfig } from './guildConfigService.js';
import { resolveVerificationRole } from './verificationRoleService.js';

const APP_ID = '1139187282075721768';
const REVISION = 'CENAR-BOOKING-20261121';
const reason = 'Cenar Booking channel setup';
const glyphs = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/u;
const statuses = new WeakMap();
const icons = {
  welcome: '474566-confetti.png', rules: '912203-shield.png', calendar: '47836-calendar.png',
  profiles: '739224-member.png', apply: '4817-staff.png', reviews: '521557-textmessage.png',
  game: '451014-target.png', voice: '308605-microphone.png', male: '962321-maparrow.png',
  female: '510611-star.png', support: '687464-ticketsupportroleicon.png', news: '541187-announce.png',
};
const newCategories = {
  start: ['01 · BẮT ĐẦU', 'START HERE'],
  booking: ['02 · BOOKING'],
  community: ['03 · CỘNG ĐỒNG & VOICE', 'GLOBAL COMMUNITY'],
  support: ['04 · HỖ TRỢ & BẢO HÀNH', 'CUSTOMER SUPPORT'],
  market: ['05 · DỊCH VỤ CŨ', 'GLOBAL MARKETPLACE'],
  guides: ['06 · HƯỚNG DẪN DỊCH VỤ CŨ', 'GUIDES & RESOURCES'],
  premium: ['07 · TIỆN ÍCH CŨ', 'PREMIUM SERVICES'],
};
const oldChannels = {
  welcome: ['1514604934245384233', 'bat-dau', 'start'],
  rules: ['1536693543463297104', 'noi-quy', 'start'],
  news: ['1514594182717640735', 'thong-bao', 'start'],
  verify: ['1514604946308464722', 'xac-minh', 'start'],
  guide: ['1536693550455070761', 'huong-dan-mua-hang-cu', 'market'],
  support: ['1514604974066237551', 'ho-tro-dich-vu-cu', 'support'],
  reminders: ['1514604985193861182', 'log-nhac-nho', 'support'],
  warranty: ['1517266178282618980', 'log-bao-hanh', 'support'],
};
const requiredExisting = ['welcome', 'rules', 'news', 'verify', 'guide', 'support'];

export function bookingStoreSetupStatus(client) {
  return statuses.get(client) ?? { status: 'not_started' };
}

function existing(channels, name, type) {
  const matches = channels.filter(channel => channel.type === type && channel.name === name);
  if (matches.size > 1) throw new Error('BOOKING_DUPLICATE_CHANNEL');
  return matches.first();
}

function withoutDecoration(name) {
  if (!glyphs.test(name)) return name;
  return name.replace(new RegExp(glyphs.source, 'gu'), '').replace(/^[\s｜|・·\-]+/u, '').trim();
}

function access(guild, verified, staff, kind) {
  const membersCanChat = kind === 'chat' && !verified;
  const publicAllow = [P.ViewChannel, P.ReadMessageHistory];
  if (kind === 'voice' && !verified) publicAllow.push(P.Connect, P.Speak);
  if (membersCanChat) publicAllow.push(P.SendMessages);
  const publicDeny = membersCanChat ? [] : [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads];
  if (kind === 'voice' && verified) publicDeny.push(P.Connect, P.Speak);
  const items = [
    { id: guild.id, allow: publicAllow, deny: publicDeny },
    { id: guild.client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageMessages] },
    ...staff.map(id => ({ id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages,
      ...(kind === 'forum' ? [P.CreatePublicThreads, P.SendMessagesInThreads, P.ManageThreads] : []),
      ...(kind === 'voice' ? [P.Connect, P.Speak] : [])] })),
  ];
  if (verified && !staff.includes(verified.id) && ['chat', 'voice'].includes(kind)) {
    items.push({ id: verified.id, allow: kind === 'voice' ? [P.Connect, P.Speak] : [P.SendMessages] });
  }
  return items;
}

async function loadIcons(guild) {
  const inventory = await guild.emojis.fetch();
  const result = {};
  for (const [key, image] of Object.entries(icons)) {
    const name = `cenar_booking_${key}`;
    const item = inventory.find(emoji => emoji.name === name)
      ?? await guild.emojis.create({
        name, attachment: fileURLToPath(new URL(`../../assets/emojis/ui27/${image}`, import.meta.url)), reason,
      }).catch(() => null);
    if (item && item.available !== false && !item.roles.cache.size) {
      result[key] = { id: item.id, name: item.name, animated: Boolean(item.animated) };
    }
  }
  return result;
}

export function bookingPanels(guildId, channels, emoji) {
  const intro = (key, title) => {
    const item = emoji[key];
    return item ? `<${item.animated ? 'a' : ''}:${item.name}:${item.id}> ${title}` : title;
  };
  const button = (key, name, target) => {
    const value = new ButtonBuilder().setLabel(name);
    if (emoji[key]) value.setEmoji(emoji[key]);
    return target
      ? value.setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guildId}/${channels[target].id}`)
      : value.setStyle(ButtonStyle.Primary).setCustomId('ticket:create:SUPPORT');
  };
  const panel = (key, style, title, notes, actions = []) => {
    const card = new ContainerBuilder().setAccentColor(style)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${intro(key === 'request' ? 'calendar' : key, title)}\n${notes}`));
    if (actions.length) card.addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(new ActionRowBuilder().addComponents(actions));
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${REVISION} · ${key}`));
    return { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  };
  return {
    welcome: panel('welcome', 0x9d87ff, 'Cenar Booking', 'Chọn host để chơi game, nói chuyện hoặc tìm bạn vào voice cùng.\n\n**Xem hồ sơ → Chọn khung giờ → Mở ticket → Staff xác nhận lịch.**\nHồ sơ host, giá và khung giờ được cập nhật khi có thông tin đã duyệt.', [
      button('profiles', 'Xem hồ sơ host', 'profiles'),
      button('calendar', 'Đặt lịch', 'request'),
      button('rules', 'Đọc nội quy', 'rules'),
    ]),
    rules: panel('rules', 0x6fcfbb, 'Nội quy booking', 'Tôn trọng ranh giới và thời gian của nhau. Chỉ đặt lịch chơi game, trò chuyện và voice phù hợp với nội quy Discord.\n\n- Xác nhận host, giờ, thời lượng và chi phí trong ticket trước khi bắt đầu.\n- Giữ thông tin riêng tư trong ticket. Không yêu cầu mật khẩu, mã OTP hoặc thông tin cá nhân nhạy cảm.\n- Báo staff qua ticket nếu bị quấy rối, mạo danh hoặc cần đổi lịch.', [button('support', 'Liên hệ qua ticket')]),
    request: panel('request', 0x7c9df7, 'Đặt lịch với host', 'Mở ticket và gửi các mục bên dưới để staff kiểm tra lịch.\n\n> Host bạn muốn gặp hoặc nhóm Nam/Nữ\n> Game hoặc trò chuyện\n> Ngày, giờ theo giờ Việt Nam (UTC+7) và thời lượng\n> Ghi chú nếu có\n\nLịch được chốt khi staff xác nhận host, giờ và chi phí trong ticket.', [button('support', 'Mở ticket đặt lịch')]),
    apply: panel('apply', 0xe384bc, 'Đăng ký làm host', 'Mở ticket và gửi biệt danh, nhóm hồ sơ bạn tự chọn, game/chủ đề, khung giờ rảnh (UTC+7) và mô tả ngắn. Staff duyệt nội dung công khai cùng bạn trước khi đăng hồ sơ.', [button('support', 'Gửi hồ sơ qua ticket')]),
    news: panel('news', 0x9d87ff, 'Khu booking của Cenar', 'Xem cách đặt lịch, tìm hồ sơ host và vào voice cộng đồng từ trang bắt đầu. Các yêu cầu về đơn cũ tiếp tục được xử lý qua khu hỗ trợ và bảo hành.', [
      button('calendar', 'Xem khu booking', 'welcome'),
      button('support', 'Hỗ trợ đơn cũ', 'support'),
    ]),
  };
}

function textOnMessage(message) {
  const inspect = rows => rows.flatMap(row => [row.content || row.data?.content || '', ...inspect(row.components ?? [])]);
  return [message.content || '', ...inspect(message.components ?? [])].join('\n');
}

async function ensurePanel(channel, key, payload) {
  const messages = await channel.messages.fetch({ limit: 50 });
  const marker = `${REVISION} · ${key}`;
  const oldMarker = { welcome: 'CENAR GLOBAL • INTERNATIONAL STORE', rules: 'CENAR GLOBAL • STORE RULES' }[key];
  const candidates = messages.filter(message => message.author.id === channel.client.user.id);
  const saved = candidates.find(message => textOnMessage(message).includes(marker));
  const replaced = saved || (oldMarker && candidates.find(message =>
    !message.attachments.size && message.flags.has(MessageFlags.IsComponentsV2) && textOnMessage(message).includes(oldMarker)));
  const message = replaced || await channel.send({
    ...payload, nonce: `cenar-bk-261121-${key}`, enforceNonce: true,
  });
  if (replaced && !saved) await replaced.edit(payload);
  if (!message.pinned) await message.pin(reason);
}

async function channelSnapshot(guild) {
  // Discord.js may return null for a channel type it cannot represent. Use the
  // API inventory to verify that even those channels and their ACLs survive.
  const channels = await guild.client.rest.get(Routes.guildChannels(guild.id));
  return channels.map(channel => ({
    id: channel.id, type: channel.type, name: channel.name, parent: channel.parent_id ?? null,
    position: channel.position, acl: (channel.permission_overwrites ?? [])
      .map(item => [item.id, item.type, String(item.allow), String(item.deny)])
      .sort((a, b) => a[0].localeCompare(b[0])),
  }));
}

export async function setupBookingStore(client, guildId) {
  if (guildId !== STORE_TWO_GUILD_ID || client?.user?.id !== APP_ID) return { status: 'not_configured' };
  statuses.set(client, { status: 'syncing', revision: REVISION });
  try {
    const result = await applyBookingLayout(client, guildId);
    statuses.set(client, result);
    return result;
  } catch (error) {
    const code = String(error.code || error.message || '');
    statuses.set(client, { status: 'retry_required', revision: REVISION,
      code: /^(?:BOOKING_[A-Z_]+|\d{5})$/.test(code) ? code : 'DISCORD_SETUP_FAILED' });
    throw error;
  }
}

async function applyBookingLayout(client, guildId) {
  const guild = await client.guilds.fetch({ guild: guildId, force: true });
  const [existingChannels, original] = await Promise.all([
    guild.channels.fetch(), channelSnapshot(guild), guild.roles.fetch(),
  ]);
  if (!requiredExisting.every(key => existingChannels.get(oldChannels[key][0]))) throw new Error('BOOKING_BASELINE_MISSING');
  const key = `booking_discord_snapshot:${guildId}:${REVISION}`;
  db.prepare('INSERT OR IGNORE INTO system_settings (key,value) VALUES (?,?)').run(key, JSON.stringify(original));
  const proof = JSON.parse(db.prepare('SELECT value FROM system_settings WHERE key=?').get(key).value);
  const verified = resolveVerificationRole(guild);
  const cfg = getGuildConfig(guild.id);
  const staff = [...new Set([cfg?.manager_role_id, cfg?.support_role_id].filter(id => id && id !== guild.id && guild.roles.cache.has(id)))];
  const emoji = await loadIcons(guild);
  const categories = {};
  for (const [id, [name, old]] of Object.entries(newCategories)) {
    let channel = existing(guild.channels.cache, name, ChannelType.GuildCategory)
      || (old && existing(guild.channels.cache, old, ChannelType.GuildCategory));
    if (!channel && ['guides', 'premium'].includes(id)) continue;
    if (!channel) channel = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason });
    else if (channel.name !== name) channel = await channel.setName(name, reason);
    categories[id] = channel;
  }

  const channels = {};
  async function edit(channel, name, category) {
    if (channel.name !== name) channel = await channel.setName(name, reason);
    if (category && channel.parentId !== category.id) {
      channel = await channel.setParent(category.id, { lockPermissions: false, reason });
    }
    return channel;
  }
  for (const [id, [channelId, name, category]] of Object.entries(oldChannels)) {
    const channel = existingChannels.get(channelId);
    if (channel) channels[id] = await edit(channel, name, categories[category]);
  }

  const slots = [
    ['profiles', 'ho-so-host', 'booking', 'forum', 'Hồ sơ do staff duyệt. Lọc theo nhóm Nam/Nữ và dịch vụ. Hồ sơ ghi game/chủ đề, giờ rảnh theo UTC+7, thời lượng và giá đã xác nhận.'],
    ['request', 'dat-lich', 'booking', 'read', 'Mở ticket để gửi host, dịch vụ, thời gian và thời lượng. Staff xác nhận lịch.'],
    ['reviews', 'danh-gia-booking', 'booking', 'forum', 'Đánh giá các phiên đã diễn ra. Gửi phản hồi qua ticket để staff hỗ trợ đăng.'],
    ['apply', 'tuyen-host', 'booking', 'read', 'Đăng ký host chơi game hoặc trò chuyện qua ticket.'],
    ['chat', 'tro-chuyen', 'community', 'chat', 'Tìm bạn chơi game, voice và trò chuyện cùng cộng đồng.'],
    ['lobby', 'Sảnh chờ', 'community', 'voice'],
    ['game', 'Chơi cùng', 'community', 'voice'],
    ['voice', 'Voice chill', 'community', 'voice'],
  ];
  const hasForums = guild.features.includes('COMMUNITY');
  for (const [id, name, parent, kind, topic] of slots) {
    const type = kind === 'voice' ? ChannelType.GuildVoice
      : kind === 'forum' && hasForums ? ChannelType.GuildForum : ChannelType.GuildText;
    let channel = existing(guild.channels.cache, name, type);
    if (id === 'chat') channel ||= existing(guild.channels.cache, 'global-chat', type);
    if (channel) {
      channels[id] = await edit(channel, name, categories[parent]);
      continue;
    }
    const forumTags = id === 'profiles' ? [['Nam', 'male'], ['Nữ', 'female'], ['Chơi game', 'game'], ['Trò chuyện', 'voice']]
      : [['Chơi game', 'game'], ['Trò chuyện', 'voice']];
    channels[id] = await guild.channels.create({
      name, type, parent: categories[parent].id, topic, reason, permissionOverwrites: access(guild, verified, staff, kind),
      ...(type === ChannelType.GuildForum ? {
        availableTags: forumTags.map(([tag, icon]) => ({
          name: tag, moderated: true, ...(emoji[icon] ? { emoji: { id: emoji[icon].id } } : {}),
        })),
        ...(emoji.reviews ? { defaultReactionEmoji: { id: emoji.reviews.id } } : {}),
      } : {}),
      ...(kind === 'voice' ? { userLimit: 0 } : {}),
    });
  }

  for (const item of original) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel || /^(?:closed-)?(?:ticket|order|support|warranty)-\d/i.test(channel.name)) continue;
    const cleaned = withoutDecoration(channel.name);
    if (cleaned && cleaned !== channel.name) await channel.setName(cleaned, reason);
  }
  const ordered = [...Object.values(categories), ...guild.channels.cache.filter(channel =>
    channel.type === ChannelType.GuildCategory && !Object.values(categories).some(target => target.id === channel.id),
  ).sort((a, b) => a.rawPosition - b.rawPosition).values()];
  if (ordered.some((channel, index) => channel.rawPosition !== index)) {
    await guild.channels.setPositions(ordered.map(({ id }, position) => ({ channel: id, position, lockPermissions: false })));
  }

  for (const [id, payload] of Object.entries(bookingPanels(guild.id, channels, emoji))) {
    await ensurePanel(channels[id], id, payload);
  }
  if (guild.name !== 'Cenar Booking') await guild.setName('Cenar Booking', reason);
  const live = new Map((await channelSnapshot(guild)).map(channel => [channel.id, channel]));
  if (!original.every(channel => live.has(channel.id) && JSON.stringify(live.get(channel.id).acl) === JSON.stringify(channel.acl))) {
    throw new Error('BOOKING_LEGACY_ACCESS_MISMATCH');
  }
  return {
    status: 'ready', revision: REVISION, existingChannelsRetained: proof.length,
    bookingChannels: slots.length, guidesPinned: 5, customEmoji: Object.keys(emoji).length,
    forums: hasForums ? 2 : 0,
  };
}
