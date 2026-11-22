// Quyết định khi nào cần sao lưu. Lịch cũ là setInterval 12 giờ nên mỗi lần deploy/restart
// đồng hồ lại đếm từ đầu; bot được deploy nhiều lần mỗi ngày nên bản gửi Telegram có thể
// không bao giờ tới. Lịch mới bám theo giờ Việt Nam và trạng thái lưu trên đĩa, nên
// restart không làm lỡ lượt gửi.

export const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const STARTUP_BACKUP_DELAY_MS = 3 * 60 * 1000;
export const BACKUP_CHECK_INTERVAL_MS = 10 * 60 * 1000;
// Giờ Việt Nam gửi bản mã hóa lên Telegram mỗi ngày.
export const TELEGRAM_SLOT_HOURS = [3, 15];
export const TELEGRAM_RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh không có giờ mùa hè

function telegramConfigured(env) {
  return Boolean(env.TELEGRAM_BACKUP_TOKEN && env.TELEGRAM_BACKUP_CHAT_ID);
}

/** Khóa của lượt gửi Telegram gần nhất đã tới hạn tại thời điểm `at`, ví dụ "2026-11-22@15". */
export function telegramSlotKey(at = Date.now(), slotHours = TELEGRAM_SLOT_HOURS) {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const hours = [...slotHours].sort((a, b) => a - b);
  const local = new Date(ms + VN_OFFSET_MS);
  const hour = local.getUTCHours();
  let slot = [...hours].reverse().find((h) => h <= hour);
  if (slot === undefined) {
    // Trước lượt đầu tiên trong ngày: lượt đang hiệu lực là lượt cuối của hôm trước.
    local.setUTCDate(local.getUTCDate() - 1);
    slot = hours[hours.length - 1];
  }
  const day = local.toISOString().slice(0, 10);
  return `${day}@${String(slot).padStart(2, '0')}`;
}

/**
 * Lý do cần sao lưu ngay, hoặc null nếu chưa tới hạn.
 * - no_previous_backup / previous_backup_stale: bản cục bộ thiếu hoặc cũ hơn 12 giờ.
 * - telegram_slot_due: Telegram đã cấu hình và lượt giờ hiện tại chưa được gửi.
 */
export function scheduledBackupReason(status, {
  now = Date.now(),
  env = process.env,
  intervalMs = BACKUP_INTERVAL_MS,
  lastTelegramSentAt = null,
} = {}) {
  const completedAt = Date.parse(status?.completedAt ?? '');
  if (!Number.isFinite(completedAt)) return 'no_previous_backup';
  if (now - completedAt >= intervalMs) return 'previous_backup_stale';
  if (telegramConfigured(env)) {
    // Telegram lỗi (mạng, giới hạn API): thử lại mỗi giờ thay vì mỗi lần kiểm tra 10 phút.
    if (status?.telegram?.status === 'failed' && now - completedAt < TELEGRAM_RETRY_AFTER_FAILURE_MS) return null;
    const due = telegramSlotKey(now);
    const sent = lastTelegramSentAt ? telegramSlotKey(lastTelegramSentAt) : null;
    if (due && due !== sent) return 'telegram_slot_due';
  }
  return null;
}

// Giữ tên cũ cho phần khởi động: cùng một chính sách cho lần kiểm tra đầu tiên.
export const startupBackupReason = scheduledBackupReason;
