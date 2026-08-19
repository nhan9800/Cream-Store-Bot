import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import {
  getWalletBalance,
  addWalletBalance,
  getWalletTransactions,
  getWalletSummary,
} from '../services/walletService.js';
import { formatCurrency } from '../utils/formatters.js';

export const data = new SlashCommandBuilder()
  .setName('wallet')
  .setDescription('Quản lý Ví Cenar dùng chung giữa website và Discord Bot')
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('Xem số dư và lịch sử Ví Cenar')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Chỉ quản trị viên được xem ví của người khác').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Cộng hoặc trừ số dư ví (Quản trị viên)')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Khách hàng').setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName('amount').setDescription('Số tiền; dùng số âm để trừ').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('reason').setDescription('Lý do điều chỉnh').setRequired(false)
      )
  );

function oneLine(value, maxLength = 120) {
  return String(value || 'Giao dịch Ví Cenar')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function transactionLabel(type) {
  return {
    TOPUP: 'Nạp ví',
    PAYMENT: 'Thanh toán',
    PAY_ORDER: 'Thanh toán',
    REFUND: 'Hoàn tiền',
    ADMIN_ADD: 'Điều chỉnh tăng',
    ADMIN_SUB: 'Điều chỉnh giảm',
    CARD_TOPUP: 'Nạp bằng thẻ',
  }[String(type || '').toUpperCase()] || 'Giao dịch';
}

function transactionLine(tx, E) {
  const amount = Number(tx.amount || 0);
  const positive = amount >= 0;
  const icon = positive ? E('status_check') : E('payment_money');
  const sign = positive ? '+' : '−';
  const unix = Math.floor(new Date(tx.created_at).getTime() / 1000);
  const timestamp = Number.isFinite(unix) ? `<t:${unix}:R>` : 'không rõ thời gian';
  const code = tx.related_code ? ` · \`${oneLine(tx.related_code, 40)}\`` : '';
  return [
    `${icon} **${sign}${formatCurrency(Math.abs(amount))}** · ${transactionLabel(tx.type)}`,
    `-# ${oneLine(tx.description)}${code} · ${timestamp}`,
  ].join('\n');
}

export function buildWalletView({ guildId, targetUser, balance, summary, transactions }) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0x76e0b6);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('icon_wallet')} VÍ CENAR`,
      `-# Tài khoản <@${targetUser.id}> · Đồng bộ trực tiếp với cenarstore.xyz`,
      '',
      '### Số dư khả dụng',
      `# ${formatCurrency(balance)}`,
      '',
      `> ${E('icon_green')} **Tổng tiền vào:** ${formatCurrency(summary.totalIn)}`,
      `> ${E('icon_red')} **Tổng đã sử dụng:** ${formatCurrency(summary.totalOut)}`,
      `> ${E('icon_clipboard')} **Số giao dịch:** ${summary.transactionCount}`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      transactions.length > 0
        ? [
            '### Giao dịch gần đây',
            ...transactions.flatMap((tx, index) => [
              transactionLine(tx, E),
              ...(index < transactions.length - 1 ? [''] : []),
            ]),
          ].join('\n')
        : [
            '### Giao dịch gần đây',
            `${E('status_info')} Ví chưa có giao dịch nào.`,
          ].join('\n'),
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${E('status_info')} Dữ liệu tài chính chỉ hiển thị riêng cho bạn và đội ngũ quản trị.`,
    ),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function buildWalletAdjustment({ guildId, targetUser, amount, reason, newBalance }) {
  const E = createEmojiResolver(guildId);
  const positive = amount > 0;
  const container = new ContainerBuilder().setAccentColor(positive ? 0x57f2b2 : 0xff6b6b);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${positive ? E('status_check') : E('status_warn')} ĐÃ CẬP NHẬT VÍ`,
      '',
      `> **Khách hàng:** <@${targetUser.id}>`,
      `> **Điều chỉnh:** ${positive ? '+' : '−'}${formatCurrency(Math.abs(amount))}`,
      `> **Lý do:** ${oneLine(reason, 300)}`,
      '',
      `### Số dư mới · ${formatCurrency(newBalance)}`,
      `-# Thao tác quản trị đã được ghi vào lịch sử ví.`,
    ].join('\n')),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const canManageWallet = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild);

  if (subcommand === 'view') {
    const requestedUser = interaction.options.getUser('user');
    if (requestedUser && requestedUser.id !== interaction.user.id && !canManageWallet) {
      return interaction.reply({
        content: `${E('status_cross')} Số dư ví là thông tin riêng tư. Bạn chỉ có thể xem ví của chính mình.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    const targetUser = requestedUser || interaction.user;
    const balance = getWalletBalance(guildId, targetUser.id);
    const summary = getWalletSummary(guildId, targetUser.id);
    const transactions = getWalletTransactions(guildId, targetUser.id, 6);
    return interaction.reply(buildWalletView({ guildId, targetUser, balance, summary, transactions }));
  }

  if (subcommand === 'add') {
    if (!canManageWallet) {
      return interaction.reply({
        content: `${E('status_cross')} Bạn không có quyền điều chỉnh số dư ví.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const reason = interaction.options.getString('reason') || 'Quản trị viên điều chỉnh số dư';
    if (amount === 0) {
      return interaction.reply({
        content: `${E('status_cross')} Số tiền phải khác 0.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const type = amount > 0 ? 'ADMIN_ADD' : 'ADMIN_SUB';
    const newBalance = addWalletBalance(guildId, targetUser.id, amount, type, reason);
    return interaction.reply(buildWalletAdjustment({
      guildId,
      targetUser,
      amount,
      reason,
      newBalance,
    }));
  }
}
