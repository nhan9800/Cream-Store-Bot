import { ActionRowBuilder, escapeMarkdown, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getCustomerFlag, getTicketMuteStatus } from '../services/blacklistService.js';
import { getOrderByCode, listWarrantyEligibleOrders } from '../services/orderService.js';
import { openWarrantyTicket } from '../services/warrantyService.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { buildPurchaseIntake } from '../utils/ticketIntakeView.js';
import {
  buildWarrantyIssueModal, buildWarrantyIssueReport, buildWarrantyOrderPicker, buildWarrantySubmitted,
  warrantyNotice, WARRANTY_ORDER_CODE, WARRANTY_PICK_ID, WARRANTY_QUESTIONS,
} from '../utils/warrantyIntakeView.js';
import { storefrontEmoji as icon } from '../utils/storefrontEmoji.js';
import { handleTicketCreate } from './ticketHandlers.js';

const forms = {
  order: {
    title: 'Mua hàng',
    questions: [
      { id: 'product', label: 'Bạn muốn mua sản phẩm gì?', max: 120, placeholder: 'Ví dụ Netflix Premium' },
      { id: 'duration', label: 'Bạn muốn mua trong bao lâu?', max: 40, placeholder: 'Ví dụ 1 tháng' },
      { id: 'payment', label: 'Phương thức thanh toán mong muốn', max: 60, placeholder: 'Ví dụ ngân hàng, MoMo hoặc thẻ Vina' },
    ],
  },
  support: {
    title: 'Hỗ trợ',
    questions: [
      { id: 'topic', label: 'Bạn cần hỗ trợ về việc gì?', max: 100 },
      { id: 'code', label: 'Mã đơn hàng nếu có', max: 32, optional: true },
      { id: 'issue', label: 'Mô tả cụ thể để staff hỗ trợ', max: 500, paragraph: true },
    ],
  },
  // Legacy single-step form: only parses modals opened before the order picker shipped.
  warranty: {
    title: 'Bảo hành',
    questions: [
      { id: 'code', label: 'Mã đơn cần bảo hành', max: 32, placeholder: 'Ví dụ CN_123456' },
      { id: 'issue', label: 'Sản phẩm đang gặp lỗi gì?', max: 500, paragraph: true },
    ],
  },
};

const warrantyRequests = new Set();

export function buildTicketIntakeModal(type) {
  const { title, questions } = forms[type];
  const modal = new ModalBuilder().setCustomId(`ticket:intake:form:${type}`).setTitle(title);
  return modal.addComponents(questions.map(({ id, label, max, optional, paragraph, placeholder }) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max)
      .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(!optional);
    if (placeholder) field.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(field);
  }));
}

const privateReply = (interaction, key, message) => interaction.reply({
  content: warrantyNotice(key, message), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
});

function isRestricted(interaction) {
  return Number(getCustomerFlag(interaction.guildId, interaction.user.id).is_blacklisted) === 1
    || Boolean(getTicketMuteStatus(interaction.guildId, interaction.user.id).is_ticket_muted);
}

function eligibleOrder(interaction, orderCode) {
  const order = WARRANTY_ORDER_CODE.test(orderCode) ? getOrderByCode(orderCode) : null;
  if (order?.guild_id !== interaction.guildId || order?.customer_id !== interaction.user.id) return { error: 'missing' };
  if (!['COMPLETED', 'WARRANTY_OPEN'].includes(order.status)) return { error: 'status' };
  return { order };
}

function rejectOrder(interaction, error) {
  return error === 'missing'
    ? privateReply(interaction, 'search', 'Không tìm thấy đơn của bạn trong máy chủ này. Kiểm tra mã đơn hoặc chọn **Hỗ trợ**.')
    : privateReply(interaction, 'warn', 'Chỉ mở bảo hành cho đơn đã hoàn thành. Nếu cần kiểm tra đơn, hãy chọn **Hỗ trợ**.');
}

const restricted = interaction => privateReply(interaction, 'warn', 'Tài khoản của bạn đang bị giới hạn mở ticket.');

async function showWarrantyPicker(interaction) {
  if (isRestricted(interaction)) return restricted(interaction);
  return interaction.reply(buildWarrantyOrderPicker(listWarrantyEligibleOrders(interaction.guildId, interaction.user.id)));
}

async function pickWarrantyOrder(interaction) {
  const { order, error } = eligibleOrder(interaction, String(interaction.values?.[0] ?? ''));
  if (error) return rejectOrder(interaction, error);
  if (isRestricted(interaction)) return restricted(interaction);
  return interaction.showModal(buildWarrantyIssueModal(order.order_code));
}

