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
import { accentFor, brandName } from '../utils/uiKit.js';

export const data = new SlashCommandBuilder()
  .setName('setup-otp')
  .setDescription('Cài đặt bảng điều khiển thuê số điện thoại trực tuyến (ViOTP)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) => option
    .setName('kenh')
    .setDescription('Kênh hiển thị bảng thuê số (mặc định kênh hiện tại)')
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(false));

export function buildOtpPanel(guildId) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('primary') || 0x5865f2);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_sparkle')} THUÊ SỐ ĐIỆN THOẠI ONLINE · ${brandName().toUpperCase()}`,
    `> Thuê số Việt Nam để nhận OTP từ nhiều nền tảng, xử lý riêng tư và ghi nhận trạng thái tự động.`,
    '',
    `### ${E('cenar_verified')} Quy trình rõ ràng`,
    `${E('icon_id')} Chọn dịch vụ và nhận số đang còn khả dụng.`,
    `${E('otp_loading') || E('status_loading')} Dùng số vừa cấp, sau đó chờ bot quét tin nhắn mỗi 15 giây.`,
    `${E('icon_key')} Mã OTP chỉ được gửi riêng cho tài khoản đã thuê.`,
    '',
    `### ${E('icon_wallet')} Bảo vệ số dư`,
    `${E('payment_refund')} Hoàn tiền đúng một lần nếu không cấp được số, lỗi phiên hoặc hết hạn sau tối đa 10 phút.`,
    `${E('customer_patron')} Cenar Patron và lịch sử dịch vụ được đồng bộ với website ngay khi cấp số.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${E('cenar_support')} Không chia sẻ số hoặc mã OTP · Luôn kiểm tra đúng tên dịch vụ trước khi thuê`));

  const rentButton = new ButtonBuilder()
    .setCustomId('otp:open_menu')
    .setLabel('Thuê Số Mới')
    .setStyle(ButtonStyle.Primary);
  const rentEmoji = E.component('panel_order');
  if (rentEmoji) rentButton.setEmoji(rentEmoji);

  const walletButton = new ButtonBuilder()
    .setCustomId('otp:check_balance')
    .setLabel('OTP & Số Dư')
    .setStyle(ButtonStyle.Secondary);
  const walletEmoji = E.component('icon_wallet');
  if (walletEmoji) walletButton.setEmoji(walletEmoji);

  const topupButton = new ButtonBuilder()
    .setCustomId('otp:topup_menu')
    .setLabel('Nạp Tiền')
    .setStyle(ButtonStyle.Success);
  const topupEmoji = E.component('payment_payos');
  if (topupEmoji) topupButton.setEmoji(topupEmoji);

  return {
    components: [container, new ActionRowBuilder().addComponents(rentButton, walletButton, topupButton)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const E = createEmojiResolver(interaction.guildId);
  const targetChannel = interaction.options.getChannel('kenh') || interaction.channel;
  try {
    await targetChannel.send(buildOtpPanel(interaction.guildId));
    await interaction.editReply({ content: `${E('status_check')} Đã gửi panel Thuê SIM tại <#${targetChannel.id}>.` });
  } catch (error) {
    console.error('[OTP Setup] Send error:', error);
    await interaction.editReply({ content: `${E('status_cross')} Không thể gửi panel: ${error.message}` });
  }
}
