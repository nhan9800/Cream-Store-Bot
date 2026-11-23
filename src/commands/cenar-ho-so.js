import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { isManager, isSupport } from '../utils/permissions.js';
import { BOOKING_APP_ID, bookingPortal } from '../services/bookingStoreSetupService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { BookingProfileError, createBookingProfileService } from '../services/bookingProfileService.js';
import { bookingProfileServices, bookingProfileText, buildBookingProfileResponse, hostNumber, publishBookingHost,
  publishBookingReview, unpublishBookingHost, withBookingHostUpdate } from '../services/bookingProfilePublication.js';

export const bookingOnly = true;
const privateReply = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const hostOption = option => option.setName('host').setDescription('Chọn thành viên sở hữu hồ sơ').setRequired(true);
const ticketOption = option => option.setName('phieu').setDescription('Mã phiếu ở đầu ticket booking').setRequired(true).setMaxLength(32);

export const data = new SlashCommandBuilder()
  .setName('cenar-ho-so').setDescription('Hồ sơ host và đánh giá phiên Cenar Booking')
  .addSubcommand(command => command.setName('gui-ban-nhap').setDescription('Gửi mới hoặc sửa hồ sơ của bạn để staff duyệt')
    .addStringOption(o => o.setName('biet_danh').setDescription('Tên hiển thị trên hồ sơ').setMaxLength(40).setRequired(true))
    .addStringOption(o => o.setName('gioi_thieu').setDescription('Một câu giới thiệu với khách').setMaxLength(120).setRequired(true))
    .addStringOption(o => o.setName('dich_vu').setDescription('Dịch vụ bạn nhận').setRequired(true)
      .addChoices(...Object.entries(bookingProfileServices).map(([value, name]) => ({ value, name }))))
    .addStringOption(o => o.setName('chu_de').setDescription('Game hoặc chủ đề bạn nhận').setMaxLength(150).setRequired(true))
    .addStringOption(o => o.setName('gio_ranh').setDescription('Khung giờ bạn thường rảnh theo giờ Việt Nam').setMaxLength(120).setRequired(true))
    .addBooleanOption(o => o.setName('dong_y').setDescription('Đồng ý cho staff đăng hồ sơ này vào forum Cenar').setRequired(true)))
  .addSubcommand(command => command.setName('xem-ban-nhap').setDescription('Xem bản nháp của bạn hoặc xem với quyền staff')
    .addUserOption(o => o.setName('host').setDescription('Bỏ trống để xem bản nháp của bạn')))
  .addSubcommand(command => command.setName('duyet').setDescription('Staff duyệt và đăng đúng phiên bản bản nháp')
    .addUserOption(hostOption)
    .addIntegerOption(o => o.setName('phien_ban').setDescription('Số phiên bản thấy trong bản nháp').setMinValue(1).setRequired(true)))
  .addSubcommand(command => command.setName('lam-moi').setDescription('Staff cập nhật mẫu thẻ và điểm cho hồ sơ đã duyệt')
    .addUserOption(hostOption))
  .addSubcommand(command => command.setName('an-ho-so').setDescription('Rút đồng ý và gỡ hồ sơ công khai của bạn'))
  .addSubcommand(command => command.setName('mau-the').setDescription('Quản lý đổi tiêu đề và màu nhấn trên thẻ host')
    .addStringOption(o => o.setName('tieu_de').setDescription('Tiêu đề trên thẻ').setMaxLength(40).setRequired(true))
    .addStringOption(o => o.setName('mau').setDescription('Mã màu HEX, ví dụ #8176e9').setMinLength(7).setMaxLength(7).setRequired(true)))
  .addSubcommand(command => command.setName('danh-gia').setDescription('Đánh giá riêng một phiên booking đã hoàn thành')
    .addStringOption(ticketOption)
    .addIntegerOption(o => o.setName('diem').setDescription('Điểm từ 1 đến 5').setMinValue(1).setMaxValue(5).setRequired(true))
    .addStringOption(o => o.setName('nhan_xet').setDescription('Nhận xét, không nhập thông tin liên hệ').setMaxLength(400))
    .addBooleanOption(o => o.setName('dong_y').setDescription('Cho phép staff xem và đăng nhận xét ẩn danh lên forum')))
  .addSubcommand(command => command.setName('xem-danh-gia').setDescription('Staff xem nhận xét khách đã đồng ý công khai')
    .addStringOption(ticketOption))
  .addSubcommand(command => command.setName('dang-danh-gia').setDescription('Staff đăng nhận xét ẩn danh đã được khách cho phép')
    .addStringOption(ticketOption));

