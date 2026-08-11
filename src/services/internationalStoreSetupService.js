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
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { buildTicketPanelV2 } from '../utils/embeds.js';
import { snapshotGuildForRecovery } from './guildRecoveryService.js';
import { upsertGuildConfig } from './guildConfigService.js';
import { buildVerificationPanelV2 } from './verificationPanelService.js';
import { resolveVerificationRole } from './verificationRoleService.js';

const MIGRATION_VERSION = '2026-08-global-v1';

const CATEGORY_RULES = Object.freeze([
  [/cua-hang|marketplace|store/, 'GLOBAL MARKETPLACE'],
  [/cam-nang|huong-dan|guide|resource/, 'GUIDES & RESOURCES'],
  [/phong-tro-chuyen|community|conversation/, 'GLOBAL COMMUNITY'],
  [/cenar-ctv|affiliate-program|collaborator/, 'AFFILIATE PROGRAM'],
  [/cenar-partner|partner-network/, 'PARTNER NETWORK'],
  [/trung-tam-ho-tro|customer-support|support-center/, 'CUSTOMER SUPPORT'],
  [/san-pham-premium|premium-service/, 'PREMIUM SERVICES'],
  [/khu-vuc-quan-tri|staff-operation|administration/, 'STAFF OPERATIONS'],
  [/bat-dau|start-here|welcome-and-info/, 'START HERE'],
]);

const CHANNEL_RULES = Object.freeze([
  [/^chao-mung$|^welcome$/, 'welcome'],
  [/^xac-minh$|^verify$|^verification$/, 'verify'],
  [/^thong-bao$|^announcements?$/, 'announcements'],
  [/^quy-dinh$|^noi-quy$|^rules$/, 'rules'],
  [/^cach-mua-hang$|^how-to-buy$/, 'how-to-buy'],
  [/^bang-gia$|^pricing$|^price-list$/, 'pricing'],
  [/^danh-gia$|^reviews?$/, 'reviews'],
  [/^bang-vinh-danh$|^hall-of-fame$/, 'hall-of-fame'],
  [/^log-don-hang$|^order-log$/, 'order-log'],
  [/^lich-su-mua-hang$|^purchase-history$/, 'purchase-history'],
  [/^khuyen-mai$|^promotions?$|^deals$/, 'deals'],
  [/^cay-thue-valorant$|^valorant-rank-service$/, 'valorant-rank-service'],
  [/^dev-bot$|^bot-development$/, 'bot-development'],
  [/^dev-web$|^web-development$/, 'web-development'],
  [/^thue-sim-online$|^otp-rental$/, 'otp-rental'],
  [/^nap-the-tu-dong$|^gift-card-exchange$/, 'gift-card-exchange'],
  [/^bang-chiet-khau$|^discount-rates$/, 'discount-rates'],
  [/^su-kien$|^community-events$/, 'community-events'],
  [/^lenh-bot$|^bot-commands$/, 'bot-commands'],
  [/^hinh-anh$|^media$/, 'media'],
  [/^huong-dan-nitro$|^nitro-guide$/, 'nitro-guide'],
  [/^huong-dan-youtube$|^youtube-guide$/, 'youtube-guide'],
  [/^huong-dan-spotify$|^spotify-guide$/, 'spotify-guide'],
  [/^huong-dan-netflix$|^netflix-guide$/, 'netflix-guide'],
  [/^boost-server$|^server-boost$/, 'server-boost'],
  [/^log-boost-server$|^boost-orders$/, 'boost-orders'],
  [/^thao-luan$|^global-chat$|^general-chat$/, 'global-chat'],
  [/^ho-tro$|^support$|^support-center$/, 'support-center'],
  [/^tuyen-cong-tac-vien$|^affiliate-apply$/, 'affiliate-apply'],
  [/^duyet-ctv$|^affiliate-review$/, 'affiliate-review'],
  [/^ctv-tro-chuyen$|^affiliate-lounge$/, 'affiliate-lounge'],
  [/^ctv-log-don-hang$|^affiliate-order-log$/, 'affiliate-order-log'],
  [/^ctv-bang-gia$|^affiliate-pricing$/, 'affiliate-pricing'],
  [/^hop-tac-doi-tac$|^partner-apply$/, 'partner-apply'],
  [/^danh-sach-doi-tac$|^verified-partners$/, 'verified-partners'],
  [/^duyet-partner$|^partner-review$/, 'partner-review'],
  [/^duyet-bao-hanh-youtube$|^warranty-review$/, 'warranty-review'],
  [/^partner-truyen-thong$|^partner-media$/, 'partner-media'],
]);

