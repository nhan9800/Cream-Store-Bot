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
import { createOAuthRequestGuard, DiscordOAuthRequestError, fetchDiscordOAuthJson } from '../services/oauthRequestGuard.js';

const DISCORD_REQUEST_ATTEMPTS = 5;
const MAX_INLINE_WAIT_MS = 5_000;
const activeRuns = new Set();
const defaultOAuthGuard = createOAuthRequestGuard({ database: db });
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const oauthScope = (configuration, env) => ({ clientId: String(configuration.clientId || 'unconfigured'),
  store: String(env.ENV_FILE || '').includes('store2') ? 'store2' : 'store1' });
const noMentions = { parse: [], users: [], roles: [], repliedUser: false };
const safeName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/@/g, '＠').replace(/`/g, '′').replace(/</g, '‹').replace(/>/g, '›').slice(0, 80);
const credentialVersionFields = ['access_token', 'refresh_token', 'token_expires_at', 'scopes', 'recovery_consent_at', 'verified_at'];
const sameCredentialVersion = (left, right) => credentialVersionFields.every(field => left[field] === right[field]);
class RecoveryRecordChangedError extends Error {
  constructor() { super('Bản ghi recovery đã thay đổi hoặc không còn đủ quyền.'); this.name = 'RecoveryRecordChangedError'; }
}

export class RecoveryRequestError extends Error {
  constructor(code, { status = null, retryAfterMs = null } = {}) {
    super(code === 'TOKEN_COOLDOWN' ? 'Discord OAuth đang giới hạn; recovery tạm dừng.'
      : status ? `Refresh thất bại: Discord HTTP ${status}` : 'Yêu cầu recovery chưa hoàn tất.');
    this.name = 'RecoveryRequestError'; this.code = code; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}

/** Member-route waits never become OAuth-token cooldowns. No credentials stored. */
export function createRecoveryMemberCooldownGuard({ database = db, now = Date.now } = {}) {
  let initialized = false;
  function init() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS recovery_member_cooldowns (
      application_id TEXT NOT NULL,bucket_key TEXT NOT NULL,retry_at INTEGER NOT NULL,
      PRIMARY KEY(application_id,bucket_key));`);
    initialized = true;
  }
  return Object.freeze({
    retryAfter(applicationId, guildId) {
      init();
      const row = database.prepare('SELECT MAX(retry_at) AS retry_at FROM recovery_member_cooldowns WHERE application_id=? AND bucket_key IN (?,\'*\')')
        .get(applicationId, guildId);
      return Math.max(0, (row?.retry_at ?? 0) - now());
    },
    setCooldown(applicationId, guildId, waitMs, global = false) {
      init();
      const candidate = now() + waitMs;
      const retryAt = Number.isSafeInteger(candidate) ? candidate : Number.MAX_SAFE_INTEGER;
      database.prepare(`INSERT INTO recovery_member_cooldowns(application_id,bucket_key,retry_at) VALUES(?,?,?)
        ON CONFLICT(application_id,bucket_key) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)`)
        .run(applicationId, global ? '*' : guildId, retryAt);
    },
  });
}

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
export async function refreshAccessToken(refreshToken, { fetchImpl = fetch, configuration = config, env = process.env,
  requestGuard = defaultOAuthGuard, now = Date.now, timeoutMs = 12_000 } = {}) {
  const clientId = configuration.clientId;
  const clientSecret = env.CLIENT_SECRET;

  if (!String(clientSecret || '').trim()) throw new Error('CLIENT_SECRET chưa được cấu hình');
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) throw new Error('Token recovery không đầy đủ.');

  const scope = oauthScope(configuration, env), wait = requestGuard.retryAfter(scope);
  if (wait) throw new RecoveryRequestError('TOKEN_COOLDOWN', { status: 429, retryAfterMs: wait });
  let data;
  try {
    data = await fetchDiscordOAuthJson('https://discord.com/api/oauth2/token', {
      method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        grant_type: 'refresh_token', refresh_token: refreshToken }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, { fetchImpl, now, timeoutMs,
      onRateLimit: (retryMs, count, metadata) => metadata?.finalize
        ? requestGuard.finalizeCooldown(scope, metadata.finalize, retryMs) : requestGuard.setCooldown(scope, retryMs, count) });
  } catch (error) {
    if (error instanceof DiscordOAuthRequestError) {
      if (error.code === 'RATE_LIMITED') throw new RecoveryRequestError('TOKEN_COOLDOWN',
        { status: 429, retryAfterMs: requestGuard.retryAfter(scope) || error.retryAfterMs });
      throw new RecoveryRequestError(error.code, { status: error.status });
    }
    if (['TimeoutError', 'AbortError'].includes(error?.name)) throw error;
    throw new RecoveryRequestError('TOKEN_REQUEST_UNAVAILABLE');
  }
  if (!data || typeof data !== 'object'
    || typeof data.access_token !== 'string' || !data.access_token.trim()
    || (data.refresh_token != null && (typeof data.refresh_token !== 'string' || !data.refresh_token.trim()))
    || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || Number(data.expires_in) > 31_536_000) {
    throw new Error('Discord không trả thông tin làm mới token hợp lệ.');
  }
  if (data.scope != null) {
    const scopes = new Set(String(data.scope).split(/\s+/));
    if (!scopes.has('identify') || !scopes.has('guilds.join')) throw new Error('Quyền recovery không còn đầy đủ.');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: new Date(now() + Number(data.expires_in) * 1000).toISOString(),
  };
}

