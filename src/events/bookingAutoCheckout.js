import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags,
  StringSelectMenuBuilder, escapeMarkdown,
} from 'discord.js';
import { db } from '../database/db.js';
import { BookingLedgerError } from '../services/bookingLedgerService.js';
import { bookingPayosAvailable, createBookingPaymentOrder } from '../services/bookingPaymentService.js';
import { createBookingSelfService } from '../services/bookingSelfService.js';
import { sendOrRefreshPaymentQr } from '../services/paymentService.js';
import { getOpenTicketByCustomer, getTicketByChannelId } from '../services/ticketService.js';
import { BOOKING_PANEL_IDS } from '../utils/bookingPortalViews.js';
import { addBookingTicketSection, bookingTicketCard, bookingTicketPayload } from '../utils/bookingTicketUi.js';
import { formatCurrency } from '../utils/formatters.js';
import { safeReply } from './shared.js';
import { handleTicketCreate } from './ticketHandlers.js';

const controls = /^booking:auto:(list|select|confirm):(\d{17,20})(?::([1-9]\d{0,14}))?$/u;
const resumeControl = /^booking:auto:resume:([1-9]\d{0,14})$/u;
const slotNumber = value => /^[1-9]\d{0,14}$/u.test(value ?? '') ? Number(value) : null;
const localTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
const mode = service => service === 'game' ? 'Chơi game' : 'Trò chuyện';
const timestamp = ms => `<t:${Math.floor(ms / 1000)}:f>`;
const describeSlot = slot => `**${escapeMarkdown(slot.hostName)}** · ${mode(slot.service)}\n${timestamp(slot.startsAt)} · ${slot.durationMinutes} phút\n**Tổng cộng** · ${formatCurrency(slot.amount)}`;
const privatePayload = card => ({ ...bookingTicketPayload(card), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
const action = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const button = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji?.id) button.setEmoji(emoji);
  return button;
};

function showSlots(slots, userId, emoji) {
  const card = bookingTicketCard({ section: 'ĐẶT LỊCH TỰ ĐỘNG', title: 'Chọn giờ cùng host',
    subtitle: 'Giờ Việt Nam · Lịch do ban vận hành mở', emoji });
  if (!slots.length) {
    addBookingTicketSection(card, 'Chưa có ca tự đặt đang mở. Chọn **Chơi game** hoặc **Voice** trên bảng đặt lịch để gửi yêu cầu cho staff.');
    return privatePayload(card);
  }
  const menu = new StringSelectMenuBuilder().setCustomId(`booking:auto:select:${userId}`)
    .setPlaceholder('Chọn một ca để xem giá và xác nhận')
    .addOptions(slots.map(slot => ({ value: String(slot.id), label: `${slot.hostName} · ${mode(slot.service)}`.slice(0, 100),
      description: `${localTime.format(slot.startsAt)} · ${slot.durationMinutes} phút · ${formatCurrency(slot.amount)}`.slice(0, 100),
    })));
  card.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return privatePayload(card);
}

function showQuote(slot, userId, emoji) {
  const card = bookingTicketCard({ section: 'KIỂM TRA LỊCH', title: 'Xác nhận ca của bạn', emoji });
  addBookingTicketSection(card, describeSlot(slot));
  addBookingTicketSection(card, slot.amount > 0
    ? 'Sau khi giữ chỗ, mở QR PayOS trong phiếu và thanh toán trong thời hạn hiển thị. Bot xác nhận ca sau khi đối soát.'
    : 'Ca miễn phí được xác nhận khi giữ chỗ. Phòng riêng sẽ xuất hiện trong phiếu khi đến giờ.');
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    action(`booking:auto:confirm:${userId}:${slot.id}`, 'Xác nhận giữ chỗ', ButtonStyle.Primary, emoji),
    action(`booking:auto:list:${userId}`, 'Chọn ca khác'),
  ));
  return privatePayload(card);
}

function privateTicket(channel, interaction, ticket) {
  return channel?.type === ChannelType.GuildText && channel.guildId === interaction.guildId
    && channel.id === ticket.channel_id && ticket.customer_id === interaction.user.id
    && channel.permissionsFor(interaction.guild.roles.everyone)?.has('ViewChannel') === false;
}

async function sendInvoice(interaction, paymentAvailable, reservation) {
  const invoice = reservation.invoice;
  if (paymentAvailable && invoice.status === 'PENDING' && invoice.order_code
    && reservation.checkoutExpiresAt > Date.now()) {
    await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode: invoice.order_code });
    return true;
  }
  return false;
}

