import { PermissionFlagsBits, SlashCommandBuilder, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { upsertGuildConfig } from '../services/guildConfigService.js';
import {
  buildBoostPanelEmbed,
  buildBoostPanelRows,
  refreshBoostPanel,
} from '../services/boostServerService.js';

const ANNOUNCE_CHANNEL_ID = '1514598369597587546';
const BOOST_CHANNEL_ID    = '1524080488233435336';

export const data = new SlashCommandBuilder()
  .setName('boost-server')
  .setDescription('Quản lý hệ thống Boost Server tự động')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Thiết lập kênh hiện tại làm kênh Boost Server và đăng panel')
  )
  .addSubcommand(sub =>
    sub.setName('set-log')
      .setDescription('Đặt kênh hiện tại làm kênh log boost')
  )
  .addSubcommand(sub =>
    sub.setName('refresh')
      .setDescription('Cập nhật lại panel Boost Server (danh sách live)')
  )
  .addSubcommand(sub =>
    sub.setName('announce')
      .setDescription('Gửi thông báo ra mắt tính năng Boost Server tự động vào #thông-báo')
  );

export async function execute(interaction) {
  const E   = createEmojiResolver(interaction.guildId);
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'setup') {
      await interaction.deferReply({ flags: 64 });
      const embed = buildBoostPanelEmbed(interaction.guildId);
      const rows  = buildBoostPanelRows(interaction.guildId);
      const msg   = await interaction.channel.send({ embeds: [embed], components: rows });
      upsertGuildConfig({
        guild_id: interaction.guildId,
        boost_panel_channel_id: interaction.channel.id,
        boost_panel_message_id: msg.id,
        updated_by: interaction.user.id,
      });
      return interaction.editReply(
        `<a:tickgreen:1384069022831874169> Đã đăng panel Boost Server tại <#${interaction.channel.id}>!\n` +
        `Dùng \`/boost-server set-log\` trong kênh log để bật tính năng ghi log đơn boost.`
      );
    }

    if (sub === 'set-log') {
      await interaction.deferReply({ flags: 64 });
      upsertGuildConfig({
        guild_id: interaction.guildId,
        boost_log_channel_id: interaction.channel.id,
        updated_by: interaction.user.id,
      });
      return interaction.editReply(
        `<a:tickgreen:1384069022831874169> Đã đặt <#${interaction.channel.id}> làm kênh log đơn Boost Server!`
      );
    }

    if (sub === 'refresh') {
      await interaction.deferReply({ flags: 64 });
      await refreshBoostPanel(interaction.client, interaction.guildId);
      return interaction.editReply(`<a:tickgreen:1384069022831874169> Đã cập nhật lại panel Boost Server!`);
    }

    if (sub === 'announce') {
      await interaction.deferReply({ flags: 64 });

      const channel = await interaction.client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (!channel) {
        return interaction.editReply(`<a:tick_red51:1384069065626222632> Không tìm thấy kênh thông-báo (ID: ${ANNOUNCE_CHANNEL_ID}).`);
      }

      const guildId = interaction.guildId;

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

      const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Đặt Boost Ngay')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guildId}/${BOOST_CHANNEL_ID}`)
          .setEmoji({ id: '1392750857329705000', name: 'cr_pay' })
      );

      await channel.send({
        components: [container, btnRow],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: ['everyone'] },
      });

      return interaction.editReply(
        `<a:tickgreen:1384069022831874169> Đã gửi thông báo vào <#${ANNOUNCE_CHANNEL_ID}>!`
      );
    }

  } catch (error) {
    console.error('[BOOST-SERVER CMD]', error);
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(`<a:tick_red51:1384069065626222632> Lỗi: ${error.message}`);
    }
    return interaction.reply({ content: `<a:tick_red51:1384069065626222632> Lỗi: ${error.message}`, ephemeral: true });
  }
}
