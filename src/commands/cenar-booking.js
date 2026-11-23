import {
  ChannelType, ContainerBuilder, MessageFlags, SeparatorBuilder, SlashCommandBuilder, TextDisplayBuilder, formatEmoji,
} from 'discord.js';
import { db } from '../database/db.js';
import { createBookingLedger } from '../services/bookingLedgerService.js';
import { bookingReceiptPreview, createBookingReceiptService } from '../services/bookingReceiptService.js';
import { createBookingSelfService } from '../services/bookingSelfService.js';
import { BOOKING_APP_ID, bookingPortal } from '../services/bookingStoreSetupService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getTicketByChannelId } from '../services/ticketService.js';
import { createBookingVoiceStore } from '../services/bookingVoiceService.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { bookingScheduleCard } from '../utils/bookingPortalViews.js';
import { buildBookingReceiptCard } from '../utils/bookingReceiptViews.js';
import { isManager, isSupport } from '../utils/permissions.js';
import { addBookingTicketSection, bookingTicketCard, bookingTicketPayload, buildBookingBillReview, buildBookingFreeQuote } from '../utils/bookingTicketUi.js';

export const bookingOnly = true;

const hourlyPrice = option => option.setName('gia_gio').setDescription('Giá theo giờ, nhập 0 nếu miễn phí').setRequired(true).setMinValue(0);
const hourlyWage = option => option.setName('luong_gio').setDescription('Tiền công host theo giờ').setRequired(true).setMinValue(0);

export const data = new SlashCommandBuilder().setName('cenar-booking').setDescription('Lịch và vận hành Cenar Booking')
  .addSubcommand(cmd => cmd.setName('lich').setDescription('Xem các phiên booking của bạn'))
  .addSubcommand(cmd => cmd.setName('hoa-don').setDescription('Xem riêng hóa đơn đã lưu của một phiếu booking')
    .addStringOption(o => o.setName('ma_phieu').setDescription('Để trống khi đang trong phiếu').setMaxLength(32))
    .addIntegerOption(o => o.setName('so_hoa_don').setDescription('Số hóa đơn cụ thể, mặc định là hóa đơn mới nhất').setMinValue(1)))
  .addSubcommand(cmd => cmd.setName('mau-hoa-don').setDescription('Quản lý xem mẫu hóa đơn Booking, nạp, ủng hộ hoặc hoàn tiền')
    .addStringOption(o => o.setName('loai').setDescription('Chọn mẫu').setRequired(true).addChoices(
      { name: 'Booking', value: 'BOOKING' }, { name: 'Nạp tiền', value: 'DEPOSIT' },
      { name: 'Ủng hộ', value: 'DONATION' }, { name: 'Hoàn tiền', value: 'REFUND' })))
  .addSubcommand(cmd => cmd.setName('mo-ca').setDescription('Quản lý mở ca tự đặt sau khi host đồng ý')
    .addUserOption(o => o.setName('host').setDescription('Host đã duyệt hồ sơ và đồng ý giờ lẫn giá').setRequired(true))
    .addStringOption(o => o.setName('dich_vu').setDescription('Dịch vụ của ca').setRequired(true).addChoices(
      { name: 'Chơi game', value: 'game' }, { name: 'Trò chuyện', value: 'voice' }))
    .addStringOption(o => o.setName('gio').setDescription('Giờ Việt Nam, dd/mm/yyyy HH:mm').setRequired(true).setMaxLength(18))
    .addIntegerOption(o => o.setName('phut').setDescription('Thời lượng cố định của ca').setRequired(true).setMinValue(1).setMaxValue(1440))
    .addIntegerOption(hourlyPrice).addIntegerOption(hourlyWage))
  .addSubcommand(cmd => cmd.setName('dong-ca').setDescription('Quản lý đóng ca tự đặt, phiên đã giữ tiếp tục được theo dõi')
    .addIntegerOption(o => o.setName('ma_ca').setDescription('Mã ca đã hiển thị khi mở').setRequired(true).setMinValue(1)))
  .addSubcommand(cmd => cmd.setName('phan-host').setDescription('Gán host cho phiếu booking này')
    .addUserOption(o => o.setName('host').setDescription('Host đã đồng ý nhận lịch').setRequired(true)))
  .addSubcommand(cmd => cmd.setName('bao-gia').setDescription('Gửi báo giá và QR trong phiếu booking này')
    .addIntegerOption(hourlyPrice).addIntegerOption(hourlyWage))
  .addSubcommand(cmd => cmd.setName('gia-han').setDescription('Báo giá gia hạn phiên đang diễn ra')
    .addIntegerOption(o => o.setName('phut').setDescription('Số phút gia hạn').setRequired(true).setMinValue(1).setMaxValue(1440))
    .addIntegerOption(hourlyPrice).addIntegerOption(hourlyWage))
  .addSubcommand(cmd => cmd.setName('kiem-tra-bill').setDescription('Đối chiếu hóa đơn booking với PayOS'))
  .addSubcommand(cmd => cmd.setName('tu-choi').setDescription('Từ chối lịch chưa có hóa đơn thanh toán'))
  .addSubcommand(cmd => cmd.setName('ket-thuc').setDescription('Xác nhận hoàn thành một phiên đã diễn ra'))
  .addSubcommand(cmd => cmd.setName('bao-cao').setDescription('Xem báo cáo doanh thu và lương host trong 7 ngày gần nhất'))
  .addSubcommand(cmd => cmd.setName('nhap-icon').setDescription('Nhập emoji hoặc sticker từ tệp bạn có quyền sử dụng')
    .addStringOption(o => o.setName('loai').setDescription('Loại biểu tượng').setRequired(true)
      .addChoices({ name: 'Emoji custom', value: 'emoji' }, { name: 'Sticker', value: 'sticker' }))
    .addStringOption(o => o.setName('ten').setDescription('Tên từ 2–30 ký tự, chữ Latin, số hoặc dấu gạch dưới').setRequired(true))
    .addAttachmentOption(o => o.setName('tep').setDescription('PNG, JPG, WebP hoặc GIF đã tải lên Discord, tối đa 512 KB').setRequired(true))
    .addStringOption(o => o.setName('bieu_tuong').setDescription('Emoji Unicode đi kèm nếu tạo sticker').setMaxLength(8)))
  .addSubcommand(cmd => cmd.setName('hoi').setDescription('Hỏi về Cenar Booking hoặc yêu cầu số liệu được cấp quyền')
    .addStringOption(o => o.setName('cau_hoi').setDescription('Câu hỏi, ví dụ Tổng doanh thu tuần này?').setRequired(true).setMaxLength(200)));

