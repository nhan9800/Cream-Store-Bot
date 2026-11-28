import {
  ContainerBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getTicketByChannelId } from '../services/ticketService.js';
import { setOrderStatus } from '../services/orderService.js';
import { updateOrderLogMessage } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { attachWarrantyToTicket } from '../services/warrantyService.js';
import { refundDecorations } from '../services/refundPresentation.js';
import {
  applyTicketMove, findOrderCodes, movedChannelName, planTicketMove, TICKET_MOVE_TYPES, TicketMoveError,
} from '../services/ticketMoveService.js';
import { getTicketCategoryId } from '../events/shared.js';
import { assertStaffCapability } from '../utils/permissions.js';

const T = (content) => new TextDisplayBuilder().setContent(content);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const card = (accent, ...blocks) => {
  const container = new ContainerBuilder().setAccentColor(accent);
  blocks.forEach((block, i) => { if (i) container.addSeparatorComponents(sep()); container.addTextDisplayComponents(T(block)); });
  return container;
};

export const data = new SlashCommandBuilder()
  .setName('chuyen-ticket')
  .setDescription('Chuyển ticket khách mở nhầm mục sang đúng loại (bảo hành, đơn hàng, hỗ trợ…).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addStringOption((option) => option.setName('loai').setDescription('Mục đúng của ticket').setRequired(true)
    .addChoices(...Object.entries(TICKET_MOVE_TYPES).map(([value, type]) => ({ name: type.label, value }))))
  .addStringOption((option) => option.setName('ma_don')
    .setDescription('Mã đơn, ví dụ CN_123456. Bỏ trống: bot tự tìm mã khách đã gửi trong ticket').setMaxLength(20))
  .addStringOption((option) => option.setName('ghi_chu').setDescription('Lời nhắn cho khách (hiện trong ticket)').setMaxLength(300));

/** Order codes the customer (or staff) wrote in the last 100 messages of the ticket. */
async function codesInTicket(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return [];
  const text = [...messages.values()].map((m) => [m.content, ...m.embeds.map((e) => `${e.title ?? ''} ${e.description ?? ''}`)].join(' ')).join('\n');
  return findOrderCodes(text);
}

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  const d = refundDecorations(guildId, ['change', 'receipt', 'submit', 'info', 'confirm', 'reason', 'contact']);
  const reply = (accent, ...blocks) => interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [card(accent, ...blocks)], allowedMentions: { parse: [] } });
  const guildConfig = getGuildConfig(guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'SUPPORT')) {
    await reply(0xe8b977, `### ${d.reason} Chỉ staff mới chuyển được ticket`);
    return;
  }
  const channel = interaction.channel;
  const ticket = getTicketByChannelId(channel?.id);
  try {
    const targetType = interaction.options.getString('loai', true);
    const plan = planTicketMove(db, { ticket, guildId, targetType, orderCode: interaction.options.getString('ma_don'),
      messageCodes: interaction.options.getString('ma_don') ? [] : await codesInTicket(channel) });
    if (plan.unchanged) {
      await reply(0x5f6d87, `### ${d.info} Ticket đã đúng mục ${plan.label}${plan.orderCode ? ` · \`${plan.orderCode}\`` : ''}`, 'Không có gì thay đổi.');
      return;
    }

    const categoryId = getTicketCategoryId(guildConfig, targetType);
    if (categoryId && channel.parentId !== categoryId) {
      // Keep the ticket's own permission overwrites (customer + staff), do not sync to the category.
      await channel.setParent(categoryId, { lockPermissions: false, reason: `Chuyển ticket sang ${plan.label} bởi ${interaction.user.tag}` });
    }
    const name = movedChannelName({ ticket, channelName: channel.name, targetType, orderCode: plan.orderCode });
    if (name && name !== channel.name) await channel.setName(name, `Chuyển ticket sang ${plan.label}`).catch(() => null);

    const moved = applyTicketMove(db, { ticket, plan });
    if (plan.releaseWarranty) {
      const released = db.prepare("SELECT status FROM orders WHERE order_code = ?").get(plan.releaseWarranty)?.status === 'WARRANTY_OPEN'
        ? setOrderStatus(plan.releaseWarranty, 'COMPLETED') : null;
      if (released) await updateOrderLogMessage(interaction.guild, released).catch(() => null);
    }

    const note = interaction.options.getString('ghi_chu')?.trim();
    await channel.send({ flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, components: [card(0x8796cb,
      `### ${d.change} Ticket đã được chuyển sang mục ${plan.label}`,
      [
        plan.orderCode ? `${d.receipt} **Đơn liên quan:** \`${plan.orderCode}\`${plan.order?.product_name ? ` · ${plan.order.product_name}` : ''}` : null,
        `${d.submit} Bạn tiếp tục trao đổi ngay trong ticket này, không cần mở ticket mới.`,
        note ? `${d.contact} **Shop nhắn:** ${note}` : null,
      ].filter(Boolean).join('\n'),
      `-# Cenar Store · Chuyển từ ${plan.fromLabel} bởi staff`,
    )] });

    if (targetType === 'WARRANTY') {
      await attachWarrantyToTicket({ guild: interaction.guild, guildConfig, order: plan.order, ticket: moved, channel, actorId: interaction.user.id });
    }
    await emitStaffLog(interaction.client, { guildId, actorId: interaction.user.id, targetId: ticket.customer_id, action: 'TICKET_MOVED',
      detail: `${plan.fromType} → ${targetType}${plan.orderCode ? ` · ${plan.orderCode}` : ''}${plan.detected ? ' (tự tìm trong ticket)' : ''}`,
      relatedTicketCode: ticket.ticket_code, relatedOrderCode: plan.orderCode ?? null }).catch(() => null);
    await reply(0x79d4bd, `### ${d.confirm} Đã chuyển ticket sang ${plan.label}`, [
      `${d.info} **Kênh:** <#${channel.id}>${categoryId ? ` · danh mục <#${categoryId}>` : ''}`,
      plan.orderCode ? `${d.receipt} **Đơn:** \`${plan.orderCode}\`${plan.detected ? ' · bot tự tìm thấy trong ticket' : ''}` : null,
      targetType === 'WARRANTY' ? `${d.submit} Đã gửi panel bảo hành, chuyển đơn sang chờ bảo hành và ghi log bảo hành.` : null,
      plan.releaseWarranty ? `${d.reason} Đơn \`${plan.releaseWarranty}\` đã trả về Hoàn thành vì ticket rời mục Bảo hành.` : null,
    ].filter(Boolean).join('\n'));
  } catch (error) {
    if (error instanceof TicketMoveError) {
      await reply(0xe8b977, `### ${d.reason} Chưa chuyển được ticket`, error.message);
      return;
    }
    console.error('[CHUYEN-TICKET]', error);
    await reply(0xe8b977, `### ${d.reason} Có lỗi khi chuyển ticket`, 'Kiểm tra bot có quyền Quản lý kênh ở danh mục đích rồi thử lại.');
  }
}
