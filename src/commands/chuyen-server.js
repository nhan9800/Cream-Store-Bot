import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { hasConfiguredOwnerRole, isBotDeveloper } from '../utils/permissions.js';
import { getRecoveryRoleMapping } from '../services/guildRecoveryService.js';

const DISCORD_REQUEST_ATTEMPTS = 5;
const MAX_RETRY_WAIT_MS = 60_000;

export const data = new SlashCommandBuilder()
  .setName('chuyen-server')
  .setDescription('[Admin] Di chuyển toàn bộ thành viên đã verify sang server mới bằng OAuth2 token')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(opt =>
    opt.setName('guild_id')
      .setDescription('ID của server mới cần chuyển thành viên vào')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('nguon')
      .setDescription('Chỉ chuyển từ guild cụ thể (mặc định: guild hiện tại)')
      .setRequired(false)
  );

// Refresh access token dùng refresh_token
async function refreshAccessToken(refreshToken) {
  const clientId = config.clientId;
  const clientSecret = process.env.CLIENT_SECRET;

  if (!clientSecret) throw new Error('CLIENT_SECRET chưa được cấu hình');

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Refresh thất bại: ${err}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: new Date(Date.now() + (data.expires_in || 604800) * 1000).toISOString(),
  };
}

function retryDelayMs(response, payload, attempt) {
  const headerValue = response?.headers?.get?.('retry-after');
  const retryAfterSeconds = Number(payload?.retry_after ?? headerValue);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(MAX_RETRY_WAIT_MS, Math.max(50, retryAfterSeconds * 1000));
  }
  return Math.min(MAX_RETRY_WAIT_MS, 250 * (2 ** attempt));
}

async function readErrorPayload(response) {
  if (typeof response.json !== 'function') return null;
  return response.json().catch(() => null);
}

