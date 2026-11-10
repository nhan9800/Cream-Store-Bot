import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder,
  MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';

const CATEGORY_ID = '1514606994256957600';
const CHANNEL_NAME = '🛒・autobuy';
const channelTopic = botId => `Cenar AutoBuy · Cenar Store quản lý · Bot ${botId}`;
const PREFIX = `supplier-autobuy:${STORE_ONE_GUILD_ID}:`;
const CONTROL_IDS = ['supplier-autobuy:catalog', 'supplier-autobuy:status'];
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const starts = new WeakMap();
let panelHealth = Object.freeze({ status: 'NOT_STARTED', channelId: null, messageId: null });
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);

function setHealth(status, channelId = null, messageId = null) {
  panelHealth = Object.freeze({ status, channelId: snowflake(channelId) ? channelId : null, messageId: snowflake(messageId) ? messageId : null });
  return panelHealth;
}

export function getSupplierAutobuyPanelHealth() { return panelHealth; }

function checkedLine(snapshot) {
  const value = snapshot?.checkedAt;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return 'Đang chờ lần kiểm tra đầu tiên.';
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 'Đang chờ lần kiểm tra đầu tiên.';
  return `Lần kiểm tra gần nhất: <t:${Math.floor(date / 1000)}:f>.`;
}

function stateLine(snapshot) {
  if (snapshot?.status === 'HTTP_OK_SCHEMA_UNVERIFIED') return 'Đã nhận phản hồi kết nối. Shop đang kiểm tra danh mục và điều kiện bán.';
  if (snapshot?.status === 'CHECKING') return 'Shop đang kiểm tra kết nối nguồn hàng.';
  return 'Shop đang hoàn thiện kết nối nguồn hàng và bảng giá.';
}

function containerWithTitle(title, text, accent = 0x41B899) {
  const container = new ContainerBuilder().setAccentColor(accent);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return container;
}

