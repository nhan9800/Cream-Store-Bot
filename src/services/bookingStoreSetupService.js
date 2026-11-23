import { fileURLToPath } from 'node:url';
import { ChannelType, MessageFlags, PermissionFlagsBits as P, Routes } from 'discord.js';
import { db } from '../database/db.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { BOOKING_BANNER_NAME, BOOKING_PANEL_IDS, BOOKING_PANEL_MARKER, bookingPanels } from '../utils/bookingPortalViews.js';
import { getGuildConfig } from './guildConfigService.js';
import { resolveVerificationRole } from './verificationRoleService.js';

export { bookingPanels } from '../utils/bookingPortalViews.js';
export const BOOKING_APP_ID = '1139187282075721768';
const LAYOUT = 'CENAR-BOOKING-VISUAL-20261123';
const reason = 'Cenar Booking channel setup';
const glyphs = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/u;
const statuses = new WeakMap();
const portals = new WeakMap();
const icons = {
  welcome: '474566-confetti.png', rules: '912203-shield.png', calendar: '47836-calendar.png',
  profiles: '739224-member.png', apply: '4817-staff.png', reviews: '521557-textmessage.png',
  game: '451014-target.png', voice: '308605-microphone.png', male: '962321-maparrow.png',
  female: '510611-star.png', support: '687464-ticketsupportroleicon.png', news: '541187-announce.png',
};
const existingIcons = {
  welcome: '7560cinnamonwave', rules: 'AGENT_Warning_327', calendar: 'pepenoted',
  profiles: '1651_peepo_neutral', apply: 'tickgreen', reviews: 'starxoay',
  game: '1621swordge', voice: '6038peepochat', male: '2558keroppiwave',
  female: '9014hellokittywave', support: 'blobcathug', news: 'tsm_fire',
};
const newCategories = {
  start: ['01 · SẢNH CENAR', '01 · BẮT ĐẦU'],
  booking: ['02 · ĐẶT LỊCH', '02 · BOOKING'],
  hosts: ['03 · HOST & ĐÁNH GIÁ'],
  community: ['04 · CỘNG ĐỒNG & VOICE', '03 · CỘNG ĐỒNG & VOICE'],
  tickets: ['05 · PHIẾU BOOKING'],
  support: ['HỖ TRỢ & BẢO HÀNH ĐƠN CŨ', '04 · HỖ TRỢ & BẢO HÀNH'],
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
const requiredExisting = ['welcome', 'rules', 'news', 'verify', 'support'];

export function bookingStoreSetupStatus(client) {
  return statuses.get(client) ?? { status: 'not_started' };
}

export function markBookingOperationsReady(client, { voicePermissions, payosEnabled }) {
  const setup = statuses.get(client);
  if (setup?.status !== 'ready' || !bookingPortal(client)) return;
  statuses.set(client, { ...setup, operations: { status: 'ready', voicePermissions, payosEnabled } });
}

export function bookingPortal(client) {
  return portals.get(client);
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
  const usable = item => item && item.available !== false && !item.roles.cache.size;
  for (const [key, image] of Object.entries(icons)) {
    const name = `cenar_booking_${key}`;
    const item = inventory.find(emoji => usable(emoji) && emoji.name === name)
      ?? inventory.find(emoji => usable(emoji) && emoji.name === existingIcons[key])
      ?? await guild.emojis.create({
        name, attachment: fileURLToPath(new URL(`../../assets/emojis/ui27/${image}`, import.meta.url)), reason,
      }).catch(() => null);
    if (usable(item)) {
      result[key] = { id: item.id, name: item.name, animated: Boolean(item.animated) };
    }
  }
  return result;
}

function textOnMessage(message) {
  const inspect = rows => rows.flatMap(row => [row.content || row.data?.content || '', ...inspect(row.components ?? [])]);
  return [message.content || '', ...inspect(message.components ?? [])].join('\n');
}

function panelSignature(components) {
  return components.map(component => {
    const row = component.toJSON?.() ?? component;
    return [
      row.type, row.content, row.label, row.custom_id, row.url, row.style, row.emoji?.id,
      row.accent_color, row.type === 14 ? (row.divider ?? true) : null, panelSignature(row.components ?? []),
      row.accessory ? panelSignature([row.accessory]) : null,
      row.items?.map(item => [bannerSignature(item.media?.url), item.description]),
    ];
  });
}

function bannerSignature(url) {
  if (url === `attachment://${BOOKING_BANNER_NAME}`) return BOOKING_BANNER_NAME;
  if (/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(url || '')
    && url.split('?')[0].endsWith(`/${BOOKING_BANNER_NAME}`)) return BOOKING_BANNER_NAME;
  return url;
}

async function ensurePanel(channel, key, payload) {
  const messages = await channel.messages.fetch({ limit: 50 });
  const marker = `${BOOKING_PANEL_MARKER} · ${key}`;
  const oldMarker = { welcome: 'CENAR GLOBAL • INTERNATIONAL STORE', rules: 'CENAR GLOBAL • STORE RULES' }[key];
  const owned = message => message.author.id === channel.client.user.id;
  const hasIdentity = message => owned(message) && (message.components.some(component =>
    (component.id ?? component.data?.id) === BOOKING_PANEL_IDS[key]) || textOnMessage(message).includes(marker));
  const candidates = messages.filter(owned);
  let saved = candidates.find(hasIdentity);
  if (!saved && channel.messages.fetchPins) {
    const pins = await channel.messages.fetchPins({ limit: 50 });
    saved = pins.items.map(item => item.message).find(hasIdentity);
  }
  const replaced = saved || (oldMarker && candidates.find(message =>
    !message.attachments.size && message.flags.has(MessageFlags.IsComponentsV2) && textOnMessage(message).includes(oldMarker)));
  const message = replaced || await channel.send({
    ...payload, nonce: `cenar-bk-261121-${key}`, enforceNonce: true,
  });
  if (replaced) {
    const { files, ...content } = payload;
    const pendingUploads = files?.filter(file => !replaced.attachments.some(existing => existing.name === file.name));
    if (pendingUploads?.length || JSON.stringify(panelSignature(replaced.components)) !== JSON.stringify(panelSignature(payload.components))) {
      await replaced.edit({ ...content, ...(pendingUploads?.length ? {
        files: pendingUploads,
        attachments: replaced.attachments.map(existing => ({ id: existing.id })),
      } : {}) });
    }
  }
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
  if (guildId !== STORE_TWO_GUILD_ID || client?.user?.id !== BOOKING_APP_ID) return { status: 'not_configured' };
  statuses.set(client, { status: 'syncing', revision: LAYOUT });
  try {
    const result = await applyBookingLayout(client, guildId);
    statuses.set(client, result);
    return result;
  } catch (error) {
    const code = String(error.code || error.message || '');
    portals.delete(client);
    statuses.set(client, { status: 'retry_required', revision: LAYOUT,
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
  const key = `booking_discord_snapshot:${guildId}:${BOOKING_PANEL_MARKER}`;
  db.prepare('INSERT OR IGNORE INTO system_settings (key,value) VALUES (?,?)').run(key, JSON.stringify(original));
  const proof = JSON.parse(db.prepare('SELECT value FROM system_settings WHERE key=?').get(key).value);
  const verified = resolveVerificationRole(guild);
  const cfg = getGuildConfig(guild.id);
  const staff = [...new Set([cfg?.manager_role_id, cfg?.support_role_id].filter(id => id && id !== guild.id && guild.roles.cache.has(id)))];
  const emoji = await loadIcons(guild);
  const categories = {};
  for (const [id, [name, old]] of Object.entries(newCategories)) {
    let channel = existing(guild.channels.cache, name, ChannelType.GuildCategory)
      || (old && existing(guild.channels.cache, old, ChannelType.GuildCategory))
      || (id === 'start' && existing(guild.channels.cache, 'START HERE', ChannelType.GuildCategory))
      || (id === 'support' && existing(guild.channels.cache, 'CUSTOMER SUPPORT', ChannelType.GuildCategory))
      || (id === 'community' && existing(guild.channels.cache, 'GLOBAL COMMUNITY', ChannelType.GuildCategory));
    if (!channel && ['market', 'guides', 'premium'].includes(id)) continue;
    if (!channel) channel = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason,
      ...(id === 'tickets' ? { permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: guild.client.user.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.ManageChannels] },
        ...staff.map(role => ({ id: role, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages] })),
      ] } : {}),
    });
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
    ['request', 'dat-lich', 'booking', 'read', 'Mở ticket để gửi host, dịch vụ, thời gian và thời lượng. Staff xác nhận lịch.'],
    ['handbook', 'cam-nang-booking', 'booking', 'read', 'Cách chọn host, gửi giờ mong muốn, đổi lịch và gửi phản hồi.'],
    ['profiles', 'ho-so-host', 'hosts', 'forum', 'Hồ sơ do staff duyệt. Lọc theo nhóm Nam/Nữ và dịch vụ. Hồ sơ ghi game/chủ đề, giờ rảnh theo UTC+7, thời lượng và giá đã xác nhận.'],
    ['reviews', 'danh-gia-booking', 'hosts', 'forum', 'Đánh giá các phiên đã diễn ra. Gửi phản hồi qua ticket để staff hỗ trợ đăng.'],
    ['apply', 'tuyen-host', 'hosts', 'read', 'Đăng ký host chơi game hoặc trò chuyện qua phiếu riêng.'],
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
    const tagIcons = id === 'profiles' ? [['Nam', 'male'], ['Nữ', 'female'], ['Chơi game', 'game'], ['Trò chuyện', 'voice']]
      : [['Chơi game', 'game'], ['Trò chuyện', 'voice']];
    const forumTags = tagIcons.map(([tag, icon]) => ({
      name: tag, moderated: true, ...(emoji[icon] ? { emoji: { id: emoji[icon].id } } : {}),
    }));
    const defaultReactionEmoji = emoji.reviews ? { id: emoji.reviews.id } : undefined;
    if (channel) {
      channel = await edit(channel, name, categories[parent]);
      if (type === ChannelType.GuildForum) {
        const tags = channel.availableTags.map(current => {
          const expected = forumTags.find(tag => tag.name === current.name);
          return expected ? { ...current, emoji: expected.emoji } : current;
        });
        tags.push(...forumTags.filter(tag => !tags.some(current => current.name === tag.name)));
        const changedTags = tags.length !== channel.availableTags.length || tags.some((tag, i) =>
          (tag.emoji?.id ?? tag.emoji?.name) !== (channel.availableTags[i].emoji?.id ?? channel.availableTags[i].emoji?.name),
        );
        const changedReaction = defaultReactionEmoji?.id !== (channel.defaultReactionEmoji?.id ?? channel.defaultReactionEmoji?.name);
        if (changedTags || changedReaction) {
          channel = await channel.edit({
            ...(changedTags ? { availableTags: tags } : {}),
            ...(changedReaction ? { defaultReactionEmoji: defaultReactionEmoji ?? null } : {}),
            reason,
          });
        }
      }
      channels[id] = channel;
      continue;
    }
    channels[id] = await guild.channels.create({
      name, type, parent: categories[parent].id, topic, reason, permissionOverwrites: access(guild, verified, staff, kind),
      ...(type === ChannelType.GuildForum ? {
        availableTags: forumTags, defaultReactionEmoji,
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
  portals.set(client, {
    request: channels.request.id, apply: channels.apply.id, handbook: channels.handbook.id, tickets: categories.tickets.id,
    profiles: channels.profiles.id, reviews: channels.reviews.id, chat: channels.chat.id,
    voiceChannels: [channels.lobby.id, channels.game.id, channels.voice.id],
    voiceCategory: categories.tickets.id, emoji,
  });
  return {
    status: 'ready', revision: LAYOUT,
    existingChannelsRetained: proof.filter(channel => live.has(channel.id)).length,
    bookingChannels: slots.length, guidesPinned: 6, customEmoji: Object.keys(emoji).length,
    forums: hasForums ? 2 : 0,
  };
}
