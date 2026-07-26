import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { brandName, accentFor } from '../utils/uiKit.js';

export const data = new SlashCommandBuilder()
  .setName('setup-otp')
  .setDescription('Cài đặt bảng điều khiển thuê số điện thoại trực tuyến (ViOTP)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(opt =>
    opt.setName('kenh')
      .setDescription('Kênh hiển thị bảng thuê số (mặc định kênh hiện tại)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const E = createEmojiResolver(interaction.guildId);
  const storeName = brandName();
  const targetChannel = interaction.options.getChannel('kenh') || interaction.channel;

  // ─── Dựng Components V2 panel ───────────────────────────────
  const iconSparkle = E('starxoay', '✨');
  const iconCheck   = E('tickgreen', '✅');
  const iconPhone   = E('phone', '📱');
  const iconMoney   = E('money', '💰');
  const iconHistory = E('chamxanh', '🕒');

  const headerLine = [iconSparkle, `THUÊ SỐ ĐIỆN THOẠI ONLINE — ${storeName.toUpperCase()}`]
    .filter(Boolean).join(' ');

  const bodyLines = [
    `Dịch vụ cho thuê số điện thoại trực tuyến để nhận mã OTP đăng ký tài khoản (Facebook, Zalo, Momo, Shopee...).`,
    ``,
    `${iconCheck} **Ưu điểm nổi bật:**`,
    `> ${iconPhone} Nhận mã SMS cực nhanh.`,
    `> ${iconMoney} Trừ thẳng vào số dư ví của bạn trong Bot.`,
    `> ${iconHistory} Tự động hoàn tiền 100% nếu số bị lỗi hoặc không nhận được mã sau 5 phút.`,
    '',
    '**Bấm nút bên dưới để chọn dịch vụ và bắt đầu thuê:**',
  ].join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(accentFor('primary') || 0x3498db);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${headerLine}`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(bodyLines)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );

  // ─── Nút tương tác ───────────────────────────────────────────
  const rentBtn = new ButtonBuilder()
    .setCustomId('otp:open_menu')
    .setLabel('Thuê Số Mới')
    .setStyle(ButtonStyle.Primary);

  const btnEmoji = E.component('cr_shop') || E.component('icon_cart');
  if (btnEmoji) rentBtn.setEmoji(btnEmoji);

  const checkBalanceBtn = new ButtonBuilder()
    .setCustomId('otp:check_balance')
    .setLabel('Kiểm Tra OTP & Số Dư')
    .setStyle(ButtonStyle.Secondary);

  const checkEmoji = E.component('cr_pay') || E.component('icon_history');
  if (checkEmoji) checkBalanceBtn.setEmoji(checkEmoji);

  const actionRow = new ActionRowBuilder().addComponents(rentBtn, checkBalanceBtn);

  const panelPayload = {
    components: [container, actionRow],
    flags: MessageFlags.IsComponentsV2,
  };

  try {
    await targetChannel.send(panelPayload);
    await interaction.editReply({
      content: `${E('status_check')} Đã gửi Panel Thuê SIM thành công tại kênh <#${targetChannel.id}>.`
    });
  } catch (error) {
    console.error('[OTP Setup] Send error:', error);
    await interaction.editReply({
      content: `${E('status_cross')} Lỗi khi gửi Panel: \`${error.message}\`. Bạn nhớ cấp quyền Send Messages cho Bot.`
    });
  }
}
