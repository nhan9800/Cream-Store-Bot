import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { db, getDatabasePath } from '../database/db.js';
import { fileURLToPath } from 'node:url';
import { snapshotAllGuilds } from './guildRecoveryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const BACKUP_DIR = path.resolve(projectRoot, process.env.BACKUP_DIRECTORY || 'backups');
const BACKUP_RETENTION = Math.max(3, Number(process.env.BACKUP_RETENTION || 3));
const BACKUP_STATUS_PATH = path.join(BACKUP_DIR, 'latest-status.json');

function getBackupPrefix() {
  return String(process.env.ENV_FILE || '.env').includes('store2')
    ? 'shopbot-store2'
    : 'shopbot-store1';
}

// ─── Telegram Backup ──────────────────────────────────────────────────────────

async function sendBackupToTelegram(filePath) {
  const botToken = process.env.TELEGRAM_BACKUP_TOKEN;
  const chatId = process.env.TELEGRAM_BACKUP_CHAT_ID;
  const fileName   = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize   = (fileBuffer.length / 1024).toFixed(1);
  const dateStr    = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  // Multipart form-data gửi file
  const boundary = `tg_backup_${Date.now()}`;
  const caption  = `🗄 *Cenar Store — Auto Backup*\n📁 \`${fileName}\`\n📦 ${fileSize} KB\n🕐 ${dateStr} (GMT+7)`;

  const metaCaption = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8'
  );
  const closePart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([metaCaption, fileBuffer, closePart]);

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data;
}

// ─── Google Drive Backup ──────────────────────────────────────────────────────

async function getGoogleAccessToken(clientEmail, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Claim  = Buffer.from(JSON.stringify(claim)).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${base64Header}.${base64Claim}`);
  const signature = sign.sign(privateKey, 'base64url');

  const jwt = `${base64Header}.${base64Claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Google OAuth error: ${data.error_description || data.error}`);
  return data.access_token;
}

async function uploadToGoogleDrive(accessToken, filePath, folderId = null) {
  const fileName    = path.basename(filePath);
  const metadata    = { name: fileName, parents: folderId ? [folderId] : [] };
  const fileContent = fs.readFileSync(filePath);
  const boundary    = 'google_drive_backup_boundary';

  const metaPart = Buffer.from(
    `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8'
  );
  const closePart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([metaPart, fileContent, closePart]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Google Drive REST Upload Error');
  return data;
}

// ─── Main backup function ─────────────────────────────────────────────────────

// Theo dõi ngày đã gửi Telegram để tránh spam mỗi 5 phút
let lastTelegramSentDate = null;

export function verifyBackupRestore(filePath) {
  const restoreDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-restore-check-'));
  const restoredPath = path.join(restoreDirectory, 'restored.sqlite');
  let restoredDatabase = null;
  try {
    fs.copyFileSync(filePath, restoredPath);
    restoredDatabase = new Database(restoredPath, { fileMustExist: true });
    const integrity = restoredDatabase.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
    const tableCount = Number(restoredDatabase.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).get()?.total || 0);
    restoredDatabase.exec(`BEGIN IMMEDIATE;
      CREATE TABLE __cenar_restore_probe (id INTEGER PRIMARY KEY, checked_at TEXT NOT NULL);
      INSERT INTO __cenar_restore_probe (checked_at) VALUES (CURRENT_TIMESTAMP);
      ROLLBACK;`);
    return { status: 'success', integrity, tableCount };
  } finally {
    restoredDatabase?.close();
    fs.rmSync(restoreDirectory, { recursive: true, force: true });
  }
}

