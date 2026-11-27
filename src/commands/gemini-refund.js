import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { assertStaffCapability } from '../utils/permissions.js';
import { formatCurrency as money } from '../utils/formatters.js';
import { previewGeminiRefunds, applyGeminiRefunds, ensureRefundCases, getRefundCase,
  claimRefundNotice, finishRefundNotice, GeminiRefundError } from '../services/geminiRefundService.js';
import { buildRefundOffer, buildRefundPayout } from '../services/refundPresentation.js';
import { updateOrderLogMessage } from '../services/notificationService.js';
import { sendRefundTicketNotice } from '../services/refundTicketNoticeService.js';

let dmQuarantined = false;

export const data = new SlashCommandBuilder().setName('gemini-refund')
  .setDescription('Đối soát Gemini, mở hồ sơ nhận hoàn và xem QR riêng tư.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName('hanh_dong').setDescription('Thao tác').setRequired(true).addChoices(
    { name: 'Xem đối soát trước khi chuyển', value: 'PREVIEW' },
    { name: 'Chuyển các đơn đã đối soát sang chờ hoàn', value: 'APPLY' },
    { name: 'Gửi hồ sơ cho khách (chưa thông báo)', value: 'NOTIFY' },
    { name: 'Gửi hồ sơ trong ticket riêng (DM bị chặn)', value: 'TICKET_NOTIFY' },
    { name: 'Xem QR của một đơn', value: 'QR' },
    { name: 'Xem tiến độ nhận tài khoản', value: 'STATUS' },
  ))
  .addStringOption(o => o.setName('ma_doi_soat').setDescription('Mã bảng đối soát vừa xem; bắt buộc khi chuyển').setMaxLength(20))
  .addStringOption(o => o.setName('ma_don').setDescription('Mã đơn cần xem QR'));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, getGuildConfig(interaction.guildId), 'MANAGE')) {
    await interaction.editReply('Chỉ quản lý được dùng lệnh này.'); return;
  }
  try {
    const action = interaction.options.getString('hanh_dong', true);
    ensureRefundCases(db);
    if (action === 'PREVIEW') {
      const p = previewGeminiRefunds(db, interaction.guildId);
      await interaction.editReply([
        '## Đối soát Gemini đang bảo hành',
        ...p.ready.map(r => `**${r.orderCode}** · Gốc ${money(r.quote.paid)} − dùng ${money(r.quote.usageDeduction)} − phí 10% ${money(r.quote.fee)} = **${money(r.quote.refund)}**`),
        ...p.blocked.map(r => `${r.orderCode} · Cần kiểm tra: ${r.reason}`),
        `**Tổng ${p.ready.length} đơn: ${money(p.ready.reduce((s, r) => s + r.quote.refund, 0))}**`,
        `Mã đối soát: \`${p.fingerprint}\``,
        '-# Chỉ chuyển sang chờ thông tin nhận hoàn. Không chuyển tiền và không đánh dấu đã hoàn.',
      ].join('\n')); return;
    }
    if (action === 'APPLY') {
      const rows = applyGeminiRefunds(db, { guildId: interaction.guildId, actorId: interaction.user.id,
        fingerprint: interaction.options.getString('ma_doi_soat') });
      await interaction.editReply(`Đã chuyển **${rows.length} đơn** sang **Chờ hoàn tiền → Chờ thông tin nhận hoàn**. Dùng thao tác **Gửi hồ sơ cho khách** để gửi bảng tính riêng tư.`);
      await Promise.allSettled(rows.map(row => updateOrderLogMessage(interaction.guild,
        db.prepare('SELECT * FROM orders WHERE order_code=?').get(row.order_code)))); return;
    }
    if (action === 'QR') {
      const row = getRefundCase(db, interaction.options.getString('ma_don')?.trim().toUpperCase() || '');
      if (!row || row.guild_id !== interaction.guildId) throw new GeminiRefundError('Không tìm thấy hồ sơ trong shop này.');
      await interaction.editReply(await buildRefundPayout(row)); return;
    }
    const rows = db.prepare('SELECT id FROM order_refund_cases WHERE guild_id=? ORDER BY created_at').all(interaction.guildId)
      .map(r => getRefundCase(db, r.id)).filter(r => r.active);
    if (action === 'STATUS') {
      await interaction.editReply(rows.map(r => `**${r.order_code}** · ${r.stage === 'READY_TO_PAY' ? 'Chờ shop chuyển hoàn' : 'Chờ thông tin nhận hoàn'} · ${money(r.quote.refund)} · DM: ${r.notice_state} · Ticket: ${r.ticket_notice_state}`).join('\n') || 'Không có hồ sơ đang chờ.'); return;
    }
    if (action === 'TICKET_NOTIFY') {
      const results = [];
      for (const row of rows) results.push(`${row.order_code}: ${await sendRefundTicketNotice(db, {
        id: row.id, guild: interaction.guild, guildConfig: getGuildConfig(interaction.guildId),
      })}`);
      await interaction.editReply(results.join('\n') || 'Không có hồ sơ đang chờ.'); return;
    }
    if (action !== 'NOTIFY') throw new GeminiRefundError('Thao tác không hợp lệ.');
    const results = [];
    for (const row of rows) {
      if (dmQuarantined) { results.push(`${row.order_code}: Discord chặn DM (20026); dùng thao tác gửi trong ticket riêng.`); continue; }
      if (!claimRefundNotice(db, row.id)) { results.push(`${row.order_code}: đã xử lý DM (${row.notice_state})`); continue; }
      try {
        const customer = await interaction.client.users.fetch(row.customer_id);
        const dm = await customer.send({ ...buildRefundOffer(row), nonce: `refund-${row.order_code}`, enforceNonce: true });
        finishRefundNotice(db, row.id, dm.id);
        results.push(`${row.order_code}: đã gửi hồ sơ`);
      } catch (error) {
        dmQuarantined ||= Number(error.code) === 20026;
        finishRefundNotice(db, row.id, null, [50007,20026].includes(Number(error.code)));
        results.push(`${row.order_code}: ${dmQuarantined ? 'Discord chặn DM (20026)' : Number(error.code) === 50007 ? 'khách khóa DM' : 'chưa xác nhận gửi được'}; dùng ticket riêng hoặc /hoan-tien ma_don`);
      }
    }
    await interaction.editReply(results.join('\n') || 'Không có hồ sơ đang chờ.');
  } catch (error) {
    if (!(error instanceof GeminiRefundError)) throw error;
    await interaction.editReply(error.message);
  }
}
