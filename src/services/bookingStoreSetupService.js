import { fileURLToPath } from 'node:url';
import { ChannelType, MessageFlags, PermissionFlagsBits as P, Routes } from 'discord.js';
import { db } from '../database/db.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { BOOKING_BANNER_NAME, BOOKING_PANEL_IDS, BOOKING_PANEL_MARKER, bookingPanels } from '../utils/bookingPortalViews.js';
import { getGuildConfig } from './guildConfigService.js';
import { resolveVerificationRole } from './verificationRoleService.js';

export { bookingPanels } from '../utils/bookingPortalViews.js';
export const BOOKING_APP_ID = '1139187282075721768';
const LAYOUT = 'CENAR-BOOKING-HOST-DESK-20261123';
const LEGACY_PANEL_MARKERS = ['CENAR-BOOKING-LOBBY-20261122', 'CENAR-BOOKING-OPERATIONS-20261123'];
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
  start: ['----- ☬ 𝐈𝐦𝐩𝐨𝐫𝐭𝐚𝐧𝐭 ☬ ------', '01 · SẢNH CENAR'],
  booking: ['----- ☬ 𝐁𝐨𝐨𝐤𝐢𝐧𝐠 ☬ ------', '02 · ĐẶT LỊCH'],
  hosts: ['----- ☬ 𝐇𝐨𝐬𝐭 & 𝐅𝐞𝐞𝐝𝐛𝐚𝐜𝐤 ☬ ------'],
  community: ['----- ☬ 𝐂𝐡𝐚𝐭𝐭𝐢𝐧𝐠 ☬ ------', '04 · CỘNG ĐỒNG & VOICE'],
  events: ['----- ☬ 𝐄𝐯𝐞𝐧𝐭𝐬 ☬ ------'],
  games: ['----- ☬ 𝐆𝐚𝐦𝐞𝐬 ☬ ------'],
  voice: ['----- ☬ 𝐕𝐨𝐢𝐜𝐞 ☬ ------'],
  tickets: ['----- ☬ 𝐏𝐡𝐢ế𝐮 𝐁𝐨𝐨𝐤𝐢𝐧𝐠 ☬ ------'],
  support: ['----- ☬ 𝐒𝐮𝐩𝐩𝐨𝐫𝐭 ☬ ------', 'HỖ TRỢ & BẢO HÀNH ĐƠN CŨ'],
  market: ['05 · DỊCH VỤ CŨ', 'GLOBAL MARKETPLACE'],
  guides: ['06 · HƯỚNG DẪN DỊCH VỤ CŨ', 'GUIDES & RESOURCES'],
  premium: ['07 · TIỆN ÍCH CŨ', 'PREMIUM SERVICES'],
};
const oldChannels = {
  welcome: ['1514604934245384233', '✦ㆍ𝑰𝑵𝑭𝑶𝑹𝑴𝑨𝑻𝑰𝑶𝑵', 'start'],
  rules: ['1536693543463297104', '✦ㆍ𝑹𝑼𝑳𝑬𝑺', 'start'],
  news: ['1514594182717640735', '✦ㆍ𝑵𝑶𝑻𝑰𝑭𝑰𝑪𝑨𝑻𝑰𝑶𝑵𝑺', 'start'],
  verify: ['1514604946308464722', '✦ㆍ𝑽𝑬𝑹𝑰𝑭𝒀', 'start'],
  guide: ['1536693550455070761', 'huong-dan-mua-hang-cu', 'market'],
  support: ['1514604974066237551', '✦ㆍ𝑺𝑼𝑷𝑷𝑶𝑹𝑻', 'support'],
  reminders: ['1514604985193861182', '✦ㆍ𝑹𝑬𝑴𝑰𝑵𝑫𝑬𝑹𝑺', 'support'],
  warranty: ['1517266178282618980', '✦ㆍ𝑾𝑨𝑹𝑹𝑨𝑵𝑻𝒀', 'support'],
};
const oldSlotNames = {
  request: ['dat-lich'], handbook: ['cam-nang-booking'], profiles: ['ho-so-host'], reviews: ['danh-gia-booking'],
  apply: ['tuyen-host'], chat: ['tro-chuyen', 'global-chat'], lobby: ['Sảnh chờ'], game: ['Chơi cùng'], voice: ['Voice chill'],
};
const legacyCategoryNames = new Set(['03 · HOST & ĐÁNH GIÁ', '05 · PHIẾU BOOKING', '05 · DỊCH VỤ CŨ']);
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
  let saved = candidates.find(hasIdentity)
    ?? candidates.find(message => LEGACY_PANEL_MARKERS.some(version => textOnMessage(message).includes(`${version} · ${key}`)));
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
    ['request', '˖ი𐑼⋆𝑻𝑰𝑪𝑲𝑬𝑻', 'booking', 'read', 'Mở ticket để gửi host, dịch vụ, thời gian và thời lượng. Staff xác nhận lịch.'],
    ['handbook', '˖ი𐑼⋆𝑩𝑶𝑶𝑲𝑰𝑵𝑮-𝑮𝑼𝑰𝑫𝑬', 'booking', 'read', 'Cách chọn host, gửi giờ mong muốn, đổi lịch và gửi phản hồi.'],
    ['profiles', '✰・𝑽𝑰𝑷-𝑷𝑹𝑶𝑭𝑰𝑳𝑬', 'hosts', 'forum', 'Hồ sơ do staff duyệt. Lọc theo nhóm Nam/Nữ và dịch vụ. Hồ sơ ghi game/chủ đề, giờ rảnh theo UTC+7, thời lượng và giá đã xác nhận.'],
    ['reviews', '✰・𝑭𝑬𝑬𝑫𝑩𝑨𝑪𝑲', 'hosts', 'forum', 'Đánh giá các phiên đã diễn ra. Gửi phản hồi qua ticket để staff hỗ trợ đăng.'],
    ['apply', '✰・𝑨𝑷𝑷𝑳𝒀', 'hosts', 'read', 'Đăng ký host chơi game hoặc trò chuyện qua phiếu riêng.'],
    ['chat', '˳·˖✶ㆍ𝑴𝑨𝑰𝑵-𝑪𝑯𝑨𝑻', 'community', 'chat', 'Tìm bạn chơi game, voice và trò chuyện cùng cộng đồng.'],
    ['events', '✦・sự-kiện-cenar', 'events', 'read', 'Sự kiện cộng đồng và giveaway do ban vận hành Cenar tổ chức.'],
    ['games', '✦・trò-chơi-cenar', 'games', 'read', 'Ô chữ hằng ngày, nhiệm vụ và cửa hàng điểm cộng đồng.'],
    ['lobby', '⌁・𝑳𝑶𝑩𝑩𝒀', 'voice', 'voice'],
    ['game', '⌁・𝑮𝑨𝑴𝑬', 'voice', 'voice'],
    ['voice', '⌁・𝑽𝑶𝑰𝑪𝑬', 'voice', 'voice'],
  ];
  const hasForums = guild.features.includes('COMMUNITY');
  for (const [id, name, parent, kind, topic] of slots) {
    const type = kind === 'voice' ? ChannelType.GuildVoice
      : kind === 'forum' && hasForums ? ChannelType.GuildForum : ChannelType.GuildText;
    let channel = existing(guild.channels.cache, name, type);
    for (const oldName of oldSlotNames[id] ?? []) channel ||= existing(guild.channels.cache, oldName, type);
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

  let archiveNumber = 1;
  for (const legacyCategory of guild.channels.cache.filter(channel =>
    channel.type === ChannelType.GuildCategory && legacyCategoryNames.has(channel.name)).values()) {
    const hasChildren = guild.channels.cache.some(channel => channel.parentId === legacyCategory.id);
    if (!hasChildren) {
      const archiveName = `----- ☬ 𝐀𝐫𝐜𝐡𝐢𝐯𝐞 ${archiveNumber} ☬ ------`;
      archiveNumber += 1;
      await legacyCategory.setName(archiveName, reason);
    }
  }

  for (const item of original) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel || Object.values(categories).some(target => target.id === channel.id)
      || Object.values(channels).some(target => target.id === channel.id)
      || /^(?:closed-)?(?:ticket|order|support|warranty)-\d/i.test(channel.name)) continue;
    const cleaned = withoutDecoration(channel.name);
    if (cleaned && cleaned !== channel.name) await channel.setName(cleaned, reason);
  }
  const orderedGroups = [
    [categories.start, channels.welcome, channels.news, channels.rules, channels.verify],
    [categories.events, channels.events],
    [categories.booking, channels.request, channels.handbook],
    [categories.hosts, channels.profiles, channels.reviews, channels.apply],
    [categories.community, channels.chat],
    [categories.games, channels.games],
    [categories.voice, channels.lobby, channels.game, channels.voice],
    [categories.tickets],
    [categories.support, channels.support, channels.reminders, channels.warranty],
  ];
  const orderedIds = orderedGroups.flat().filter(Boolean).map(channel => channel.id);
  const orderedSet = new Set(orderedIds);
  const byPosition = (left, right) => left.rawPosition - right.rawPosition || left.id.localeCompare(right.id);
  const inOrder = list => list.every((channel, i) => i === 0 || byPosition(list[i - 1], channel) < 0);
  const remainder = guild.channels.cache.filter(channel => !orderedSet.has(channel.id))
    .sort(byPosition).map(channel => channel.id);
  const ordered = [...orderedIds, ...remainder];
  // Discord can renumber positions. Compare sidebar order, not absolute offsets.
  if (!inOrder(orderedGroups.map(([category]) => category).filter(Boolean))
    || orderedGroups.some(([, ...children]) => !inOrder(children.filter(Boolean)))) {
    await guild.channels.setPositions(ordered.map((id, position) => ({ channel: id, position, lockPermissions: false })));
  }

  const panels = Object.entries(bookingPanels(guild.id, channels, emoji));
  for (const [id, payload] of panels) {
    await ensurePanel(channels[id], id, payload);
  }
  if (guild.name !== 'Cenar Booking') await guild.setName('Cenar Booking', reason);
  const live = new Map((await channelSnapshot(guild)).map(channel => [channel.id, channel]));
  if (!original.every(channel => live.has(channel.id) && JSON.stringify(live.get(channel.id).acl) === JSON.stringify(channel.acl))) {
    throw new Error('BOOKING_LEGACY_ACCESS_MISMATCH');
  }
  if (!slots.every(([id, , parent]) => live.get(channels[id].id)?.parent === categories[parent].id)) {
    throw new Error('BOOKING_CHANNEL_GROUP_MISMATCH');
  }
  portals.set(client, {
    welcome: channels.welcome.id, request: channels.request.id, apply: channels.apply.id, handbook: channels.handbook.id,
    tickets: categories.tickets.id, games: channels.games.id, rules: channels.rules.id,
    profiles: channels.profiles.id, reviews: channels.reviews.id, chat: channels.chat.id,
    voiceChannels: [channels.lobby.id, channels.game.id, channels.voice.id],
    voiceCategory: categories.tickets.id, emoji,
  });
  return {
    status: 'ready', revision: LAYOUT,
    existingChannelsRetained: proof.filter(channel => live.has(channel.id)).length,
    bookingChannels: slots.length, guidesPinned: panels.length, customEmoji: Object.keys(emoji).length,
    forums: hasForums ? 2 : 0,
  };
}
