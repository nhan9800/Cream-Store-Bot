import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { publishAnnouncement } from '../services/announcementService.js';
import { getActiveProducts } from '../services/productCatalogService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';
import { getNitroTrialEligibility, isNitroTrialProduct } from '../constants/nitroTrial.js';

const PRIMARY_PRICE_CHANNEL_ID = '1514606995842273280';

function findNitroOption(products, marker) {
  return products.find((product) => (
    product.is_active !== 0
    && product.name.includes('Discord Nitro Boost 2 Tháng')
    && product.name.includes(marker)
  ));
}

export function buildPriceAnnouncementContent(guildId, products) {
  const E = createEmojiResolver(guildId);
  const keepMail = findNitroOption(products, 'Giữ Mail 7 Ngày');
  const guaranteedMail = findNitroOption(products, 'Mail Bao Sống');
  const nitroTrial = products.find((product) => product.is_active !== 0 && isNitroTrialProduct(product));
  const priceChannelMention = `<#${PRIMARY_PRICE_CHANNEL_ID}>`;

  const nitroLines = keepMail && guaranteedMail
    ? [
      `### ${E('brand_nitro')} Nitro Boost Login · 2 Tháng`,
      `- **Giữ mail 7 ngày:** ${formatCurrency(keepMail.price)}`,
      `- **Mail bao sống:** ${formatCurrency(guaranteedMail.price)}`,
    ]
    : [];
  const trialLines = nitroTrial
    ? [
      `### ${E('brand_nitro')} Nitro Trial 3 Tháng · Ưu Đãi Lần Đầu`,
      `- **Giá bán:** ${formatCurrency(nitroTrial.price)}`,
      `${E('status_check')} **Đối tượng áp dụng:**`,
      ...getNitroTrialEligibility().map((item) => `- ${item}`),
    ]
    : [];

  return [
    `## ${E('icon_price')} BẢNG GIÁ CENAR ĐÃ ĐƯỢC CẬP NHẬT`,
    '> Toàn bộ mức giá đang mở bán vừa được đồng bộ trực tiếp từ hệ thống sản phẩm.',
    '',
    ...nitroLines,
    nitroLines.length ? '' : null,
    ...trialLines,
    trialLines.length ? '' : null,
    `${E('icon_search')} Xem đầy đủ tên gói, giá bán và thời hạn tại ${priceChannelMention}.`,
    `${E('status_info')} Giá trên kênh bảng giá là dữ liệu chính thức mới nhất của shop.`,
  ].filter((line) => line !== null).join('\n');
}

export const data = new SlashCommandBuilder()
  .setName('thong-bao-bang-gia')
  .setDescription('Đồng bộ bảng giá và gửi thông báo giá mới nhất (@everyone).')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((option) => option
    .setName('channel')
    .setDescription('Kênh đăng thông báo; mặc định là kênh hiện tại.')
    .setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  if (!targetChannel?.isTextBased() || targetChannel.isThread?.()) {
    return interaction.editReply({ content: 'Kênh đã chọn không hỗ trợ đăng thông báo.' });
  }

  try {
    const products = getActiveProducts(interaction.guildId);
    const result = await publishAnnouncement({
      guild: interaction.guild,
      channelId: targetChannel.id,
      content: buildPriceAnnouncementContent(interaction.guildId, products),
      tagEveryone: true,
    });

    const board = result.priceBoard;
    if (board?.status !== 'published' && board?.status !== 'current') {
      return interaction.editReply({
        content: `Thông báo đã đăng tại <#${targetChannel.id}>, nhưng bảng giá chưa thể đồng bộ (${board?.error || board?.status || 'không rõ lỗi'}).`,
      });
    }

    return interaction.editReply({
      content: `Đã đăng thông báo tại <#${targetChannel.id}> và đồng bộ bảng giá tại <#${board.channelId}>.`,
    });
  } catch (error) {
    console.error('[THONG-BAO-BANG-GIA] Lỗi:', error);
    return interaction.editReply({ content: `Không thể đăng thông báo: ${error.message}` });
  }
}
