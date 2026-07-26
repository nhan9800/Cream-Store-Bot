import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getActiveProducts } from '../services/productCatalogService.js';
import { config } from '../config.js';
import { formatCurrency } from '../utils/formatters.js';
import { getEmojiMap, resolveSelectMenuEmoji, resolveProductEmoji } from '../services/emojiService.js';
import { fmt, h2, subtext } from '../utils/embedHelpers.js';

export const data = new SlashCommandBuilder()
  .setName('stock')
  .setDescription('Hiển thị panel sản phẩm (Components V2) cho khách hàng chọn mua')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export function buildStockPanelComponents(guildId) {
  const products = getActiveProducts(guildId);
  if (!products.length) return null;

  const em = getEmojiMap(guildId);
  const E = (slot, fallback = '') => em[slot] || fallback;
  const brandName = config.storeName || 'Cenar Store';

  // ─── Container ───
  const container = new ContainerBuilder()
    .setAccentColor(config.accentColorPrimary);

  // Header với heading h1 (lớn nhất Discord cho phép)
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${E('stock_header')}  ${brandName} — Bảng Giá\n` +
      `> ${E('icon_sparkle')} ${fmt.b('Sản phẩm chính chủ — Giao tự động 24/7')}\n` +
      subtext('Chọn sản phẩm bên dưới để đặt hàng ngay!')
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Mỗi sản phẩm 1 dòng đẹp, dùng quote + bold
  const productLines = products.map(p => {
    const priceText = p.price > 0 ? fmt.b(formatCurrency(p.price)) : `${E('icon_gift')} ${fmt.b('Thương lượng')}`;
    const dur = p.duration_months > 1 ? `${p.duration_months} tháng` : '1 tháng';
    const desc = p.description ? `\n  ${subtext(p.description)}` : '';
    const emoji = resolveProductEmoji(guildId, p.emoji) || E('order_product');
    return `${emoji} ${fmt.b(p.name)} ${fmt.b('·')} ${priceText} ${fmt.b('·')} ${E('icon_duration')} ${dur}${desc}`;
  }).join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(productLines)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Footer với subtext
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('icon_heart_purple')} Chọn sản phẩm từ dropdown bên dưới để đặt hàng · Cenar Store`)
    )
  );

  // ─── Select menu ───
  const selectOptions = products.slice(0, 25).map(p => ({
    label: `${p.name}`.slice(0, 100),
    description: (p.description || `${p.duration_months} tháng — ${formatCurrency(p.price)}`).slice(0, 100),
    value: `${p.id}`,
    emoji: resolveSelectMenuEmoji(guildId, p.emoji, E('order_product')) || undefined,
  }));

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('product:select')
      .setPlaceholder('Chọn sản phẩm muốn mua...')
      .addOptions(selectOptions)
  );

  return [container, selectRow];
}

// Registry để lưu vị trí panel theo guildId
// Map<guildId, { channelId, messageId }>
export const stockPanelRegistry = new Map();

export async function refreshStockPanel(client, guildId) {
  const entry = stockPanelRegistry.get(guildId);
  if (!entry) return;
  try {
    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (!msg) return;
    const components = buildStockPanelComponents(guildId);
    if (!components) return;
    await msg.edit({ components, flags: MessageFlags.IsComponentsV2 }).catch(() => null);
  } catch (e) {
    // Bỏ qua lỗi nếu panel đã bị xóa
  }
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: 64 });

  try {
    const components = buildStockPanelComponents(interaction.guildId);
    if (!components) {
      return interaction.editReply(`Chưa có sản phẩm nào. Dùng \`/product add\` hoặc \`/product sale\` để thêm trước.`);
    }

    const panelMessage = await interaction.channel.send({
      components,
      flags: MessageFlags.IsComponentsV2,
    });

    // Lưu vị trí panel để các lệnh khác có thể tự reload
    stockPanelRegistry.set(interaction.guildId, {
      channelId: interaction.channel.id,
      messageId: panelMessage.id,
    });

    await interaction.editReply(`${E('status_check')} Panel sản phẩm đã được gửi!`);
  } catch (error) {
    console.error('[STOCK] Error:', error);
    return interaction.editReply(`${E('status_cross')} Lỗi: ${error.message}`);
  }
}
