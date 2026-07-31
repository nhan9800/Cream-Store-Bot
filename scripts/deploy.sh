#!/bin/bash
# ============================================
# Atomic Deploy Script - Cenar Store Bot
# ============================================

set -e

APP_DIR="/opt/cenar-store"
REPO_URL="https://github.com/TranNhan09082003/Cream-Store-Bot.git"
PM2_APP="cenar-store-bot"
TMP_DIR="${APP_DIR}/.tmp_deploy_$(date +%s)"
CURRENT_DIR="${APP_DIR}/current"
DATA_DIR="${APP_DIR}/data"
ENV_FILE="${APP_DIR}/.env"

echo "🚀 Bắt đầu Atomic Deploy..."

# 1. Clone code vào thư mục tạm
echo "📥 Clone repository..."
git clone -b main "$REPO_URL" "$TMP_DIR"

cd "$TMP_DIR"

# 2. Cài đặt dependencies bằng npm ci
echo "📦 Cài đặt dependencies (npm ci)..."
npm ci --omit=dev

# 3. Link thư mục data và .env từ ngoài vào
echo "🔗 Link cấu hình và dữ liệu..."
ln -s "$DATA_DIR" "$TMP_DIR/data"
ln -s "$ENV_FILE" "$TMP_DIR/.env"

# 4. Chạy CI suite tại chỗ
echo "🧪 Chạy các bước kiểm tra (CI Suite)..."
npm run check:syntax
npm run check:imports
npm run check:commands

# 5. Backup và Verify Database (để an toàn trước khi switch)
if [ -f "$DATA_DIR/database.sqlite" ]; then
    echo "💾 Đang backup database..."
    npm run backup
    npm run verify:backup
fi

# 6. Atomic Swap
echo "🔄 Thực hiện hoán đổi thư mục (Atomic Swap)..."
if [ -d "$CURRENT_DIR" ]; then
    mv "$CURRENT_DIR" "${APP_DIR}/old_deploy_$(date +%s)"
fi
mv "$TMP_DIR" "$CURRENT_DIR"

# 7. Reload PM2 (Zero-downtime)
echo "⚡ Reload PM2..."
cd "$CURRENT_DIR"
pm2 reload "$PM2_APP" --update-env

echo "✅ Deploy hoàn tất thành công!"
