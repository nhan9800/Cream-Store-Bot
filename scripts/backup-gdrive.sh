#!/bin/bash
# ============================================
# Cenar Store Bot — Auto Backup to Google Drive
# Chạy mỗi 6 giờ qua cron job
# ============================================

APP_DIR="/opt/cenar-store"
DATA_DIR="$APP_DIR/data"
BACKUP_DIR="$DATA_DIR/backups"
RCLONE_REMOTE="gdrive"  # Tên remote trong rclone config
GDRIVE_FOLDER="CenarStore-Backups"
LOG_FILE="$APP_DIR/logs/backup-gdrive.log"

mkdir -p "$APP_DIR/logs"
mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Bắt đầu backup ==="

# 1. Backup database hiện tại
BACKUP_NAME="shopbot_$(date '+%Y_%m_%d_%H%M').sqlite"
cp "$DATA_DIR/shopbot.sqlite" "$BACKUP_DIR/$BACKUP_NAME"
log "Database copied: $BACKUP_NAME ($(du -h "$BACKUP_DIR/$BACKUP_NAME" | cut -f1))"

# 2. Backup .env (mã hóa nhẹ)
cp "$APP_DIR/.env" "$BACKUP_DIR/env_backup_$(date '+%Y_%m_%d').txt"
log ".env backed up"

# 3. Upload lên Google Drive
if command -v rclone &> /dev/null; then
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE:$GDRIVE_FOLDER/" \
    --transfers 2 \
    --checkers 2 \
    --log-level INFO \
    --log-file "$LOG_FILE" \
    2>&1
  
  if [ $? -eq 0 ]; then
    log "✅ Upload Google Drive thành công!"
    
    # Đếm file trên Drive
    DRIVE_FILES=$(rclone ls "$RCLONE_REMOTE:$GDRIVE_FOLDER/" 2>/dev/null | wc -l)
    log "   Files trên Drive: $DRIVE_FILES"
    
    # Xóa backup local cũ (giữ 7 ngày)
    find "$BACKUP_DIR" -name "shopbot_*.sqlite" -mtime +7 -delete 2>/dev/null
    log "   Local cleanup: giữ 7 ngày gần nhất"
    
    # Xóa backup trên Drive cũ hơn 30 ngày
    rclone delete "$RCLONE_REMOTE:$GDRIVE_FOLDER/" \
      --min-age 30d \
      --include "shopbot_*.sqlite" \
      2>/dev/null
    log "   Drive cleanup: giữ 30 ngày gần nhất"
  else
    log "❌ Upload Google Drive thất bại!"
  fi
else
  log "⚠️ rclone chưa cài! Chạy: curl https://rclone.org/install.sh | bash"
fi

log "=== Backup hoàn tất ==="
echo ""
