import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown,
  MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { bookingPortal, BOOKING_APP_ID } from '../services/bookingStoreSetupService.js';
import { db } from '../database/db.js';
import { createBookingLedger } from '../services/bookingLedgerService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getTicketByChannelId } from '../services/ticketService.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { isSupport } from '../utils/permissions.js';
import { bookingHelpCard, bookingScheduleCard } from '../utils/bookingPortalViews.js';
import { addBookingTicketSection, bookingTicketCard } from '../utils/bookingTicketUi.js';
import { safeReply } from './shared.js';
import { handleTicketCreate } from './ticketHandlers.js';

const activeChanges = new Set();
const bookingServices = { game: 'Chơi game', voice: 'Trò chuyện qua voice', apply: 'Đăng ký host' };
const nextStates = {
  confirm: 'Đã xác nhận lịch', complete: 'Đã diễn ra', decline: 'Không thể nhận lịch',
};

const bookingHelp = [
  '**Đặt lịch và theo dõi**\nGửi lịch từ bảng này. Dùng `/cenar-booking lich` để xem tiến độ và mở lại phiếu.',
  '**Hồ sơ và đánh giá**\nDùng `/cenar-ho-so` để chuẩn bị hồ sơ host hoặc gửi đánh giá cho phiên đã diễn ra.',
  '**Cộng đồng**\nDùng `/cenar-cong-dong` để xem cấp, điểm danh, nhiệm vụ và các trò chơi.',
];

export function parseBookingTime(value, now = Date.now()) {
  const parts = /^(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!parts) return null;
  const [day, month, year, hours, minutes] = parts.slice(1).map(Number);
  if (hours > 23 || minutes > 59) return null;
  const local = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  const timestamp = local.getTime() - 7 * 3_600_000;
  return timestamp > now ? Math.floor(timestamp / 1000) : null;
}

export function bookingForm(service) {
  const modal = new ModalBuilder().setCustomId(`booking:form:${service}`).setTitle(bookingServices[service]);
  const field = (id, label, max, { required = true, long = false, placeholder } = {}) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label)
      .setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(max).setRequired(required);
    if (placeholder) input.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(input);
  };
  if (service === 'apply') {
    return modal.addComponents(
      field('name', 'Biệt danh', 60),
      field('group', 'Nhóm hồ sơ nếu muốn công khai', 50, { required: false, placeholder: 'Nam, Nữ hoặc để trống' }),
      field('skills', 'Dịch vụ bạn nhận', 200, { long: true, placeholder: 'Game hoặc chủ đề trò chuyện' }),
      field('availability', 'Giờ rảnh (giờ Việt Nam)', 200, { long: true }),
    );
  }
  return modal.addComponents(
    field('host', 'Host hoặc nhóm bạn muốn gặp', 80, { required: false, placeholder: 'Để trống nếu muốn staff gợi ý' }),
    field('start', 'Ngày giờ (dd/mm/yyyy HH:mm, UTC+7)', 18, { placeholder: 'Ví dụ 28/11/2026 20:30' }),
    field('duration', 'Thời lượng (phút)', 4, { placeholder: 'Ví dụ 60' }),
    field('details', service === 'game' ? 'Tên game và ghi chú' : 'Chủ đề hoặc ghi chú', 300,
      { required: service === 'game', long: true }),
  );
}

function stateButtons(ticketId, emoji, actions) {
  const definitions = {
    confirm: ['Xác nhận lịch', ButtonStyle.Primary, 'calendar'],
    complete: ['Đánh dấu đã diễn ra', ButtonStyle.Success, 'reviews'],
    decline: ['Không nhận lịch', ButtonStyle.Secondary, 'support'],
  };
  return new ActionRowBuilder().addComponents(actions.map((action) => {
    const [label, style, icon] = definitions[action];
    const control = new ButtonBuilder().setCustomId(`booking:state:${action}:${ticketId}`).setLabel(label).setStyle(style);
    if (emoji[icon]) control.setEmoji(emoji[icon]);
    return control;
  }));
}