const ROLE_RULES = Object.freeze([
  [/^(?:cenar-)?(?:thanh-vien-moi|new-member|newcomer|global-newcomer)$/, 'Global Newcomer'],
  [/^(?:cenar-)?(?:thanh-vien|member)$/, 'Cenar Member'],
  [/^(?:cenar-)?(?:khach-hang|customer)$/, 'Cenar Customer'],
  [/^(?:cenar-)?(?:cong-tac-vien|ctv|affiliate)$/, 'Cenar Affiliate'],
  [/^(?:cenar-)?(?:doi-tac|partner)$/, 'Cenar Partner'],
  [/^(?:cenar-|global-)?(?:ho-tro|support)$/, 'Global Support'],
  [/^(?:cenar-|global-)?(?:cham-soc|care)$/, 'Global Care'],
  [/^(?:cenar-|global-)?(?:quan-tri-vien|administrator)$/, 'Global Administrator'],
]);

const PARENT_BY_CHANNEL = Object.freeze({
  welcome: 'START HERE', verify: 'START HERE', announcements: 'START HERE', rules: 'START HERE', 'how-to-buy': 'START HERE',
  pricing: 'GLOBAL MARKETPLACE', reviews: 'GLOBAL MARKETPLACE', 'hall-of-fame': 'GLOBAL MARKETPLACE', 'order-log': 'GLOBAL MARKETPLACE', 'purchase-history': 'GLOBAL MARKETPLACE', deals: 'GLOBAL MARKETPLACE',
  'nitro-guide': 'GUIDES & RESOURCES', 'youtube-guide': 'GUIDES & RESOURCES', 'spotify-guide': 'GUIDES & RESOURCES', 'netflix-guide': 'GUIDES & RESOURCES',
  'global-chat': 'GLOBAL COMMUNITY', media: 'GLOBAL COMMUNITY', 'community-events': 'GLOBAL COMMUNITY',
  'support-center': 'CUSTOMER SUPPORT', 'warranty-review': 'CUSTOMER SUPPORT',
  'affiliate-apply': 'AFFILIATE PROGRAM', 'affiliate-review': 'AFFILIATE PROGRAM', 'affiliate-lounge': 'AFFILIATE PROGRAM', 'affiliate-order-log': 'AFFILIATE PROGRAM', 'affiliate-pricing': 'AFFILIATE PROGRAM',
  'partner-apply': 'PARTNER NETWORK', 'verified-partners': 'PARTNER NETWORK', 'partner-review': 'PARTNER NETWORK', 'partner-media': 'PARTNER NETWORK',
  'valorant-rank-service': 'PREMIUM SERVICES', 'otp-rental': 'PREMIUM SERVICES', 'gift-card-exchange': 'PREMIUM SERVICES', 'discount-rates': 'PREMIUM SERVICES', 'server-boost': 'PREMIUM SERVICES', 'boost-orders': 'PREMIUM SERVICES',
  'bot-development': 'STAFF OPERATIONS', 'web-development': 'STAFF OPERATIONS', 'bot-commands': 'STAFF OPERATIONS',
});

function semanticName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveRule(name, rules) {
  const normalized = semanticName(name);
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] || null;
}

function channelAccessOverwrites(guild, botId, { verifiedRole = null, publicAccess = true, allowSend = false } = {}) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      allow: publicAccess ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] : [],
      deny: [
        PermissionFlagsBits.SendMessages,
        ...(!publicAccess ? [PermissionFlagsBits.ViewChannel] : []),
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
  if (verifiedRole) {
    overwrites.push({
      id: verifiedRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        ...(allowSend ? [PermissionFlagsBits.SendMessages] : []),
      ],
      deny: allowSend ? [] : [PermissionFlagsBits.SendMessages],
    });
  }
  return overwrites;
}

