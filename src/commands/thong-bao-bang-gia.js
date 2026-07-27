import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('thong-bao-bang-gia')
  .setDescription('Gửi thông báo quảng bá Bảng Giá mới bằng Component V2 (@everyone).')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Kênh gửi thông báo (Mặc định: kênh 1514598369597587546 hoặc kênh hiện tại)')
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetChannel =
    interaction.options.getChannel('channel') ||
    interaction.guild.channels.cache.get('1514598369597587546') ||
    interaction.channel;

  if (!targetChannel?.isTextBased()) {
    return interaction.editReply({ content: '❌ Kênh không hợp lệ hoặc không phải kênh tin nhắn.' });
  }

  const E = createEmojiResolver(interaction.guildId);
  const container = new ContainerBuilder().setAccentColor(0xFFA500);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `@everyone\n## ${E('icon_sparkle', '✨')} BẢNG GIÁ CẬP NHẬT — CENAR STORE\n` +
        `> ${E('icon_fire', '🔥')} *Sản phẩm mới · Giá tốt nhất · Bảo hành toàn diện*`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${E('brand_nitro', '💎')} DISCORD NITRO & BOOST\n` +
        `${E('status_check', '✅')} Nitro Basic · Nitro Full · Server Boost\n` +
        `${E('icon_price', '💰')} Giá từ **\`9,000đ\`** — Rẻ nhất thị trường`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${E('brand_claude', '🤖')} AI & PHẦN MỀM BẢN QUYỀN\n` +
        `${E('status_check', '✅')} Claude API 100M · Claude Pro · ChatGPT Plus\n` +
        `${E('status_check', '✅')} Canva Pro · Capcut Pro · Adobe CC\n` +
        `${E('icon_crown', '👑')} **Claude 5 Opus** vừa ra mắt 24/7/2026 — Mạnh nhất hiện tại!`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${E('brand_youtube', '🎬')} GIẢI TRÍ — STREAMING\n` +
        `${E('status_check', '✅')} YouTube Premium · Spotify · Netflix\n` +
        `${E('icon_price', '💰')} Giá từ **\`19,000đ\`/tháng** — Bảo hành trọn gói`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${E('icon_heart_purple', '💛')} SẢN PHẨM PREMIUM ĐẶC BIỆT\n` +
        `${E('brand_claude', '🤖')} **Claude API 100M** — Truy cập Claude 5 Opus/Sonnet\n` +
        `${E('icon_heart_purple', '💛')} **Locket Gold 1 Năm** — VIP không quảng cáo, Streak Shield\n` +
        `${E('icon_sparkle', '✨')} Xem chi tiết tại kênh **SẢN PHẨM PREMIUM** ngay bên trên!`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${E('icon_gem', '💎')} TẠI SAO CHỌN CENAR STORE?\n` +
        `${E('icon_gem', '💎')} **Bảo hành trọn gói** — Đổi trả nếu lỗi, không hỏi thêm.\n` +
        `${E('icon_key', '🔒')} **Bảo mật tuyệt đối** — Không thu thập thông tin cá nhân.\n` +
        `${E('status_check', '✅')} **Hỗ trợ 24/7** — Team luôn online sẵn sàng.\n` +
        `${E('icon_fire', '🚀')} **Giao hàng tức thì** — Nhận trong vài phút sau thanh toán.`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${E('icon_heart_purple', '💜')} Cenar Store — Uy Tín · Chất Lượng · Bảo Hành Trọn Gói · Hỗ Trợ 24/7`
    )
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Xem Bảng Giá')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(E.component('icon_price') || '💰')
      .setCustomId('announce:view_price'),
    new ButtonBuilder()
      .setLabel('Mua Claude API')
      .setStyle(ButtonStyle.Success)
      .setEmoji(E.component('brand_claude') || '🤖')
      .setCustomId('product:claude:buy'),
    new ButtonBuilder()
      .setLabel('Mua Locket Gold')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(E.component('icon_heart_purple') || '💛')
      .setCustomId('product:locket:buy')
  );

  try {
    await targetChannel.send({
      components: [container, row],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: ['everyone'] },
    });

    return interaction.editReply({
      content: `✅ Đã gửi thông báo bảng giá mới thành công vào kênh <#${targetChannel.id}>!`,
    });
  } catch (err) {
    console.error('[THONG-BAO-BANG-GIA] Lỗi:', err);
    return interaction.editReply({
      content: `❌ Lỗi gửi thông báo: \`${err.message}\``,
    });
  }
}