function writeBackupStatus(report) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const temporaryPath = `${BACKUP_STATUS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (fs.existsSync(BACKUP_STATUS_PATH)) fs.rmSync(BACKUP_STATUS_PATH, { force: true });
  fs.renameSync(temporaryPath, BACKUP_STATUS_PATH);
}

export async function backupDatabase({ snapshot = true } = {}) {
  const report = {
    startedAt: new Date().toISOString(),
    completedAt: null,
    backupPath: null,
    statusPath: BACKUP_STATUS_PATH,
    local: { status: 'pending' },
    restoreVerification: { status: 'pending' },
    telegram: { status: 'pending' },
    googleDrive: { status: 'pending' },
  };

  // Chụp cấu trúc Discord trước khi sao lưu SQLite để cùng một file có thể
  // phục hồi dữ liệu shop, vai trò, kênh, quyền và asset custom emoji.
  if (snapshot) {
    await snapshotAllGuilds().catch((error) => {
      console.error('[RECOVERY] Không thể cập nhật snapshot trước backup:', error.message);
    });
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const now = new Date();
  const todayStr = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPrefix = getBackupPrefix();
  const backupPath = path.join(BACKUP_DIR, `${backupPrefix}-${timestamp}.sqlite`);
  report.backupPath = backupPath;

  try {
    await db.backup(backupPath);
    fs.chmodSync(backupPath, 0o600);
    report.local = { status: 'success', bytes: fs.statSync(backupPath).size };
    console.log(`[BACKUP] Sao lưu database thành công (cục bộ): ${backupPath}`);
  } catch (error) {
    report.local = { status: 'failed', error: String(error.message || error) };
    report.overallStatus = 'failed';
    report.restoreVerification = { status: 'skipped', reason: 'local_backup_failed' };
    report.telegram = { status: 'skipped', reason: 'local_backup_failed' };
    report.googleDrive = { status: 'skipped', reason: 'local_backup_failed' };
    report.completedAt = new Date().toISOString();
    writeBackupStatus(report);
    throw error;
  }

  try {
    report.restoreVerification = verifyBackupRestore(backupPath);
    console.log(`[BACKUP-RESTORE] Khôi phục thử thành công; integrity=ok, tables=${report.restoreVerification.tableCount}.`);
    cleanOldBackups(backupPrefix, BACKUP_RETENTION);
  } catch (error) {
    report.restoreVerification = { status: 'failed', error: String(error.message || error) };
    report.overallStatus = 'failed';
    report.telegram = { status: 'skipped', reason: 'restore_verification_failed' };
    report.googleDrive = { status: 'skipped', reason: 'restore_verification_failed' };
    report.completedAt = new Date().toISOString();
    writeBackupStatus(report);
    console.error('[BACKUP-RESTORE] Khôi phục thử thất bại:', error.message);
    const restoreError = new Error(`Backup restore verification failed: ${error.message}`);
    restoreError.report = report;
    throw restoreError;
  }

  const telegramToken = process.env.TELEGRAM_BACKUP_TOKEN;
  const telegramChatId = process.env.TELEGRAM_BACKUP_CHAT_ID;
  if (!telegramToken && !telegramChatId) {
    report.telegram = { status: 'skipped', reason: 'not_configured' };
    console.log('[BACKUP-TG] Chưa cấu hình; bản sao Telegram không được gửi.');
  } else if (!telegramToken || !telegramChatId) {
    report.telegram = { status: 'failed', reason: 'incomplete_configuration' };
    console.error('[BACKUP-TG] Cấu hình chưa đầy đủ; cần cả TELEGRAM_BACKUP_TOKEN và TELEGRAM_BACKUP_CHAT_ID.');
  } else if (lastTelegramSentDate === todayStr) {
    report.telegram = { status: 'skipped', reason: 'already_sent_today' };
    console.log(`[BACKUP-TG] Bỏ qua — đã gửi Telegram hôm nay (${todayStr}).`);
  } else {
    try {
      const result = await sendBackupToTelegram(backupPath);
      lastTelegramSentDate = todayStr;
      report.telegram = { status: 'success', messageId: result?.result?.message_id ?? null };
      console.log(`[BACKUP-TG] Đã gửi backup lên Telegram thành công (${todayStr}).`);
    } catch (error) {
      report.telegram = { status: 'failed', error: String(error.message || error) };
      console.error('[BACKUP-TG] Thất bại khi gửi lên Telegram:', error.message);
    }
  }

  const clientEmail = process.env.GD_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GD_PRIVATE_KEY;
  const folderId = process.env.GD_FOLDER_ID;
  if (!clientEmail && !privateKeyRaw && !folderId) {
    report.googleDrive = { status: 'skipped', reason: 'not_configured' };
    console.log('[BACKUP-GD] Chưa cấu hình; bản sao Google Drive không được gửi.');
  } else if (!clientEmail || !privateKeyRaw || !folderId) {
    report.googleDrive = { status: 'failed', reason: 'incomplete_configuration' };
    console.error('[BACKUP-GD] Cấu hình chưa đầy đủ; cần email, private key và folder ID.');
  } else {
    try {
      console.log('[BACKUP-GD] Bắt đầu đồng bộ bản sao lưu lên Google Drive...');
      const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
      const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
      const result = await uploadToGoogleDrive(accessToken, backupPath, folderId);
      report.googleDrive = { status: 'success', fileId: result.id || null };
      console.log(`[BACKUP-GD] Đồng bộ lên Google Drive thành công. File ID: ${result.id}`);
    } catch (error) {
      report.googleDrive = { status: 'failed', error: String(error.message || error) };
      console.error('[BACKUP-GD] Thất bại khi đồng bộ lên Google Drive:', error.message);
    }
  }

  report.completedAt = new Date().toISOString();
  const remoteStatuses = [report.telegram.status, report.googleDrive.status];
  report.overallStatus = remoteStatuses.includes('failed')
    ? 'degraded'
    : remoteStatuses.includes('success')
      ? 'success'
      : 'local_only';
  writeBackupStatus(report);
  return report;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanOldBackups(prefix, maxKeep) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(`${prefix}-`) && f.endsWith('.sqlite'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > maxKeep) {
      for (let i = maxKeep; i < files.length; i++) {
        const base = path.join(BACKUP_DIR, files[i].name);
        fs.unlinkSync(base);
        for (const ext of ['-wal', '-shm']) {
          const sidecar = base + ext;
          if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        }
        console.log(`[BACKUP] Đã xóa bản backup cũ: ${files[i].name}`);
      }
    }
  } catch (err) {
    console.error('[BACKUP] Lỗi khi dọn dẹp backup cũ:', err);
  }
}