async function ensureCategory(guild, name) {
  let category = guild.channels.cache.find((item) => item.type === ChannelType.GuildCategory && item.name === name);
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: 'Cenar Global international storefront structure',
    });
  }
  return category;
}

async function ensurePublicChannel(guild, name, parent, access = {}) {
  const permissionOverwrites = channelAccessOverwrites(guild, guild.client.user.id, access);
  let channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name === name);
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent.id,
      permissionOverwrites,
      reason: 'Cenar Global international storefront structure',
    });
  } else if (channel.parentId !== parent.id) {
    await channel.setParent(parent.id, { lockPermissions: false, reason: 'Cenar Global channel organization' });
  }
  for (const overwrite of permissionOverwrites) {
    await channel.permissionOverwrites.edit(overwrite.id, {
      ViewChannel: overwrite.allow.includes(PermissionFlagsBits.ViewChannel)
        ? true
        : (overwrite.deny.includes(PermissionFlagsBits.ViewChannel) ? false : null),
      ReadMessageHistory: overwrite.allow.includes(PermissionFlagsBits.ReadMessageHistory) ? true : null,
      SendMessages: overwrite.allow.includes(PermissionFlagsBits.SendMessages)
        ? true
        : (overwrite.deny.includes(PermissionFlagsBits.SendMessages) ? false : null),
      EmbedLinks: overwrite.allow.includes(PermissionFlagsBits.EmbedLinks) ? true : null,
      AttachFiles: overwrite.allow.includes(PermissionFlagsBits.AttachFiles) ? true : null,
      ManageMessages: overwrite.allow.includes(PermissionFlagsBits.ManageMessages) ? true : null,
    }, { reason: 'Cenar Global access policy' }).catch(() => null);
  }
  return channel;
}

function linkButton({ label, guildId, channel, emoji }) {
  if (!channel) return null;
  const button = new ButtonBuilder()
    .setLabel(label)
    .setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${guildId}/${channel.id}`);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function buildGlobalWelcomePayload(guild, channels) {
  const E = createEmojiResolver(guild.id);
  const container = new ContainerBuilder().setAccentColor(0x7C5CFC);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_store')} CENAR GLOBAL • INTERNATIONAL STORE`,
    `> ${E('cenar_verified')} Premium digital services, secure checkout and human support for customers worldwide.`,
    '',
    `### ${E('icon_sparkle')} WHAT YOU CAN FIND HERE`,
    `${E('order_product')} Discord, AI, streaming, gaming and account services in one catalog.`,
    `${E('payment_money')} Transparent pricing with bank checkout and Binance Pay support.`,
    `${E('cenar_support')} Guided ordering, delivery tracking and warranty assistance.`,
    '',
    `### ${E('verify_shield')} START SAFELY`,
    `Verify your account, review the store rules, then choose a product from the live pricing board.`,
    `-# ${E('icon_heart_purple')} Cenar Global • Reliable digital services since 2022`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const buttons = [
    linkButton({ label: 'View Pricing', guildId: guild.id, channel: channels.pricing, emoji: E.component('payment_money') }),
    linkButton({ label: 'How to Buy', guildId: guild.id, channel: channels['how-to-buy'], emoji: E.component('icon_cart') }),
    linkButton({ label: 'Get Support', guildId: guild.id, channel: channels['support-center'], emoji: E.component('cenar_support') }),
  ].filter(Boolean);

  return {
    components: [container, ...(buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [])],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildRulesPayload(guildId) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0xF5B942);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('partner_rules')} CENAR GLOBAL • STORE RULES`,
    `> ${E('verify_shield')} These rules protect customers, staff and every transaction.`,
    '',
    `### ${E('status_check')} CUSTOMER STANDARD`,
    `- Use accurate information when placing an order.`,
    `- Keep payment references and order credentials private.`,
    `- Follow the product instructions to keep your warranty valid.`,
    `- Contact support through the correct ticket instead of repeatedly tagging staff.`,
    '',
    `### ${E('status_warn')} ZERO-TOLERANCE AREA`,
    `- No scams, chargeback abuse, harassment, spam, NSFW material or Discord policy violations.`,
    `- Never send payment to an address shared outside an official Cenar Global checkout panel.`,
    '',
    `${E('cenar_verified')} By ordering, you accept the product terms shown before checkout.`,
    `-# ${E('cenar_support')} Need clarification? Open a support ticket before paying.`,
  ].join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function buildHowToBuyPayload(guildId, binanceEnabled) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0x20C997);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_cart')} HOW TO BUY • GLOBAL CHECKOUT`,
    `> ${E('cenar_verified')} A clear four-step flow from product selection to warranty coverage.`,
    '',
    `### ${E('order_product')} 01 • CHOOSE A PRODUCT`,
    `Open the pricing board, review the duration, region and product terms, then create an order.`,
    `### ${E('ticket_create')} 02 • CONFIRM YOUR ORDER`,
    `Check the product, quantity, account requirements and final amount inside your private ticket.`,
    `### ${E('payment_money')} 03 • PAY SECURELY`,
    binanceEnabled
      ? `Select bank checkout or **Binance Pay**. Crypto checkout supports the currencies listed on the official Binance payment page.`
      : `Use the payment method displayed by the checkout panel. Binance Pay will appear automatically after Merchant activation.`,
    `### ${E('order_complete')} 04 • DELIVERY & WARRANTY`,
    `The bot records your payment, moves the order into processing and keeps delivery/warranty history linked to your account.`,
    '',
    `-# ${E('status_warn')} Cenar Global staff will never ask for your Discord password or Binance login credentials.`,
  ].join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function upsertPanel(channel, marker, payload) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const matches = recent
    ? [...recent.values()].filter((message) => message.author.id === channel.client.user.id
      && JSON.stringify(message.components.map((component) => component.toJSON())).includes(marker))
    : [];
  const primary = matches[0];
  const message = primary?.flags?.has(MessageFlags.IsComponentsV2)
    ? await primary.edit(payload)
    : await channel.send(payload);
  await Promise.all(matches.slice(1).map((duplicate) => duplicate.delete('Remove duplicate Cenar Global panel').catch(() => null)));
  return message;
}