function bookingReceipt(ticket, service, details, emoji, schedule) {
  const isApply = service === 'apply';
  const container = bookingTicketCard({
    section: isApply ? 'TUYỂN HOST' : 'PHIẾU RIÊNG', title: bookingServices[service],
    subtitle: `Mã phiếu \`${ticket.ticket_code}\``, emoji: emoji[service],
  });
  if (schedule) {
    const start = Math.floor(schedule.startsAt / 1000);
    addBookingTicketSection(container,
      `### Khung giờ đề xuất\n<t:${start}:F> · <t:${start}:R>\n**Thời lượng** · ${schedule.durationMinutes} phút`);
  }
  addBookingTicketSection(container, `${isApply ? '### Hồ sơ ứng tuyển' : '### Yêu cầu của bạn'}\n${details}`);
  addBookingTicketSection(container, isApply
    ? '### Trạng thái\n**Chờ duyệt hồ sơ**\nStaff sẽ trao đổi với bạn trong phiếu này.'
    : '### Trạng thái\nChờ xác nhận\nStaff sẽ trao đổi để chốt host, giờ và chi phí.');
  if (!isApply && !schedule) container.addActionRowComponents(stateButtons(ticket.id, emoji, ['confirm', 'decline']));
  if (schedule) {
    createBookingLedger(db).createSession({ guildId: ticket.guild_id, ticketId: ticket.id, service, ...schedule });
    addBookingTicketSection(container, '**Theo dõi phiên**\nDùng `/cenar-booking lich` để xem lịch của bạn.');
  }
  return { container, flags: MessageFlags.IsComponentsV2 };
}

