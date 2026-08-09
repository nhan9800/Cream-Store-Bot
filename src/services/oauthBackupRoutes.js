import { config } from '../config.js';
import { db } from '../database/db.js';
import { timingSafeEqual } from 'node:crypto';
import { encrypt } from '../utils/crypto.js';
import {
  createOAuthState,
  oauthStateCookieName,
  OAUTH_STATE_TTL_MS,
  parseCookieHeader,
  verifyOAuthState,
} from '../utils/oauthState.js';
import { snapshotGuildForRecovery, updateOauthMemberSnapshot } from './guildRecoveryService.js';
import { buildVerificationSuccessDmV2 } from './verificationPanelService.js';
import { resolveVerificationRole } from './verificationRoleService.js';

// So sánh key an toàn theo thời gian (chống timing attack), fail-closed nếu thiếu key.
function safeKeyMatch(provided) {
  const expected = process.env.BOT_API_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerOauthRoutes(app) {
  
  // 1. Route redirect to Discord OAuth2 page
  app.get('/oauth/login', async (req, res) => {
    const guildId = String(req.query.guild_id || config.guildId || '').trim();
    const clientId = config.clientId;
    
    if (!clientId) {
      return res.status(500).send('CLIENT_ID is not configured in bot settings.');
    }
    if (!String(process.env.CLIENT_SECRET || '').trim() || !String(process.env.ENCRYPTION_KEY || '').trim()) {
      return res.status(503).send(buildErrorPage(
        'Recovery đang chờ cấu hình',
        'Owner cần hoàn tất khóa OAuth và mã hóa trên hosting trước khi người dùng xác minh.',
      ));
    }

    if (!/^\d{17,20}$/.test(guildId)) {
      return res.status(400).send(buildErrorPage('Server không hợp lệ', 'Liên kết xác minh không chứa Discord server hợp lệ.'));
    }
    const discordClient = req.app.locals.discordClient;
    const guild = discordClient?.isReady?.()
      ? await discordClient.guilds.fetch(guildId).catch(() => null)
      : null;
    if (!guild) {
      return res.status(400).send(buildErrorPage('Không tìm thấy server', 'Bot chưa sẵn sàng hoặc không thuộc Discord server này.'));
    }

    const host = req.get('host');
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const baseUrl = config.publicBaseUrl || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/oauth/callback`;
    const state = createOAuthState(guildId);
    const cookieName = oauthStateCookieName(clientId);
    const secureCookie = baseUrl.startsWith('https://') ? '; Secure' : '';
    const cookiePath = new URL(redirectUri).pathname;
    res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(state)}; Max-Age=${Math.floor(OAUTH_STATE_TTL_MS / 1000)}; Path=${cookiePath}; HttpOnly; SameSite=Lax${secureCookie}`);
    const authorizeUrl = `https://discord.com/api/oauth2/authorize?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds.join',
      state,
    }).toString()}`;
    
    res.redirect(authorizeUrl);
  });

  // 2. Route OAuth2 Callback
  app.get('/oauth/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send(buildErrorPage('Thiếu mã xác minh', 'Không tìm thấy mã xác minh từ Discord. Vui lòng thử lại.'));
    }

    const clientSecret = process.env.CLIENT_SECRET;
    const clientId = config.clientId;

    const host = req.get('host');
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const baseUrl = config.publicBaseUrl || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/oauth/callback`;
    const cookieName = oauthStateCookieName(clientId);
    const cookies = parseCookieHeader(req.headers.cookie);
    let guildId;
    try {
      guildId = verifyOAuthState(state, cookies[cookieName]).guildId;
    } catch (error) {
      return res.status(400).send(buildErrorPage('Phiên xác minh không hợp lệ', error.message));
    }
    const secureCookie = baseUrl.startsWith('https://') ? '; Secure' : '';
    const cookiePath = new URL(redirectUri).pathname;
    res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; Path=${cookiePath}; HttpOnly; SameSite=Lax${secureCookie}`);
    if (!String(clientSecret || '').trim() || !String(process.env.ENCRYPTION_KEY || '').trim()) {
      return res.status(503).send(buildErrorPage(
        'Recovery đang chờ cấu hình',
        'Owner cần hoàn tất khóa OAuth và mã hóa trên hosting trước khi người dùng xác minh.',
      ));
    }

    try {
      // Exchange code for token
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri,
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errText}`);
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const scopes = String(tokenData.scope || '').trim();
      if (!accessToken || !refreshToken || !scopes.split(/\s+/).includes('guilds.join')) {
        throw new Error('Discord không cấp đủ quyền recovery bắt buộc.');
      }
      const expiresIn = tokenData.expires_in || 604800; // 7 ngày mặc định
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Fetch user profile
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch user profile.');
      }

      const userProfile = await userResponse.json();
      const discordId = userProfile.id;
      const username = `${userProfile.username}${userProfile.discriminator !== '0' ? '#' + userProfile.discriminator : ''}`;
      const email = userProfile.email || null;
      const avatar = userProfile.avatar || null;
      const resolvedGuildId = guildId;
      const discordClient = req.app.locals.discordClient;
      const verifiedGuild = discordClient?.isReady?.()
        ? await discordClient.guilds.fetch(guildId).catch(() => null)
        : null;
      const verifiedMember = verifiedGuild
        ? await verifiedGuild.members.fetch(discordId).catch(() => null)
        : null;
      if (!verifiedGuild || !verifiedMember) {
        return res.status(400).send(buildErrorPage(
          'Không thể xác nhận thành viên',
          'Bạn cần ở trong server Cenar Store trước khi bật recovery backup.',
        ));
      }

      // Save user to database oauth_backups
      db.prepare(`
        INSERT INTO oauth_backups (
          discord_id, guild_id, access_token, refresh_token, token_expires_at,
          username, email, avatar, scopes, recovery_consent_at, verified_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(discord_id, guild_id) DO UPDATE SET
          access_token     = excluded.access_token,
          refresh_token    = excluded.refresh_token,
          token_expires_at = excluded.token_expires_at,
          username         = excluded.username,
          email            = excluded.email,
          avatar           = excluded.avatar,
          scopes           = excluded.scopes,
          recovery_consent_at = CURRENT_TIMESTAMP,
          verified_at      = CURRENT_TIMESTAMP
      `).run(
        discordId,
        resolvedGuildId,
        encrypt(accessToken),
        encrypt(refreshToken),
        tokenExpiresAt,
        username,
        email,
        avatar,
        scopes,
      );

      console.log(`[OAuth Verify] OAuth callback validated and recovery consent stored: ${username} (${discordId})`);

      // Assign verified role in the target guild
      let roleGranted = false;
      let assignedRoleName = '';
      let errorMsg = '';
      let guildName = '';

      if (discordClient && guildId) {
        try {
          const guild = verifiedGuild;
          if (guild) {
            guildName = guild.name;
            const member = verifiedMember;
            if (member) {
              // Customer/VIP roles must never count as account verification.
              // This role is resolved only after the OAuth callback was validated.
              const role = resolveVerificationRole(guild);
              
              if (role) {
                // Check if already has the role
                if (!member.roles.cache.has(role.id)) {
                  await member.roles.add(role);
                  roleGranted = true;
                  assignedRoleName = role.name;
                  console.log(`[OAuth Verify] Assigned role "${role.name}" to ${username} in ${guild.name}`);
                } else {
                  // Already has the role — still count as success
                  roleGranted = true;
                  assignedRoleName = role.name;
                  console.log(`[OAuth Verify] ${username} already has role "${role.name}" in ${guild.name}`);
                }

                // ─── Gửi DM chào mừng sau khi verify thành công ───
                try {
                  await member.send(buildVerificationSuccessDmV2({
                    guildId,
                    guildName: guild.name,
                    roleName: role.name,
                  })).catch(() => {
                    // DM có thể bị tắt — không phải lỗi nghiêm trọng
                    console.log(`[OAuth Verify] DM disabled for ${username}, skipping.`);
                  });
                } catch (dmErr) {
                  console.warn('[OAuth Verify] DM send failed:', dmErr.message);
                }

              } else {
                console.warn(`[OAuth Verify] Verification role not found in guild ${guild.name}`);
                errorMsg = 'Không tìm thấy vai trò xác minh trong server.';
              }
              updateOauthMemberSnapshot(guildId, member);
              await snapshotGuildForRecovery(guild).catch((snapshotError) => {
                console.warn(`[RECOVERY] Chưa thể làm mới snapshot sau OAuth: ${snapshotError.message}`);
              });
            } else {
              console.warn(`[OAuth Verify] Member ${discordId} not in guild ${guild.name}`);
              errorMsg = 'Bạn chưa vào server Discord. Hãy join server trước rồi thử lại.';
            }
          } else {
            console.warn(`[OAuth Verify] Guild ${guildId} not found`);
            errorMsg = 'Không tìm thấy server Discord.';
          }
        } catch (err) {
          console.error('[OAuth Verify] Error assigning role:', err.message);
          errorMsg = `Lỗi cấp quyền: ${err.message}`;
        }
      } else {
        errorMsg = 'Bot đang khởi động hoặc server không hợp lệ. Vui lòng thử lại sau vài giây.';
      }

      // Render success/partial success page
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildSuccessPage(username, roleGranted, assignedRoleName, errorMsg, guildName));

    } catch (err) {
      console.error('[OAuth Verify] Callback Error:', err);
      res.status(500).send(buildErrorPage(
        'Xác Minh Thất Bại',
        'Phiên kết nối chưa hoàn tất. Vui lòng thử lại; nếu lỗi lặp lại, hãy mở ticket hỗ trợ.',
      ));
    }
  });

  // 3. Check if a Discord user is verified (used by admin API)
  app.get('/oauth/status/:discordId', (req, res) => {
    const providedKey = req.headers['x-bot-api-key'] || req.query.api_key;
    if (!safeKeyMatch(providedKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const { discordId } = req.params;
    const row = db.prepare('SELECT discord_id, username, verified_at FROM oauth_backups WHERE discord_id = ? LIMIT 1').get(discordId);
    if (row) {
      res.json({ verified: true, username: row.username, verified_at: row.verified_at });
    } else {
      res.json({ verified: false });
    }
  });
}

// ─────────────────────────────────────────────────
// HTML Page Builders
// ─────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function buildSuccessPage(username, roleGranted, roleName, errorMsg, guildName) {
  username = escapeHtml(username);
  roleName = escapeHtml(roleName);
  errorMsg = escapeHtml(errorMsg);
  guildName = escapeHtml(guildName);
  const isPartial = !roleGranted && errorMsg;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cenar Store — ${roleGranted ? 'Xác Minh Thành Công' : 'Xác Minh Hoàn Tất'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: #0a0a0f;
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(124, 58, 237, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(99, 102, 241, 0.1) 0%, transparent 40%);
      color: #f4f4f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(18, 18, 28, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(124, 58, 237, 0.25);
      border-radius: 24px;
      padding: 48px 40px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      box-shadow: 0 0 60px rgba(124, 58, 237, 0.1), 0 20px 40px rgba(0,0,0,0.4);
      animation: fadeUp 0.7s ease-out both;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(24px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .icon-wrap {
      width: 88px; height: 88px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 44px; margin: 0 auto 28px;
      animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.2s both;
    }
    @keyframes popIn {
      from { transform: scale(0); }
      to   { transform: scale(1); }
    }
    .icon-success {
      background: linear-gradient(135deg, #7C3AED, #4F46E5);
      box-shadow: 0 0 40px rgba(124, 58, 237, 0.5);
    }
    .icon-partial {
      background: linear-gradient(135deg, #D97706, #F59E0B);
      box-shadow: 0 0 40px rgba(245, 158, 11, 0.4);
    }
    h1 {
      font-size: 28px; font-weight: 700; margin-bottom: 10px;
      background: linear-gradient(135deg, #a78bfa, #818cf8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .subtitle {
      font-size: 15px; opacity: 0.7; margin-bottom: 28px; line-height: 1.6;
    }
    .info-box {
      background: rgba(124, 58, 237, 0.08);
      border: 1px solid rgba(124, 58, 237, 0.2);
      border-radius: 14px;
      padding: 20px 24px;
      margin-bottom: 24px;
      text-align: left;
    }
    .info-box.warning {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.25);
    }
    .info-row {
      display: flex; align-items: center; gap: 10px;
      font-size: 14px; padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .info-row:last-child { border-bottom: none; }
    .info-row .label { opacity: 0.55; min-width: 90px; font-size: 13px; }
    .info-row .value { font-weight: 600; color: #a78bfa; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 16px; border-radius: 9999px;
      font-size: 13px; font-weight: 600; margin-bottom: 24px;
    }
    .badge-success { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
    .badge-warning { background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(251,191,36,0.25); }
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: linear-gradient(135deg, #7C3AED, #4F46E5);
      color: white; text-decoration: none;
      padding: 14px 32px; border-radius: 14px;
      font-weight: 600; font-size: 15px;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 4px 16px rgba(124,58,237,0.3);
      transition: all 0.25s ease;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(124,58,237,0.5); }
    .footer { margin-top: 32px; font-size: 12px; opacity: 0.35; }
    .steps { text-align: left; margin: 20px 0; }
    .step { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; font-size: 14px; }
    .step-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .step-text { line-height: 1.5; opacity: 0.85; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap ${isPartial ? 'icon-partial' : 'icon-success'}">${roleGranted ? '&#10003;' : '!'}</div>
    <h1>${roleGranted ? 'Xác Minh Thành Công!' : 'Xác Minh Hoàn Tất'}</h1>
    <p class="subtitle">Xin chào <strong>${username}</strong>! ${roleGranted ? 'Tài khoản của bạn đã được xác thực.' : 'Tài khoản được lưu nhưng có lỗi cấp quyền.'}</p>

    ${roleGranted
      ? `<div class="badge badge-success">Vai trò: ${roleName || 'Thành Viên'}</div>`
      : `<div class="badge badge-warning">${errorMsg}</div>`
    }

    <div class="info-box ${isPartial ? 'warning' : ''}">
      <div class="info-row">
        <span class="label">Tài khoản</span>
        <span class="value">${username}</span>
      </div>
      <div class="info-row">
        <span class="label">Server</span>
        <span class="value">${guildName || 'Cenar Store'}</span>
      </div>
      <div class="info-row">
        <span class="label">Trạng thái</span>
        <span class="value">${roleGranted ? 'OAuth recovery đã mã hóa' : 'Recovery đã lưu, chưa cấp vai trò'}</span>
      </div>
    </div>

    ${roleGranted ? `
    <div class="steps">
      <div class="step"><span class="step-icon">&rarr;</span><span class="step-text">Xem bảng giá sản phẩm trong kênh <strong>bảng-giá</strong></span></div>
      <div class="step"><span class="step-icon">&rarr;</span><span class="step-text">Mở ticket mua hàng trong kênh <strong>hỗ-trợ</strong></span></div>
      <div class="step"><span class="step-icon">&rarr;</span><span class="step-text">Tham gia trò chuyện trong kênh <strong>thảo-luận</strong></span></div>
    </div>
    ` : ''}

    <a href="https://discord.com/app" class="btn">
      &larr; Quay lại Discord
    </a>
    <div class="footer">Cenar Store — Uy Tín &amp; Bảo Mật</div>
  </div>
</body>
</html>`;
}