async function publishCoreServicePanels(guild, channels) {
  const verificationPayload = buildVerificationPanelV2(guild.id, 'Cenar Global');
  await upsertPanel(channels.verify, 'oauth:verify:button', {
    ...verificationPayload,
    allowedMentions: { parse: [] },
  });

  const existingConfig = getGuildConfig(guild.id);
  const { container, rows, flags } = buildTicketPanelV2({
    ...(existingConfig || {}),
    guild_id: guild.id,
    panel_title: null,
    panel_description: null,
  });
  const supportMessage = await upsertPanel(channels['support-center'], 'ticket:create:ORDER', {
    components: [container, ...rows],
    flags,
    allowedMentions: { parse: [] },
  });
  upsertGuildConfig({
    guild_id: guild.id,
    ticket_panel_channel_id: channels['support-center'].id,
    ticket_panel_message_id: supportMessage.id,
  });
}

function migrationPlan(guild) {
  const categoryRenames = [];
  const channelRenames = [];
  const roleRenames = [];

  for (const category of guild.channels.cache.filter((item) => item.type === ChannelType.GuildCategory).values()) {
    const target = resolveRule(category.name, CATEGORY_RULES);
    if (target && category.name !== target) categoryRenames.push({ item: category, target });
  }
  for (const channel of guild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildForum].includes(channel.type)) continue;
    const target = resolveRule(channel.name, CHANNEL_RULES);
    if (target && channel.name !== target) channelRenames.push({ item: channel, target });
  }
  for (const role of guild.roles.cache.values()) {
    if (role.managed || role.id === guild.roles.everyone.id) continue;
    const target = resolveRule(role.name, ROLE_RULES);
    if (target && role.name !== target) roleRenames.push({ item: role, target });
  }
  return { categoryRenames, channelRenames, roleRenames };
}

