import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';

const ANNOUNCE_CHANNEL_ID = '1514598369597587546';
const BOOST_CHANNEL_ID    = '1524080488233435336';
const SERVER1_ID          = '1282637033340403754';

export async function sendBoostAnnouncement(client) {
  const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('[BOOST-ANNOUNCE] Không tìm thấy kênh', ANNOUNCE_CHANNEL_ID);
    return;
  }

  const guildId = SERVER1_ID;

  const header = [
    `## <a:tsm_fire:1327553120842158111> TÍNH NĂNG MỚI — BOOST SERVER TỰ ĐỘNG <a:tsm_fire:1327553120842158111>`,
    ``,
    `<:purple_heart_glow:1327541911749263360> **Cenar Store** vừa ra mắt hệ thống **Boost Server tự động**!`,
    `<a:starxoay:1481141954346483845> Từ nay bạn chỉ cần đặt đơn — bot xử lý thanh toán & thông báo tự động.`,
  ].join('\n');

  const howItWorks = [
    `## <:cr_muahang:1348622828152426528> Cách Thức Hoạt Động`,
    `> <:muiten:1481124261501337601> **Bước 1:** Vào kênh <#${BOOST_CHANNEL_ID}> → bấm **Mua Boost Server**`,
    `> <:muiten:1481124261501337601> **Bước 2:** Điền thông tin server + chọn gói muốn mua`,
    `> <:muiten:1481124261501337601> **Bước 3:** Bot gửi **mã QR PayOS** vào DM — quét là thanh toán xong`,
    `> <:muiten:1481124261501337601> **Bước 4:** Hệ thống tự xác nhận — Admin boost trong **5–10 phút**`,
    `> <:muiten:1481124261501337601> **Bước 5:** Nhận thông báo hoàn thành qua DM <a:tickgreen:1384069022831874169>`,
  ].join('\n');

  const pricing = [
    `## <:cr_pay:1392750857329705000> Bảng Giá Dịch Vụ`,
    `> <a:starxoay:1481141954346483845> **Gói 1 Tháng** (14 Boosts) — **120.000 VND**`,
    `> <a:starxoay:1481141954346483845> **Gói 3 Tháng** (14 Boosts) — **290.000 VND**`,
    `> <:cr_tim:1366636325352116225> *Giá đã được điều chỉnh theo chi phí nguồn hiện tại.*`,
    ``,
    `<a:Dotyellow:1481134440725090315> *Nếu đông đơn, thời gian xử lý có thể lâu hơn — vui lòng kiên nhẫn!*`,
  ].join('\n');

  const rules = [
    `## <a:tick_red51:1384069065626222632> Điều Kiện Bảo Hành`,
    `> <:cr_green:1366636327415713832> Server phải **mở công khai** — không để chế độ duyệt thành viên`,
    `> <:cr_green:1366636327415713832> **Không kick** Boost Server ra khỏi server trong thời gian boost`,
    `> <:cr_green:1366636327415713832> **Không** vi phạm Discord ToS trong thời gian boost`,
    ``,
    `<a:tick_red51:1384069065626222632> Vi phạm bất kỳ điều nào trên sẽ **mất bảo hành** ngay lập tức!`,
  ].join('\n');

  const footer = `-# <:cr_tim:1366636325352116225> Cenar Store — Uy Tín • Chất Lượng • Tự Động 24/7 <:purple_heart_glow:1327541911749263360>`;

  const container = new ContainerBuilder().setAccentColor(0xEB459E);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(howItWorks));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(pricing));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rules));
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif')
    )
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  // @everyone phải nằm trong TextDisplay riêng — không dùng content field với Components V2
  const everyoneRow = new ContainerBuilder().setAccentColor(0xEB459E);
  everyoneRow.addTextDisplayComponents(new TextDisplayBuilder().setContent('@everyone'));

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Đặt Boost Ngay')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${BOOST_CHANNEL_ID}`)
      .setEmoji({ id: '1392750857329705000', name: 'cr_pay' })
  );

  await channel.send({
    components: [everyoneRow, container, btnRow],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: ['everyone'] },
  });
}
