#!/bin/bash
# ---------------------------------------------------------
# SMART CPANEL GIT DEPLOYMENT SCRIPT
# ---------------------------------------------------------
# CPanel Git Version Control automatically clones/pulls the code.
# This script runs AFTER the files are updated.
# We use an MD5 hash check on package.json to ONLY run 
# `npm install` when dependencies have actually changed.
# ---------------------------------------------------------

echo "[DEPLOY] Kích hoạt Smart cPanel Deploy..."

# 1. Tính toán mã băm (MD5) của tệp package.json hiện tại
if [ -f "package.json" ]; then
    CURRENT_HASH=$(md5sum package.json | awk '{ print $1 }')
else
    CURRENT_HASH="none"
fi

# 2. Đọc mã băm từ lần deploy trước
HASH_FILE=".last_package_hash"
if [ -f "$HASH_FILE" ]; then
    LAST_HASH=$(cat $HASH_FILE)
else
    LAST_HASH="none"
fi

echo "[DEPLOY] Mã package.json cũ: $LAST_HASH"
echo "[DEPLOY] Mã package.json mới: $CURRENT_HASH"

# 3. So sánh và quyết định chạy npm install
if [ "$CURRENT_HASH" != "$LAST_HASH" ] || [ ! -d "node_modules" ]; then
    echo "[DEPLOY] Phát hiện thư viện thay đổi (hoặc chưa cài đặt). Đang chạy npm install..."
    # --omit=dev để bỏ qua thư viện dev, --prefer-offline để cài nhanh hơn
    npm install --omit=dev --prefer-offline
    
    # Cập nhật mã băm mới
    echo "$CURRENT_HASH" > $HASH_FILE
else
    echo "[DEPLOY] Không có thư viện mới. BỎ QUA npm install (Tiết kiệm Process)!"
fi

# 4. Chạy các tác vụ Migration / Cập nhật UI
echo "[DEPLOY] Đang chạy các script cấu hình..."
node scripts/fix-products.js || echo "migration failed"
node scripts/send-price-panel.js || echo "send price failed"

# 5. Khởi động lại Bot
echo "[DEPLOY] Đã xong. Đang kích hoạt khởi động lại (Restart)..."
mkdir -p tmp
touch tmp/restart.txt

echo "[DEPLOY] Smart Deploy hoàn tất thành công!"
