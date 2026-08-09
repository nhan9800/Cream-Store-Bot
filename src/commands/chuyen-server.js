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
import { mapRecoveryRoleIds } from '../services/guildRecoveryService.js';

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
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in || 604800) * 1000).toISOString(),
  };
}

// Thêm user vào guild mới dùng access_token của họ
async function addMemberToGuild(newGuildId, discordId, accessToken, botToken, roles = []) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${newGuildId}/members/${discordId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: accessToken, roles }),
  });

  // 201 = thêm mới, 204 = đã có trong server
  let error = '';
  if (res.status !== 201 && res.status !== 204) {
    const payload = await res.json().catch(() => null);
    error = String(payload?.message || `HTTP ${res.status}`).slice(0, 100);
  }
  return { status: res.status, ok: res.status === 201 || res.status === 204, error };
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
  if (!newGuild.members.me?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
    return interaction.editReply(`${E('status_cross')} Bot cần quyền **Create Invite** tại server đích để Discord cho phép thêm thành viên qua OAuth2.`);
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
      const refreshToken = decrypt(row.refresh_token);
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
          // Lưu token mới vào DB ngay lập tức
          updateStmt.run(encrypt(refreshed.access_token), encrypt(refreshed.refresh_token), refreshed.expires_at, row.discord_id, sourceGuildId);
        } catch (refreshErr) {
          failures.push({ user: row.username || row.discord_id, reason: `Refresh token thất bại` });
          countFailed++;
          continue;
        }
      }

      const targetRoleIds = mapRecoveryRoleIds(row.member_roles_json, newGuild);
      const result = await addMemberToGuild(newGuildId, row.discord_id, accessToken, botToken, targetRoleIds);

      if (result.status === 201) {
        countSuccess++;
      } else if (result.status === 204) {
        countAlready++;
      } else {
        failures.push({ user: row.username || row.discord_id, reason: result.error || `HTTP ${result.status}` });
        countFailed++;
      }
    } catch (err) {
      failures.push({ user: row.username || row.discord_id, reason: err.message.slice(0, 60) });
      countFailed++;
    }

    // Delay 120ms giữa mỗi request để tránh rate limit Discord
    await new Promise(r => setTimeout(r, 120));
  }

  const icon = countFailed === 0 ? E('status_check') : countSuccess > 0 ? E('status_warn') : E('status_cross');
  const lines = [
    `## ${icon} KHÔI PHỤC THÀNH VIÊN HOÀN TẤT`,
    `> ${E('recovery_backup')} Nguồn: \`${sourceGuildId}\``,
    `> ${E('recovery_restore')} Đích: **${newGuild.name}** (\`${newGuildId}\`)`,
    '',
    `${E('status_check')} **Thêm mới:** ${countSuccess}`,
    `${E('icon_group')} **Đã có sẵn:** ${countAlready}`,
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
    .setAccentColor(countFailed === 0 ? 0x10B981 : countSuccess > 0 ? 0xF59E0B : 0xEF4444)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  await interaction.editReply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}
