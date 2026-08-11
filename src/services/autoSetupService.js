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
import { isInternationalGuild } from '../utils/locale.js';

const IDS = Object.freeze({
  partnerRole: '1522844528237740066',
  ctvRole: '1522844530242748446',
  partnerCategory: '1522844526195114185',
  partnerRecruit: '1522844532318801962',
  partnerDirectory: '1522844534470348810',
  partnerReview: '1522844538396479639',
  partnerBroadcast: '1535669776628584449',
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

const internationalNames = Object.freeze({
  partnerCategory: 'PARTNER NETWORK',
  ctvCategory: 'AFFILIATE PROGRAM',
  partnerRecruit: 'partner-apply',
  partnerDirectory: 'verified-partners',
  partnerReview: 'partner-review',
  partnerBroadcast: 'partner-media',
  ctvRecruit: 'affiliate-apply',
  ctvReview: 'affiliate-review',
  ctvChat: 'affiliate-lounge',
  ctvOrderLog: 'affiliate-order-log',
  ctvPrice: 'affiliate-pricing',
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
  if (!role) role = guild.roles.cache.find((candidate) => !candidate.managed && candidate.name === name);
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
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor(isCtv ? 'success' : 'primary'));
  const title = international
    ? (isCtv ? `${E('cenar_ctv')} CENAR AFFILIATE | Apply` : `${E('cenar_partner')} CENAR PARTNER | Connect your community`)
    : (isCtv ? `${E('cenar_ctv')} CENAR CTV | Đăng ký cộng tác viên` : `${E('cenar_partner')} CENAR PARTNER | Kết nối server`);
  const details = international
    ? (isCtv
      ? [
          `## ${title}`,
          `${E('cenar_verified')} Affiliate inventory and pricing stay synchronized between Discord and the website.`,
          '',
          `### ${E('cenar_price')} Benefits`,
          `- Private affiliate pricing and prioritized order records.`,
          `- Order activity is logged at <#${references.ctvOrderLog}>.`,
          `- Internal communication is available at <#${references.ctvChat}>.`,
          '',
          `### ${E('cenar_staff')} Requirements`,
          `Operate a transparent sales channel and provide responsible customer support.`,
          `-# Applications are reviewed manually within 24 hours.`,
        ].join('\n')
      : [
          `## ${title}`,
          `${E('cenar_verified')} Build a transparent partnership through community promotion and shared benefits.`,
          '',
          `### ${E('cenar_partner_ok')} Review criteria`,
          `- Communities with 500+ members enter the standard review queue.`,
          `- Smaller communities receive manual review so promising projects are not excluded.`,
          `- The server must follow Discord policies and maintain a suitable promotion area.`,
          '',
          `### ${E('cenar_announce')} After approval`,
          `The Partner role is granted automatically. Your media channel is <#${references.partnerBroadcast}>.`,
          `Mention quota: Partner role twice and @everyone once per rolling 24-hour window.`,
        ].join('\n'))
    : isCtv
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
    .setLabel(international ? (isCtv ? 'Apply as Affiliate' : 'Apply as Partner') : (isCtv ? 'Đăng ký CTV' : 'Đăng ký Partner'))
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

export function buildPartnerBroadcastGuidePayload(guildId, { partnerRoleId } = {}) {
  const E = createEmojiResolver(guildId);
  const roleLabel = partnerRoleId ? `<@&${partnerRoleId}>` : '**Role Partner**';
  if (isInternationalGuild(guildId)) {
    const guide = new ContainerBuilder().setAccentColor(accentFor('primary'));
    guide.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${E('partner_guide')} CENAR PARTNER | MEDIA CENTER`,
      `> ${E('cenar_announce')} A verified publishing area for approved community partners.`,
      '',
      `### ${E('cenar_partner')} PUBLISHING FLOW`,
      `${E('partner_guide')} Use \`/partner-post send\` inside this server.`,
      `${E('icon_link')} Select \`Partner Role\` to notify ${roleLabel}.`,
      `${E('cenar_announce')} Select \`Everyone\` only for a major and relevant announcement.`,
      `${E('cenar_verified')} Include the server name, a concise offer and a valid invite link.`,
      `-# ${E('cenar_support')} The bot validates permissions, deducts quota and records an audit log.`,
    ].join('\n')));
    const rules = new ContainerBuilder().setAccentColor(accentFor('warning'));
    rules.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${E('partner_rules')} RULES & ROLLING 24-HOUR QUOTA`,
      `${E('cenar_partner')} **Partner Role:** \`2 mentions / member / 24 hours\``,
      `${E('cenar_announce')} **Everyone:** \`1 mention / member / 24 hours\``,
      `${E('cenar_cooldown')} The rolling window begins with the first mention.`,
      '',
      `${E('status_check')} Keep claims accurate and invite links active.`,
      `${E('status_warn')} Do not repeat posts, bypass limits or directly mention roles outside the command.`,
      `${E('status_cross')} Scams, prohibited goods, NSFW content and Discord policy violations are forbidden.`,
      `-# ${E('partner_guide')} Check remaining quota at any time with \`/partner-post quota\`.`,
    ].join('\n')));
    return { components: [guide, rules], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  }

  const guide = new ContainerBuilder().setAccentColor(accentFor('primary'));
  guide.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('partner_guide')} CENAR PARTNER | TRUNG TÂM TRUYỀN THÔNG`,
    `> ${E('cenar_announce')} Khu vực đăng bài dành riêng cho đại diện đối tác đã được xác minh.`,
  ].join('\n')));
  guide.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  guide.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_partner')} CÁCH ĐĂNG BÀI`,
    `${E('partner_guide')} Dùng lệnh \`/partner-post send\` ngay trong server.`,
    `${E('icon_link')} Chọn \`ping: Role Partner\` để thông báo ${roleLabel}.`,
    `${E('cenar_announce')} Chọn \`ping: Everyone\` khi đây là thông báo quan trọng cho toàn server.`,
    `${E('cenar_verified')} Điền \`noi_dung\` rõ ràng: tên server, nội dung chính, ưu đãi và link mời còn hạn.`,
    `-# ${E('cenar_support')} Bot sẽ đăng hộ, kiểm tra quyền, trừ hạn mức và ghi log tự động.`,
  ].join('\n')));

  const rules = new ContainerBuilder().setAccentColor(accentFor('warning'));
  rules.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('partner_rules')} QUY ĐỊNH & HẠN MỨC 24 GIỜ`,
    `${E('cenar_partner')} **Role Partner** · \`2 lượt / người / 24 giờ\``,
    `${E('cenar_announce')} **Everyone** · \`1 lượt / người / 24 giờ\``,
    `${E('cenar_cooldown')} Cửa sổ giới hạn tính liên tục 24 giờ từ lần sử dụng đầu tiên.`,
  ].join('\n')));
  rules.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  rules.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_verified')} CHECKLIST TRƯỚC KHI GỬI`,
    `${E('status_check')} Nội dung ngắn gọn, đúng sự thật và link Discord còn hoạt động.`,
    `${E('status_warn')} Không spam, lặp bài, lách hạn mức hoặc tag trực tiếp bên ngoài lệnh.`,
    `${E('status_cross')} Cấm nội dung lừa đảo, NSFW, hàng cấm hoặc vi phạm chính sách Discord.`,
    `${E('cenar_support')} Staff có quyền gỡ bài và tạm khóa quyền truyền thông khi phát hiện vi phạm.`,
    `-# ${E('partner_guide')} Kiểm tra lượt còn lại bất kỳ lúc nào bằng \`/partner-post quota\`.`,
  ].join('\n')));

  return {
    components: [guide, rules],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function publishPartnerBroadcastGuide(channel, guildId, settings = {}) {
  if (!channel?.isTextBased()) return null;
  const payload = buildPartnerBroadcastGuidePayload(guildId, {
    partnerRoleId: settings.partner_role_id,
  });
  const marker = isInternationalGuild(guildId)
    ? 'CENAR PARTNER | MEDIA CENTER'
    : 'CENAR PARTNER | TRUNG TÂM TRUYỀN THÔNG';
  const latest = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = latest
    ? [...latest.values()].filter((message) => (
        message.author.id === channel.client.user.id
        && JSON.stringify(message.components.map((component) => component.toJSON())).includes(marker)
      ))
    : [];
  const primary = existing[0];
  const message = primary?.flags?.has(MessageFlags.IsComponentsV2)
    ? await primary.edit(payload)
    : await channel.send(payload);
  await Promise.all(existing.slice(1).map((duplicate) => (
    duplicate.delete('Remove duplicate Partner broadcast guide').catch(() => null)
  )));
  return message;
}

export async function autoSetupPartnerAndCtv(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.roles.fetch().catch(() => null);
      const names = isInternationalGuild(guild.id) ? internationalNames : fruitNames;
      const settings = db.prepare('SELECT support_role_id, manager_role_id FROM guild_settings WHERE guild_id = ?').get(guild.id) || {};
      const staffRoles = [...new Set([
        settings.support_role_id,
        settings.manager_role_id,
        '1282638119497109524',
      ].filter((id) => id && guild.roles.cache.has(id)))];
      const enhancedRoleColors = guild.features.includes('ENHANCED_ROLE_COLORS');
      const partnerRole = await ensureRole(guild, client, IDS.partnerRole, {
        name: 'Cenar Partner', colors: roleColorsFor(IDS.partnerRole, { enhanced: enhancedRoleColors }), iconUrl: ROLE_ICON_URLS.partner, mentionable: false,
        legacyIds: ['1367138153735131176'],
      });
      const ctvRole = await ensureRole(guild, client, IDS.ctvRole, {
        name: isInternationalGuild(guild.id) ? 'Cenar Affiliate' : 'Cenar CTV', colors: roleColorsFor(IDS.ctvRole, { enhanced: enhancedRoleColors }), iconUrl: ROLE_ICON_URLS.ctv, mentionable: false,
        legacyIds: ['1514858684151369832'],
      });

      const partnerCategory = await ensureCategory(guild, IDS.partnerCategory, names.partnerCategory);
      const ctvSettings = getCtvSettings(guild.id);
      const ctvCategory = await ensureCategory(guild, ctvSettings.category_id, names.ctvCategory);
      const botId = client.user.id;

      const partnerRecruit = await ensureChannel(guild, { id: IDS.partnerRecruit, name: names.partnerRecruit, parent: partnerCategory, overwrites: publicReadOverrides(guild, botId, staffRoles) });
      const partnerDirectory = await ensureChannel(guild, { id: IDS.partnerDirectory, name: names.partnerDirectory, parent: partnerCategory, overwrites: publicReadOverrides(guild, botId, staffRoles) });
      const partnerReview = await ensureChannel(guild, { id: IDS.partnerReview, name: names.partnerReview, parent: partnerCategory, overwrites: staffOverrides(guild, botId, staffRoles) });
      const partnerBroadcast = await ensureChannel(guild, { id: IDS.partnerBroadcast, name: names.partnerBroadcast, parent: partnerCategory, overwrites: restrictedOverrides(guild, botId, partnerRole.id, staffRoles, { allowMention: false }) });

      const ctvRecruit = await ensureChannel(guild, { id: IDS.ctvRecruit, name: names.ctvRecruit, parent: ctvCategory, overwrites: publicReadOverrides(guild, botId, staffRoles) });
      const ctvReview = await ensureChannel(guild, { name: names.ctvReview, parent: ctvCategory, overwrites: staffOverrides(guild, botId, staffRoles) });
      const ctvChat = await ensureChannel(guild, { name: names.ctvChat, parent: ctvCategory, overwrites: restrictedOverrides(guild, botId, ctvRole.id, staffRoles) });
      const ctvOrderLog = await ensureChannel(guild, { name: names.ctvOrderLog, parent: ctvCategory, overwrites: restrictedOverrides(guild, botId, ctvRole.id, staffRoles) });
      const ctvPrice = await ensureChannel(guild, { name: names.ctvPrice, parent: ctvCategory, overwrites: restrictedOverrides(guild, botId, ctvRole.id, staffRoles) });

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
      await publishPartnerBroadcastGuide(partnerBroadcast, guild.id, { partner_role_id: partnerRole.id });
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