async function assertStaff(interaction, managerOnly) {
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  const cfg = getGuildConfig(interaction.guildId);
  const roles = {
    manager_role_id: cfg?.manager_role_id === interaction.guildId ? null : cfg?.manager_role_id,
    support_role_id: cfg?.support_role_id === interaction.guildId ? null : cfg?.support_role_id,
  };
  if (!(managerOnly ? isManager(member, roles) : isSupport(member, roles))) {
    throw new BookingProfileError('Bạn chưa có quyền để thực hiện thao tác này.');
  }
}

function draftSummary(profile, saved = false) {
  if (!profile) throw new BookingProfileError('Chưa có bản nháp hồ sơ.');
  const { name, tagline, service, games, availability, consent } = profile.draft;
  return {
    title: saved ? 'Đã lưu bản nháp' : `Bản nháp v${profile.draft_revision}`,
    detail: saved ? `Phiên bản v${profile.draft_revision}` : undefined,
    sections: [
      `**${bookingProfileText(name)}**\n${bookingProfileText(tagline)}`,
      `### ${bookingProfileServices[service]}\n${bookingProfileText(games)}\n\n**Giờ thường rảnh**\n${bookingProfileText(availability)} (UTC+7)`,
      consent ? '**Quyền công khai**\nCó thể đăng sau khi staff duyệt.' : '**Quyền công khai**\nBản nháp riêng tư.',
    ],
  };
}

function ticketId(guildId, code) {
  const ticket = db.prepare(`SELECT id FROM tickets WHERE guild_id=? AND ticket_code=? AND ticket_type='BOOKING'`)
    .get(guildId, code.trim().toUpperCase());
  if (!ticket) throw new BookingProfileError('Không tìm thấy phiên booking đủ điều kiện.');
  return ticket.id;
}

