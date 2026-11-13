import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { getRecoveryStatus } from './guildRecoveryService.js';
import { memberHasVerificationRole, resolveVerificationRole } from './verificationRoleService.js';
import { buildVerificationPromptV2, buildVerificationUnavailableV2 } from './verificationPanelService.js';

const memberRequests = new WeakMap();
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);

/** Launch only the configured HTTPS origin; never infer it from an interaction. */
export function verificationLoginUrl(publicBaseUrl, guildId) {
  const base = String(publicBaseUrl || '').trim();
  if (!snowflake(guildId) || !base || /[\s\\\u0000-\u001f\u007f]/u.test(base)) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/oauth/login`;
    url.searchParams.set('guild_id', guildId);
    return url.href;
  } catch { return null; }
}

function recordedRecoveryConsent(recovery) {
  const scopes = new Set(String(recovery?.scopes || '').trim().split(/\s+/));
  return Boolean(recovery?.recovery_consent_at && scopes.has('identify') && scopes.has('guilds.join'));
}

function completeMember(member, guildId, userId) {
  return member?.id === userId && member.partial !== true
    && (!member.guild?.id || member.guild.id === guildId)
    && typeof member.roles?.cache?.has === 'function';
}

async function verificationMember(guild, userId) {
  const cached = guild.members?.cache?.get(userId);
  if (completeMember(cached, guild.id, userId)) return cached;
  if (typeof guild.members?.fetch !== 'function') return null;
  let pending = memberRequests.get(guild);
  if (!pending) { pending = new Map(); memberRequests.set(guild, pending); }
  if (pending.has(userId)) return pending.get(userId);
  const task = Promise.resolve().then(() => guild.members.fetch(userId)).catch(() => null);
  pending.set(userId, task);
  try { return await task; }
  finally { if (pending.get(userId) === task) pending.delete(userId); }
}

/** The caller retains its existing button cooldown. This never grants roles. */
export async function handleVerificationInteraction(interaction, {
  publicBaseUrl = config.publicBaseUrl,
  env = process.env,
  getRecovery = getRecoveryStatus,
  resolveRole = resolveVerificationRole,
} = {}) {
  if (interaction?.customId !== 'oauth:verify:button') return false;
  if (interaction.deferred || interaction.replied) return true;
  // Acknowledge before any member REST request; use exactly one edit afterward.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  let payload;
  try {
    const guild = interaction.guild;
    if (!snowflake(guildId) || !snowflake(interaction.user?.id) || guild?.id !== guildId) {
      payload = buildVerificationUnavailableV2(guildId, { reason: 'guild' });
    } else if (!String(env.CLIENT_SECRET || '').trim() || !String(env.ENCRYPTION_KEY || '').trim()) {
      payload = buildVerificationUnavailableV2(guildId);
    } else {
      const member = await verificationMember(guild, interaction.user.id);
      const role = resolveRole(guild);
      if (!completeMember(member, guildId, interaction.user.id)) {
        payload = buildVerificationUnavailableV2(guildId, { reason: 'member' });
      } else if (!role) {
        payload = buildVerificationUnavailableV2(guildId);
      } else {
        const hasRole = memberHasVerificationRole(member, role);
        const recoveryActive = recordedRecoveryConsent(await getRecovery(guildId, interaction.user.id));
        const loginUrl = verificationLoginUrl(publicBaseUrl, guildId);
        payload = !loginUrl && !(hasRole && recoveryActive)
          ? buildVerificationUnavailableV2(guildId, { reason: 'launch' })
          : buildVerificationPromptV2({ guildId, username: interaction.user.username,
            loginUrl, hasRole, recoveryActive });
      }
    }
  } catch {
    payload = buildVerificationUnavailableV2(guildId, { reason: 'temporary' });
  }
  // Privacy was set by deferReply; edit cannot change it. Retain only edit flags.
  await interaction.editReply({ ...payload, flags: payload.flags & ~MessageFlags.Ephemeral });
  return true;
}