export function buildSupplierAutobuyPanel({ client, snapshot, supportChannelId } = {}) {
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const container = containerWithTitle(`## ${E('panel_order')} CENAR AUTOBUY`.trim(), [
    `### ${E('status_loading')} Đang chuẩn bị mở bán`,
    stateLine(snapshot),
    '',
    'Danh mục, giá bán và bảo hành sẽ được công bố sau khi kiểm tra đầy đủ.',
    '**Kênh hiện chưa nhận thanh toán hoặc tạo đơn autobuy.**',
  ].join('\n'));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${E('status_info')} ${checkedLine(snapshot)}\n-# Các đơn đang có vẫn được shop hỗ trợ theo chính sách đã mua.`));
  const row = new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setCustomId(CONTROL_IDS[0]).setLabel('Danh mục & giá').setStyle(ButtonStyle.Primary), E('icon_doc')),
    withButtonEmoji(new ButtonBuilder().setCustomId(CONTROL_IDS[1]).setLabel('Tình trạng mở bán').setStyle(ButtonStyle.Secondary), E('status_loading')),
  );
  if (snowflake(supportChannelId)) row.addComponents(withButtonEmoji(new ButtonBuilder().setLabel('Tạo ticket hỗ trợ')
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${STORE_ONE_GUILD_ID}/${supportChannelId}`), E('cenar_support')));
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications, allowedMentions: { ...NO_MENTIONS } };
}

export function buildSupplierAutobuyReply({ client, snapshot, action } = {}) {
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const catalog = action === 'catalog';
  const title = catalog ? `## ${E('icon_doc')} Danh mục đang được chuẩn bị` : `## ${E('status_loading')} Tình trạng autobuy`;
  const text = catalog
    ? 'Shop chưa công bố sản phẩm hoặc giá bán autobuy. Giá, thời hạn và bảo hành sẽ hiển thị rõ trước khi khách xác nhận mua.\n\n**Hiện chưa nhận tiền hoặc tạo đơn ở kênh này.**'
    : `${stateLine(snapshot)}\n\n${checkedLine(snapshot)}\nĐây là kết quả kiểm tra đã lưu; thao tác này không tạo giao dịch.\n\n**Autobuy chưa mở bán.**`;
  return { components: [containerWithTitle(title, text)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { ...NO_MENTIONS } };
}

function readSetting(name) { return db.prepare('SELECT value FROM system_settings WHERE key = ?').get(`${PREFIX}${name}`)?.value ?? null; }
function saveSetting(name, value) {
  db.prepare(`INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(`${PREFIX}${name}`, value, new Date().toISOString());
}
function componentIds(message) {
  const ids = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.custom_id === 'string') ids.push(value.custom_id);
    if (Array.isArray(value.components)) value.components.forEach(walk);
  };
  for (const component of message.components || []) walk(typeof component.toJSON === 'function' ? component.toJSON() : component);
  return ids.sort();
}
function ownedPanel(message, botId) {
  return message?.author?.id === botId && !message.webhookId
    && JSON.stringify(componentIds(message)) === JSON.stringify([...CONTROL_IDS].sort());
}
function ownedChannel(channel, botId) {
  return channel?.type === ChannelType.GuildText && channel.guildId === STORE_ONE_GUILD_ID
    && channel.parentId === CATEGORY_ID && channel.name === CHANNEL_NAME
    && channel.topic === channelTopic(botId);
}
function readOnlyPermissions(channel, botId) {
  const everyone = channel.permissionOverwrites?.cache?.get(STORE_ONE_GUILD_ID);
  const bot = channel.permissionsFor?.(botId);
  const deny = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads];
  const permittedWriter = [...(channel.permissionOverwrites?.cache?.values() || [])]
    .some(overwrite => overwrite.id !== botId && overwrite.id !== STORE_ONE_GUILD_ID && overwrite.allow?.any(deny));
  return everyone?.allow?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    && everyone?.deny?.has(deny)
    && !permittedWriter
    && bot?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]);
}

export function ensureSupplierAutobuyChannel(client, { guildId, envFile, snapshot } = {}) {
  if (guildId !== STORE_ONE_GUILD_ID || envFile !== '.env') return Promise.resolve(setHealth('DISABLED_OTHER_STORE'));
  if (starts.has(client)) return starts.get(client);
  const task = Promise.resolve().then(async () => {
    let channelId = null;
    let messageId = null;
    try {
      const botId = client.user?.id;
      if (!snowflake(botId)) return setHealth('DEGRADED_BOT_UNAVAILABLE');
      const guild = await client.guilds.fetch(STORE_ONE_GUILD_ID);
      if (guild?.id !== STORE_ONE_GUILD_ID) return setHealth('DEGRADED_GUILD_UNAVAILABLE');
      // Authoritative inventory, never a cache-only absence followed by create.
      const channels = await guild.channels.fetch();
      if (!channels || typeof channels.values !== 'function') return setHealth('DEGRADED_CHANNEL_READ');
      const parent = channels.get(CATEGORY_ID);
      if (parent?.type !== ChannelType.GuildCategory || parent.guildId !== STORE_ONE_GUILD_ID) return setHealth('DEGRADED_CATEGORY_UNAVAILABLE');
      channelId = readSetting('channel_id');
      messageId = readSetting('message_id');
      if ((channelId && !snowflake(channelId)) || (messageId && !snowflake(messageId)) || (!channelId && messageId)) return setHealth('DEGRADED_SAVED_REFERENCE');
      let channel;
      if (channelId) {
        channel = channels.get(channelId);
        if (!ownedChannel(channel, botId)) return setHealth('DEGRADED_SAVED_CHANNEL', channelId, messageId);
      } else {
        const matches = [...channels.values()].filter(item => ownedChannel(item, botId));
        if (matches.length > 1) return setHealth('DEGRADED_AMBIGUOUS_CHANNEL');
        channel = matches[0];
        if (!channel) {
          // A conflicting name is not ours to adopt, rename or overwrite.
          if ([...channels.values()].some(item => item.parentId === CATEGORY_ID && item.name === CHANNEL_NAME)) return setHealth('DEGRADED_CHANNEL_CONFLICT');
          if (readSetting('channel_pending') === '1') return setHealth('DEGRADED_CHANNEL_UNCERTAIN');
          if (!parent.permissionsFor?.(botId)?.has(PermissionFlagsBits.ManageChannels)) return setHealth('DEGRADED_NO_ACCESS');
          saveSetting('channel_pending', '1');
          channel = await guild.channels.create({
            name: CHANNEL_NAME, type: ChannelType.GuildText, parent: CATEGORY_ID,
            topic: channelTopic(botId),
            permissionOverwrites: [
              { id: STORE_ONE_GUILD_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads] },
              { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] },
            ],
            reason: 'Owner-requested separate autobuy channel; sales remain disabled',
          });
          if (!ownedChannel(channel, botId)) return setHealth('DEGRADED_CREATED_CHANNEL');
        }
        channelId = channel.id;
        saveSetting('channel_id', channelId);
        saveSetting('channel_pending', '0');
      }
      if (!readOnlyPermissions(channel, botId)) return setHealth('DEGRADED_CHANNEL_PERMISSIONS', channelId, messageId);
      const supportId = db.prepare('SELECT ticket_panel_channel_id FROM guild_settings WHERE guild_id = ?').get(STORE_ONE_GUILD_ID)?.ticket_panel_channel_id;
      const support = snowflake(supportId) ? channels.get(supportId) : null;
      const supportChannelId = support?.guildId === STORE_ONE_GUILD_ID && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(support.type) ? supportId : null;
      const payload = buildSupplierAutobuyPanel({ client, snapshot, supportChannelId });
      let message;
      if (messageId) {
        message = await channel.messages.fetch(messageId);
        if (!ownedPanel(message, botId)) return setHealth('DEGRADED_SAVED_MESSAGE', channelId, messageId);
      } else {
        const recent = await channel.messages.fetch({ limit: 100 });
        const matching = [...recent.values()].filter(item => ownedPanel(item, botId));
        if (matching.length > 1) return setHealth('DEGRADED_AMBIGUOUS_PANEL', channelId);
        message = matching[0];
        if (!message) {
          // Unknown send outcomes require reconciliation; don't duplicate a
          // potentially posted card when its receipt was lost or aged away.
          if (readSetting('panel_pending') === '1' || recent.size >= 100) return setHealth('DEGRADED_PUBLICATION_UNCERTAIN', channelId);
          saveSetting('panel_pending', '1');
          message = await channel.send(payload);
          if (!ownedPanel(message, botId) || !snowflake(message.id)) return setHealth('DEGRADED_SENT_MESSAGE', channelId);
        }
        messageId = message.id;
        saveSetting('message_id', messageId);
        saveSetting('panel_pending', '0');
      }
      // SuppressNotifications is a send-only flag; edits retain silence through
      // allowedMentions and do not attempt to set an unsupported edit flag.
      await message.edit({ ...payload, flags: MessageFlags.IsComponentsV2 });
      return setHealth('READY', channelId, messageId);
    } catch {
      return setHealth('DEGRADED_SETUP_FAILED', channelId, messageId);
    }
  });
  starts.set(client, task);
  return task;
}
