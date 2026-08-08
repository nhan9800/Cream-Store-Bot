import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from './guildConfigService.js';
import { recordStaffLog } from './staffLogService.js';

function clean(value, max = 500) {
  return String(value ?? '')
    .replace(/[`*_~|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function maskPhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  if (phone.length < 7) return 'Đã ẩn';
  return `${phone.slice(0, 3)}***${phone.slice(-3)}`;
}

export function maskSerial(value) {
  const serial = String(value || '').trim();
  if (serial.length < 6) return 'Đã ẩn';
  return `${serial.slice(0, 3)}***${serial.slice(-3)}`;
}

export async function emitAutomationLog(client, {
  guildId,
  customerId,
  action,
  title,
  summary,
  reference,
  fields = [],
  status = 'info',
}) {
  const safeReference = clean(reference, 80);
  const safeSummary = clean(summary, 700);
  recordStaffLog({
    guildId,
    targetId: customerId || null,
    action: clean(action || title, 80),
    detail: [safeReference && `Mã: ${safeReference}`, safeSummary].filter(Boolean).join(' · '),
  });

  if (!client) return;
  const settings = getGuildConfig(guildId);
  if (!settings?.staff_log_channel_id) return;
  const guild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild
    ? await guild.channels.fetch(settings.staff_log_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) return;

  const E = createEmojiResolver(guildId);
  const palette = {
    success: { color: 0x57f287, emoji: E('status_check') },
    warning: { color: 0xfee75c, emoji: E('status_warn') },
    danger: { color: 0xed4245, emoji: E('status_cross') },
    info: { color: 0x5865f2, emoji: E('status_info') },
  };
  const tone = palette[status] || palette.info;
  const lines = [
    `## ${tone.emoji} ${clean(title, 120)}`,
    safeSummary ? `> ${safeSummary}` : null,
    '',
    customerId ? `${E('ticket_user')} **Khách hàng** — <@${customerId}>` : null,
    safeReference ? `${E('icon_id')} **Mã tham chiếu** — \`${safeReference}\`` : null,
    ...fields
      .map((field) => {
        const label = clean(field?.label, 80);
        const value = clean(field?.value, 300);
        const emoji = E(field?.emoji || 'status_info');
        return label && value ? `${emoji} **${label}** — ${value}` : null;
      }),
  ].filter((line) => line !== null);

  const container = new ContainerBuilder().setAccentColor(tone.color);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${E('icon_clock')} Ghi nhận tự động · <t:${Math.floor(Date.now() / 1000)}:F>`),
  );

  await channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch((error) => console.error('[AUTOMATION_LOG] Không thể gửi log:', error.message));
}