async function submitWarrantyIntake(interaction, orderCode, data) {
  const customerId = interaction.user.id;
  const { error } = eligibleOrder(interaction, orderCode);
  if (error) return rejectOrder(interaction, error);
  if (isRestricted(interaction)) return restricted(interaction);
  const key = `${interaction.guildId}:${orderCode}`;
  if (warrantyRequests.has(key)) {
    return privateReply(interaction, 'pending', 'Yêu cầu bảo hành đang được xử lý. Vui lòng đợi phản hồi.');
  }
  warrantyRequests.add(key);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const report = {
      issue: escapeMarkdown(data.issue),
      ...(data.since ? { since: escapeMarkdown(data.since) } : {}),
      ...(data.tried ? { tried: escapeMarkdown(data.tried) } : {}),
    };
    const formData = {
      issue: report.issue,
      ...(report.since ? { issueSince: report.since } : {}),
      ...(report.tried ? { triedSteps: report.tried } : {}),
    };
    const result = await openWarrantyTicket({
      guild: interaction.guild, customerId, actorId: customerId, orderCode, formData,
    });
    const channel = result.channel;
    if (!channel) {
      await interaction.editReply({ content: warrantyNotice('warn', 'Không tìm thấy kênh bảo hành của đơn này. Hãy chọn **Hỗ trợ** để staff kiểm tra.') });
      return;
    }
    if (result.reused && channel.isTextBased()
      && channel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) === false) {
      await channel.send({ content: buildWarrantyIssueReport(report), allowedMentions: { parse: [] }, nonce: interaction.id, enforceNonce: true });
    }
    await interaction.editReply({ content: buildWarrantySubmitted(orderCode, channel.id, Boolean(result.reused)) });
  } catch (failure) {
    console.error('[WARRANTY_INTAKE]', failure.code || failure.name);
    if (interaction.deferred) {
      await interaction.editReply({ content: warrantyNotice('warn', 'Chưa thể cập nhật yêu cầu bảo hành. Vui lòng thử lại hoặc chọn **Hỗ trợ**.') });
    }
  } finally {
    warrantyRequests.delete(key);
  }
}

function readFields(interaction, questions) {
  const data = Object.fromEntries(questions.map(({ id }) => [id, (interaction.fields.getTextInputValue(id) ?? '').trim()]));
  const invalid = questions.some(({ id, max, optional }) => (!optional && !data[id]) || data[id].length > max);
  return invalid ? null : data;
}

export async function handleTicketIntakeInteraction(interaction) {
  if (!interaction.customId?.startsWith('ticket:intake:')) return false;
  const [, , action, type, extra] = interaction.customId.split(':');
  const warrantyForm = action === 'form' && type === 'warranty' && extra !== undefined;
  if (interaction.guildId !== STORE_ONE_GUILD_ID || !Object.hasOwn(forms, type)
    || (extra !== undefined && !(warrantyForm && WARRANTY_ORDER_CODE.test(extra)))) {
    await privateReply(interaction, 'info', 'Biểu mẫu này chỉ dùng ở bảng tạo ticket của Cenar Store.');
    return true;
  }
  if (action === 'open' && interaction.isButton()) {
    if (type === 'warranty') await showWarrantyPicker(interaction);
    else await interaction.showModal(buildTicketIntakeModal(type));
    return true;
  }
  if (interaction.customId === WARRANTY_PICK_ID && interaction.isStringSelectMenu?.()) {
    await pickWarrantyOrder(interaction);
    return true;
  }
  if (action !== 'form' || !interaction.isModalSubmit()) return true;
  if (warrantyForm) {
    const data = readFields(interaction, WARRANTY_QUESTIONS);
    if (!data) await privateReply(interaction, 'warn', 'Vui lòng mô tả lỗi bạn đang gặp rồi gửi lại.');
    else await submitWarrantyIntake(interaction, extra, data);
    return true;
  }

  const { title, questions } = forms[type];
  const data = readFields(interaction, questions);
  if (!data) {
    await privateReply(interaction, 'warn', 'Vui lòng nhập đủ các trường bắt buộc rồi gửi lại.');
    return true;
  }
  if (type === 'warranty') {
    await submitWarrantyIntake(interaction, data.code.toUpperCase(), { issue: data.issue });
    return true;
  }

  const text = type === 'order'
    ? buildPurchaseIntake(data)
    : [`### ${icon('mic')} ${title}`, ...[
      ['location', 'Chủ đề', data.topic], ['link', 'Mã đơn', data.code], ['edit', 'Nội dung', data.issue],
    ].filter(([, , value]) => value)
      .map(([key, label, value]) => `${icon(key)} **${label}** · ${escapeMarkdown(value)}`)].join('\n');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await handleTicketCreate(interaction, type.toUpperCase(), null, { intake: { title, text } });
  return true;
}