const statusLabels = { REQUESTED: 'Chờ xếp host', CONFIRMED: 'Đã xếp host', ACTIVE: 'Đang diễn ra',
  COMPLETED: 'Đã hoàn thành', DECLINED: 'Đã từ chối', NEEDS_REVIEW: 'Chờ staff kiểm tra' };
const time = ms => `<t:${Math.floor(ms / 1000)}:f>`;

export function ledgerCard(title, lines, emoji) {
  const icon = emoji?.id ? `${formatEmoji(emoji.id, emoji.animated)} ` : '';
  const card = new ContainerBuilder().setAccentColor(0x556ed5)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon}${title}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
  return { flags: MessageFlags.IsComponentsV2, components: [card], allowedMentions: { parse: [] } };
}

export function showSessions(ledger, guildId, userId) {
  const owned = [ledger.listSessions(guildId, { customerId: userId, limit: 8 }), ledger.listSessions(guildId, { hostId: userId, limit: 8 })];
  const unique = new Map(owned.flat().map(session => [session.ticket_id, session]));
  if (!unique.size) return ['Bạn chưa có phiên booking nào. Mở kênh đặt lịch để gửi yêu cầu.'];
  const voice = createBookingVoiceStore(db);
  return [...unique.values()].sort((a, b) => b.starts_at - a.starts_at).slice(0, 8).map(session => {
    const room = session.status === 'ACTIVE' ? voice.get(session.ticket_id) : null;
    const link = room?.room_id && !room.released ? ` · <#${room.room_id}>`
      : session.customer_id === userId ? ` · <#${session.ticket_channel_id}>` : '';
    return `**${session.service === 'game' ? 'Chơi game' : 'Trò chuyện'} · ${statusLabels[session.status]}**\n${time(session.starts_at)} · ${session.duration_minutes} phút${link}`;
  });
}

function requirePrivateTicket(interaction) {
  const ticket = getTicketByChannelId(interaction.channelId);
  if (ticket?.status !== 'OPEN' || ticket.ticket_type !== 'BOOKING' || ticket.guild_id !== interaction.guildId
    || interaction.channel?.type !== ChannelType.GuildText || interaction.channel.permissionsFor(interaction.guild.roles.everyone)?.has('ViewChannel') !== false) {
    throw Object.assign(new Error('Phiếu không hợp lệ'), { code: 'BOOKING_PRIVATE_TICKET_REQUIRED' });
  }
  return ticket;
}

const userErrors = {
  BOOKING_PRIVATE_TICKET_REQUIRED: 'Mở lệnh này bên trong phiếu booking riêng đang mở.',
  BOOKING_PAYMENTS_DISABLED: 'Thanh toán booking chưa được bật. Staff có thể dùng báo giá 0đ để chạy phiên miễn phí.',
  BOOKING_NOT_FOUND: 'Phiếu này chưa có lịch trong hệ thống. Mở yêu cầu mới từ bảng đặt lịch để dùng các chức năng tự động.',
  HOST_UNAVAILABLE: 'Host này đã có phiên trùng giờ. Hãy chọn host khác hoặc chốt giờ khác với khách.',
};