async function changeState(interaction, action, id, portal) {
  const ticket = getTicketByChannelId(interaction.channelId);
  const respond = content => safeReply(interaction, { content, flags: MessageFlags.Ephemeral });
  if (ticket?.guild_id !== STORE_TWO_GUILD_ID || ticket?.ticket_type !== 'BOOKING'
    || ticket?.status !== 'OPEN' || String(ticket.id) !== id || interaction.message?.author?.id !== BOOKING_APP_ID) {
    await respond('Phiếu booking này đã đóng hoặc không còn hợp lệ.');
    return;
  }
  if (activeChanges.has(id)) {
    await respond('Phiếu đang được cập nhật. Vui lòng thử lại.');
    return;
  }
  activeChanges.add(id);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    const cfg = getGuildConfig(interaction.guildId);
    const staff = {
      support_role_id: cfg?.support_role_id === interaction.guildId ? null : cfg?.support_role_id,
      manager_role_id: cfg?.manager_role_id === interaction.guildId ? null : cfg?.manager_role_id,
    };
    if (!isSupport(member, staff)) {
      await respond('Staff phụ trách mới có thể cập nhật lịch.');
      return;
    }
    const message = await interaction.channel.messages.fetch({ message: interaction.message.id, force: true });
    const contents = message.components.map(component => component.toJSON());
    const card = contents[0];
    const status = card?.components?.find(item => item.content?.startsWith('### Trạng thái\n'));
    const controls = card?.components?.find(item => item.components?.some(control => control.custom_id === interaction.customId));
    if (!status || !controls || message.author.id !== BOOKING_APP_ID || getTicketByChannelId(interaction.channelId)?.status !== 'OPEN') {
      await respond('Lịch đã được cập nhật. Hãy xem trạng thái mới nhất trong phiếu.');
      return;
    }
    status.content = `### Trạng thái\n${nextStates[action]}`;
    card.components = card.components.filter(item => item !== controls);
    if (action === 'confirm') card.components.push(stateButtons(ticket.id, portal.emoji, ['complete', 'decline']).toJSON());
    await message.edit({ components: contents, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    await respond(nextStates[action]);
  } finally {
    activeChanges.delete(id);
  }
}

async function askExtension(interaction, action, ticketId) {
  const reply = content => safeReply(interaction, { content, flags: MessageFlags.Ephemeral });
  const current = () => {
    const ticket = getTicketByChannelId(interaction.channelId);
    if (!ticket || ticket.guild_id !== STORE_TWO_GUILD_ID || ticket.ticket_type !== 'BOOKING'
      || ticket.status !== 'OPEN' || String(ticket.id) !== ticketId || ticket.customer_id !== interaction.user.id) return null;
    const booked = createBookingLedger(db).getSession(interaction.guildId, ticket.id);
    return booked?.status === 'ACTIVE' && booked.ends_at > Date.now() ? booked : null;
  };
  const session = current();
  if (!session) { await reply('Chỉ khách trong phiên đang diễn ra có thể yêu cầu gia hạn.'); return; }
  if (action === 'open' && interaction.isButton()) {
    await interaction.showModal(new ModalBuilder().setTitle('Yêu cầu gia hạn booking')
      .setCustomId(`booking:extension:submit:${ticketId}`).addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('minutes').setLabel('Số phút muốn gia hạn').setStyle(TextInputStyle.Short)
          .setRequired(true).setMinLength(1).setMaxLength(4),
      )));
  } else if (action === 'submit' && interaction.isModalSubmit()) {
    const raw = interaction.fields.getTextInputValue('minutes').trim();
    const minutes = Number(raw);
    if (!/^\d{1,4}$/.test(raw) || minutes < 1 || minutes > 1440) {
      await reply('Nhập số phút từ 1 đến 1440.'); return;
    }
    // The customer requests time only. Staff quotes the extension separately.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const key = `booking_extension_requested:${ticketId}:${session.ends_at}`;
    if (!db.prepare('INSERT OR IGNORE INTO system_settings (key,value) VALUES (?,?)').run(key, String(minutes)).changes) {
      await reply('Yêu cầu cho thời điểm kết thúc này đã có trong phiếu.'); return;
    }
    try {
      await interaction.channel.send({ content: `**Khách yêu cầu gia hạn ${minutes} phút.**\nStaff lấy xác nhận của host rồi dùng \`/cenar-booking gia-han\` để báo giá.`,
        allowedMentions: { parse: [] } });
    } catch (error) {
      db.prepare('DELETE FROM system_settings WHERE key=?').run(key);
      throw error;
    }
    await reply('Đã gửi yêu cầu. Hãy chờ xác nhận của staff trong phiếu.');
  }
}

