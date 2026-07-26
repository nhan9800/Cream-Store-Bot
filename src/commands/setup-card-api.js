import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setup-card-api')
  .setDescription('Cài đặt API Card2K / CardSwap')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('cardswap:setup_api_modal')
    .setTitle('Cấu hình API Đổi Thẻ Cào');

  const inputDomain = new TextInputBuilder()
    .setCustomId('cardswap:domain')
    .setLabel('Tên miền API (VD: card2k.com)')
    .setStyle(TextInputStyle.Short)
    .setValue('card2k.com')
    .setRequired(true);

  const inputPartnerId = new TextInputBuilder()
    .setCustomId('cardswap:partner_id')
    .setLabel('Partner ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const inputPartnerKey = new TextInputBuilder()
    .setCustomId('cardswap:partner_key')
    .setLabel('Partner Key')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const inputChargingFeeAdd = new TextInputBuilder()
    .setCustomId('cardswap:charging_fee_add')
    .setLabel('% Lời khi Đổi Thẻ (Gạch Thẻ)')
    .setPlaceholder('VD: 5')
    .setStyle(TextInputStyle.Short)
    .setValue('5.0')
    .setRequired(true);

  const inputBuyProfitAdd = new TextInputBuilder()
    .setCustomId('cardswap:buy_profit_add')
    .setLabel('Tiền lãi cố định khi Bán Thẻ (VND/thẻ)')
    .setPlaceholder('VD: 3000')
    .setStyle(TextInputStyle.Short)
    .setValue('3000')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputDomain),
    new ActionRowBuilder().addComponents(inputPartnerId),
    new ActionRowBuilder().addComponents(inputPartnerKey),
    new ActionRowBuilder().addComponents(inputChargingFeeAdd),
    new ActionRowBuilder().addComponents(inputBuyProfitAdd)
  );

  await interaction.showModal(modal);
}
