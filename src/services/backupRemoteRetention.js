import fs from 'node:fs';
import path from 'node:path';

// Giữ số bản sao lưu ngoài host theo BACKUP_REMOTE_KEEP (mặc định 1 = chỉ bản mới nhất).
// Telegram chỉ cho bot xóa tin nhắn gửi trong vòng 48 giờ, nên bot xóa bản cũ ngay sau
// mỗi lần gửi thành công (mỗi ngày một lần) và ghi lại message_id vào file trạng thái.
export const TELEGRAM_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function getRemoteKeepCount(env = process.env) {
  const value = Number.parseInt(String(env.BACKUP_REMOTE_KEEP ?? '1'), 10);
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : 1;
}

export function readRemoteState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      telegram: Array.isArray(parsed?.telegram) ? parsed.telegram : [],
    };
  } catch {
    return { telegram: [] };
  }
}

export function writeRemoteState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, statePath);
}

async function telegramDeleteMessage(token, chatId, messageId) {
  const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
  const data = await res.json();
  if (data.ok) return { deleted: true };
  // Tin đã bị xóa tay thì coi như đã dọn xong.
  if (/message to delete not found/i.test(String(data.description || ''))) return { deleted: true };
  return { deleted: false, error: String(data.description || 'Telegram deleteMessage error') };
}

// Ghi nhận bản vừa gửi rồi xóa các bản cũ hơn số lượng cần giữ.
export async function pruneTelegramBackups({ statePath, token, chatId, newEntry, keep, now = Date.now() }) {
  const state = readRemoteState(statePath);
  const entries = [...state.telegram.filter((entry) => entry && entry.messageId != null), newEntry]
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const retained = entries.slice(0, keep);
  const result = { deleted: 0, failed: [] };
  for (const entry of entries.slice(keep)) {
    let outcome;
    try {
      outcome = await telegramDeleteMessage(token, entry.chatId ?? chatId, entry.messageId);
    } catch (error) {
      outcome = { deleted: false, error: String(error.message || error) };
    }
    if (outcome.deleted) {
      result.deleted += 1;
      continue;
    }
    const ageMs = now - Date.parse(entry.sentAt);
    if (Number.isFinite(ageMs) && ageMs < TELEGRAM_DELETE_WINDOW_MS) {
      retained.push(entry); // thử lại ở lần gửi sau
    }
    result.failed.push({ messageId: entry.messageId, error: outcome.error });
  }
  writeRemoteState(statePath, { ...state, telegram: retained });
  return result;
}

/** Thời điểm (ISO) của bản Telegram mới nhất đã gửi thành công, hoặc null. */
export function lastTelegramSentAt(statePath) {
  const latest = readRemoteState(statePath).telegram
    .map((entry) => Date.parse(entry.sentAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return latest ? new Date(latest).toISOString() : null;
}

export function lastTelegramSendDay(statePath, timeZone = 'Asia/Ho_Chi_Minh') {
  const latest = readRemoteState(statePath).telegram
    .map((entry) => Date.parse(entry.sentAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return latest ? new Date(latest).toLocaleDateString('vi-VN', { timeZone }) : null;
}

// Google Drive (scope drive.file chỉ thấy file do chính ứng dụng tạo): xóa các bản
// cùng store trong thư mục đích, giữ lại `keep` bản mới nhất.
export async function pruneGoogleDriveBackups({ accessToken, folderId, prefix, keep }) {
  const query = `'${String(folderId).replace(/'/g, "\\'")}' in parents and name contains '${prefix}-' and trashed = false`;
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.search = new URLSearchParams({
    q: query,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,createdTime)',
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  }).toString();
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const listed = await listRes.json();
  if (listed.error) throw new Error(listed.error.message || 'Google Drive list error');
  const files = (listed.files || []).filter((file) => String(file.name).endsWith('.cenc'));
  const result = { deleted: 0, failed: [] };
  for (const file of files.slice(keep)) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?supportsAllDrives=true`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 204 || res.status === 404 || res.ok) result.deleted += 1;
    else result.failed.push({ fileId: file.id, status: res.status });
  }
  return result;
}
