import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { addProduct, getProductById, updateProduct } from '../services/productCatalogService.js';
import { normalizeCatalogEmoji, publishCtvPricePanel } from '../services/ctvPriceService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';
import { accentFor } from '../utils/uiKit.js';

export const data = new SlashCommandBuilder()
  .setName('ctv-price')
  .setDescription('[Admin] Quản lý và xuất bản bảng giá riêng cho CTV.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub
    .setName('publish')
    .setDescription('Đăng mới hoặc đồng bộ panel bảng giá CTV.'))
  .addSubcommand((sub) => sub
    .setName('set')
    .setDescription('Chỉnh giá CTV và emoji custom của sản phẩm hiện có.')
    .addIntegerOption((option) => option.setName('id').setDescription('ID sản phẩm').setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName('gia_ctv').setDescription('Giá CTV mới (VND)').setRequired(true).setMinValue(0))
    .addStringOption((option) => option.setName('emoji').setDescription('Emoji custom, tên emoji hoặc slot emoji').setRequired(false)))
  .addSubcommand((sub) => sub
    .setName('add')
    .setDescription('Thêm sản phẩm mới kèm giá CTV và emoji custom.')
    .addStringOption((option) => option.setName('ten').setDescription('Tên sản phẩm').setRequired(true).setMaxLength(80))
    .addIntegerOption((option) => option.setName('gia_le').setDescription('Giá bán lẻ (VND)').setRequired(true).setMinValue(0))
    .addIntegerOption((option) => option.setName('gia_ctv').setDescription('Giá CTV (VND)').setRequired(true).setMinValue(0))
    .addStringOption((option) => option.setName('emoji').setDescription('Emoji custom hoặc tên emoji custom của server').setRequired(true))
    .addIntegerOption((option) => option.setName('thoi_han').setDescription('Thời hạn theo tháng').setRequired(false).setMinValue(1).setMaxValue(120))
    .addStringOption((option) => option.setName('danh_muc').setDescription('Danh mục sản phẩm').setRequired(false).setMaxLength(50))
    .addStringOption((option) => option.setName('mo_ta').setDescription('Mô tả ngắn').setRequired(false).setMaxLength(300)));

function statusPayload(guildId, tone, title, lines = []) {
  const E = createEmojiResolver(guildId);
  const icon = tone === 'danger' ? E('status_cross') : tone === 'warning' ? E('cenar_cooldown') : E('cenar_verified');
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon} ${title}`));
  if (lines.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();
  await interaction.reply(statusPayload(
    interaction.guildId,
    'warning',
    'Đang đồng bộ bảng giá CTV',
    [`${E('cenar_cooldown')} Hệ thống đang kiểm tra catalog và panel hiện tại.`],
  ));

  try {
    let resultLines = [];
    if (subcommand === 'set') {
      const id = interaction.options.getInteger('id', true);
      const ctvPrice = interaction.options.getInteger('gia_ctv', true);
      const rawEmoji = interaction.options.getString('emoji');
      const product = getProductById(id);
      if (!product) throw new Error(`Không tìm thấy sản phẩm ID ${id}.`);
      if (Number(product.price) > 0 && ctvPrice > Number(product.price)) {
        throw new Error('Giá CTV không được cao hơn giá bán lẻ.');
      }
      const fields = { ctvPrice };
      if (rawEmoji) fields.emoji = normalizeCatalogEmoji(interaction.guild, rawEmoji, E);
      const updated = updateProduct(id, fields);
      resultLines = [
        `${E('cenar_price')} **${updated.name}**`,
        `${E('cenar_wallet')} Giá CTV mới: **${formatCurrency(updated.ctv_price)}**`,
        `${E('cenar_verified')} Panel đã được đồng bộ tự động.`,
      ];
    }

    if (subcommand === 'add') {
      const name = interaction.options.getString('ten', true).trim();
      const retailPrice = interaction.options.getInteger('gia_le', true);
      const ctvPrice = interaction.options.getInteger('gia_ctv', true);
      if (retailPrice > 0 && ctvPrice > retailPrice) {
        throw new Error('Giá CTV không được cao hơn giá bán lẻ.');
      }
      const emoji = normalizeCatalogEmoji(interaction.guild, interaction.options.getString('emoji', true), E);
      const product = addProduct({
        guildId: interaction.guildId,
        name,
        description: interaction.options.getString('mo_ta'),
        price: retailPrice,
        ctvPrice,
        durationMonths: interaction.options.getInteger('thoi_han') || 1,
        serviceType: interaction.options.getString('danh_muc') || 'other',
        emoji,
      });
      const updated = updateProduct(product.id, { ctvPrice, emoji, isActive: true });
      resultLines = [
        `${emoji} **${updated.name}** đã được thêm vào catalog.`,
        `${E('cenar_wallet')} Giá lẻ: ${formatCurrency(updated.price)} · Giá CTV: **${formatCurrency(updated.ctv_price)}**`,
        `${E('cenar_verified')} ID sản phẩm: \`${updated.id}\``,
      ];
    }

    const panelMessage = await publishCtvPricePanel(interaction.guild);
    if (subcommand === 'publish') {
      resultLines = [
        `${E('cenar_price')} Bảng giá đã đọc lại dữ liệu catalog mới nhất.`,
        `${E('cenar_verified')} Panel: [Mở bảng giá](${panelMessage.url})`,
      ];
    }
    await interaction.editReply(statusPayload(interaction.guildId, 'success', 'Cập nhật bảng giá thành công', resultLines));
  } catch (error) {
    await interaction.editReply(statusPayload(
      interaction.guildId,
      'danger',
      'Không thể cập nhật bảng giá',
      [`${E('status_cross')} ${error.message}`],
    ));
  }
}
