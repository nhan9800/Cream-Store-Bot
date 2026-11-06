import { ActionRowBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { STORE_FORUMS } from '../config/storeForums202611.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getCapcutPriceProduct, getEditableCapcutProducts, updateCapcutPrice } from '../services/capcutPricingService.js';
import { isManager } from '../utils/permissions.js';
import { safeReply } from './shared.js';

async function resolveCapcutManager(interaction) {
  if (!interaction.guild || interaction.guildId !== STORE_FORUMS.guildId) return false;
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  return isManager(member, getGuildConfig(interaction.guildId));
}

const denied = 'Chỉ Admin/quản lý Cenar Store được sửa giá CapCut.';

export async function handleCapcutPriceEdit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!await resolveCapcutManager(interaction)) return interaction.editReply(denied);
  const products = getEditableCapcutProducts();
  if (!products.length) return interaction.editReply('Không còn gói CapCut đang mở bán.');
  const select = new StringSelectMenuBuilder().setCustomId('capcut:price:select')
    .setPlaceholder('Chọn đúng gói CapCut cần sửa giá')
    .addOptions(products.map(product => ({ label: product.name.slice(0, 100),
      value: String(product.id), description: `Giá hiện tại: ${Number(product.price).toLocaleString('vi-VN')}đ` })));
  return interaction.editReply({ content: 'Chọn gói CapCut. Giá mới áp dụng cho đơn mới trên bot và website Cenar Store.',
    components: [new ActionRowBuilder().addComponents(select)], allowedMentions: { parse: [] } });
}

export async function handleCapcutPriceSelect(interaction) {
  if (!await resolveCapcutManager(interaction)) return safeReply(interaction, { content: denied, flags: MessageFlags.Ephemeral });
  let product;
  try { product = getCapcutPriceProduct(interaction.values?.[0]); }
  catch (error) { return safeReply(interaction, { content: error.message, flags: MessageFlags.Ephemeral }); }
  const modal = new ModalBuilder().setCustomId(`capcut:price:modal:${product.id}:${product.price}`)
    .setTitle('Sửa giá CapCut · Admin');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price')
    .setLabel('Giá mới (VND) · Ví dụ: 100000').setValue(String(product.price))
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)));
  return interaction.showModal(modal);
}

export async function handleCapcutPriceModal(interaction, productId, expectedPrice) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!await resolveCapcutManager(interaction)) return interaction.editReply(denied);
  let product;
  try { product = updateCapcutPrice(productId, interaction.fields.getTextInputValue('price'), expectedPrice, interaction.user.id); }
  catch (error) { return interaction.editReply(error.message); }
  let refreshed = false;
  try {
    const { refreshCapcutPriceForumPost } = await import('../services/autoSetupPriceBoardService.js');
    await refreshCapcutPriceForumPost(interaction.guild);
    refreshed = true;
  } catch { /* The committed shared catalog remains authoritative if Discord refresh fails. */ }
  return interaction.editReply(`Đã lưu **${product.name}**: **${product.price.toLocaleString('vi-VN')}đ** cho đơn mới trên bot và website Cenar Store. Đơn đã tạo giữ nguyên số tiền.${refreshed ? '\nĐã cập nhật bài bảng giá CapCut & Office.' : '\nBài Discord chưa làm mới được; dùng /product sync để thử lại.'}`);
}
