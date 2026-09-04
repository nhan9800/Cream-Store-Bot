import { createEmojiResolver } from '../utils/emojiHelper.js';
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getPublicUrl } from '../config.js';
import {
  getAllActiveSubscriptions,
  getSubscriptionById,
  getSubscriptionsDueInDays,
  findSubscriptions,
  getSubscriptionHistory,
  getSubscriptionProgress,
  isSubscriptionRenewalDue,
  markDisconnected,
  markRenewed,
  deleteSubscription,
  setSubscriptionFulfilledMonths,
} from '../services/subscriptionService.js';
import { config } from '../config.js';

// ═══════════════ Emoji & Color Map ═══════════════

const SERVICE_LABEL = { nitro: 'Discord Nitro', spotify_family: 'Spotify Family', youtube: 'YouTube Premium', netflix: 'Netflix' };
const SERVICE_COLOR = { nitro: 0x5865F2, spotify_family: 0x1DB954, youtube: 0xFF0000, netflix: 0xE50914 };
const SERVICE_SLOT = { nitro: 'brand_nitro', spotify_family: 'brand_spotify', youtube: 'brand_youtube', netflix: 'brand_netflix' };

function serviceEmoji(E, type) {
  return E(SERVICE_SLOT[type]) || E('order_product');
}

export const data = new SlashCommandBuilder()
  .setName('subscription')
  .setDescription('Quản lý gia hạn Nitro / Spotify / YouTube / Netflix')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(s => s.setName('add-nitro').setDescription('Thêm Gmail Nitro cần theo dõi gia hạn'))
  .addSubcommand(s => s.setName('add-spotify').setDescription('Thêm Spotify Family cần theo dõi gia hạn'))
  .addSubcommand(s => s.setName('add-youtube').setDescription('Thêm YouTube Premium cần theo dõi gia hạn'))
  .addSubcommand(s => s.setName('add-netflix').setDescription('Thêm Netflix cần theo dõi gia hạn'))
  .addSubcommand(s =>
    s.setName('list').setDescription('Xem danh sách subscriptions')
      .addStringOption(o => o.setName('loai').setDescription('Lọc theo loại').setRequired(false)
        .addChoices({ name: 'Nitro', value: 'nitro' }, { name: 'Spotify Family', value: 'spotify_family' }, { name: 'YouTube', value: 'youtube' }, { name: 'Netflix', value: 'netflix' }))
  )
  .addSubcommand(s =>
    s.setName('check').setDescription('Xem cần gia hạn trong N ngày tới')
      .addIntegerOption(o => o.setName('so_ngay').setDescription('Số ngày (mặc định 7)').setRequired(false).setMinValue(1).setMaxValue(60))
  )
  .addSubcommand(s =>
    s.setName('renew').setDescription('Đánh dấu đã gia hạn')
      .addIntegerOption(o => o.setName('id').setDescription('ID subscription').setRequired(true))
  )
  .addSubcommand(s =>
    s.setName('find').setDescription('Tìm theo Gmail, mã đơn hoặc khách hàng')
      .addStringOption(o => o.setName('tu_khoa').setDescription('Gmail, mã đơn hoặc Discord ID').setRequired(true))
  )
  .addSubcommand(s =>
    s.setName('progress').setDescription('Xác nhận số tháng thực tế đã cấp')
      .addIntegerOption(o => o.setName('id').setDescription('ID subscription').setRequired(true))
      .addIntegerOption(o => o.setName('da_cap_thang').setDescription('Số tháng đã cấp, tính cả tháng đầu').setRequired(true).setMinValue(1).setMaxValue(120))
      .addStringOption(o => o.setName('ghi_chu').setDescription('Lý do điều chỉnh').setRequired(false).setMaxLength(300))
  )
  .addSubcommand(s =>
    s.setName('history').setDescription('Xem lịch sử gia hạn của một hồ sơ')
      .addIntegerOption(o => o.setName('id').setDescription('ID subscription').setRequired(true))
  )
  .addSubcommand(s =>
    s.setName('disconnect').setDescription('Xác nhận đã ngắt gói khi đủ thời hạn')
      .addIntegerOption(o => o.setName('id').setDescription('ID subscription').setRequired(true))
      .addStringOption(o => o.setName('ghi_chu').setDescription('Ghi chú ngắt gói').setRequired(false).setMaxLength(300))
  )
  .addSubcommand(s =>
    s.setName('remove').setDescription('Xóa subscription')
      .addIntegerOption(o => o.setName('id').setDescription('ID subscription').setRequired(true))
  )
  .addSubcommand(s => s.setName('overview').setDescription('Tổng quan subscriptions + link web dashboard'));

