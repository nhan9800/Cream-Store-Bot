import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { collectPaymentConfigIssues } from '../config.js';
import { confirmPayOSWebhookUrl } from '../services/paymentService.js';
import { buildPayOSSetupV2 } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('setup-payos')
  .setDescription('Kiểm tra cấu hình PayOS và xác nhận webhook URL với PayOS.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption((option) =>
    option
      .setName('xac_nhan_webhook')
      .setDescription('Bật để bot gọi API confirm-webhook của PayOS ngay bây giờ')
      .setRequired(false),
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const shouldConfirm = interaction.options.getBoolean('xac_nhan_webhook') ?? false;
  const issues = collectPaymentConfigIssues();
  const notes = [];

  if (issues.length) {
    notes.push(...issues.map((issue) => `• ${issue}`));
  }

  if (shouldConfirm && !issues.length) {
    try {
      const result = await confirmPayOSWebhookUrl();
      notes.push(`• Confirm webhook OK: ${result.webhookUrl ?? 'đã xác nhận'}`);
    } catch (error) {
      notes.push(`• Confirm webhook lỗi: ${error.message}`);
    }
  } else if (shouldConfirm && issues.length) {
    notes.push('• Chưa thể confirm webhook vì ENV PayOS còn thiếu hoặc sai.');
  }

  await interaction.reply({
    ...buildPayOSSetupV2(notes, interaction.guildId),
    ephemeral: true,
  });
}
