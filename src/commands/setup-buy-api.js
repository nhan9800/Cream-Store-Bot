import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setup-buy-api')
  .setDescription('Cài đặt API Mua Thẻ Cào')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('cardswap:setup_buy_api_modal')
    .setTitle('Cấu hình API Mua Thẻ Cào');

  const inputPartnerId = new TextInputBuilder()
    .setCustomId('cardswap:buy_partner_id')
    .setLabel('Partner ID (Mua Thẻ)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const inputPartnerKey = new TextInputBuilder()
    .setCustomId('cardswap:buy_partner_key')
    .setLabel('Partner Key (Mua Thẻ)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(inputPartnerId),
    new ActionRowBuilder().addComponents(inputPartnerKey)
  );

  await interaction.showModal(modal);
}