export async function setupInternationalStore(guild) {
  if (!guild || guild.id !== STORE_TWO_GUILD_ID) return { skipped: true, reason: 'not-store-two' };

  await Promise.all([
    guild.channels.fetch().catch(() => null),
    guild.roles.fetch().catch(() => null),
    guild.emojis.fetch().catch(() => null),
  ]);

  const plan = migrationPlan(guild);
  const shouldRenameGuild = guild.name !== 'Cenar Global';
  const hasChanges = shouldRenameGuild || plan.categoryRenames.length || plan.channelRenames.length || plan.roleRenames.length;
  if (hasChanges) await snapshotGuildForRecovery(guild, { force: true });

  if (shouldRenameGuild) await guild.setName('Cenar Global', `Cenar Global migration ${MIGRATION_VERSION}`).catch((error) => {
    console.warn(`[GLOBAL-SETUP] Cannot rename guild: ${error.message}`);
  });

  for (const { item, target } of plan.categoryRenames) {
    await item.setName(target, `Cenar Global migration ${MIGRATION_VERSION}`).catch((error) => console.warn(`[GLOBAL-SETUP] Category ${item.id}: ${error.message}`));
  }
  for (const { item, target } of plan.channelRenames) {
    await item.setName(target, `Cenar Global migration ${MIGRATION_VERSION}`).catch((error) => console.warn(`[GLOBAL-SETUP] Channel ${item.id}: ${error.message}`));
  }
  for (const { item, target } of plan.roleRenames) {
    if (!item.editable) continue;
    await item.setName(target, `Cenar Global migration ${MIGRATION_VERSION}`).catch((error) => console.warn(`[GLOBAL-SETUP] Role ${item.id}: ${error.message}`));
  }

  const categoryNames = [...new Set(Object.values(PARENT_BY_CHANNEL))];
  const categories = Object.fromEntries(await Promise.all(categoryNames.map(async (name) => [name, await ensureCategory(guild, name)])));

  const requiredPublic = ['welcome', 'verify', 'announcements', 'rules', 'how-to-buy', 'pricing', 'support-center', 'global-chat'];
  const publicBeforeVerification = new Set(['welcome', 'verify', 'announcements', 'rules', 'how-to-buy']);
  const verifiedRole = resolveVerificationRole(guild);
  const channels = {};
  for (const name of requiredPublic) {
    const category = categories[PARENT_BY_CHANNEL[name]];
    channels[name] = await ensurePublicChannel(guild, name, category, {
      verifiedRole,
      publicAccess: publicBeforeVerification.has(name) || !verifiedRole,
      allowSend: name === 'global-chat',
    });
  }

  upsertGuildConfig({
    guild_id: guild.id,
    price_list_channel_id: channels.pricing.id,
    updated_by: guild.client.user.id,
  });

  for (const channel of guild.channels.cache.values()) {
    const parentName = PARENT_BY_CHANNEL[channel.name];
    const parent = categories[parentName];
    if (parent && channel.parentId !== parent.id && channel.type !== ChannelType.GuildCategory) {
      await channel.setParent(parent.id, { lockPermissions: false, reason: 'Cenar Global channel organization' }).catch(() => null);
    }
  }

  await upsertPanel(channels.welcome, 'CENAR GLOBAL • INTERNATIONAL STORE', buildGlobalWelcomePayload(guild, channels));
  await upsertPanel(channels.rules, 'CENAR GLOBAL • STORE RULES', buildRulesPayload(guild.id));
  const binanceEnabled = String(process.env.BINANCE_PAY_ENABLED || '').toLowerCase() === 'true';
  await upsertPanel(channels['how-to-buy'], 'HOW TO BUY • GLOBAL CHECKOUT', buildHowToBuyPayload(guild.id, binanceEnabled));
  await publishCoreServicePanels(guild, channels);

  const result = {
    skipped: false,
    version: MIGRATION_VERSION,
    guildRenamed: shouldRenameGuild,
    categoriesRenamed: plan.categoryRenames.length,
    channelsRenamed: plan.channelRenames.length,
    rolesRenamed: plan.roleRenames.length,
    publicChannelsReady: requiredPublic.length,
    servicePanelsReady: 2,
    verificationGateReady: Boolean(verifiedRole),
  };
  console.log(`[GLOBAL-SETUP] ${JSON.stringify(result)}`);
  return result;
}

export async function setupInternationalStores(client) {
  const guild = client.guilds.cache.get(STORE_TWO_GUILD_ID);
  if (!guild) return { skipped: true, reason: 'store-two-not-cached' };
  return setupInternationalStore(guild);
}

export const internationalStoreInternals = { semanticName, resolveRule, migrationPlan };
