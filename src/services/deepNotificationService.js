import { getOrdersExpiringInWindowRaw, markExpiryNoticeRaw, getExpiredSubscriptionOrdersRaw } from './v11DbHelpers.js';
import { db } from '../database/db.js';
import {
  getAllDueForRenewalGlobal,
  getAllExpiringOneTimeGlobal,
  markRemindSent,
  markCustomerResponse,
} from './subscriptionService.js';
import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { decrypt } from '../utils/crypto.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

// ═══════════════ Helpers ═══════════════

async function safeSend(user, content) {
  try {
    await user.send(content);
    return true;
  } catch {
    return false;
  }
}

async function safeSendEmbed(user, payload) {
  try {
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

function getReminderChannel(client, guildId) {
  try {
    const gCfg = db.prepare('SELECT reminder_channel_id FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (gCfg?.reminder_channel_id) {
      return client.channels.cache.get(gCfg.reminder_channel_id) ?? null;
    }
  } catch {}
  return null;
}

// ═══════════════ Subscription Notification Embeds ═══════════════

const SERVICE_LABEL = { nitro: 'Discord Nitro', spotify_family: 'Spotify Family', youtube: 'YouTube Premium', netflix: 'Netflix' };
const SERVICE_COLOR = { nitro: 0x5865F2, spotify_family: 0x1DB954, youtube: 0xFF0000, netflix: 0xE50914 };
const SERVICE_SLOT = { nitro: 'brand_nitro', spotify_family: 'brand_spotify', youtube: 'brand_youtube', netflix: 'brand_netflix' };

function serviceEmoji(E, type) {
  return E(SERVICE_SLOT[type]) || E('order_product');
}

// Trả về { components, flags } để gửi qua channel.send / user.send
function buildRenewalV2(sub) {
  const E = createEmojiResolver(sub.guild_id);
  const label = SERVICE_LABEL[sub.service_type] || sub.service_type;
  const color = SERVICE_COLOR[sub.service_type] || 0xFEE75C;
  const totalRenewals = sub.renewal_cycle_months > 0 ? Math.max(0, Math.floor(sub.total_duration_months / sub.renewal_cycle_months) - 1) : 0;
  const renewalTs = Math.floor(new Date(sub.next_renewal_at).getTime() / 1000);
  const customer = sub.customer_id ? `<@${sub.customer_id}>` : (sub.customer_discord_name || '_Chưa gán_');

  const lines = [
    `## ${serviceEmoji(E, sub.service_type)} CẦN GIA HẠN ${label.toUpperCase()}`,
    `> ${E('payment_money')} **Gmail:** \`${sub.gmail_email}\``,
    `> ${E('icon_key')} **Mật khẩu:** \`${decrypt(sub.gmail_password)}\``,
    `> ${E('ticket_user')} **Khách hàng:** ${customer}`,
    `> ${E('icon_clock')} **Hạn gia hạn:** <t:${renewalTs}:F> (<t:${renewalTs}:R>)`,
    `> ${E('icon_number')} **Lần gia hạn:** ${sub.times_renewed + 1}/${totalRenewals + 1}`,
  ];
  if (sub.related_order_code) lines.push(`> ${E('icon_clipboard')} **Đơn gốc:** \`${sub.related_order_code}\``);
  if (sub.spotify_family_name) lines.push(`> ${E('icon_home')} **Family:** ${sub.spotify_family_name} · ${E('icon_group')} **Slots:** ${sub.spotify_slots_used || 0}/5`);
  if (sub.note) lines.push(`> ${E('icon_edit')} **Ghi chú:** ${sub.note}`);
  lines.push('');
  lines.push(`-# ID: ${sub.id} | Dùng /subscription renew ${sub.id} sau khi gia hạn xong`);

  const container = new ContainerBuilder().setAccentColor(color);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildCustomerRenewalAskV2(sub) {
  const E = createEmojiResolver(sub.guild_id);
  const label = SERVICE_LABEL[sub.service_type] || sub.service_type;
  const expiryTs = Math.floor(new Date(sub.expiry_at).getTime() / 1000);

  const lines = [
    `## ${serviceEmoji(E, sub.service_type)} Gói ${label} sắp hết hạn!`,
    sub.related_order_code ? `> ${E('icon_clipboard')} Mã đơn: \`${sub.related_order_code}\`` : null,
    `> ${E('icon_clock')} Hết hạn: <t:${expiryTs}:F> (<t:${expiryTs}:R>)`,
    '',
    '**Bạn có muốn gia hạn tiếp không?**',
    'Nhấn nút bên dưới để trả lời.',
  ].filter(Boolean);

  const container = new ContainerBuilder().setAccentColor(0xFEE75C);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  const row = buildCustomerRenewalButtons(sub.id, E);
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

function buildCustomerRenewalButtons(subId, E) {
  return new ActionRowBuilder().addComponents(
    withButtonEmoji(
      new ButtonBuilder().setCustomId(`sub:renew:yes:${subId}`).setLabel('Có, tôi muốn gia hạn').setStyle(ButtonStyle.Success),
      E.component('status_check'),
    ),
    withButtonEmoji(
      new ButtonBuilder().setCustomId(`sub:renew:no:${subId}`).setLabel('Không, cảm ơn').setStyle(ButtonStyle.Secondary),
      E.component('status_cross'),
    ),
  );
}

function buildCustomerYoutubeNoticeV2(sub) {
  const E = createEmojiResolver(sub.guild_id);
  const renewalTs = Math.floor(new Date(sub.next_renewal_at).getTime() / 1000);
  const lines = [
    `## ${E('brand_youtube')} Gói YouTube Premium sắp tới kỳ gia hạn!`,
    `> ${E('icon_clock')} Hạn: <t:${renewalTs}:F> (<t:${renewalTs}:R>)`,
    '',
    'Chủ shop sẽ gia hạn cho bạn. Nếu có vấn đề, hãy mở ticket.',
  ];
  const container = new ContainerBuilder().setAccentColor(0xFF0000);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildOwnerCustomerWantsRenewalV2(sub, customerUser) {
  const E = createEmojiResolver(sub.guild_id);
  const lines = [
    `## ${serviceEmoji(E, sub.service_type)} ${E('status_check')} KHÁCH MUỐN GIA HẠN`,
    `> ${E('ticket_user')} **Khách hàng:** ${customerUser ? `<@${customerUser.id}> (${customerUser.tag})` : (sub.customer_discord_name || '_Không rõ_')}`,
    `> ${E('payment_money')} **Gmail:** \`${sub.gmail_email}\``,
    `> ${E('icon_key')} **Mật khẩu:** \`${decrypt(sub.gmail_password)}\``,
    '',
    `-# ID: ${sub.id}`,
  ];
  const container = new ContainerBuilder().setAccentColor(0x57F287);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ═══════════════ Main: Order Expiry Notifications ═══════════════

function buildExpiredSubscriptionAlertV2(order, ownerId) {
  const E = createEmojiResolver(order.guild_id);
  const expiryTs = Math.floor(new Date(order.expiry_at).getTime() / 1000);

  let pName = (order.product_name || '').toLowerCase();
  let emoji = E('icon_price', '<:Diamond:1485905790903783465>');
  let color = 0x808080;
  let serviceName = "DỊCH VỤ";
  
  if (pName.includes('youtube')) {
    emoji = E('brand_youtube', '<:youtube:1373734824342327297>'); color = 0xFF0000; serviceName = "YOUTUBE PREMIUM";
  } else if (pName.includes('netflix')) {
    emoji = E('brand_netflix', '<:cr_shop:1392749981332541501>'); color = 0xE50914; serviceName = "NETFLIX";
  } else if (pName.includes('spotify')) {
    emoji = E('brand_spotify', '<a:tickgreen:1384069022831874169>'); color = 0x1DB954; serviceName = "SPOTIFY";
  } else if (pName.includes('canva')) {
    emoji = E('brand_canva', '<:verifybadge:1481127479702847646>'); color = 0x00C4CC; serviceName = "CANVA";
  } else if (pName.includes('office') || pName.includes('microsoft')) {
    emoji = E('brand_office', '<:money:1442876095442714748>'); color = 0xD83B01; serviceName = "OFFICE 365";
  } else if (pName.includes('vpn')) {
    emoji = E('brand_vpn', '<:verifybadge:1481127479702847646>'); color = 0x00A4FF; serviceName = "VPN";
  }

  const container = new ContainerBuilder().setAccentColor(color);

  const pingText = ownerId ? `<@${ownerId}>` : '@everyone';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${pingText}\n` +
      `# ${E('status_warn')} **BÁO ĐỘNG: GÓI ${serviceName} ĐÃ HẾT HẠN** ${E('status_warn')}\n` +
      `> Đã phát hiện khách hàng hết hạn gói mua. Cần xử lý ngay để tránh lỗ gia hạn!`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> ${E('icon_fire')} **Tài khoản (Email):** \`${order.credential_email || 'Không có Email'}\`\n` +
      `> ${E('icon_gift')} **Sản phẩm:** ${order.product_name}\n` +
      `> ${E('icon_cart')} **Đơn hàng gốc:** \`${order.order_code}\`\n` +
      `> ${E('icon_heart')} **Khách hàng:** <@${order.customer_id}>\n` +
      `> ${E('icon_clock')} **Ngày hết hạn:** <t:${expiryTs}:d> (<t:${expiryTs}:R>)`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${E('icon_gem')} *Vui lòng truy cập trang quản lý để Kick/Huỷ gói này hoặc yêu cầu khách gia hạn!*`
    )
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sub_order:renew:bill:${order.order_code}`)
      .setLabel('Gửi bill nhắc gia hạn')
      .setStyle(ButtonStyle.Success)
      .setEmoji({ id: '1348626032747614268', name: 'cr_carttt' }),
    new ButtonBuilder()
      .setCustomId(`sub_order:renew:kicked:${order.order_code}`)
      .setLabel('Đã Kick / Ngừng gia hạn')
      .setStyle(ButtonStyle.Danger)
      .setEmoji({ id: '1348625535512870965', name: 'cr_baohanh' })
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

export async function checkExpiredSubscriptionOrders(client) {
  const expiredOrders = getExpiredSubscriptionOrdersRaw();
  let alerted = 0;
  for (const order of expiredOrders) {
    try {
      const ch = getReminderChannel(client, order.guild_id);
      if (ch) {
        await ch.send(buildExpiredSubscriptionAlertV2(order, ch.guild.ownerId));
        markExpiryNoticeRaw(order.order_code, 'expiry_notice_expired_sent_at');
        alerted++;
      }
    } catch (e) {
      console.error(`[SUB-EXPIRY] Lỗi gửi cảnh báo Subscription Order ${order.order_code}:`, e);
    }
  }
  if (alerted > 0) console.log(`[SUB-EXPIRY] Đã cảnh báo ${alerted} đơn Subscription hết hạn.`);
}

export async function runDeepNotifications(client) {
  const notify3d = getOrdersExpiringInWindowRaw(48, 72).filter((o) => !o.expiry_notice_3d_sent_at);
  const notify2d = getOrdersExpiringInWindowRaw(24, 48).filter((o) => !o.expiry_notice_2d_sent_at);
  const notify1d = getOrdersExpiringInWindowRaw(0, 24).filter((o) => !o.expiry_notice_1d_sent_at);

  let sent3d = 0, sent2d = 0, sent1d = 0;

  for (const order of notify3d) {
    const E = createEmojiResolver(order.guild_id);
    const user = await client.users.fetch(order.customer_id).catch(() => null);
    if (!user) continue;
    const ok = await safeSend(user, [
      `${E('icon_announce')} **Gói của bạn sắp hết hạn trong khoảng 3 ngày**`,
      `Mã đơn: \`${order.order_code}\``, `Sản phẩm: **${order.product_name}**`,
      `Ngày hết hạn: <t:${Math.floor(new Date(order.expiry_at).getTime() / 1000)}:F>`,
      'Hãy chuẩn bị gia hạn để quá trình sử dụng không bị ngắt quãng nhé.',
    ].join('\n'));
    if (ok) {
      markExpiryNoticeRaw(order.order_code, 'expiry_notice_3d_sent_at'); sent3d++;
      try {
        const ch = getReminderChannel(client, order.guild_id);
        ch?.send(`${E('icon_announce')} Đã nhắc gia hạn **(3 ngày)** cho <@${order.customer_id}> — \`${order.order_code}\` | **${order.product_name}**`);
      } catch {}
    }
  }

  for (const order of notify2d) {
    const E = createEmojiResolver(order.guild_id);
    const user = await client.users.fetch(order.customer_id).catch(() => null);
    if (!user) continue;
    const ok = await safeSend(user, [
      `${E('icon_announce')} **Gói của bạn sắp hết hạn trong khoảng 2 ngày**`,
      `Mã đơn: \`${order.order_code}\``, `Sản phẩm: **${order.product_name}**`,
      `Ngày hết hạn: <t:${Math.floor(new Date(order.expiry_at).getTime() / 1000)}:F>`,
      'Nếu muốn tiếp tục sử dụng, hãy mở ticket hoặc liên hệ shop để gia hạn.',
    ].join('\n'));
    if (ok) {
      markExpiryNoticeRaw(order.order_code, 'expiry_notice_2d_sent_at'); sent2d++;
      try { const ch = getReminderChannel(client, order.guild_id); ch?.send(`${E('icon_announce')} Đã nhắc gia hạn **(2 ngày)** cho <@${order.customer_id}> — \`${order.order_code}\` | **${order.product_name}**`); } catch {}
    }
  }

  for (const order of notify1d) {
    const E = createEmojiResolver(order.guild_id);
    const user = await client.users.fetch(order.customer_id).catch(() => null);
    if (!user) continue;
    const ok = await safeSend(user, [
      `${E('icon_clock')} **Gói của bạn sẽ hết hạn trong vòng 1 ngày**`,
      `Mã đơn: \`${order.order_code}\``, `Sản phẩm: **${order.product_name}**`,
      `Ngày hết hạn: <t:${Math.floor(new Date(order.expiry_at).getTime() / 1000)}:F>`,
      'Hãy mở ticket gia hạn để tránh gián đoạn sử dụng.',
    ].join('\n'));
    if (ok) {
      markExpiryNoticeRaw(order.order_code, 'expiry_notice_1d_sent_at'); sent1d++;
      try { const ch = getReminderChannel(client, order.guild_id); ch?.send(`${E('icon_clock')} Đã nhắc gia hạn **(1 ngày)** cho <@${order.customer_id}> — \`${order.order_code}\` | **${order.product_name}**`); } catch {}
    }
  }

  return { sent3d, sent2d, sent1d };
}

// ═══════════════ Subscription Notifications ═══════════════

export async function runSubscriptionNotifications(client) {
  let sentOwner = 0, sentCustomer = 0;

  // 1. auto_cycle — nhắc chủ shop (Nitro dài hạn, Spotify, YouTube tháng)
  const dueSubs = getAllDueForRenewalGlobal(72, 50);
  for (const sub of dueSubs) {
    try {
      const ch = getReminderChannel(client, sub.guild_id);
      if (!ch) continue;

      await ch.send(buildRenewalV2(sub));
      markRemindSent(sub.id);
      sentOwner++;

      // YouTube auto_cycle → cũng DM cho khách
      if (sub.service_type === 'youtube' && sub.customer_id) {
        const user = await client.users.fetch(sub.customer_id).catch(() => null);
        if (user) {
          await safeSendEmbed(user, buildCustomerYoutubeNoticeV2(sub));
          sentCustomer++;
        }
      }
    } catch (e) {
      console.error(`[SUB-NOTIFY] Lỗi auto_cycle sub ${sub.id}:`, e);
    }
  }

  // 2. one_time / full_paid — hỏi khách có muốn gia hạn
  const expiringSubs = getAllExpiringOneTimeGlobal(72, 50);
  for (const sub of expiringSubs) {
    try {
      if (!sub.customer_id) {
        // Không có khách → nhắc chủ shop
        const ch = getReminderChannel(client, sub.guild_id);
        if (ch) {
          await ch.send(buildRenewalV2(sub));
          markRemindSent(sub.id);
          sentOwner++;
        }
        continue;
      }

      const user = await client.users.fetch(sub.customer_id).catch(() => null);
      if (!user) continue;

      const ok = await safeSendEmbed(user, buildCustomerRenewalAskV2(sub));

      if (ok) {
        markRemindSent(sub.id);
        sentCustomer++;
      }
    } catch (e) {
      console.error(`[SUB-NOTIFY] Lỗi one_time sub ${sub.id}:`, e);
    }
  }

  if (sentOwner > 0 || sentCustomer > 0) {
    console.log(`[SUB-NOTIFY] Gửi ${sentOwner} nhắc chủ shop, ${sentCustomer} nhắc khách hàng.`);
  }

  return { sentOwner, sentCustomer };
}

// Re-export for use in interactionCreate button handler
export { buildOwnerCustomerWantsRenewalV2, getReminderChannel };
