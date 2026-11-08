import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createShopPanel, buildShopPanelV2 } from '../services/shopPanelService.js';

export const data = new SlashCommandBuilder()
  .setName('setup-shop')
  .setDescription('Thả Panel Shop xịn xò vào kênh (Components V2)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(opt =>
    opt.setName('category')
      .setDescription('Tên danh mục sản phẩm (VD: Nitro, Netflix, Spotify)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('title')
      .setDescription('Tiêu đề hiển thị trên panel (mặc định = tên category)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('image_url')
      .setDescription('Link ảnh banner lớn (URL)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('features')
      .setDescription('Các tính năng (phân cách bằng dấu |). VD: ESP + AIM | Chỉ AIM | Support HVCI')
      .setRequired(false)
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: 64 });

  try {
    const category = interaction.options.getString('category', true);
    const title = interaction.options.getString('title') || category;
    const imageUrl = interaction.options.getString('image_url') || null;
    const rawFeatures = interaction.options.getString('features') || null;

    // Convert pipe-separated features to newline-separated
    const features = rawFeatures ? rawFeatures.split('|').map(f => f.trim()).filter(Boolean).join('\n') : null;

    const payload = buildShopPanelV2({
      guildId: interaction.guildId,
      category,
      title,
      imageUrl,
      features,
    });

    const panelMessage = await interaction.channel.send(payload);

    // Lưu vào DB để có thể edit sau
    createShopPanel({
      guildId: interaction.guildId,
      channelId: interaction.channel.id,
      messageId: panelMessage.id,
      category,
      title,
      imageUrl,
      features,
    });

    await interaction.editReply(`${E('status_check')} Panel Shop **${title}** (danh mục: \`${category}\`) đã được thả vào kênh thành công!`);
  } catch (error) {
    console.error('[SETUP-SHOP] Error:', error);
    await interaction.editReply(`${E('status_cross')} Lỗi: ${error.message}`);
  }
}
