import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { roleColorsFor } from '../config/roleColors.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getPartnerSettings, upsertPartnerSettings } from './partnerService.js';
import { getCtvSettings, upsertCtvSettings } from './ctvService.js';
import { accentFor } from '../utils/uiKit.js';
import { publishCtvPricePanel } from './ctvPriceService.js';

const IDS = Object.freeze({
  partnerRole: '1522844528237740066',
  ctvRole: '1522844530242748446',
  partnerCategory: '1522844526195114185',
  partnerRecruit: '1522844532318801962',
  partnerDirectory: '1522844534470348810',
  partnerReview: '1522844538396479639',
  ctvRecruit: '1522844536202727491',
});

const ROLE_ICON_URLS = Object.freeze({
  partner: 'https://cdn.discordapp.com/emojis/1535637391841173534.png?size=96',
  ctv: 'https://cdn.discordapp.com/emojis/1535637396782317689.png?size=96',
});

const fruitNames = Object.freeze({
  partnerCategory: '🍓 ｜ Cenar Partner',
  ctvCategory: '🥝 ｜ Cenar CTV',
  partnerRecruit: '🍇-hợp-tác-đối-tác',
  partnerDirectory: '🍒-danh-sách-đối-tác',
  partnerReview: '🍍-duyệt-partner',
  partnerBroadcast: '🥭-partner-truyền-thông',
  ctvRecruit: '🍊-tuyển-cộng-tác-viên',
  ctvReview: '🍋-duyệt-ctv',
  ctvChat: '🍏-ctv-trò-chuyện',
  ctvOrderLog: '🍐-ctv-log-đơn-hàng',
  ctvPrice: '🍎-ctv-bảng-giá',
});

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;
const HISTORY = PermissionFlagsBits.ReadMessageHistory;
const EMBED = PermissionFlagsBits.EmbedLinks;
const ATTACH = PermissionFlagsBits.AttachFiles;
const REACT = PermissionFlagsBits.AddReactions;
const MENTION = PermissionFlagsBits.MentionEveryone;
const MANAGE = PermissionFlagsBits.ManageChannels;

function permissions(allow = [], deny = []) {
  return { allow, deny };
}

function staffOverrides(guild, clientId, staffRoleIds = []) {
  const rows = [
    { id: guild.roles.everyone.id, ...permissions([], [VIEW, SEND, HISTORY]) },
    { id: clientId, ...permissions([VIEW, SEND, HISTORY, EMBED, ATTACH, MANAGE]) },
  ];
  for (const id of staffRoleIds.filter(Boolean)) {
    rows.push({ id, ...permissions([VIEW, SEND, HISTORY, EMBED, ATTACH, REACT]) });
  }
  return rows;
}

function publicReadOverrides(guild, clientId, staffRoleIds = []) {
  const rows = [
    { id: guild.roles.everyone.id, ...permissions([VIEW, HISTORY], [SEND]) },
    { id: clientId, ...permissions([VIEW, SEND, HISTORY, EMBED, ATTACH, MANAGE]) },
  ];
  for (const id of staffRoleIds.filter(Boolean)) {
    rows.push({ id, ...permissions([VIEW, SEND, HISTORY, EMBED, ATTACH, REACT]) });
  }
  return rows;
}

function restrictedOverrides(guild, clientId, roleId, staffRoleIds = [], { allowMention = false } = {}) {
  const roleAllow = [VIEW, SEND, HISTORY, EMBED, ATTACH, REACT];
  if (allowMention) roleAllow.push(MENTION);
  const rows = [
    { id: guild.roles.everyone.id, ...permissions([], [VIEW, SEND, HISTORY, MENTION]) },
    { id: roleId, ...permissions(roleAllow, allowMention ? [] : [MENTION]) },
    { id: clientId, ...permissions([VIEW, SEND, HISTORY, EMBED, ATTACH, REACT, MENTION, MANAGE]) },
  ];
  for (const id of staffRoleIds.filter(Boolean)) {
    rows.push({ id, ...permissions([VIEW, SEND, HISTORY, EMBED, ATTACH, REACT, MENTION]) });
  }
  return rows;
}

async function setRoleIcon(role, url) {
  try {
    const response = await fetch(url);
    if (response.ok) await role.setIcon(Buffer.from(await response.arrayBuffer()), 'Cenar custom role icon');
  } catch (error) {
    console.warn(`[AUTO-SETUP] role icon ${role.id}: ${error.message}`);
  }
}

