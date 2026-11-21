// Quyết định có cần sao lưu bù ngay sau khi bot khởi động hay không.
// Lịch định kỳ là setInterval 12 giờ nên mỗi lần deploy/restart đồng hồ lại đếm từ đầu;
// nếu bot restart thường xuyên hơn 12 giờ thì bản sao lưu ngoài host sẽ không bao giờ chạy.

export const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const STARTUP_BACKUP_DELAY_MS = 3 * 60 * 1000;

function telegramConfigured(env) {
  return Boolean(env.TELEGRAM_BACKUP_TOKEN && env.TELEGRAM_BACKUP_CHAT_ID);
}

export function startupBackupReason(status, { now = Date.now(), env = process.env, intervalMs = BACKUP_INTERVAL_MS } = {}) {
  const completedAt = Date.parse(status?.completedAt ?? '');
  if (!Number.isFinite(completedAt)) return 'no_previous_backup';
  if (now - completedAt >= intervalMs) return 'previous_backup_stale';
  // Chủ shop vừa cấu hình Telegram (hoặc lần gửi trước lỗi): chạy ngay để kiểm tra được luôn.
  // Giới hạn một lần gửi Telegram mỗi ngày trong backupService vẫn chặn gửi trùng.
  const telegram = status?.telegram ?? {};
  if (telegramConfigured(env) && telegram.status !== 'success' && telegram.reason !== 'already_sent_today') {
    return 'remote_target_pending';
  }
  return null;
}
