import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { getCtvSettings, isCustomerCtv } from './ctvService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';
import { accentFor } from '../utils/uiKit.js';

export async function sendCtvOrderLog(order, client = global.discordClient) {
  if (!order?.guild_id || !order?.customer_id || !client) return null;
  if (!isCustomerCtv(order.guild_id, order.customer_id)) return null;

  const guild = client.guilds.cache.get(order.guild_id)
    || await client.guilds.fetch(order.guild_id).catch(() => null);
  if (!guild) return null;
  const settings = getCtvSettings(order.guild_id);
  const channel = settings.order_log_channel_id
    ? await guild.channels.fetch(settings.order_log_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) return null;

  const E = createEmojiResolver(order.guild_id);
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${E('cenar_ctv')} Đơn hàng CTV mới`,
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('cenar_verified')} **Mã đơn:** \`${order.order_code}\``,
    `${E('cenar_partner_ok')} **CTV:** <@${order.customer_id}>`,
    `${E('cenar_price')} **Sản phẩm:** ${order.product_name}`,
    `${E('cenar_wallet')} **Tổng tiền:** ${formatCurrency(order.total_amount)}`,
    `${E('cenar_cooldown')} **Trạng thái:** ${order.status || order.payment_status}`,
    order.ticket_channel_id ? `${E('cenar_support')} **Ticket:** <#${order.ticket_channel_id}>` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# Log nội bộ dành cho CTV và đội ngũ vận hành · ${new Date().toLocaleString('vi-VN')}`,
  ));

  return channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

export function buildCtvPriorityNotice(guildId, customerId, order, roleIds = []) {
  const E = createEmojiResolver(guildId);
  const roles = roleIds.filter(Boolean);
  const roleMentions = roles.map((roleId) => `<@&${roleId}>`).join(' ');
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('cenar_ctv')} Đơn CTV ưu tiên`,
    roleMentions,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('cenar_verified')} **CTV:** <@${customerId}>`,
    `${E('cenar_partner_ok')} **Mã đơn:** \`${order.order_code}\``,
    `${E('cenar_price')} **Sản phẩm:** ${order.product_name}`,
    `${E('cenar_cooldown')} Vui lòng ưu tiên kiểm tra, xử lý và bàn giao.`,
  ].join('\n')));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], roles, users: [customerId] },
  };
}
