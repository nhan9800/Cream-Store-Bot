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
import { isInternationalGuild } from '../utils/locale.js';

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
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('primary') || 0x5865f2);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_sparkle')} ${international ? 'ONLINE OTP NUMBER RENTAL · CENAR GLOBAL' : `THUÊ SỐ ĐIỆN THOẠI ONLINE · ${brandName().toUpperCase()}`}`,
    international ? `> Rent an available number for supported OTP services with private delivery and automatic status tracking.` : `> Thuê số Việt Nam để nhận OTP từ nhiều nền tảng, xử lý riêng tư và ghi nhận trạng thái tự động.`,
    '',
    `### ${E('cenar_verified')} ${international ? 'CLEAR WORKFLOW' : 'Quy trình rõ ràng'}`,
    international ? `${E('icon_id')} Select a service and receive a currently available number.` : `${E('icon_id')} Chọn dịch vụ và nhận số đang còn khả dụng.`,
    international ? `${E('otp_loading') || E('status_loading')} Use the assigned number, then wait while the bot checks for the message.` : `${E('otp_loading') || E('status_loading')} Dùng số vừa cấp, sau đó chờ bot quét tin nhắn mỗi 15 giây.`,
    international ? `${E('icon_key')} The OTP is shown privately only to the account that rented the number.` : `${E('icon_key')} Mã OTP chỉ được gửi riêng cho tài khoản đã thuê.`,
    '',
    `### ${E('icon_wallet')} ${international ? 'BALANCE PROTECTION' : 'Bảo vệ số dư'}`,
    international ? `${E('payment_refund')} A failed allocation or expired session is refunded once according to the service result.` : `${E('payment_refund')} Hoàn tiền đúng một lần nếu không cấp được số, lỗi phiên hoặc hết hạn sau tối đa 10 phút.`,
    international ? `${E('customer_patron')} Customer activity and website roles synchronize as soon as a number is allocated.` : `${E('customer_patron')} Cenar Patron và lịch sử dịch vụ được đồng bộ với website ngay khi cấp số.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(international
    ? `-# ${E('cenar_support')} Never share the number or OTP · Confirm the correct service before renting`
    : `-# ${E('cenar_support')} Không chia sẻ số hoặc mã OTP · Luôn kiểm tra đúng tên dịch vụ trước khi thuê`));

  const rentButton = new ButtonBuilder()
    .setCustomId('otp:open_menu')
    .setLabel(international ? 'Rent a Number' : 'Thuê Số Mới')
    .setStyle(ButtonStyle.Primary);
  const rentEmoji = E.component('panel_order');
  if (rentEmoji) rentButton.setEmoji(rentEmoji);

  const walletButton = new ButtonBuilder()
    .setCustomId('otp:check_balance')
    .setLabel(international ? 'OTP & Balance' : 'OTP & Số Dư')
    .setStyle(ButtonStyle.Secondary);
  const walletEmoji = E.component('icon_wallet');
  if (walletEmoji) walletButton.setEmoji(walletEmoji);

  const topupButton = new ButtonBuilder()
    .setCustomId('otp:topup_menu')
    .setLabel(international ? 'Add Funds' : 'Nạp Tiền')
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