async function ensureRole(guild, client, id, { name, colors, iconUrl, mentionable, legacyIds = [] }) {
  let role = guild.roles.cache.get(id);
  if (!role) {
    role = await guild.roles.create({ name, colors, mentionable, reason: 'Cenar Partner/CTV workspace setup' });
  }
  if (!role.editable) return role;
  for (const legacyId of legacyIds) {
    const legacy = guild.roles.cache.get(legacyId);
    if (!legacy || legacy.id === role.id || !legacy.editable) continue;
    for (const member of legacy.members.values()) {
      await member.roles.add(role, 'Migrate to canonical Cenar role').catch(() => null);
    }
    await legacy.delete('Remove duplicate Cenar role').catch(() => null);
  }
  await role.edit({ name, colors, mentionable, reason: 'Cenar role naming and color standard' }).catch(() => null);
  if (!role.icon && iconUrl) await setRoleIcon(role, iconUrl);
  return role;
}

async function ensureCategory(guild, id, name) {
  let category = id ? guild.channels.cache.get(id) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  }
  if (!category) category = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  if (category.name !== name) await category.setName(name).catch(() => null);
  return category;
}

async function ensureChannel(guild, { id, name, parent, overwrites }) {
  let channel = id ? guild.channels.cache.get(id) : null;
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name && c.parentId === parent.id);
  }
  if (!channel) {
    channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parent.id, permissionOverwrites: overwrites });
  } else {
    if (channel.name !== name) await channel.setName(name).catch(() => null);
    if (channel.parentId !== parent.id) await channel.setParent(parent.id).catch(() => null);
    await channel.permissionOverwrites.set(overwrites, 'Cenar workspace permission standard').catch(() => null);
  }
  return channel;
}