function retryWait(value) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (seconds === Infinity) return Infinity;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const milliseconds = Math.ceil(seconds * 1000);
  return Number.isSafeInteger(milliseconds) ? Math.max(50, milliseconds) : Infinity;
}
function retryDelayMs(response, payload, attempt, now) {
  const raw = response?.headers?.get?.('retry-after');
  let header = retryWait(raw);
  if (header === null && typeof raw === 'string') {
    const deadline = Date.parse(raw);
    if (Number.isFinite(deadline) && deadline >= now) header = Math.max(50, deadline - now);
  }
  const body = retryWait(payload?.retry_after);
  const known = [header, body].filter(value => value !== null);
  return known.length ? Math.max(...known) : response?.status === 429 ? 60_000 : 250 * (2 ** attempt);
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function readErrorPayload(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const chunks = []; let size = 0, complete = false;
  try {
    if (Number(response.headers?.get?.('content-length')) > 4096) return null;
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value?.byteLength || 0;
      if (size > 4096) return null;
      if (value?.byteLength) chunks.push(Buffer.from(value));
    }
    complete = true;
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { return null; }
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
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
  { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
    timeoutMs = 12_000, checkCooldown = () => 0, onRateLimit = () => {}, checkAuthorization = () => {} } = {},
) {
  let lastStatus = 0;
  let lastError = '';
  let retries = 0;
  for (let attempt = 0; attempt < DISCORD_REQUEST_ATTEMPTS; attempt += 1) {
    const cooling = checkCooldown();
    if (cooling) return { status: 429, ok: false, deferred: true, retryAfterMs: cooling, global: false,
      error: 'Discord đang giới hạn khôi phục; chưa gửi thêm yêu cầu.', retries };
    // Recheck after retry backoff as a browser callback can replace/revoke the
    // canonical grant while this request is waiting. Fail before sending it.
    checkAuthorization();
    let res;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      res = await abortable(fetchImpl(`https://discord.com/api/v10/guilds/${newGuildId}/members/${discordId}`, {
        method: 'PUT',
        redirect: 'error', signal,
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken, roles }),
      }), signal);
    } catch {
      lastStatus = 0;
      lastError = 'Không thể kết nối Discord trong thời hạn yêu cầu.';
      if (attempt >= DISCORD_REQUEST_ATTEMPTS - 1) break;
      retries += 1;
      await sleep(retryDelayMs(null, null, attempt, now()));
      continue;
    }
    lastStatus = res.status;

    // 201 = thêm mới, 204 = đã có trong server.
    if (res.status === 201 || res.status === 204) {
      void res.body?.cancel?.().catch(() => {});
      return { status: res.status, ok: true, error: '', retries };
    }

    let payload;
    try { payload = await readErrorPayload(res, signal); } catch { /* Keep only HTTP status and bounded wait metadata. */ }
    lastError = `Discord HTTP ${Number.isInteger(res.status) ? res.status : 0}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) break;
    const waitMs = retryDelayMs(res, payload, attempt, now());
    const global = payload?.global === true || res.headers?.get?.('x-ratelimit-global') === 'true'
      || res.headers?.get?.('x-ratelimit-scope') === 'global';
    if (res.status === 429 || waitMs > MAX_INLINE_WAIT_MS) onRateLimit(waitMs, global);
    if (global || waitMs > MAX_INLINE_WAIT_MS || attempt >= DISCORD_REQUEST_ATTEMPTS - 1) {
      return { status: res.status, ok: false, deferred: true, retryAfterMs: waitMs, global, error: lastError, retries };
    }

    retries += 1;
    await sleep(waitMs);
  }

  return { status: lastStatus, ok: false, error: lastError || `HTTP ${lastStatus}`, retries };
}

export async function syncMemberRoles(targetGuild, discordId, targetRoleIds, { checkAuthorization = () => {} } = {}) {
  if (!targetRoleIds.length) return { synced: 0, missing: 0, error: '' };
  const member = await targetGuild.members.fetch(discordId).catch(() => null);
  if (!member) return { synced: 0, missing: targetRoleIds.length, error: 'Không tìm thấy thành viên sau khi thêm vào server' };

  const missingRoleIds = targetRoleIds.filter((roleId) => !member.roles.cache.has(roleId));
  if (!missingRoleIds.length) return { synced: 0, missing: 0, error: '' };
  if (!member.roles?.add) {
    return { synced: 0, missing: missingRoleIds.length, error: 'Discord.js không hỗ trợ thêm role cho thành viên' };
  }

  try {
    checkAuthorization();
    await member.roles.add(missingRoleIds, 'Cenar recovery: đồng bộ role đã được khách đồng ý');
    return { synced: missingRoleIds.length, missing: 0, error: '' };
  } catch {
    return { synced: 0, missing: missingRoleIds.length, error: 'Discord chưa thể đồng bộ vai trò.' };
  }
}

export function createRecoveryCommand({ database = db, configuration = config, env = process.env,
  fetchImpl = (...args) => fetch(...args), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  decryptTokens = decrypt, encryptTokens = encrypt, roleMapping = getRecoveryRoleMapping,
  syncRoles = syncMemberRoles, emojiResolver = createEmojiResolver, requestGuard, memberCooldownGuard,
} = {}) {
  const tokenGuard = requestGuard || createOAuthRequestGuard({ database, now });
  const memberGuard = memberCooldownGuard || createRecoveryMemberCooldownGuard({ database, now });
  return async function executeRecovery(interaction) {
  const E = emojiResolver(interaction.guildId);

  // Kiểm tra quyền
  const canRunRecovery = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || hasConfiguredOwnerRole(interaction.member)
    || isBotDeveloper(interaction.user.id);
  if (!canRunRecovery) {
    return interaction.reply({ content: `${E('status_cross')} Chỉ Owner hoặc quản trị viên cấp cao được chạy khôi phục thành viên.`, ephemeral: true });
  }

  const newGuildId = interaction.options.getString('guild_id', true).trim();
  const sourceGuildId = String(interaction.options.getString('nguon') || interaction.guildId).trim();

  // Validate guild ID format
  if (!snowflake(newGuildId) || !snowflake(sourceGuildId)) {
    return interaction.reply({ content: 'ID server không hợp lệ. Phải là chuỗi số 17-20 chữ số.', ephemeral: true });
  }

  const applicationId = String(configuration.clientId || interaction.client?.user?.id || 'unconfigured');
  if (activeRuns.has(applicationId)) {
    return interaction.reply({ content: `${E('status_warn')} Một tác vụ recovery của ứng dụng này đang chạy. Vui lòng chờ kết quả trước khi mở tác vụ khác.`,
      flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
  }
  activeRuns.add(applicationId);
  try {
  await interaction.deferReply({ ephemeral: true });

  const botToken = configuration.botToken;
  if (!String(botToken || '').trim()) return interaction.editReply('Bot chưa có cấu hình xác thực recovery hợp lệ.');
  const scope = oauthScope(configuration, env);
  const initialWait = Math.max(tokenGuard.retryAfter(scope), memberGuard.retryAfter(applicationId, newGuildId));
  if (initialWait) return interaction.editReply(`Discord đang giới hạn recovery. Chờ ít nhất ${Math.ceil(initialWait / 1000)} giây trước khi mở tác vụ mới; chưa gửi yêu cầu thêm thành viên.`);
  const refresh = token => refreshAccessToken(token, { fetchImpl, configuration, env, requestGuard: tokenGuard, now });
  const add = (credential, roles) => addMemberToGuild(newGuildId, credential.row.discord_id, credential.accessToken, botToken, roles,
    { fetchImpl, sleep, now, checkCooldown: () => Math.max(tokenGuard.retryAfter(scope), memberGuard.retryAfter(applicationId, newGuildId)),
      checkAuthorization: () => assertCurrentCredential(credential),
      onRateLimit: (waitMs, global) => memberGuard.setCooldown(applicationId, newGuildId, waitMs, global) });

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
  const rows = database.prepare(
    `SELECT discord_id, username
     FROM oauth_backups
     WHERE guild_id = ? AND recovery_consent_at IS NOT NULL AND TRIM(recovery_consent_at)!=''
     ORDER BY verified_at`
  ).all(sourceGuildId);

  if (rows.length === 0) {
    return interaction.editReply(`Không có thành viên đã verify nào trong guild \`${sourceGuildId}\` được lưu trong hệ thống.`);
  }

  const readStmt = database.prepare(`SELECT discord_id,guild_id,username,access_token,refresh_token,token_expires_at,
    member_roles_json,scopes,recovery_consent_at,verified_at FROM oauth_backups WHERE discord_id=? AND guild_id=?`);
  const updateStmt = database.prepare(`UPDATE oauth_backups SET access_token=?,refresh_token=?,token_expires_at=?,
    last_refreshed_at=CURRENT_TIMESTAMP WHERE discord_id=? AND guild_id=? AND access_token IS ? AND refresh_token IS ?
    AND token_expires_at IS ? AND scopes IS ? AND recovery_consent_at IS ? AND verified_at IS ?`);
  function readCredential(discordId) {
    const row = readStmt.get(discordId, sourceGuildId);
    const scopes = new Set(String(row?.scopes || '').split(/\s+/));
    if (!snowflake(discordId) || row?.discord_id !== discordId || row.guild_id !== sourceGuildId
      || !String(row.recovery_consent_at || '').trim() || !scopes.has('identify') || !scopes.has('guilds.join')) {
      throw new RecoveryRecordChangedError();
    }
    const accessToken = decryptTokens(row.access_token), refreshToken = decryptTokens(row.refresh_token);
    if (typeof accessToken !== 'string' || !accessToken.trim() || typeof refreshToken !== 'string' || !refreshToken.trim()) {
      throw new RecoveryRecordChangedError();
    }
    return { row, accessToken, refreshToken };
  }
  function assertCurrentCredential(credential) {
    const fresh = readCredential(credential.row.discord_id);
    if (!sameCredentialVersion(credential.row, fresh.row)
      || credential.row.member_roles_json !== fresh.row.member_roles_json) throw new RecoveryRecordChangedError();
  }
  function usableReplacement(credential) {
    if (!(Date.parse(credential.row.token_expires_at || '') > now())) throw new RecoveryRecordChangedError();
    return credential;
  }
  async function refreshCredential(credential) {
    const fresh = readCredential(credential.row.discord_id);
    // A completed callback supersedes the old401/expiry snapshot. Never refresh
    // that stale grant or overwrite the callback's new pair.
    if (!sameCredentialVersion(credential.row, fresh.row)) return usableReplacement(fresh);
    const refreshed = await refresh(fresh.refreshToken);
    const changed = updateStmt.run(encryptTokens(refreshed.access_token), encryptTokens(refreshed.refresh_token), refreshed.expires_at,
      fresh.row.discord_id, sourceGuildId, ...credentialVersionFields.map(field => fresh.row[field])).changes;
    const canonical = readCredential(fresh.row.discord_id);
    return changed ? canonical : usableReplacement(canonical);
  }

  let countSuccess = 0;
  let countAlready = 0;
  let countFailed = 0;
  let countRoleSynced = 0;
  let countRoleFailed = 0;
  let processed = 0;
  let deferred = null;
  const failures = [];
  const tokenStopped = error => error instanceof RecoveryRequestError && (error.code === 'TOKEN_COOLDOWN'
    || ['TOKEN_REQUEST_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code) || [401, 403].includes(error.status) || error.status >= 500)
    || ['TimeoutError', 'AbortError'].includes(error?.name);
  const stopForToken = error => ({ kind: error?.code === 'TOKEN_COOLDOWN' ? 'TOKEN_COOLDOWN' : 'TOKEN_UNAVAILABLE',
    waitMs: error?.retryAfterMs ?? null });

  // Xử lý từng user với delay nhỏ để tránh rate limit
  for (const listed of rows) {
    let row = listed;
    processed++;
    try {
      const tokenWait = tokenGuard.retryAfter(scope);
      if (tokenWait) { deferred = { kind: 'TOKEN_COOLDOWN', waitMs: tokenWait }; break; }
      const memberWait = memberGuard.retryAfter(applicationId, newGuildId);
      if (memberWait) { deferred = { kind: 'MEMBER_COOLDOWN', waitMs: memberWait }; break; }
      let credential = readCredential(listed.discord_id);
      row = credential.row;

      // Refresh token nếu đã hết hạn hoặc sắp hết (trong vòng 1 giờ)
      const expiresAt = Date.parse(row.token_expires_at || '');
      const needsRefresh = !Number.isFinite(expiresAt) || expiresAt - now() < 3600 * 1000;

      if (needsRefresh) {
        try {
          credential = await refreshCredential(credential);
          row = credential.row;
        } catch (refreshErr) {
          if (tokenStopped(refreshErr)) { deferred = stopForToken(refreshErr); break; }
          failures.push({ user: row.username || row.discord_id, reason: `Refresh token thất bại` });
          countFailed++;
          continue;
        }
      }

      let mapped = roleMapping(row.member_roles_json, newGuild);
      let targetRoleIds = mapped.ids;
      if (mapped.skipped.length) {
        countRoleFailed++;
        failures.push({
          user: row.username || row.discord_id,
          reason: 'Một số vai trò đã lưu không thể khôi phục với quyền hiện tại của bot.',
        });
      }
      let result = await add(credential, targetRoleIds);

      // Token có thể bị thu hồi giữa lần kiểm tra expiry và request. Refresh
      // một lần rồi thử lại để không làm mất khách chỉ vì access token cũ.
      if (result.status === 401) {
        try {
          credential = await refreshCredential(credential);
          row = credential.row;
          mapped = roleMapping(row.member_roles_json, newGuild);
          targetRoleIds = mapped.ids;
          result = await add(credential, targetRoleIds);
        } catch (refreshErr) {
          if (tokenStopped(refreshErr)) { deferred = stopForToken(refreshErr); break; }
          // Giữ lỗi 401 ban đầu để báo cáo ngắn gọn cho Owner.
        }
      }

      // Một số server từ chối cả PUT khi một role nằm trên role cao nhất của
      // bot. Thử thêm thành viên trước với body roles rỗng, sau đó sync từng
      // role hợp lệ để phần di chuyển vẫn hoàn tất.
      if (!result.ok && [400, 403].includes(result.status) && targetRoleIds.length) {
        const joinOnlyResult = await add(credential, []);
        if (joinOnlyResult.ok || joinOnlyResult.deferred) result = joinOnlyResult;
      }

      if (result.deferred) { deferred = { kind: result.global ? 'GLOBAL_COOLDOWN' : 'MEMBER_COOLDOWN', waitMs: result.retryAfterMs }; break; }

      if (result.status === 201) {
        countSuccess++;
      } else if (result.status === 204) {
        countAlready++;
      } else {
        failures.push({ user: row.username || row.discord_id, reason: result.error || `HTTP ${result.status}` });
        countFailed++;
        continue;
      }

      try { assertCurrentCredential(credential); }
      catch {
        countRoleFailed++;
        failures.push({ user: row.username || row.discord_id, reason: 'Quyền recovery đã thay đổi trong lúc Discord xử lý; chưa gửi thêm yêu cầu vai trò.' });
        continue;
      }

      // 201 có thể vẫn không gán được role nếu bot thiếu hierarchy; 204 cũng
      // không đảm bảo body roles được áp dụng cho thành viên đã tồn tại.
      const roleSync = await syncRoles(newGuild, row.discord_id, targetRoleIds,
        { checkAuthorization: () => assertCurrentCredential(credential) });
      countRoleSynced += roleSync.synced;
      if (roleSync.error || roleSync.missing > 0) {
        countRoleFailed++;
        failures.push({
          user: row.username || row.discord_id,
          reason: 'Chưa đồng bộ đủ các vai trò đã lưu; cần kiểm tra quyền và hierarchy.',
        });
      }
    } catch {
      failures.push({ user: row.username || row.discord_id, reason: 'Chưa thể xử lý bản ghi recovery này.' });
      countFailed++;
    } finally {
      // Pace every record, including continue, failure, and deferred exits.
      await sleep(120);
    }
  }

  const hasWarnings = Boolean(deferred) || countFailed > 0 || countRoleFailed > 0;
  const icon = !hasWarnings ? E('status_check') : countSuccess > 0 || countAlready > 0 ? E('status_warn') : E('status_cross');
  const lines = [
    `## ${icon} ${deferred ? 'TẠM DỪNG KHÔI PHỤC THÀNH VIÊN' : 'KHÔI PHỤC THÀNH VIÊN HOÀN TẤT'}`,
    `> ${E('recovery_backup')} Nguồn: \`${sourceGuildId}\``,
    `> ${E('recovery_restore')} Đích: **${safeName(newGuild.name)}** (\`${newGuildId}\`)`,
    '',
    `${E('status_check')} **Thêm mới:** ${countSuccess}`,
    `${E('icon_group')} **Đã có sẵn:** ${countAlready}`,
    `${E('icon_group')} **Role đã đồng bộ:** ${countRoleSynced}`,
    `${E('status_warn')} **Ca role cần kiểm tra:** ${countRoleFailed}`,
    `${E('status_cross')} **Thất bại:** ${countFailed}`,
  ];
  if (deferred) {
    lines.push(`${E('status_warn')} **Chưa xử lý:** ${rows.length - processed + 1} bản ghi. Không tự chạy lại tác vụ.`,
      deferred.waitMs === null ? 'Discord chưa sẵn sàng; kiểm tra cấu hình hoặc kết nối trước khi chạy lại.'
        : `Chờ ít nhất ${Number.isFinite(deferred.waitMs) ? Math.ceil(deferred.waitMs / 1000) : 'thời gian Discord yêu cầu'} giây trước khi thử lại.`);
  }
  if (failures.length > 0) {
    lines.push(
      '',
      `### ${E('status_warn')} CHI TIẾT CẦN KIỂM TRA`,
      ...failures.slice(0, 8).map((failure) => `> \`${safeName(failure.user)}\` • ${failure.reason}`),
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
    allowedMentions: noMentions,
  });
  return { status: deferred ? 'DEFERRED' : 'COMPLETE', processed, remaining: deferred ? rows.length - processed + 1 : 0,
    added: countSuccess, already: countAlready, failed: countFailed, retryAfterMs: deferred?.waitMs ?? null };
  } finally { activeRuns.delete(applicationId); }
  };
}
export const execute = createRecoveryCommand();