export async function execute(interaction) {
  const portal = bookingPortal(interaction.client);
  if (interaction.guildId !== STORE_TWO_GUILD_ID || interaction.client.user?.id !== BOOKING_APP_ID || !portal) {
    await interaction.reply({ content: 'Lệnh này chỉ hoạt động tại Cenar Booking.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  const actorId = interaction.user.id;
  const operation = interaction.options.getSubcommand();
  const ledger = createBookingLedger(db);
  if (operation === 'lich') {
    await interaction.editReply(bookingScheduleCard(guildId, portal, showSessions(ledger, guildId, actorId)));
    return;
  }
  const member = await interaction.guild.members.fetch({ user: actorId, force: true });
  const cfg = getGuildConfig(guildId);
  const roles = {
    manager_role_id: cfg?.manager_role_id === guildId ? null : cfg?.manager_role_id,
    support_role_id: cfg?.support_role_id === guildId ? null : cfg?.support_role_id,
  };
  const manager = isManager(member, roles);
  if (operation === 'hoa-don') {
    const code = interaction.options.getString('ma_phieu')?.trim();
    const reference = code && /^[A-Za-z0-9_-]{1,32}$/u.test(code)
      ? db.prepare('SELECT id FROM tickets WHERE guild_id=? AND ticket_code=? AND ticket_type=\'BOOKING\'').get(guildId, code.toUpperCase())
      : code ? null : getTicketByChannelId(interaction.channelId);
    const receipt = reference && createBookingReceiptService(db).getForTicket({ guildId, ticketId: reference.id, viewerId: actorId,
      canManage: manager, invoiceId: interaction.options.getInteger('so_hoa_don') ?? undefined });
    if (!receipt) { await interaction.editReply('Không tìm thấy hóa đơn mà bạn có quyền xem. Nhập mã phiếu hoặc dùng lệnh trong phiếu.'); return; }
    await interaction.editReply(await buildBookingReceiptCard({ ...receipt, emoji: portal.emoji.calendar, ephemeral: false }));
    return;
  }
  if (['mau-hoa-don', 'mo-ca', 'dong-ca'].includes(operation)) {
    if (!manager) { await interaction.editReply('Chỉ quản lý Cenar Booking có thể dùng lệnh này.'); return; }
    if (operation === 'mau-hoa-don') {
      const sample = bookingReceiptPreview(interaction.options.getString('loai', true));
      await interaction.editReply(await buildBookingReceiptCard({ ...sample, emoji: portal.emoji.calendar, ephemeral: false }));
      return;
    }
    try {
      const selfService = createBookingSelfService(db);
      if (operation === 'dong-ca') {
        const closed = selfService.closeSlot({ guildId, actorId, slotId: interaction.options.getInteger('ma_ca', true) });
        await interaction.editReply(closed ? 'Đã đóng ca để dừng nhận đặt mới.' : 'Ca không tồn tại hoặc đã đóng.');
        return;
      }
      const host = interaction.options.getUser('host', true);
      const { parseBookingTime } = await import('../events/bookingHandlers.js');
      const start = parseBookingTime(interaction.options.getString('gio', true), Date.now() + 60_000);
      if (!start || host.bot) { await interaction.editReply('Chọn host thật và nhập giờ tương lai theo dd/mm/yyyy HH:mm (giờ Việt Nam).'); return; }
      await interaction.guild.members.fetch({ user: host.id, force: true });
      const slot = selfService.addSlot({ guildId, actorId, hostId: host.id, startsAt: start * 1000,
        service: interaction.options.getString('dich_vu', true), durationMinutes: interaction.options.getInteger('phut', true),
        hourlyPrice: interaction.options.getInteger('gia_gio', true), hourlyWage: interaction.options.getInteger('luong_gio', true) });
      const { bookingPayosAvailable } = await import('../services/bookingPaymentService.js');
      const detail = slot.amount > 0 && !bookingPayosAvailable(guildId) ? '\nCa có phí sẽ xuất hiện khi PayOS Booking của Store 2 sẵn sàng.' : '';
      await interaction.editReply(`Đã mở ca **#${slot.id}** · ${time(slot.startsAt)} · ${slot.durationMinutes} phút.${detail}`);
    } catch (error) {
      console.warn('[BOOKING-SLOT]', operation, error.code || error.name);
      await interaction.editReply(error.name === 'BookingLedgerError' ? error.message : 'Không thể cập nhật ca. Kiểm tra host và thử lại.');
    }
    return;
  }
  if (operation === 'hoi') {
    const { answerBookingQuestion } = await import('../services/bookingReportService.js');
    const result = await answerBookingQuestion(ledger, interaction.options.getString('cau_hoi', true), manager);
    await interaction.editReply(ledgerCard('Trợ lý Cenar Booking', result, portal.emoji.calendar));
    return;
  }
  if (!isSupport(member, roles)) {
    await interaction.editReply('Chỉ staff có thể vận hành phiên booking. Dùng `/cenar-booking lich` để xem lịch của bạn.');
    return;
  }
  try {
    if (operation === 'nhap-icon') {
      if (!member.permissions.has('ManageGuildExpressions')) {
        await interaction.editReply('Bạn cần quyền quản lý biểu tượng của máy chủ.'); return;
      }
      const { importBookingExpression } = await import('../services/bookingExpressions.js');
      const icon = await importBookingExpression(interaction.guild, { kind: interaction.options.getString('loai', true),
        name: interaction.options.getString('ten', true), attachment: interaction.options.getAttachment('tep', true),
        tag: interaction.options.getString('bieu_tuong') || '⭐' });
      await interaction.editReply(`Đã thêm **${icon.name}** vào Cenar Booking.`);
      return;
    }
    if (operation === 'bao-cao') {
      if (!manager) { await interaction.editReply('Báo cáo lương chỉ hiển thị cho quản lý.'); return; }
      const { getBookingReport } = await import('../services/bookingReportService.js');
      const [summary, amounts, ...hosts] = getBookingReport(ledger);
      const report = bookingTicketCard({ section: 'BÁO CÁO QUẢN LÝ', title: 'Kết quả 7 ngày', subtitle: summary, emoji: portal.emoji.calendar });
      addBookingTicketSection(report, `### Doanh thu và tiền công\n${amounts}`);
      if (hosts.length) addBookingTicketSection(report, `### Theo host\n${hosts.join('\n\n')}`);
      await interaction.editReply(bookingTicketPayload(report));
      return;
    }
    const ticket = requirePrivateTicket(interaction);
    const ticketId = ticket.id;
    if (!ledger.getSession(guildId, ticketId)) throw Object.assign(new Error('Phiếu cũ'), { code: 'BOOKING_NOT_FOUND' });
    if (operation === 'tu-choi') {
      ledger.declineSession({ guildId, ticketId, actorId });
      await interaction.editReply('Đã đánh dấu không nhận lịch. Khách có thể xem trạng thái trong `/cenar-booking lich`.');
      return;
    }
    if (operation === 'ket-thuc') {
      ledger.completeSession({ guildId, ticketId, actorId });
      await interaction.editReply('Đã xác nhận phiên diễn ra. Khách có thể đánh giá bằng `/cenar-ho-so danh-gia`.');
      return;
    }
    if (operation === 'phan-host') {
      const host = interaction.options.getUser('host', true);
      if (host.bot || host.id === ticket.owner_id || host.id === ticket.customer_id) {
        await interaction.editReply('Chọn một host là thành viên khác với người gửi phiếu.');
        return;
      }
      await interaction.guild.members.fetch({ user: host.id, force: true });
      ledger.assignHost({ guildId, ticketId, hostId: host.id, actorId });
      await interaction.editReply({ content: `Đã gán <@${host.id}> cho phiên. Tiếp theo, dùng \`/cenar-booking bao-gia\` để gửi báo giá.`, allowedMentions: { parse: [] } });
      return;
    }
    const { quoteBooking, syncBookingBills } = await import('../services/bookingPaymentService.js');
    if (operation === 'kiem-tra-bill') {
      const items = await syncBookingBills({ interaction, ledger, ticketId });
      await interaction.editReply(buildBookingBillReview(items, ticket.ticket_code, portal.emoji.calendar));
      return;
    }
    const extending = operation === 'gia-han';
    const invoice = await quoteBooking({ interaction, ledger, ticketId,
      hourlyPrice: interaction.options.getInteger('gia_gio', true), hourlyWage: interaction.options.getInteger('luong_gio', true),
      durationMinutes: extending ? interaction.options.getInteger('phut', true) : null,
    });
    if (invoice.status === 'FREE') {
      await interaction.channel.send(buildBookingFreeQuote(invoice, ticket.ticket_code, portal.emoji.calendar));
    }
    await interaction.editReply('Đã cập nhật báo giá trong phiếu.');
  } catch (error) {
    console.warn('[BOOKING-COMMAND]', operation, error.code || error.name);
    await interaction.editReply(userErrors[error.code] || 'Không thể thực hiện thao tác trên lịch hoặc hóa đơn hiện tại. Kiểm tra trạng thái bằng `/cenar-booking lich`.');
  }
}
