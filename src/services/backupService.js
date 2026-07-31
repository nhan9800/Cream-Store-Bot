import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, getDatabasePath } from '../database/db.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const BACKUP_DIR = path.resolve(projectRoot, 'backups');

// ─── Telegram Backup ──────────────────────────────────────────────────────────

async function sendBackupToTelegram(filePath) {
  const botToken = process.env.TELEGRAM_BACKUP_TOKEN;
  const chatId = process.env.TELEGRAM_BACKUP_CHAT_ID;
  if (!botToken || !chatId) return;

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

export async function backupDatabase() {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      const todayStr   = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const dateStr    = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const backupPath = path.join(BACKUP_DIR, `shopbot-${dateStr}.sqlite`);

      db.backup(backupPath)
        .then(async () => {
          console.log(`[BACKUP] Sao lưu database thành công (Cục bộ): ${backupPath}`);
          cleanOldBackups(14);

          // 1. Telegram backup — chỉ gửi 1 lần/ngày
          const alreadySentToday = lastTelegramSentDate === todayStr;
          if (!alreadySentToday) {
            try {
              await sendBackupToTelegram(backupPath);
              lastTelegramSentDate = todayStr;
              console.log(`[BACKUP-TG] Đã gửi backup lên Telegram thành công! (${todayStr})`);
            } catch (tgErr) {
              console.error('[BACKUP-TG] Thất bại khi gửi lên Telegram:', tgErr.message);
            }
          } else {
            console.log(`[BACKUP-TG] Bỏ qua — đã gửi Telegram hôm nay (${todayStr})`);
          }

          // 2. Google Drive backup (nếu có cấu hình)
          const clientEmail   = process.env.GD_CLIENT_EMAIL;
          const privateKeyRaw = process.env.GD_PRIVATE_KEY;
          const folderId      = process.env.GD_FOLDER_ID;
          if (clientEmail && privateKeyRaw && folderId) {
            try {
              console.log('[BACKUP-GD] Bắt đầu đồng bộ bản sao lưu lên Google Drive...');
              const privateKey  = privateKeyRaw.replace(/\\n/g, '\n');
              const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
              const gdResult    = await uploadToGoogleDrive(accessToken, backupPath, folderId);
              console.log(`[BACKUP-GD] Đồng bộ lên Google Drive thành công! File ID: ${gdResult.id}`);
            } catch (gdErr) {
              console.error('[BACKUP-GD] Thất bại khi đồng bộ lên Google Drive:', gdErr.message);
            }
          }

          resolve(backupPath);
        })
        .catch((err) => {
          console.error('[BACKUP] Lỗi khi sao lưu db.backup:', err);
          reject(err);
        });
    } catch (err) {
      console.error('[BACKUP] Lỗi khởi tạo sao lưu:', err);
      reject(err);
    }
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanOldBackups(maxKeep) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sqlite'))
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