export async function handleBookingInteraction(interaction) {
  if (!interaction.customId?.startsWith('booking:')) return false;
  const respond = content => safeReply(interaction, { content, flags: MessageFlags.Ephemeral });
  const portal = bookingPortal(interaction.client);
  if (interaction.guildId !== STORE_TWO_GUILD_ID || interaction.client.user?.id !== BOOKING_APP_ID || !portal) {
    await respond('Bảng Cenar Booking đang khởi tạo hoặc không khả dụng tại kênh này.');
    return true;
  }
  const [, operation, value, id] = interaction.customId.split(':');
  if (operation === 'community') {
    const { handleBookingCommunityInteraction } = await import('../commands/cenar-cong-dong.js');
    return handleBookingCommunityInteraction(interaction);
  }
  const guideChannel = interaction.channelId === portal.request || interaction.channelId === portal.handbook;
  if (operation === 'guide' && value === 'topic' && guideChannel && interaction.isStringSelectMenu()) {
    if (id !== interaction.user.id || !interaction.message?.flags?.has(MessageFlags.Ephemeral)
      || interaction.message.author?.id !== BOOKING_APP_ID) {
      await respond('Mở hướng dẫn của bạn trong cổng đặt lịch hoặc cẩm nang.');
    } else {
      const { flags, ...update } = bookingHelpCard({ userId: id, emoji: portal.emoji, topic: interaction.values[0] });
      await interaction.update(update);
    }
    return true;
  }
  if (operation === 'extension' && id) {
    await askExtension(interaction, value, id);
    return true;
  }
  if (operation === 'dashboard' && !id && interaction.isButton()) {
    if (value === 'help' && guideChannel) {
      await safeReply(interaction, bookingHelpCard({ userId: interaction.user.id, emoji: portal.emoji }));
    } else if (value === 'my' && interaction.channelId === portal.request) {
      const { showSessions } = await import('../commands/cenar-booking.js');
      await safeReply(interaction, bookingScheduleCard(interaction.guildId, portal,
        showSessions(createBookingLedger(db), interaction.guildId, interaction.user.id), true));
    } else await respond('Mở bảng đặt lịch mới nhất trong máy chủ.');
    return true;
  }
  if (operation === 'dashboard' && interaction.channelId === portal.request && !id && interaction.isButton()) {
    const { ledgerCard, showSessions } = await import('../commands/cenar-booking.js');
    if (value === 'my' || value === 'help') {
      const mine = value === 'my';
      await safeReply(interaction, { ...ledgerCard(mine ? 'Lịch của bạn' : 'Trợ giúp Cenar Booking', mine
        ? showSessions(createBookingLedger(db), interaction.guildId, interaction.user.id) : bookingHelp, portal.emoji.calendar),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    return true;
  }
  if (operation === 'state' && Object.hasOwn(nextStates, value) && interaction.isButton()) {
    await changeState(interaction, value, id, portal);
    return true;
  }
  const expectedChannel = value === 'apply' ? portal.apply : portal.request;
  if (!Object.hasOwn(bookingServices, value) || interaction.channelId !== expectedChannel || id) {
    await respond('Vui lòng mở bảng đặt lịch hoặc tuyển host mới nhất.');
    return true;
  }
  if (operation === 'open' && interaction.isButton()) {
    await interaction.showModal(bookingForm(value));
    return true;
  }
  if (operation !== 'form' || !interaction.isModalSubmit()) return true;
  const raw = key => interaction.fields.getTextInputValue(key).trim();
  const clean = key => escapeMarkdown(raw(key));
  let details, schedule;
  if (value === 'apply') {
    if (!raw('name') || !raw('skills') || !raw('availability')) {
      await respond('Nhập biệt danh, dịch vụ bạn nhận và giờ rảnh rồi gửi lại nhé.');
      return true;
    }
    details = `**Biệt danh** · ${clean('name')}\n**Nhóm hồ sơ** · ${clean('group') || 'Chưa chọn'}\n**Dịch vụ** · ${clean('skills')}\n**Giờ rảnh** · ${clean('availability')}`;
  } else {
    const start = parseBookingTime(raw('start'), Date.now() + 60_000);
    const duration = Number(raw('duration'));
    if (!start || !/^\d{1,4}$/.test(raw('duration')) || duration < 1 || duration > 1440 || (value === 'game' && !raw('details'))) {
      await respond('Chọn giờ sau ít nhất 1 phút theo dd/mm/yyyy HH:mm (UTC+7), thời lượng từ 1 đến 1440 phút và tên game nếu đặt phiên chơi game.');
      return true;
    }
    schedule = { startsAt: start * 1000, durationMinutes: duration };
    details = `**Host mong muốn**\n${clean('host') || 'Nhờ staff gợi ý'}\n\n**${value === 'game' ? 'Game và ghi chú' : 'Chủ đề và ghi chú'}**\n${clean('details') || 'Không có'}`;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await handleTicketCreate(interaction, value === 'apply' ? 'HOST_APPLICATION' : 'BOOKING', null, {
    booking: {
      title: bookingServices[value], categoryId: portal.tickets,
      render: ticket => bookingReceipt(ticket, value, details, portal.emoji, schedule),
    },
  });
  return true;
}
