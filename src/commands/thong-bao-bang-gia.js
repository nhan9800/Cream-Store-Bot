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
  AttachmentBuilder
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import fs from 'node:fs';
import path from 'node:path';

export const data = new SlashCommandBuilder()
  .setName('thong-bao-bang-gia')
  .setDescription('Gửi thông báo quảng bá Bảng Giá mới bằng Component V2 (@everyone).')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Kênh gửi thông báo (Mặc định: kênh 1515008584549797979 hoặc kênh hiện tại)')
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetChannel =
    interaction.options.getChannel('channel') ||
    interaction.guild.channels.cache.get('1515008584549797979') ||
    interaction.channel;

  if (!targetChannel?.isTextBased()) {
    return interaction.editReply({ content: '❌ Kênh không hợp lệ hoặc không phải kênh tin nhắn.' });
  }

  const E = createEmojiResolver(interaction.guildId);
  const container = new ContainerBuilder().setAccentColor(0x5865F2); // Blurple

  // Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${E('icon_gem')} **BẢNG GIÁ KHUYẾN MÃI ĐỘC QUYỀN CENAR STORE** ${E('icon_gem')}\n` +
      `> Cập nhật giá siêu rẻ tháng 7/2026. Deal cực hời, chốt đơn ngay để thăng hạng trải nghiệm số!`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

  // Nitro
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E('brand_nitro')} **Nitro Boost Login (Gia Hạn)**\n` +
      `- 2 Tháng: **99k**\n` +
      `- 4 Tháng: **250k**\n` +
      `- 6 Tháng: **380k**\n` +
      `- 8 Tháng: **450k**\n` +
      `- 12 Tháng: **590k**\n\n` +
      `## ${E('brand_nitro')} **Nitro Boost Login (Mua Thẳng)**\n` +
      `- 1 Tháng: **90k**\n` +
      `- 12 Tháng: **850k**\n\n` +
      `## ${E('icon_star')} **Nitro Trial**\n` +
      `- 3 Tháng: **45k**\n\n` +
      `## ${E('brand_boost')} **Nâng Cấp Máy Chủ (Boost Server)**\n` +
      `- 1 Tháng: **150k**\n` +
      `- 3 Tháng: **320k**\n\n` +
      `> **Lưu ý Trial:**\n` +
      `> - Dành cho tài khoản tạo trên 1 tháng\n` +
      `> - Chưa từng sử dụng Nitro Discord (kể cả Basic, không tính Nitro Trial)`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

  // Entertainment
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E('brand_spotify')} **Spotify Premium (Add Family)**\n` +
      `- 3 Tháng: **120k** | 6 Tháng: **230k** | 12 Tháng: **300k**\n\n` +
      `## ${E('brand_capcut')} **Capcut Pro (Chính Chủ)**\n` +
      `- 1 Tháng: **85k** | 6 Tháng: **450k**\n\n` +
      `## ${E('brand_adobe')} **Adobe Full App (Chính Chủ)**\n` +
      `- 1 Tháng: **90k** | 2 Tháng: **130k**\n` +
      `- 3 Tháng: **250k** | 4 Tháng: **450k**`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

  // Youtube
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E('brand_youtube')} **YouTube Premium (Chính Chủ - Ổn định lâu dài)**\n` +
      `- 3 Tháng: **190k** | 6 Tháng: **300k** | 12 Tháng: **550k**\n\n` +
      `## ${E('brand_youtube')} **YouTube Premium (Gia Hạn Hàng Tháng)**\n` +
      `- 3 Tháng: **90k** | 6 Tháng: **180k** | 12 Tháng: **280k**`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

  // Work & AI
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E('icon_crown')} **Canva Pro (Chính Chủ)**\n` +
      `- 1 Năm: **150k**\n\n` +
      `## ${E('brand_office')} **Office 365 + Full Apps + 1TB OneDrive (Chính Chủ)**\n` +
      `- 1 Năm: **250k**\n\n` +
      `## ${E('brand_gemini')} **Gemini Pro + 5TB Google One (Chính Chủ)**\n` +
      `- 12 Tháng: **250k**\n` +
      `- 18 Tháng: **280k** *(Chỉ còn 20 Slot!)*`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );

  // Gaming
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E('icon_fire')} **Tài Khoản Minecraft**\n` +
      `**Bedrock Edition: 190k**\n` +
      `- Chơi Online trên tài khoản Xbox/Microsoft cá nhân\n` +
      `- Phiên bản Bedrock full update mọi tính năng\n` +
      `- Sở hữu vĩnh viễn, bảo hành 1 năm\n\n` +
      `**Java + Bedrock: 450k**\n` +
      `- Tài khoản Microsoft mua sẵn game (Chỉ việc tải và chơi)\n` +
      `- Giao toàn bộ thông tin tài khoản + Email đăng ký\n` +
      `- Đổi mọi thông tin thoải mái (Email, Pass, SĐT)`
    )
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large)
  );

  // Footer
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `🔗 *Khám phá thêm hàng ngàn sản phẩm siêu ngon khác tại <#1514607020098191393> để được chốt giá mềm nhất!*`
    )
  );

  const bannerPath = path.join(process.cwd(), 'assets', 'promo_banner.jpg');
  let attachment = null;
  if (fs.existsSync(bannerPath)) {
    attachment = new AttachmentBuilder(fs.readFileSync(bannerPath), { name: 'banner.jpg' });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Hỗ Trợ & Mua Hàng')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(E.component('icon_store'))
      .setCustomId('announce_dummy_1')
      .setDisabled(true)
  );

  try {
    const messagePayload = {
      components: [container, row],
      flags: MessageFlags.IsComponentsV2,
    };
    if (attachment) {
      messagePayload.files = [attachment];
    }

    await targetChannel.send(messagePayload);

    return interaction.editReply({
      content: `✅ Đã gửi thông báo khuyến mãi mới thành công vào kênh <#${targetChannel.id}>!`,
    });
  } catch (err) {
    console.error('[THONG-BAO-BANG-GIA] Lỗi:', err);
    return interaction.editReply({
      content: `❌ Lỗi gửi thông báo: \`${err.message}\``,
    });
  }
}