async function postRecruitmentPanel(channel, kind, guildId, references) {
  const latest = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const E = createEmojiResolver(guildId);
  const isCtv = kind === 'ctv';
  const container = new ContainerBuilder().setAccentColor(accentFor(isCtv ? 'success' : 'primary'));
  const title = isCtv ? `${E('cenar_ctv')} CENAR CTV | Đăng ký cộng tác viên` : `${E('cenar_partner')} CENAR PARTNER | Kết nối server`;
  const details = isCtv
    ? [
        `## ${title}`,
        `${E('cenar_verified')} Nguồn hàng và giá CTV được đồng bộ giữa bot và website.`,
        '',
        `### ${E('cenar_price')} Quyền lợi`,
        `- Giá CTV tự động theo bảng giá riêng.`,
        `- Đơn hàng được gắn ưu tiên và ghi log riêng tại <#${references.ctvOrderLog}>.`,
        `- Trao đổi nội bộ tại <#${references.ctvChat}>.`,
        '',
        `### ${E('ctv_crystal') || E('cenar_staff')} Điều kiện`,
        `Có kênh bán hàng rõ ràng và cam kết hỗ trợ khách hàng minh bạch.`,
        `-# Hồ sơ sẽ được staff duyệt thủ công trong vòng 24 giờ.`,
      ].join('\n')
    : [
        `## ${title}`,
        `${E('cenar_verified')} Cùng phát triển cộng đồng, trao đổi banner và ưu đãi minh bạch.`,
        '',
        `### ${E('cenar_partner_ok')} Tiêu chí xét duyệt`,
        `- Server từ 500 thành viên: tự động chuyển vào hàng chờ xét duyệt.`,
        `- Server dưới 500 thành viên: chuyển **duyệt thủ công** để hỗ trợ cộng đồng nhỏ.`,
        `- Không vi phạm chính sách Discord và có kênh quảng bá phù hợp.`,
        '',
        `### ${E('cenar_announce')} Sau khi được duyệt`,
        `Role Partner được cấp tự động. Kênh truyền thông riêng: <#${references.partnerBroadcast}>.`,
        `Giới hạn tag: role Partner 2 lần/ngày, @everyone 1 lần/ngày cho mỗi thành viên.`,
      ].join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(details));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const button = new ButtonBuilder()
    .setCustomId(isCtv ? 'ctv:apply:start' : 'partner:apply:start')
    .setLabel(isCtv ? 'Đăng ký CTV' : 'Đăng ký Partner')
    .setStyle(ButtonStyle.Success);
  const emoji = E.component(isCtv ? 'cenar_ctv' : 'cenar_partner');
  if (emoji) button.setEmoji(emoji);
  const payload = {
    components: [container, new ActionRowBuilder().addComponents(button)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
  const customId = isCtv ? 'ctv:apply:start' : 'partner:apply:start';
  const existing = latest?.find((message) => (
    message.author.id === channel.client.user.id
    && JSON.stringify(message.components.map((component) => component.toJSON())).includes(customId)
  ));
  if (existing?.flags?.has(MessageFlags.IsComponentsV2)) {
    await existing.edit(payload);
  } else {
    if (existing) await existing.delete('Replace legacy recruitment panel with Components V2').catch(() => null);
    await channel.send(payload);
  }
}

export async function autoSetupPartnerAndCtv(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const settings = db.prepare('SELECT support_role_id, manager_role_id FROM guild_settings WHERE guild_id = ?').get(guild.id) || {};
      const staffRoles = [settings.support_role_id, settings.manager_role_id, '1282638119497109524'];
      const enhancedRoleColors = guild.features.includes('ENHANCED_ROLE_COLORS');
      const partnerRole = await ensureRole(guild, client, IDS.partnerRole, {
        name: 'Cenar Partner', colors: roleColorsFor(IDS.partnerRole, { enhanced: enhancedRoleColors }), iconUrl: ROLE_ICON_URLS.partner, mentionable: false,
        legacyIds: ['1367138153735131176'],
      });
      const ctvRole = await ensureRole(guild, client, IDS.ctvRole, {
        name: 'Cenar CTV', colors: roleColorsFor(IDS.ctvRole, { enhanced: enhancedRoleColors }), iconUrl: ROLE_ICON_URLS.ctv, mentionable: false,
        legacyIds: ['1514858684151369832'],
      });

      const partnerCategory = await ensureCategory(guild, IDS.partnerCategory, fruitNames.partnerCategory);
      const ctvSettings = getCtvSettings(guild.id);
      const ctvCategory = await ensureCategory(guild, ctvSettings.category_id, fruitNames.ctvCategory);
      const botId = client.user.id;

      const partnerRecruit = await ensureChannel(guild, { id: IDS.partnerRecruit, name: fruitNames.partnerRecruit, parent: partnerCategory, overwrites: publicReadOverrides(guild, botId, staffRoles) });
      const partnerDirectory = await ensureChannel(guild, { id: IDS.partnerDirectory, name: fruitNames.partnerDirectory, parent: partnerCategory, overwrites: publicReadOverrides(guild, botId, staffRoles) });
      const partnerReview = await ensureChannel(guild, { id: IDS.partnerReview, name: fruitNames.partnerReview, parent: partnerCategory, overwrites: staffOverrides(guild, botId, staffRoles) });
      const partnerBroadcast = await ensureChannel(guild, { name: fruitNames.partnerBroadcast, parent: partnerCategory, overwrites: restrictedOverrides(guild, botId, partnerRole.id, staffRoles, { allowMention: false }) });

      const ctvRecruit = await ensureChannel(guild, { id: IDS.ctvRecruit, name: fruitNames.ctvRecruit, parent: ctvCategory, overwrites: publicReadOverrides(guild, botId, staffRoles) });
      const ctvReview = await ensureChannel(guild, { name: fruitNames.ctvReview, parent: ctvCategory, overwrites: staffOverrides(guild, botId, staffRoles) });
      const ctvChat = await ensureChannel(guild, { name: fruitNames.ctvChat, parent: ctvCategory, overwrites: restrictedOverrides(guild, botId, ctvRole.id, staffRoles) });
      const ctvOrderLog = await ensureChannel(guild, { name: fruitNames.ctvOrderLog, parent: ctvCategory, overwrites: restrictedOverrides(guild, botId, ctvRole.id, staffRoles) });
      const ctvPrice = await ensureChannel(guild, { name: fruitNames.ctvPrice, parent: ctvCategory, overwrites: restrictedOverrides(guild, botId, ctvRole.id, staffRoles) });

      upsertPartnerSettings({
        guild_id: guild.id,
        recruit_channel_id: partnerRecruit.id,
        approve_channel_id: partnerReview.id,
        partner_role_id: partnerRole.id,
        directory_channel_id: partnerDirectory.id,
        partner_channel_id: partnerBroadcast.id,
      });
      upsertCtvSettings({
        guild_id: guild.id,
        recruit_channel_id: ctvRecruit.id,
        approve_channel_id: ctvReview.id,
        ctv_role_id: ctvRole.id,
        category_id: ctvCategory.id,
        chat_channel_id: ctvChat.id,
        order_log_channel_id: ctvOrderLog.id,
        price_channel_id: ctvPrice.id,
      });

      await postRecruitmentPanel(partnerRecruit, 'partner', guild.id, { partnerBroadcast: partnerBroadcast.id });
      await postRecruitmentPanel(ctvRecruit, 'ctv', guild.id, { ctvChat: ctvChat.id, ctvOrderLog: ctvOrderLog.id });
      await publishCtvPricePanel(guild).catch((error) => {
        console.warn(`[AUTO-SETUP] CTV price panel ${guild.id}: ${error.message}`);
      });
      console.log(`[AUTO-SETUP] Partner/CTV workspace ready: ${guild.name}`);
    } catch (error) {
      console.error(`[AUTO-SETUP] ${guild.name}: ${error.message}`);
    }
  }
}

export { IDS as PARTNER_CTV_IDS };