function buildErrorPage(title, message) {
  title = escapeHtml(title);
  message = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cenar Store — Xác Minh Thất Bại</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: #0a0a0f;
      background-image: radial-gradient(ellipse at 50% 50%, rgba(220, 38, 38, 0.1) 0%, transparent 60%);
      color: #f4f4f5;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .card {
      background: rgba(18, 18, 28, 0.9);
      border: 1px solid rgba(220, 38, 38, 0.25);
      border-radius: 24px; padding: 48px 40px;
      max-width: 480px; width: 100%; text-align: center;
      animation: fadeUp 0.6s ease-out both;
    }
    @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
    .icon { font-size: 56px; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; color: #f87171; margin-bottom: 12px; }
    p { font-size: 14px; opacity: 0.75; line-height: 1.7; margin-bottom: 28px; }
    .btn {
      display: inline-block;
      background: rgba(220,38,38,0.15);
      border: 1px solid rgba(220,38,38,0.3);
      color: #f87171; text-decoration: none;
      padding: 12px 28px; border-radius: 12px; font-weight: 600;
      transition: all 0.2s;
    }
    .btn:hover { background: rgba(220,38,38,0.25); }
    .footer { margin-top: 28px; font-size: 12px; opacity: 0.3; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" style="font-size:56px;margin-bottom:24px;">&#10007;</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://discord.com/app" class="btn">&larr; Quay lại Discord</a>
    <div class="footer">Cenar Store — Uy Tín &amp; Bảo Mật</div>
  </div>
</body>
</html>`;
}

