import { EmbedBuilder } from 'discord.js';
import { addSubscription, getSubscriptionById as getSubById, getSubscriptionProgress, markCustomerResponse as markSubResponse } from '../services/subscriptionService.js';
import { buildOwnerCustomerWantsRenewalV2, getReminderChannel } from '../services/deepNotificationService.js';
import { resolveDeliveryServiceStartAt } from '../services/deliverySubscriptionService.js';
import { getOrderByCode } from '../services/orderService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { safeReply, parseDateInput } from './shared.js';

export async function handleSubscriptionAddModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const type = interaction.customId.split(':')[2]; // nitro, spotify, youtube
  await interaction.deferReply({ ephemeral: true });

  try {
    const gmail = interaction.fields.getTextInputValue('gmail')?.trim();
    const password = interaction.fields.getTextInputValue('password')?.trim();
    if (!gmail || !password) {
      return interaction.editReply(`${E('status_cross')} Gmail và mật khẩu là bắt buộc.`);
    }

    let customerField = null, customerName = null, duration = 2, purchaseDate, renewalMode, renewalCycle = 0;
    let spotifyFamilyName = null, spotifySlotsUsed = 0, note = null;

    if (type === 'nitro') {
      customerField = interaction.fields.getTextInputValue('customer')?.trim() || null;
      duration = Number.parseInt(interaction.fields.getTextInputValue('duration')?.trim(), 10) || 2;
      purchaseDate = parseDateInput(interaction.fields.getTextInputValue('purchase_date'));
      renewalMode = duration > 1 ? 'auto_cycle' : 'one_time';
      renewalCycle = duration > 1 ? 1 : 0;
    } else if (type === 'spotify') {
      spotifyFamilyName = interaction.fields.getTextInputValue('family_name')?.trim() || 'Family';
      spotifySlotsUsed = Number.parseInt(interaction.fields.getTextInputValue('slots')?.trim(), 10) || 5;
      purchaseDate = new Date().toISOString();
      duration = 12; // Spotify Family thường 12 tháng
      renewalMode = 'auto_cycle';
      renewalCycle = 1; // mỗi tháng
    } else if (type === 'youtube') {
      customerField = interaction.fields.getTextInputValue('customer')?.trim() || null;
      interaction.fields.getTextInputValue('type'); // Giữ tương thích modal cũ; hệ thống luôn cấp theo tháng.
      duration = Number.parseInt(interaction.fields.getTextInputValue('duration')?.trim(), 10) || 12;
      purchaseDate = new Date().toISOString();
      renewalMode = duration > 1 ? 'auto_cycle' : 'one_time';
      renewalCycle = duration > 1 ? 1 : 0;
    } else if (type === 'netflix') {
      customerField = interaction.fields.getTextInputValue('customer')?.trim() || null;
      const profileName = interaction.fields.getTextInputValue('profile')?.trim() || null;
      duration = Number.parseInt(interaction.fields.getTextInputValue('duration')?.trim(), 10) || 1;
      purchaseDate = new Date().toISOString();
      renewalMode = duration > 1 ? 'auto_cycle' : 'one_time';
      renewalCycle = duration > 1 ? 1 : 0;
      if (profileName) note = profileName;
    }

    // Parse customer ID vs name vs order code
    let customerId = null;
    let relatedOrderCode = null;

    if (customerField) {
      if (/^(CR_)?\d{3,10}$/i.test(customerField)) {
        const codeToFind = customerField.toUpperCase().startsWith('CR_') ? customerField.toUpperCase() : `CR_${customerField}`;
        const order = getOrderByCode(codeToFind);
        if (order) {
          relatedOrderCode = order.order_code;
          customerId = order.customer_id;
          // Quyền lợi bắt đầu khi giao hàng, không phải khi ticket/đơn được tạo.
          purchaseDate = resolveDeliveryServiceStartAt(order);
          
          if (type !== 'spotify') {
            duration = order.duration_months || duration;
            if (type === 'nitro') {
               renewalMode = duration > 1 ? 'auto_cycle' : 'one_time';
               renewalCycle = duration > 1 ? 1 : 0;
            } else if (type === 'netflix') {
               renewalMode = duration > 1 ? 'auto_cycle' : 'one_time';
               renewalCycle = duration > 1 ? 1 : 0;
            }
          }
        }
      }

      if (!customerId && /^\d{17,20}$/.test(customerField)) {
        customerId = customerField;
      } else if (!customerId && !relatedOrderCode) {
        customerName = customerField;
      }

      if (customerId && !customerName) {
        const user = await interaction.client.users.fetch(customerId).catch(() => null);
        customerName = user?.tag || user?.username || customerId;
      }
    }

    const sub = addSubscription({
      guildId: interaction.guildId,
      serviceType: type === 'spotify' ? 'spotify_family' : type,
      renewalMode,
      gmailEmail: gmail,
      gmailPassword: password,
      customerId,
      customerDiscordName: customerName,
      relatedOrderCode,
      purchaseDate,
      totalDurationMonths: duration,
      renewalCycleMonths: renewalCycle,
      spotifyFamilyName,
      spotifySlotsUsed,
      note,
      actorId: interaction.user.id,
      source: 'DISCORD_MODAL',
    });
    const progress = getSubscriptionProgress(sub);

    const EMOJI = { nitro: '🚀', spotify: '🎵', youtube: '📺', netflix: '🎬' };
    const LABEL = { nitro: 'Discord Nitro', spotify: 'Spotify Family', youtube: 'YouTube Premium', netflix: 'Netflix' };
    const MODE_LABEL = { auto_cycle: '🔄 Định kỳ', one_time: '🔂 Mua lẻ', full_paid: `${E('status_check')} Đã trả hết` };

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI[type]} Đã Thêm ${LABEL[type]}`)
      .setColor(0x57F287)
      .setDescription([
        `**ID:** ${sub.id}`,
        `**Gmail:** \`${sub.gmail_email}\``,
        `**Chế độ:** ${MODE_LABEL[sub.renewal_mode]}`,
        `**Thời hạn:** ${sub.total_duration_months} tháng`,
        `**Tiến độ ban đầu:** ${progress.fulfilledMonths}/${progress.totalMonths} tháng`,
        sub.renewal_cycle_months > 0 ? `**Chu kỳ gia hạn:** ${sub.renewal_cycle_months} tháng/lần` : null,
        sub.next_renewal_at ? `**Kỳ gia hạn đầu:** <t:${Math.floor(new Date(sub.next_renewal_at).getTime() / 1000)}:F>` : null,
        `**Hết hạn:** <t:${Math.floor(new Date(sub.expiry_at).getTime() / 1000)}:F>`,
        customerId ? `**Khách:** <@${customerId}>` : (customerName ? `**Khách:** ${customerName}` : null),
        spotifyFamilyName ? `**Family:** ${spotifyFamilyName} (${spotifySlotsUsed}/5 slots)` : null,
        note ? `**Profile:** ${note}` : null,
      ].filter(Boolean).join('\n'))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[SUBSCRIPTION ADD] Error:', error);
    await interaction.editReply(`${E('status_cross')} Lỗi: ${error.message}`);
  }
}