// ═══════════════ Modal builders ═══════════════

function buildNitroModal() {
  const modal = new ModalBuilder().setCustomId('sub:add:nitro:modal').setTitle('Thêm Gmail Nitro');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gmail').setLabel('Gmail').setPlaceholder('example@gmail.com').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Mật khẩu Gmail').setPlaceholder('abc123').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('customer').setLabel('Mã đơn (CR_...) hoặc Discord Khách').setPlaceholder('CR_123456 hoặc 123456789').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Tổng thời hạn khách đã mua (tháng)').setPlaceholder('12').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('purchase_date').setLabel('Ngày mua (DD/MM/YYYY, bỏ trống = nay)').setPlaceholder('06/05/2026').setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return modal;
}

function buildSpotifyModal() {
  const modal = new ModalBuilder().setCustomId('sub:add:spotify:modal').setTitle('Thêm Spotify Family');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gmail').setLabel('Gmail Family Owner').setPlaceholder('family@gmail.com').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Mật khẩu').setPlaceholder('abc123').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('family_name').setLabel('Tên Family (VD: Family 1)').setPlaceholder('Family 1').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('slots').setLabel('Số slot đang dùng (1-5)').setPlaceholder('5').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('customer').setLabel('Mã đơn (CR_...) hoặc Discord Khách').setPlaceholder('CR_123456 hoặc 123456789').setStyle(TextInputStyle.Short).setRequired(false)),
  );
  return modal;
}

function buildYoutubeModal() {
  const modal = new ModalBuilder().setCustomId('sub:add:youtube:modal').setTitle('Thêm YouTube Premium');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gmail').setLabel('Gmail').setPlaceholder('example@gmail.com').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Mật khẩu Gmail').setPlaceholder('abc123').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('customer').setLabel('Mã đơn (CR_...) hoặc Discord Khách').setPlaceholder('CR_123456 hoặc 123456789').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Chu kỳ cấp (nhập: thang)').setPlaceholder('thang').setStyle(TextInputStyle.Short).setRequired(true).setValue('thang')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Thời hạn tổng (tháng)').setPlaceholder('12').setStyle(TextInputStyle.Short).setRequired(true)),
  );
  return modal;
}

function buildNetflixModal() {
  const modal = new ModalBuilder().setCustomId('sub:add:netflix:modal').setTitle('Thêm Netflix');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gmail').setLabel('Email Netflix').setPlaceholder('example@gmail.com').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Mật khẩu').setPlaceholder('abc123').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('customer').setLabel('Mã đơn (CR_...) hoặc Discord Khách').setPlaceholder('CR_123456 hoặc 123456789').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('profile').setLabel('Tên Profile (VD: Profile 2)').setPlaceholder('Profile 2').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Tổng thời hạn khách đã mua (tháng)').setPlaceholder('12').setStyle(TextInputStyle.Short).setRequired(true)),
  );
  return modal;
}

// ═══════════════ Embed builders ═══════════════

