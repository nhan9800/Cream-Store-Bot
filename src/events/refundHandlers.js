import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { readFileSync } from 'node:fs';
import { db } from '../database/db.js';
import { GeminiRefundError, requireRefundOwner, submitRefundBank } from '../services/geminiRefundService.js';
import { buildRefundOffer } from '../services/refundPresentation.js';

const banks = JSON.parse(readFileSync(new URL('../config/refundBanks.json', import.meta.url), 'utf8'));
const clean = value => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase().trim();
export function resolveRefundBank(value) {
  const needle = clean(value);
  return banks.find(b => [b.bin, b.code, b.shortName].some(v => clean(v) === needle));
}
const field = (id, label, placeholder, max) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true));

export async function handleRefundInteraction(interaction) {
  if (!interaction.customId?.startsWith('refund:')) return false;
  try {
    const [, action, id] = interaction.customId.split(':');
    requireRefundOwner(db, id, interaction.user.id);
    if (action === 'bank' && interaction.isButton()) {
      await interaction.showModal(new ModalBuilder().setCustomId(`refund:submit:${id}`).setTitle('Tài khoản nhận hoàn tiền')
        .addComponents(
          field('bank', 'Ngân hàng (mã viết tắt)', 'VD: VCB, MB, ACB, BIDV, TPB, TCB…', 40),
          field('account', 'Số tài khoản nhận tiền (không phải số thẻ)', 'Nhập chính xác số tài khoản', 19),
          field('name', 'Tên chủ tài khoản', 'Nhập họ tên đầy đủ', 80),
          field('accept', 'Xác nhận bảng tính hoàn tiền', 'Nhập ĐỒNG Ý nếu đồng ý số tiền và khoản trừ', 20),
        ));
    } else if (action === 'submit' && interaction.isModalSubmit()) {
      await interaction.deferReply({ ephemeral: true });
      const get = key => interaction.fields.getTextInputValue(key).trim();
      const row = submitRefundBank(db, { id, customerId: interaction.user.id,
        bank: resolveRefundBank(get('bank')), account: get('account'), name: get('name'), accepted: get('accept') });
      await interaction.editReply(buildRefundOffer(row));
    } else throw new GeminiRefundError('Thao tác hoàn tiền không hợp lệ.');
  } catch (error) {
    const message = error instanceof GeminiRefundError ? error.message : 'Chưa thể xử lý hồ sơ. Vui lòng liên hệ shop, không gửi tài khoản ở kênh công khai.';
    if (!(error instanceof GeminiRefundError)) console.error('[REFUND] Intake failed:', error.name);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, embeds: [], components: [] });
    else await interaction.reply({ content: message, ephemeral: true });
  }
  return true;
}