export async function execute(interaction) {
  const portal = bookingPortal(interaction.client);
  if (interaction.guildId !== STORE_TWO_GUILD_ID || interaction.client.user?.id !== BOOKING_APP_ID || !portal) {
    await interaction.reply({ ...privateReply, content: 'Lệnh này dùng tại Cenar Booking sau khi bot khởi tạo.' });
    return;
  }
  await interaction.deferReply({ flags: privateReply.flags });
  const reply = card => interaction.editReply(buildBookingProfileResponse(card));
  const { guild, guildId, options, user } = interaction;
  const action = options.getSubcommand();
  const profiles = createBookingProfileService(db);
  const value = key => options.getString(key, true);
  try {
    if (action === 'gui-ban-nhap') {
      const profile = await withBookingHostUpdate(user.id, () => profiles.saveDraft(user.id, {
        name: value('biet_danh'), tagline: value('gioi_thieu'), service: value('dich_vu'), games: value('chu_de'),
        availability: value('gio_ranh'), consent: options.getBoolean('dong_y', true),
      }));
      await reply(draftSummary(profile, true));
      return;
    }
    if (action === 'xem-ban-nhap') {
      const hostId = options.getUser('host')?.id ?? user.id;
      if (hostId !== user.id) await assertStaff(interaction);
      await reply(draftSummary(profiles.get(hostId)));
      return;
    }
    if (action === 'mau-the') {
      await assertStaff(interaction, true);
      profiles.setTemplate(value('tieu_de'), value('mau'));
      await reply({ title: 'Đã lưu mẫu thẻ', detail: 'Dùng `/cenar-ho-so lam-moi` để áp dụng vào một thẻ đã đăng.' });
      return;
    }
    if (action === 'duyet' || action === 'lam-moi') {
      await assertStaff(interaction);
      const host = options.getUser('host', true);
      const published = await withBookingHostUpdate(host.id, async () => {
        const profile = action === 'duyet' ? profiles.approve(host.id, options.getInteger('phien_ban', true)) : profiles.get(host.id);
        if (!profile?.approved) throw new BookingProfileError('Chưa có hồ sơ đã duyệt.');
        const thread = await publishBookingHost({ guild, portal, profile, rating: profiles.ratingFor(host.id), template: profiles.getTemplate() });
        profiles.setHostThread(host.id, thread.id);
        return { thread, profile };
      });
      await reply({ title: 'Hồ sơ đã cập nhật', detail: `[Mở hồ sơ #${hostNumber(published.profile.profile_number)}](${published.thread.url})` });
      return;
    }
    if (action === 'an-ho-so') {
      const changed = await withBookingHostUpdate(user.id, async () => {
        const profile = profiles.get(user.id);
        if (profile?.approved) await unpublishBookingHost({ guild, portal, profile });
        return profiles.hide(user.id);
      });
      await reply(changed ? { title: 'Hồ sơ đã ẩn', detail: 'Quyền công khai của hồ sơ đã được thu hồi.' } : { title: 'Bạn chưa có hồ sơ Cenar' });
      return;
    }
    const code = value('phieu');
    if (action === 'danh-gia') {
      const { createBookingLedger } = await import('../services/bookingLedgerService.js');
      const session = createBookingLedger(db).getSession(guildId, ticketId(guildId, code));
      const review = profiles.createReview(session, user.id, {
        rating: options.getInteger('diem', true), feedback: options.getString('nhan_xet'), consent: options.getBoolean('dong_y'),
      });
      await reply({ title: `Đã ghi nhận ${review.rating}/5`, detail: review.consent
        ? 'Staff có thể duyệt để đăng nhận xét ẩn danh.' : 'Nhận xét của bạn được lưu riêng.' });
      return;
    }
    await assertStaff(interaction);
    const id = ticketId(guildId, code);
    const review = profiles.getReview(id);
    if (!review?.consent) throw new BookingProfileError('Chưa có nhận xét được khách cho phép đăng.');
    if (action === 'xem-danh-gia') {
      await reply({ title: `Đánh giá ${review.rating}/5`, detail: 'Khách cho phép đăng ẩn danh.',
        sections: [`### Nhận xét của khách\n> ${bookingProfileText(review.feedback)}`] });
      return;
    }
    const thread = await withBookingHostUpdate(review.host_id, async () => {
      const profile = profiles.get(review.host_id);
      if (!profile?.approved || !profile.forum_thread_id) throw new BookingProfileError('Host cần có hồ sơ đã công khai trước khi đăng đánh giá.');
      const post = await publishBookingReview({ guild, portal, review, profile });
      profiles.setReviewThread(id, post.id);
      return post;
    });
    await reply({ title: 'Đánh giá đã đăng', detail: `[Mở đánh giá ẩn danh](${thread.url})`,
      sections: ['Dùng `/cenar-ho-so lam-moi` để cập nhật điểm trên thẻ host.'] });
  } catch (error) {
    if (!(error instanceof BookingProfileError)) console.warn('[BOOKING-PROFILES]', error.code || error.name);
    await reply({ title: 'Chưa cập nhật được hồ sơ', detail: error instanceof BookingProfileError ? error.message
      : 'Chưa đồng bộ được với Discord. Thử lại cùng lệnh để kiểm tra bản đã lưu.', accent: 0xbd7d9c });
  }
}
