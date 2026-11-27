import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { db } from '../database/db.js';
import { GeminiRefundError, requireRefundOwner, refundReview } from '../services/geminiRefundService.js';
import { buildRefundOffer, buildRefundPreview, buildRefundSubmitted } from '../services/refundPresentation.js';
import { confirmRefundDraft, resolveRefundBank, saveRefundDraft } from '../services/refundCaseService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { formatCurrency } from '../utils/formatters.js';

export { resolveRefundBank };

const field = (id, label, placeholder, max, min = 1) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short).setMinLength(min).setMaxLength(max).setRequired(true));

export async function handleRefundInteraction(interaction) {
  if (!interaction.customId?.startsWith('refund:')) return false;
  try {
    const [, action, id, revisionText] = interaction.customId.split(':');
    const row = requireRefundOwner(db, id, interaction.user.id);
    const review = refundReview(row), revision = Number(revisionText || 1);
    if (revision !== review.revision) throw new GeminiRefundError('Bảng tính đã cập nhật. Vui lòng mở lại /hoan-tien để đọc phương án mới.');
    if (action === 'bank' && interaction.isButton()) {
      if (row.stage === 'READY_TO_PAY' && !row.pendingQuote) {
        await interaction.reply({ ...buildRefundOffer(row), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }); return true;
      }
      await interaction.showModal(new ModalBuilder().setCustomId(`refund:submit:${id}:${revision}`)
        .setTitle(`Nhận hoàn ${formatCurrency(review.quote.refund)}`.slice(0, 45))
        .addComponents(
          field('bank', 'Ngân hàng', 'VD: Vietcombank, MB, ACB, BIDV, Techcombank, TPBank…', 60, 2),
          field('account', 'Số tài khoản nhận tiền (không phải số thẻ)', 'Nhập đúng số tài khoản, không dấu cách', 23, 6),
          field('name', 'Tên chủ tài khoản', 'VD: NGUYEN VAN A', 80, 3),
        ));
    } else if (action === 'submit' && interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const get = key => interaction.fields.getTextInputValue(key).trim();
      const draft = saveRefundDraft(db, { id, customerId: interaction.user.id, revision,
        bankInput: get('bank'), account: get('account'), name: get('name') });
      await interaction.editReply(await buildRefundPreview(draft));
    } else if (action === 'confirm' && interaction.isButton()) {
      const saved = confirmRefundDraft(db, { id, customerId: interaction.user.id, revision });
      await interaction.update({ ...buildRefundSubmitted(saved), attachments: [], files: [] });
      await emitStaffLog(interaction.client, { guildId: saved.guild_id, actorId: interaction.user.id, targetId: saved.customer_id,
        action: 'ORDER_REFUND_DETAILS', detail: `Khách xác nhận nhận hoàn ${formatCurrency(saved.quote.refund)}. Dùng /hoantien qr để chuyển.`,
        relatedOrderCode: saved.order_code }).catch(() => null);
    } else throw new GeminiRefundError('Thao tác hoàn tiền không hợp lệ.');
  } catch (error) {
    const message = error instanceof GeminiRefundError ? error.message : 'Chưa thể xử lý hồ sơ. Vui lòng liên hệ shop, không gửi tài khoản ở kênh công khai.';
    if (!(error instanceof GeminiRefundError)) console.error('[REFUND] Intake failed:', error.name);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, components: [], files: [], attachments: [] }).catch(() => null);
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }
  return true;
}