// Thêm user vào guild mới dùng access_token của họ.
// Discord có thể trả 429 theo bucket riêng hoặc giới hạn toàn cục; luôn tôn
// trọng Retry-After/retry_after trước khi thử lại.
export async function addMemberToGuild(
  newGuildId,
  discordId,
  accessToken,
  botToken,
  roles = [],
  { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  let lastStatus = 0;
  let lastError = '';
  let retries = 0;
  for (let attempt = 0; attempt < DISCORD_REQUEST_ATTEMPTS; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(`https://discord.com/api/v10/guilds/${newGuildId}/members/${discordId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken, roles }),
      });
    } catch (error) {
      lastStatus = 0;
      lastError = String(error?.message || 'Lỗi mạng khi gọi Discord').slice(0, 120);
      if (attempt >= DISCORD_REQUEST_ATTEMPTS - 1) break;
      retries += 1;
      await sleep(retryDelayMs(null, null, attempt));
      continue;
    }
    lastStatus = res.status;

    // 201 = thêm mới, 204 = đã có trong server.
    if (res.status === 201 || res.status === 204) {
      return { status: res.status, ok: true, error: '', retries };
    }

    const payload = await readErrorPayload(res);
    lastError = String(payload?.message || `HTTP ${res.status}`).slice(0, 120);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= DISCORD_REQUEST_ATTEMPTS - 1) break;

    retries += 1;
    await sleep(retryDelayMs(res, payload, attempt));
  }

  return { status: lastStatus, ok: false, error: lastError || `HTTP ${lastStatus}`, retries };
}

export async function syncMemberRoles(targetGuild, discordId, targetRoleIds) {
  if (!targetRoleIds.length) return { synced: 0, missing: 0, error: '' };
  const member = await targetGuild.members.fetch(discordId).catch(() => null);
  if (!member) return { synced: 0, missing: targetRoleIds.length, error: 'Không tìm thấy thành viên sau khi thêm vào server' };

  const missingRoleIds = targetRoleIds.filter((roleId) => !member.roles.cache.has(roleId));
  if (!missingRoleIds.length) return { synced: 0, missing: 0, error: '' };
  if (!member.roles?.add) {
    return { synced: 0, missing: missingRoleIds.length, error: 'Discord.js không hỗ trợ thêm role cho thành viên' };
  }

  try {
    await member.roles.add(missingRoleIds, 'Cenar recovery: đồng bộ role đã được khách đồng ý');
    return { synced: missingRoleIds.length, missing: 0, error: '' };
  } catch (error) {
    return { synced: 0, missing: missingRoleIds.length, error: error.message.slice(0, 120) };
  }
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);

  // Kiểm tra quyền
  const canRunRecovery = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || hasConfiguredOwnerRole(interaction.member)
    || isBotDeveloper(interaction.user.id);
  if (!canRunRecovery) {
    return interaction.reply({ content: `${E('status_cross')} Chỉ Owner hoặc quản trị viên cấp cao được chạy khôi phục thành viên.`, ephemeral: true });
  }

  const newGuildId = interaction.options.getString('guild_id', true).trim();
  const sourceGuildId = interaction.options.getString('nguon') || interaction.guildId;

  // Validate guild ID format
  if (!/^\d{17,20}$/.test(newGuildId)) {
    return interaction.reply({ content: 'ID server không hợp lệ. Phải là chuỗi số 17-20 chữ số.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const botToken = config.botToken;

  // Kiểm tra bot có trong server mới không
  let newGuild;
  try {
    newGuild = await interaction.client.guilds.fetch(newGuildId);
  } catch {
    return interaction.editReply(`${E('status_cross')} Bot chưa có trong server đích. Hãy mời bot vào server mới trước.`);
  }
  const targetPermissions = newGuild.members.me?.permissions;
  if (!targetPermissions?.has(PermissionFlagsBits.CreateInstantInvite)) {
    return interaction.editReply(`${E('status_cross')} Bot cần quyền **Create Invite** tại server đích để Discord cho phép thêm thành viên qua OAuth2.`);
  }
  if (!targetPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply(`${E('status_cross')} Bot cần quyền **Manage Roles** tại server đích để tự động gán lại role cho khách.`);
  }

  // Lấy danh sách user cần chuyển
  const rows = db.prepare(
    `SELECT discord_id, username, access_token, refresh_token, token_expires_at,
            member_roles_json, scopes, recovery_consent_at
     FROM oauth_backups
     WHERE guild_id = ? AND recovery_consent_at IS NOT NULL
     ORDER BY verified_at`
  ).all(sourceGuildId);

  if (rows.length === 0) {
    return interaction.editReply(`Không có thành viên đã verify nào trong guild \`${sourceGuildId}\` được lưu trong hệ thống.`);
  }

  const updateStmt = db.prepare(
    'UPDATE oauth_backups SET access_token = ?, refresh_token = ?, token_expires_at = ?, last_refreshed_at = CURRENT_TIMESTAMP WHERE discord_id = ? AND guild_id = ?'
  );

  let countSuccess = 0;
  let countAlready = 0;
  let countFailed = 0;
  let countRoleSynced = 0;
  let countRoleFailed = 0;
  const failures = [];

  // Xử lý từng user với delay nhỏ để tránh rate limit
  for (const row of rows) {
    try {
      if (!String(row.scopes || '').split(/\s+/).includes('guilds.join')) {
        failures.push({ user: row.username || row.discord_id, reason: 'Thiếu quyền guilds.join' });
        countFailed++;
        continue;
      }
      let accessToken = decrypt(row.access_token);
      let refreshToken = decrypt(row.refresh_token);
      if (!accessToken || !refreshToken) {
        failures.push({ user: row.username || row.discord_id, reason: 'Token recovery không đầy đủ' });
        countFailed++;
        continue;
      }

      // Refresh token nếu đã hết hạn hoặc sắp hết (trong vòng 1 giờ)
      const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;
      const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 3600 * 1000;

      if (needsRefresh && refreshToken) {
        try {
          const refreshed = await refreshAccessToken(refreshToken);
          accessToken = refreshed.access_token;
          refreshToken = refreshed.refresh_token || refreshToken;
          // Lưu token mới vào DB ngay lập tức
          updateStmt.run(encrypt(refreshed.access_token), encrypt(refreshToken), refreshed.expires_at, row.discord_id, sourceGuildId);
        } catch (refreshErr) {
          failures.push({ user: row.username || row.discord_id, reason: `Refresh token thất bại` });
          countFailed++;
          continue;
        }
      }

      const roleMapping = getRecoveryRoleMapping(row.member_roles_json, newGuild);
      const targetRoleIds = roleMapping.ids;
      if (roleMapping.skipped.length) {
        countRoleFailed++;
        failures.push({
          user: row.username || row.discord_id,
          reason: `Không thể map role: ${roleMapping.skipped.slice(0, 3).join(', ')}`,
        });
      }
      let result = await addMemberToGuild(newGuildId, row.discord_id, accessToken, botToken, targetRoleIds);

      // Token có thể bị thu hồi giữa lần kiểm tra expiry và request. Refresh
      // một lần rồi thử lại để không làm mất khách chỉ vì access token cũ.
      if (result.status === 401 && refreshToken) {
        try {
          const refreshed = await refreshAccessToken(refreshToken);
          accessToken = refreshed.access_token;
          refreshToken = refreshed.refresh_token || refreshToken;
          updateStmt.run(encrypt(refreshed.access_token), encrypt(refreshToken), refreshed.expires_at, row.discord_id, sourceGuildId);
          result = await addMemberToGuild(newGuildId, row.discord_id, accessToken, botToken, targetRoleIds);
        } catch {
          // Giữ lỗi 401 ban đầu để báo cáo ngắn gọn cho Owner.
        }
      }

      // Một số server từ chối cả PUT khi một role nằm trên role cao nhất của
      // bot. Thử thêm thành viên trước với body roles rỗng, sau đó sync từng
      // role hợp lệ để phần di chuyển vẫn hoàn tất.
      if (!result.ok && [400, 403].includes(result.status) && targetRoleIds.length) {
        const joinOnlyResult = await addMemberToGuild(newGuildId, row.discord_id, accessToken, botToken, []);
        if (joinOnlyResult.ok) result = joinOnlyResult;
      }

      if (result.status === 201) {
        countSuccess++;
      } else if (result.status === 204) {
        countAlready++;
      } else {
        failures.push({ user: row.username || row.discord_id, reason: result.error || `HTTP ${result.status}` });
        countFailed++;
        continue;
      }

      // 201 có thể vẫn không gán được role nếu bot thiếu hierarchy; 204 cũng
      // không đảm bảo body roles được áp dụng cho thành viên đã tồn tại.
      const roleSync = await syncMemberRoles(newGuild, row.discord_id, targetRoleIds);
      countRoleSynced += roleSync.synced;
      if (roleSync.error || roleSync.missing > 0) {
        countRoleFailed++;
        failures.push({
          user: row.username || row.discord_id,
          reason: `Gán role chưa đủ (${roleSync.error || `thiếu ${roleSync.missing}`})`,
        });
      }
    } catch (err) {
      failures.push({ user: row.username || row.discord_id, reason: err.message.slice(0, 60) });
      countFailed++;
    }

    // Delay 120ms giữa mỗi request để tránh rate limit Discord
    await new Promise(r => setTimeout(r, 120));
  }

  const hasWarnings = countFailed > 0 || countRoleFailed > 0;
  const icon = !hasWarnings ? E('status_check') : countSuccess > 0 || countAlready > 0 ? E('status_warn') : E('status_cross');
  const lines = [
    `## ${icon} KHÔI PHỤC THÀNH VIÊN HOÀN TẤT`,
    `> ${E('recovery_backup')} Nguồn: \`${sourceGuildId}\``,
    `> ${E('recovery_restore')} Đích: **${newGuild.name}** (\`${newGuildId}\`)`,
    '',
    `${E('status_check')} **Thêm mới:** ${countSuccess}`,
    `${E('icon_group')} **Đã có sẵn:** ${countAlready}`,
    `${E('icon_group')} **Role đã đồng bộ:** ${countRoleSynced}`,
    `${E('status_warn')} **Ca role cần kiểm tra:** ${countRoleFailed}`,
    `${E('status_cross')} **Thất bại:** ${countFailed}`,
  ];
  if (failures.length > 0) {
    lines.push(
      '',
      `### ${E('status_warn')} CHI TIẾT CẦN KIỂM TRA`,
      ...failures.slice(0, 8).map((failure) => `> \`${failure.user}\` • ${failure.reason}`),
    );
    if (failures.length > 8) lines.push(`-# Còn ${failures.length - 8} lỗi khác trong log hệ thống.`);
  }
  lines.push('', `-# ${E('icon_lock')} Token chỉ được giải mã trong bộ nhớ khi gọi API Discord.`);

  const container = new ContainerBuilder()
    .setAccentColor(!hasWarnings ? 0x10B981 : countSuccess > 0 || countAlready > 0 ? 0xF59E0B : 0xEF4444)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