export async function handleSubscriptionRenewButton(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const parts = interaction.customId.split(':'); // sub:renew:yes/no:ID
  const response = parts[2]; // 'yes' or 'no'
  const subId = Number(parts[3]);

  const sub = getSubById(subId);
  if (!sub) {
    await safeReply(interaction, { content: `${E('status_warn')} Subscription không tồn tại hoặc đã hết hạn.`, ephemeral: true });
    return;
  }

  if (response === 'yes') {
    markSubResponse(subId, 'YES');
    // Gửi thông tin về kênh reminder cho chủ shop
    const ch = getReminderChannel(interaction.client, sub.guild_id);
    if (ch) {
      const customerUser = sub.customer_id ? await interaction.client.users.fetch(sub.customer_id).catch(() => null) : null;
      await ch.send(buildOwnerCustomerWantsRenewalV2(sub, customerUser || interaction.user));
    }
    await interaction.update({
      content: `${E('status_check')} Cảm ơn bạn! Chủ shop đã nhận được yêu cầu gia hạn và sẽ xử lý sớm nhất.`,
      embeds: [], components: [],
    }).catch(() => null);
  } else {
    markSubResponse(subId, 'NO');
    await interaction.update({
      content: `${E('ticket_user')} Cảm ơn bạn đã phản hồi. Nếu thay đổi ý, hãy liên hệ shop nhé!`,
      embeds: [], components: [],
    }).catch(() => null);
  }
}