function buildListEmbed(subs, filterType, guildId = null) {
  const E = createEmojiResolver(guildId);

  const title = filterType ? `${serviceEmoji(E, filterType)} ${SERVICE_LABEL[filterType]}` : `${E('icon_history')} Tất Cả Subscriptions`;
  const color = filterType ? SERVICE_COLOR[filterType] : config.accentColorInfo;

  if (!subs.length) {
    return new EmbedBuilder().setTitle(title).setColor(color).setDescription('_Chưa có subscription nào._').setTimestamp();
  }

  const grouped = {};
  for (const s of subs) {
    const key = s.service_type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
  let desc = '';

  for (const [type, items] of Object.entries(grouped)) {
    desc += `\n### ${serviceEmoji(E, type)} ${SERVICE_LABEL[type]} (${items.length})\n`;
    for (const s of items.slice(0, 15)) {
      const progress = getSubscriptionProgress(s);
      const actionAt = progress.nextActionAt ? Math.floor(new Date(progress.nextActionAt).getTime() / 1000) : null;
      const renewInfo = `${E('icon_history')} Đã cấp **${progress.fulfilledMonths}/${progress.totalMonths} tháng** · kỳ **${progress.completedCycles}/${progress.totalCycles}** · ${progress.nextAction === 'DISCONNECT' ? 'Ngắt gói' : `kỳ kế ${progress.nextCycleNumber}/${progress.totalCycles} (tháng ${progress.nextCycleStartMonth}-${progress.nextCycleEndMonth})`}${actionAt ? ` <t:${actionAt}:R>` : ''}`;
      const customer = s.customer_id ? `<@${s.customer_id}>` : (s.customer_discord_name || '_Chưa gán_');
      const noteExtra = (s.service_type === 'netflix' && s.note) ? ` ${E('brand_netflix')} ${s.note}` : '';
      const extra = s.spotify_family_name ? ` ${E('icon_home')} ${s.spotify_family_name} (${s.spotify_slots_used}/5)` : noteExtra;
      desc += `> **ID ${s.id}** · \`${s.gmail_email}\` · ${customer}${extra}\n> ${renewInfo} · Hết hạn: <t:${Math.floor(new Date(s.expiry_at).getTime() / 1000)}:D>\n`;
    }
    if (items.length > 15) desc += `> _...và ${items.length - 15} mục khác_\n`;
  }

  embed.setDescription(desc.slice(0, 4000));
  embed.setFooter({ text: `Tổng: ${subs.length} hồ sơ · dùng /subscription find để tìm Gmail` });
  return embed;
}

function buildCheckEmbed(subs, days, guildId = null) {
  const E = createEmojiResolver(guildId);

  const embed = new EmbedBuilder()
    .setTitle(`${E('icon_clock')} Cần Gia Hạn Trong ${days} Ngày Tới`)
    .setColor(0xE74C3C)
    .setTimestamp();

  if (!subs.length) {
    embed.setDescription(`${E('order_complete')} Không có subscription nào cần gia hạn trong khoảng thời gian này.`);
    return embed;
  }

  let desc = `Tìm thấy **${subs.length}** subscription cần xử lý:\n\n`;
  for (const s of subs.slice(0, 20)) {
    const emoji = serviceEmoji(E, s.service_type);
    const progress = getSubscriptionProgress(s);
    const dateField = progress.nextActionAt;
    const ts = Math.floor(new Date(dateField).getTime() / 1000);
    const customer = s.customer_id ? `<@${s.customer_id}>` : (s.customer_discord_name || '—');
    const extra = s.spotify_family_name ? ` · ${E('icon_home')} ${s.spotify_family_name}` : '';
    desc += `${emoji} **ID ${s.id}** · \`${s.gmail_email}\` · ${customer}${extra}\n> Đã cấp **${progress.fulfilledMonths}/${progress.totalMonths} tháng** · kỳ **${progress.completedCycles}/${progress.totalCycles}** · ${progress.nextAction === 'DISCONNECT' ? 'Ngắt gói' : `kỳ kế ${progress.nextCycleNumber}/${progress.totalCycles}`} · <t:${ts}:R>\n\n`;
  }

  embed.setDescription(desc.slice(0, 4000));
  if (subs.length > 20) embed.setFooter({ text: `Và ${subs.length - 20} mục khác chưa hiển thị...` });
  return embed;
}

function buildSearchEmbed(subs, keyword, guildId) {
  const E = createEmojiResolver(guildId);
  const embed = new EmbedBuilder()
    .setTitle(`${E('icon_search')} Kết Quả Tìm Hồ Sơ`)
    .setColor(config.accentColorInfo)
    .setTimestamp();
  if (!subs.length) return embed.setDescription(`Không tìm thấy hồ sơ phù hợp với \`${keyword}\`.`);
  const lines = [`Tìm thấy **${subs.length}** hồ sơ cho \`${keyword}\`:`, ''];
  for (const item of subs) {
    const progress = getSubscriptionProgress(item);
    const customer = item.customer_id ? `<@${item.customer_id}>` : (item.customer_discord_name || 'Chưa gán khách');
    const due = progress.nextActionAt ? `<t:${Math.floor(new Date(progress.nextActionAt).getTime() / 1000)}:R>` : '—';
    lines.push(
      `${serviceEmoji(E, item.service_type)} **ID ${item.id}** · \`${item.gmail_email}\``,
      `> ${customer} · đơn \`${item.related_order_code || 'không có'}\``,
      `> **${progress.fulfilledMonths}/${progress.totalMonths} tháng** · kỳ **${progress.completedCycles}/${progress.totalCycles}** · ${progress.needsReview ? '⚠️ cần xác minh' : progress.nextAction === 'DISCONNECT' ? 'ngắt gói' : `kỳ kế ${progress.nextCycleNumber}/${progress.totalCycles}`} · ${due}`,
    );
  }
  return embed.setDescription(lines.join('\n').slice(0, 4000));
}

function buildHistoryEmbed(sub, events, guildId) {
  const E = createEmojiResolver(guildId);
  const progress = getSubscriptionProgress(sub);
  const labels = {
    ACTIVATED: 'Khởi tạo từ giao hàng',
    CREATED: 'Tạo hồ sơ',
    DELIVERY_UPDATED: 'Đồng bộ giao hàng',
    RENEWED: 'Đã cấp thêm kỳ',
    PACKAGE_EXTENDED: 'Gia hạn gói mới',
    PROGRESS_ADJUSTED: 'Điều chỉnh tiến độ',
    DISCONNECTED: 'Đã ngắt gói',
    MIGRATED: 'Nhập dữ liệu cũ',
  };
  const lines = [
    `**Gmail:** \`${sub.gmail_email}\``,
    `**Tiến độ hiện tại:** ${progress.fulfilledMonths}/${progress.totalMonths} tháng · **${sub.status}**`,
    '',
  ];
  for (const event of events) {
    const ts = Math.floor(new Date(event.created_at).getTime() / 1000);
    lines.push(`${E(event.event_type === 'DISCONNECTED' ? 'status_cross' : 'icon_history')} **${labels[event.event_type] || event.event_type}** · ${event.fulfilled_months}/${event.total_months} tháng · <t:${ts}:f>${event.actor_id ? ` · <@${event.actor_id}>` : ''}${event.note ? `\n> ${event.note}` : ''}`);
  }
  if (!events.length) lines.push('_Chưa có lịch sử thao tác._');
  return new EmbedBuilder()
    .setTitle(`${E('icon_history')} Lịch Sử Hồ Sơ #${sub.id}`)
    .setColor(config.accentColorInfo)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setTimestamp();
}

// ═══════════════ Execute ═══════════════

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const sub = interaction.options.getSubcommand();

  if (sub === 'add-nitro') return interaction.showModal(buildNitroModal());
  if (sub === 'add-spotify') return interaction.showModal(buildSpotifyModal());
  if (sub === 'add-youtube') return interaction.showModal(buildYoutubeModal());
  if (sub === 'add-netflix') return interaction.showModal(buildNetflixModal());

  await interaction.deferReply({ ephemeral: true });

  try {
    if (sub === 'list') {
      const filterType = interaction.options.getString('loai');
      const subs = getAllActiveSubscriptions(interaction.guildId, filterType);
      return interaction.editReply({ embeds: [buildListEmbed(subs, filterType, interaction.guildId)] });
    }

    if (sub === 'check') {
      const days = interaction.options.getInteger('so_ngay') || 7;
      const subs = getSubscriptionsDueInDays(interaction.guildId, days);
      return interaction.editReply({ embeds: [buildCheckEmbed(subs, days, interaction.guildId)] });
    }

    if (sub === 'find') {
      const keyword = interaction.options.getString('tu_khoa', true);
      const matches = findSubscriptions(interaction.guildId, keyword, 20);
      return interaction.editReply({ embeds: [buildSearchEmbed(matches, keyword, interaction.guildId)] });
    }

    if (sub === 'history') {
      const id = interaction.options.getInteger('id', true);
      const existing = getSubscriptionById(id);
      if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guild_id)) {
        return interaction.editReply(`${E('status_cross')} Không tìm thấy subscription với ID này.`);
      }
      return interaction.editReply({ embeds: [buildHistoryEmbed(existing, getSubscriptionHistory(id), interaction.guildId)] });
    }

    if (sub === 'progress') {
      const id = interaction.options.getInteger('id', true);
      const fulfilled = interaction.options.getInteger('da_cap_thang', true);
      const note = interaction.options.getString('ghi_chu');
      const existing = getSubscriptionById(id);
      if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guild_id)) {
        return interaction.editReply(`${E('status_cross')} Không tìm thấy subscription với ID này.`);
      }
      const updated = setSubscriptionFulfilledMonths(id, fulfilled, {
        actorId: interaction.user.id,
        source: 'DISCORD_COMMAND',
        note,
      });
      const progress = getSubscriptionProgress(updated);
      const nextTs = progress.nextActionAt ? `<t:${Math.floor(new Date(progress.nextActionAt).getTime() / 1000)}:F>` : '—';
      return interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle(`${E('status_check')} Đã Xác Nhận Tiến Độ`)
        .setColor(0x57F287)
        .setDescription([
          `**ID:** ${updated.id} · \`${updated.gmail_email}\``,
          `**Đã cấp:** ${progress.fulfilledMonths}/${progress.totalMonths} tháng`,
          `**Việc tiếp theo:** ${progress.nextAction === 'DISCONNECT' ? 'Ngắt gói khi hết hạn' : `Cấp kỳ ${progress.nextCycleNumber}/${progress.totalCycles} · tháng ${progress.nextCycleStartMonth}-${progress.nextCycleEndMonth}/${progress.totalMonths}`}`,
          `**Thời điểm:** ${nextTs}`,
        ].join('\n'))
        .setTimestamp()] });
    }

    if (sub === 'disconnect') {
      const id = interaction.options.getInteger('id', true);
      const note = interaction.options.getString('ghi_chu');
      const existing = getSubscriptionById(id);
      if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guild_id)) {
        return interaction.editReply(`${E('status_cross')} Không tìm thấy subscription với ID này.`);
      }
      const progress = getSubscriptionProgress(existing);
      if (progress.nextAction !== 'DISCONNECT') {
        return interaction.editReply(`${E('status_warn')} Hồ sơ mới cấp ${progress.fulfilledMonths}/${progress.totalMonths} tháng, chưa thể xác nhận ngắt gói.`);
      }
      markDisconnected(id, { actorId: interaction.user.id, source: 'DISCORD_COMMAND', note });
      return interaction.editReply(`${E('status_check')} Đã xác nhận ngắt gói **ID ${id}** — \`${existing.gmail_email}\`. Lịch sử đã được lưu.`);
    }

    if (sub === 'renew') {
      const id = interaction.options.getInteger('id', true);
      const existing = getSubscriptionById(id);
      if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guild_id)) {
        return interaction.editReply(`${E('status_cross')} Không tìm thấy subscription với ID này.`);
      }
      const before = getSubscriptionProgress(existing);
      if (before.nextAction === 'DISCONNECT') {
        return interaction.editReply(`${E('status_warn')} Gói đã cấp đủ ${before.fulfilledMonths}/${before.totalMonths} tháng. Hãy dùng \`/subscription disconnect\` khi đã ngắt gói.`);
      }
      if (!isSubscriptionRenewalDue(existing, config.subscriptionAdminReminderDays)) {
        return interaction.editReply(`${E('status_warn')} Kỳ tiếp theo chưa đến hạn. Hệ thống đã chặn thao tác cộng tháng sớm hoặc bấm lặp.`);
      }
      let updated;
      try {
        updated = markRenewed(id, {
          actorId: interaction.user.id,
          source: 'DISCORD_COMMAND',
          expectedTimesRenewed: Number(existing.times_renewed || 0),
        });
      } catch (error) {
        if (error?.code !== 'SUBSCRIPTION_RENEWAL_CONFLICT') throw error;
        return interaction.editReply(`${E('status_info')} Kỳ này vừa được xử lý. Hệ thống đã chặn cộng trùng; hãy tải lại dữ liệu.`);
      }
      if (!updated) return interaction.editReply(`${E('status_cross')} Lỗi khi gia hạn.`);

      const emoji = serviceEmoji(E, updated.service_type);
      const progress = getSubscriptionProgress(updated);
      const nextTs = progress.nextActionAt ? `<t:${Math.floor(new Date(progress.nextActionAt).getTime() / 1000)}:F>` : '—';
      const embed = new EmbedBuilder()
        .setTitle(`${emoji} Đã Gia Hạn Thành Công`)
        .setColor(0x57F287)
        .setDescription([
          `**ID:** ${updated.id}`,
          `**Gmail:** \`${updated.gmail_email}\``,
          `**Đã cấp:** ${progress.fulfilledMonths}/${progress.totalMonths} tháng`,
          `**Việc tiếp theo:** ${progress.nextAction === 'DISCONNECT' ? 'Ngắt gói khi hết hạn' : `Cấp kỳ ${progress.nextCycleNumber}/${progress.totalCycles} · tháng ${progress.nextCycleStartMonth}-${progress.nextCycleEndMonth}/${progress.totalMonths}`}`,
          `**Thời điểm:** ${nextTs}`,
          `**Trạng thái:** ${updated.status}`,
        ].join('\n'))
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const existing = getSubscriptionById(id);
      if (!existing || existing.guild_id !== interaction.guildId) {
        return interaction.editReply(`${E('status_cross')} Không tìm thấy subscription với ID này.`);
      }
      deleteSubscription(id);
      return interaction.editReply(`${E('icon_trash')} Đã xóa subscription **ID ${id}** — \`${existing.gmail_email}\` (${SERVICE_LABEL[existing.service_type]})`);
    }

    if (sub === 'overview') {
      const allSubs = getAllActiveSubscriptions(interaction.guildId);
      const counts = {};
      for (const s of allSubs) {
        counts[s.service_type] = (counts[s.service_type] || 0) + 1;
      }
      const dueIn7 = getSubscriptionsDueInDays(interaction.guildId, 7);

      let statsText = '';
      for (const [type, count] of Object.entries(counts)) {
        statsText += `${serviceEmoji(E, type)} **${SERVICE_LABEL[type] || type}:** ${count} tài khoản\n`;
      }
      if (!statsText) statsText = '_Chưa có subscription nào._\n';

      const webUrl = getPublicUrl('/web');
      const subApiUrl = getPublicUrl('/dashboard/api/subscriptions');

      const embed = new EmbedBuilder()
        .setTitle(`${E('icon_chart')} Tổng Quan Subscriptions`)
        .setColor(config.accentColorInfo)
        .setDescription([
          `### ${E('icon_chart')} Thống Kê`,
          statsText,
          `**Tổng:** ${allSubs.length} tài khoản active`,
          `**Cần gia hạn trong 7 ngày:** ${dueIn7.length}`,
          '',
          `### ${E('icon_web')} Web Dashboard`,
          webUrl ? `Xem tổng quan tài khoản tại:` : `${E('status_warn')} Chưa cấu hình PUBLIC_BASE_URL`,
        ].join('\n'))
        .setTimestamp()
        .setFooter({ text: 'Cream Store Subscription Manager' });

      const components = [];
      if (webUrl) {
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Mở Web Dashboard').setStyle(ButtonStyle.Link).setURL(webUrl),
          new ButtonBuilder().setLabel('API Subscriptions').setStyle(ButtonStyle.Link).setURL(subApiUrl),
        ));
      }

      return interaction.editReply({ embeds: [embed], components });
    }
  } catch (error) {
    console.error('[SUBSCRIPTION] Error:', error);
    return interaction.editReply(`${E('status_cross')} Lỗi: ${error.message}`);
  }
}

// Re-export modal builders for use in interactionCreate
export { buildNitroModal, buildSpotifyModal, buildYoutubeModal, buildNetflixModal };
export { SERVICE_LABEL, SERVICE_COLOR };
