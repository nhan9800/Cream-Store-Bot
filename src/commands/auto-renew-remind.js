import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { runDeepNotifications, runSubscriptionNotifications } from '../services/deepNotificationService.js';
import { getExpiringOrdersRaw } from '../services/v11DbHelpers.js';
import { getSubscriptionsDueInDays } from '../services/subscriptionService.js';

const SERVICE_LABEL = { nitro: 'Discord Nitro', spotify_family: 'Spotify Family', youtube: 'YouTube Premium', netflix: 'Netflix' };
const SERVICE_SLOT = { nitro: 'brand_nitro', spotify_family: 'brand_spotify', youtube: 'brand_youtube', netflix: 'brand_netflix' };

function serviceEmoji(E, type) {
  return E(SERVICE_SLOT[type]) || E('order_product');
}

function modeLabel(E, mode) {
  return ({
    auto_cycle: `${E('icon_cycle')} Định kỳ`,
    one_time: `${E('icon_once')} Mua lẻ`,
    full_paid: `${E('status_check')} Đã trả hết`,
  })[mode] || mode;
}

export const data = new SlashCommandBuilder()
  .setName('auto-renew-remind')
  .setDescription('Quản lý hệ thống nhắc gia hạn tự động')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub =>
    sub.setName('quet-ngay').setDescription('Ép quét và gửi nhắc gia hạn đơn hàng + subscription ngay lập tức')
  )
  .addSubcommand(sub =>
    sub.setName('danh-sach').setDescription('Xem Account/Khách hàng sắp hết hạn')
      .addIntegerOption(opt =>
        opt.setName('so_ngay').setDescription('Số ngày (mặc định 7)').setRequired(false).setMinValue(1).setMaxValue(30)
      )
  )
  .addSubcommand(sub =>
    sub.setName('sub-check').setDescription('Xem subscriptions cần gia hạn')
      .addIntegerOption(opt =>
        opt.setName('so_ngay').setDescription('Số ngày (mặc định 7)').setRequired(false).setMinValue(1).setMaxValue(60)
      )
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply(subcommand === 'quet-ngay'
    ? { flags: MessageFlags.IsComponentsV2 }
    : { ephemeral: false });

  try {
    if (subcommand === 'quet-ngay') {
      const [orderResult, subResult] = await Promise.all([
        runDeepNotifications(interaction.client),
        runSubscriptionNotifications(interaction.client),
      ]);

      const panel = new ContainerBuilder().setAccentColor(0x3498DB);
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `# ${E('status_check')} QUÉT GIA HẠN HOÀN TẤT`,
        `> ${E('status_info')} Hệ thống đã rà đơn hàng, subscription và hàng chờ Admin của **Store 1**.`,
      ].join('\n')));
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `### ${E('order_product')} NHẮC ĐƠN HÀNG`,
        `${E('icon_calendar')} **Trước 3 ngày** — ${orderResult?.sent3d || 0}`,
        `${E('icon_clock')} **Trước 2 ngày** — ${orderResult?.sent2d || 0}`,
        `${E('status_warn')} **Trước 1 ngày** — ${orderResult?.sent1d || 0}`,
        '',
        `### ${E('cenar_cooldown')} TRUNG TÂM SUBSCRIPTION`,
        `${E('cenar_admin')} **Panel mới gửi Admin Store 1** — ${subResult?.sentAdmin || 0}`,
        `${E('cenar_announce')} **Thông báo hệ thống cũ** — ${subResult?.sentOwner || 0}`,
        `${E('ticket_user')} **Tin nhắn khách hàng** — ${subResult?.sentCustomer || 0}`,
        subResult?.adminErrors
          ? `${E('status_cross')} **Lỗi nhắc Admin** — ${subResult.adminErrors}`
          : `${E('cenar_verified')} **Trạng thái** — Không phát hiện lỗi`,
        `-# ${E('verify_shield')} Cenar Renewal Control · chống gửi trùng · mật khẩu luôn được ẩn trên Discord`,
      ].join('\n')));

      await interaction.editReply({ components: [panel] });
      return;
    }

    if (subcommand === 'danh-sach') {
      const days = interaction.options.getInteger('so_ngay') || 7;
      const expiringOrders = getExpiringOrdersRaw(days);

      const embed = new EmbedBuilder()
        .setTitle(`${E('icon_clock')} Đơn Hàng Tới Hạn Trong ${days} Ngày`)
        .setColor(0xE74C3C)
        .setDescription(expiringOrders.length === 0
          ? 'Hiện tại chưa có đơn hàng nào sắp hết hạn.'
          : `Tìm thấy **${expiringOrders.length}** đơn hàng sắp hết hạn:`);

      if (expiringOrders.length > 0) {
        const displayOrders = expiringOrders.slice(0, 20);
        displayOrders.forEach(order => {
          const expiryTs = Math.floor(new Date(order.expiry_at).getTime() / 1000);
          embed.addFields({
            name: `Đơn: ${order.order_code} — <@${order.customer_id}>`,
            value: `**${order.product_name}** · Hết hạn: <t:${expiryTs}:F>`,
            inline: false,
          });
        });
        if (expiringOrders.length > 20) {
          embed.setFooter({ text: `Và ${expiringOrders.length - 20} đơn khác chưa hiển thị...` });
        }
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'sub-check') {
      const days = interaction.options.getInteger('so_ngay') || 7;
      const subs = getSubscriptionsDueInDays(interaction.guildId, days);

      const embed = new EmbedBuilder()
        .setTitle(`${E('icon_clock')} Subscriptions Cần Gia Hạn Trong ${days} Ngày`)
        .setColor(0xF39C12)
        .setTimestamp();

      if (!subs.length) {
        embed.setDescription(`${E('order_complete')} Không có subscription nào cần gia hạn!`);
      } else {
        let desc = `Tìm thấy **${subs.length}** subscription cần xử lý:\n\n`;
        for (const s of subs.slice(0, 20)) {
          const emoji = serviceEmoji(E, s.service_type);
          const mode = modeLabel(E, s.renewal_mode);
          const dateField = s.renewal_mode === 'auto_cycle' ? s.next_renewal_at : s.expiry_at;
          const ts = Math.floor(new Date(dateField).getTime() / 1000);
          const customer = s.customer_id ? `<@${s.customer_id}>` : (s.customer_discord_name || '—');
          const extra = s.spotify_family_name ? ` · ${E('icon_home')} ${s.spotify_family_name}` : '';
          desc += `${emoji} **ID ${s.id}** · \`${s.gmail_email}\`${extra}\n> ${E('ticket_user')} ${customer} · ${mode} · <t:${ts}:R>\n\n`;
        }
        embed.setDescription(desc.slice(0, 4000));
        if (subs.length > 20) embed.setFooter({ text: `Và ${subs.length - 20} mục khác...` });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('[AUTO-RENEW] Error:', error);
    await interaction.editReply(`${E('status_cross')} Đã xảy ra lỗi hệ thống.`);
  }
}