async function reserve(interaction, portal, service, initialSlot, paymentAvailable) {
  const guildId = interaction.guildId;
  const customerId = interaction.user.id;
  const existing = getOpenTicketByCustomer(guildId, customerId, 'BOOKING');
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
    if (privateTicket(channel, interaction, existing)) {
      const current = service.getReservation({ guildId, ticketId: existing.id, customerId });
      if (current?.slot.id === initialSlot.id) await sendInvoice(interaction, paymentAvailable, current);
      await interaction.editReply(`Bạn đã có phiếu Booking đang mở tại ${channel}. Hãy theo dõi lịch và hóa đơn trong phiếu.`);
      return;
    }
  }
  let reservation;
  let failure;
  await handleTicketCreate(interaction, 'BOOKING', null, { booking: {
    title: 'Đặt lịch tự động', categoryId: portal.tickets,
    render(ticket) {
      try {
        reservation = service.reserveSlot({ guildId, slotId: initialSlot.id, ticketId: ticket.id, customerId,
          requestId: interaction.id, paymentAvailable,
          createPaymentOrder: createBookingPaymentOrder(guildId, ticket.id, customerId),
        });
      } catch (error) {
        if (!(error instanceof BookingLedgerError)) throw error;
        failure = error.message;
      }
      const card = bookingTicketCard({ section: 'PHIẾU RIÊNG',
        title: failure ? 'Ca chưa được giữ' : reservation.invoice.status === 'FREE' ? 'Ca đã xác nhận' : 'Ca đang chờ thanh toán',
        subtitle: `Mã phiếu \`${ticket.ticket_code}\``, emoji: portal.emoji.calendar });
      addBookingTicketSection(card, failure ?? describeSlot(reservation.slot));
      addBookingTicketSection(card, failure ? 'Staff có thể trao đổi về giờ khác trong phiếu này.'
        : reservation.invoice.status === 'FREE' ? 'Bot gửi phòng riêng khi tới giờ. Mở `/cenar-booking hoa-don` để xem phiếu miễn phí.'
          : 'Quét QR trong phiếu trước khi hết hạn. Dùng nút bên dưới nếu cần mở lại hóa đơn.');
      if (reservation?.invoice.status === 'PENDING') {
        card.addActionRowComponents(new ActionRowBuilder().addComponents(
          action(`booking:auto:resume:${ticket.id}`, 'Mở lại QR', ButtonStyle.Secondary, portal.emoji.calendar),
        ));
      }
      return { container: card, flags: MessageFlags.IsComponentsV2 };
    },
  } });
  if (reservation) await sendInvoice(interaction, paymentAvailable, reservation);
}

export async function handleBookingAutoCheckout(interaction, portal, { createService = () => createBookingSelfService(db) } = {}) {
  const reject = content => safeReply(interaction, { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const launch = interaction.customId === 'booking:dashboard:auto';
  const resume = resumeControl.exec(interaction.customId);
  const control = controls.exec(interaction.customId);
  const operation = control?.[1];
  const customerId = interaction.user.id;
  const message = interaction.message;
  const ownMessage = message?.author?.id === interaction.client.user.id;
  if (resume) {
    const ticket = getTicketByChannelId(interaction.channelId);
    if (!ownMessage || !interaction.isButton() || ticket?.id !== Number(resume[1]) || ticket.ticket_type !== 'BOOKING'
      || ticket.status !== 'OPEN' || !privateTicket(interaction.channel, interaction, ticket)) {
      await reject('Chủ phiếu có thể mở lại QR từ phiếu Booking riêng đang mở.');
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const reservation = createService().getReservation({ guildId: interaction.guildId, customerId, ticketId: ticket.id });
      const sent = reservation && await sendInvoice(interaction, bookingPayosAvailable(interaction.guildId), reservation);
      await interaction.editReply(sent ? 'Đã cập nhật hóa đơn trong phiếu.'
        : 'Ca này hiện không có QR còn hạn. Xem trạng thái bằng `/cenar-booking hoa-don`.');
    } catch (error) {
      console.warn('[BOOKING-AUTO-QR]', error.code || error.name);
      await interaction.editReply('Chưa mở được QR. Kiểm tra trạng thái hóa đơn trước khi thử lại.');
    }
    return true;
  }
  const allowedSource = launch
    ? interaction.isButton() && message?.components?.some(component => (component.id ?? component.data?.id) === BOOKING_PANEL_IDS.request)
    : control?.[2] === customerId && message?.flags?.has(MessageFlags.Ephemeral)
      && (operation === 'select' ? interaction.isStringSelectMenu() : interaction.isButton());
  if (interaction.channelId !== portal.request || !ownMessage || !allowedSource) {
    await reject('Mở bảng đặt lịch của bạn tại Cenar Booking.');
    return true;
  }
  const guildId = interaction.guildId;
  const paymentAvailable = bookingPayosAvailable(guildId);
  const service = createService();
  const emoji = portal.emoji.calendar;
  const input = { guildId, customerId, paymentAvailable };
  try {
    if (launch || operation === 'list') {
      await interaction.reply(showSlots(service.listSlots({ ...input, limit: 20 }), customerId, emoji));
      return true;
    }
    const slotId = slotNumber(operation === 'select' ? interaction.values?.[0] : control?.[3]);
    if (!slotId) {
      await reject('Ca không hợp lệ. Mở lại danh sách để kiểm tra giờ mới.');
      return true;
    }
    if (operation === 'select') {
      await interaction.reply(showQuote(service.quoteSlot({ ...input, slotId }), customerId, emoji));
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      // A retained quote can reopen its existing invoice after a timed-out Discord or PayOS send.
      const existing = getOpenTicketByCustomer(guildId, customerId, 'BOOKING');
      const current = existing && service.getReservation({ guildId, ticketId: existing.id, customerId });
      const selected = current?.slot.id === slotId ? current.slot : service.quoteSlot({ ...input, slotId });
      await reserve(interaction, portal, service, selected, paymentAvailable);
    }
  } catch (error) {
    if (!(error instanceof BookingLedgerError)) console.warn('[BOOKING-AUTO]', error.code || error.name);
    const content = error instanceof BookingLedgerError ? error.message
      : 'Không thể hoàn tất thao tác. Nếu đã có phiếu, kiểm tra trong phiếu trước khi thử lại.';
    await reject(content);
  }
  return true;
}
