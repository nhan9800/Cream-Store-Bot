import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { config } from '../config.js';
import { STAFF_DEFAULT_PERMISSIONS } from '../utils/permissions.js';
import {
  completeYoutubeWarrantyClaim,
  getYoutubeWarrantyClaim,
  getYoutubeWarrantyClaimStats,
  listYoutubeWarrantyClaims,
  resendYoutubeWarrantyClaim,
  syncYoutubeWarrantyClaims,
} from '../services/youtubeWarrantyClaimService.js';

// Keep the ephemeral embed below Discord's 6,000-character aggregate limit
// even when a Gmail address is unusually long.
const MAX_DISPLAY = 8;

export const data = new SlashCommandBuilder()
  .setName('ytbaohanh')
  .setDescription('[Admin] Xem hồ sơ và tick đã bảo hành YouTube cho khách.')
  .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSIONS);

function hasAdminPermission(interaction) {
  return Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

function statusLabel(status) {
  if (status === 'SUBMITTED') return 'Gmail đã gửi · chờ staff xử lý';
  if (status === 'COMPLETED') return 'Đã bảo hành';
  if (status === 'CANCELLED') return 'Đã hủy';
  return 'Chờ khách điền Gmail';
}

function claimLines(claim, E) {
  const gmail = claim.customerGmail || claim.customerGmailMasked || 'Chưa có Gmail';
  const guidance = claim.guidanceAcceptedAt ? 'đã xác nhận hướng dẫn' : 'chưa xác nhận hướng dẫn';
  return [
    `${E('order_product')} **Sản phẩm:** ${claim.productName}`,
    `${E('ticket_user')} **Khách:** <@${claim.customerId}> · ${claim.customerId}`,
    `${E('icon_mail')} **Gmail:** ${gmail}`,
    `${E('status_info')} **Trạng thái:** ${statusLabel(claim.status)} · ${guidance}`,
    `${E('icon_link')} **Ticket:** <#${claim.ticketChannelId}>`,
  ].join('\n');
}

export function buildYoutubeWarrantyAdminPayload({ guildId, claims, stats, syncResult = null }) {
  const E = createEmojiResolver(guildId);
  const embed = new EmbedBuilder()
    .setTitle(`${E('brand_youtube')} YOUTUBE WARRANTY INBOX`)
    .setColor(config.accentColorWarning)
    .setDescription([
      `${E('icon_chart')} **Tổng:** ${stats.total} · ${E('icon_clock')} **Chờ Gmail:** ${stats.awaitingCustomer} · ${E('icon_mail')} **Đã gửi Gmail:** ${stats.submitted} · ${E('status_check')} **Đã bảo hành:** ${stats.completed}`,
      syncResult ? `${E('status_info')} Đồng bộ: quét ${syncResult.scanned}, tạo ${syncResult.created}, gửi mới ${syncResult.published}, lỗi ${syncResult.failed}.` : null,
      '',
      `${E('status_warn')} Chỉ tick sau khi đã gửi lời mời Family. Khách phải làm hướng dẫn YouTube trước khi vào Family; nếu vào sai quy trình, shop sẽ ngừng bảo hành và không chịu trách nhiệm lỗi phát sinh.`,
    ].filter(Boolean).join('\n'))
    .setTimestamp();

  const visibleClaims = claims.slice(0, MAX_DISPLAY);
  if (visibleClaims.length === 0) {
    embed.addFields({ name: 'Không có hồ sơ', value: 'Hiện không có đơn YouTube nào đang cần xử lý.' });
    return { embeds: [embed], components: [], ephemeral: true };
  }

  visibleClaims.forEach((claim, index) => {
    embed.addFields({ name: `#${index + 1} · ${claim.orderCode} · ${claim.claimCode}`, value: claimLines(claim, E), inline: false });
  });
  if (claims.length > MAX_DISPLAY) {
    embed.setFooter({ text: `Đang hiển thị ${MAX_DISPLAY}/${claims.length}. Xem toàn bộ tại Admin YouTube Warranty Inbox trên website.` });
  }

  const actionable = visibleClaims.filter((claim) => claim.status === 'SUBMITTED' || claim.status === 'AWAITING_CUSTOMER');
  const components = [];
  for (let index = 0; index < actionable.length; index += 5) {
    components.push(new ActionRowBuilder().addComponents(actionable.slice(index, index + 5).map((claim) => (
      claim.status === 'SUBMITTED'
        ? new ButtonBuilder().setCustomId(`ytw:complete:${claim.id}`).setLabel(`Tick ${claim.orderCode}`).setStyle(ButtonStyle.Success)
        : new ButtonBuilder().setCustomId(`ytw:resend:${claim.id}`).setLabel(`Nhắc ${claim.orderCode}`).setStyle(ButtonStyle.Primary)
    ))));
  }
  return { embeds: [embed], components, ephemeral: true };
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  if (!hasAdminPermission(interaction)) {
    await interaction.reply({ content: `${E('status_cross')} Chỉ Admin/Manager có thể xem và xử lý hồ sơ YouTube.`, ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const syncResult = await syncYoutubeWarrantyClaims(interaction.client, { guildId: interaction.guildId });
    const claims = listYoutubeWarrantyClaims(interaction.guildId, { status: 'ALL', limit: 500 });
    await interaction.editReply(buildYoutubeWarrantyAdminPayload({
      guildId: interaction.guildId,
      claims,
      stats: getYoutubeWarrantyClaimStats(interaction.guildId),
      syncResult,
    }));
  } catch (error) {
    console.error('[YTBAOHANH] Error:', error);
    await interaction.editReply(`${E('status_cross')} Không thể tải inbox bảo hành YouTube: ${error.message}`);
  }
}

export async function handleYoutubeWarrantyInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('ytw:')) return false;
  const E = createEmojiResolver(interaction.guildId);
  if (!hasAdminPermission(interaction)) {
    await interaction.reply({ content: `${E('status_cross')} Chỉ Admin/Manager có thể xử lý hồ sơ này.`, ephemeral: true }).catch(() => null);
    return true;
  }

  const parts = customId.split(':');
  const action = parts[1];
  const rawId = interaction.isModalSubmit() ? parts[3] : parts[2];
  const claimId = Number(rawId);
  const claim = getYoutubeWarrantyClaim(claimId, { includeEmail: true, includeToken: true });
  if (!claim || claim.guildId !== interaction.guildId) {
    await interaction.reply({ content: `${E('status_warn')} Không tìm thấy hồ sơ YouTube trong server này.`, ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.isButton() && action === 'resend') {
    await interaction.deferReply({ ephemeral: true });
    try {
      await resendYoutubeWarrantyClaim(interaction.client, claim.id);
      await interaction.editReply(`${E('status_check')} Đã nhắc <@${claim.customerId}> kiểm tra form Gmail trong ticket.`);
    } catch (error) {
      await interaction.editReply(`${E('status_cross')} Không thể gửi lại form: ${error.message}`);
    }
    return true;
  }

  if (interaction.isButton() && action === 'complete') {
    if (claim.status !== 'SUBMITTED') {
      await interaction.reply({ content: `${E('status_warn')} Chỉ có thể tick hồ sơ đã nhận Gmail.`, ephemeral: true }).catch(() => null);
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(`ytw:complete:modal:${claim.id}`)
      .setTitle(`Tick bảo hành ${claim.orderCode}`);
    const note = new TextInputBuilder()
      .setCustomId('ytw_completion_note')
      .setLabel('Ghi chú (đã gửi lời mời / lưu ý)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500)
      .setPlaceholder('Đã gửi lời mời. Khách phải đọc hướng dẫn trước khi vào Family.');
    modal.addComponents(new ActionRowBuilder().addComponents(note));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'complete' && parts[2] === 'modal') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const note = interaction.fields.getTextInputValue('ytw_completion_note')?.trim() || '';
      const result = await completeYoutubeWarrantyClaim(interaction.client, claim.id, { actorId: interaction.user.id, note });
      await interaction.editReply(result.alreadyCompleted
        ? `${E('status_info')} Hồ sơ ${claim.claimCode} đã được tick trước đó.`
        : `${E('status_check')} Đã tick **${claim.orderCode}** là đã bảo hành. Bot đã báo ticket + DM và gửi hướng dẫn YouTube bắt buộc cho khách.`);
    } catch (error) {
      await interaction.editReply(`${E('status_cross')} Không thể tick bảo hành: ${error.message}`);
    }
    return true;
  }
  return true;
}
