import { ActionRowBuilder, escapeMarkdown, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getCustomerFlag, getTicketMuteStatus } from '../services/blacklistService.js';
import { getOrderByCode } from '../services/orderService.js';
import { openWarrantyTicket } from '../services/warrantyService.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
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

async function submitWarrantyIntake(interaction, data) {
  const customerId = interaction.user.id;
  const orderCode = data.code.toUpperCase();
  const order = getOrderByCode(orderCode);
  if (order?.guild_id !== interaction.guildId || order?.customer_id !== customerId) {
    await interaction.reply({ content: 'Không tìm thấy đơn của bạn trong máy chủ này. Kiểm tra mã đơn hoặc chọn Hỗ trợ.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!['COMPLETED', 'WARRANTY_OPEN'].includes(order.status)) {
    await interaction.reply({ content: 'Chỉ mở bảo hành cho đơn đã hoàn thành. Nếu cần kiểm tra đơn, hãy chọn Hỗ trợ.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (Number(getCustomerFlag(interaction.guildId, customerId).is_blacklisted) === 1
    || getTicketMuteStatus(interaction.guildId, customerId).is_ticket_muted) {
    await interaction.reply({ content: 'Tài khoản của bạn đang bị giới hạn mở ticket.', flags: MessageFlags.Ephemeral });
    return;
  }
  const key = `${interaction.guildId}:${orderCode}`;
  if (warrantyRequests.has(key)) {
    await interaction.reply({ content: 'Yêu cầu bảo hành đang được xử lý. Vui lòng đợi phản hồi.', flags: MessageFlags.Ephemeral });
    return;
  }
  warrantyRequests.add(key);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const issue = escapeMarkdown(data.issue);
    const result = await openWarrantyTicket({
      guild: interaction.guild, customerId, actorId: customerId, orderCode, formData: { issue },
    });
    const channel = result.channel;
    if (!channel) {
      await interaction.editReply({ content: 'Không tìm thấy kênh bảo hành của đơn này. Hãy chọn Hỗ trợ để staff kiểm tra.' });
      return;
    }
    if (result.reused && channel.isTextBased()
      && channel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) === false) {
      await channel.send({ content: `**Lỗi đã báo** · ${issue}`, allowedMentions: { parse: [] }, nonce: interaction.id, enforceNonce: true });
    }
    await interaction.editReply({ content: `Ticket bảo hành của bạn: <#${channel.id}>.` });
  } catch (error) {
    console.error('[WARRANTY_INTAKE]', error.code || error.name);
    if (interaction.deferred) {
      await interaction.editReply({ content: 'Chưa thể cập nhật yêu cầu bảo hành. Vui lòng thử lại hoặc chọn Hỗ trợ.' });
    }
  } finally {
    warrantyRequests.delete(key);
  }
}

export async function handleTicketIntakeInteraction(interaction) {
  if (!interaction.customId?.startsWith('ticket:intake:')) return false;
  const [, , action, type, extra] = interaction.customId.split(':');
  if (interaction.guildId !== STORE_ONE_GUILD_ID || !Object.hasOwn(forms, type) || extra !== undefined) {
    await interaction.reply({ content: 'Biểu mẫu này chỉ dùng ở bảng tạo ticket của Cenar Store.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === 'open' && interaction.isButton()) {
    await interaction.showModal(buildTicketIntakeModal(type));
    return true;
  }
  if (action !== 'form' || !interaction.isModalSubmit()) return true;

  const { title, questions } = forms[type];
  const data = Object.fromEntries(questions.map(({ id }) => [id, interaction.fields.getTextInputValue(id).trim()]));
  if (questions.some(({ id, max, optional }) => (!optional && !data[id]) || data[id].length > max)) {
    await interaction.reply({ content: 'Vui lòng nhập đủ các trường bắt buộc rồi gửi lại.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (type === 'warranty') {
    await submitWarrantyIntake(interaction, data);
    return true;
  }

  const items = type === 'order'
    ? [['Sản phẩm', data.product], ['Thời hạn', data.duration], ['Thanh toán mong muốn', data.payment]]
    : [['Chủ đề', data.topic], ['Mã đơn', data.code], ['Nội dung', data.issue]];
  const text = [`### ${title}`, ...items.filter(([, value]) => value).map(([label, value]) =>
    `**${label}** · ${escapeMarkdown(value)}`)].join('\n');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await handleTicketCreate(interaction, type.toUpperCase(), null, { intake: { title, text } });
  return true;
}
