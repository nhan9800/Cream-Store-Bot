#!/bin/bash
# ---------------------------------------------------------
# SMART DEPLOYMENT SCRIPT FOR CPANEL (LVE / CloudLinux)
# ---------------------------------------------------------
# This script minimizes "Number of Processes" usage by only 
# running `npm install` when dependencies have actually changed.
# ---------------------------------------------------------

echo "[DEPLOY] Starting smart deployment..."
REPO_URL=${GITHUB_REPO_URL:-"https://github.com/TranNhan09082003/Cream-Store-Bot.git"}
GIT_DIR=".git"

if [ ! -d "$GIT_DIR" ]; then
    echo "[DEPLOY] No .git found - initializing git repo from GitHub..."
    git init
    git remote add origin $REPO_URL
    git fetch origin main
    git reset --hard origin/main
    
    echo "[DEPLOY] Lần đầu tải code, chạy npm install..."
    npm install --omit=dev --prefer-offline
else
    # Lấy commit hiện tại trước khi pull
    OLD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "none")

    # Fetch và Reset cứng về main
    git remote set-url origin $REPO_URL
    git fetch origin main
    git reset --hard origin/main
    
    NEW_COMMIT=$(git rev-parse HEAD)

    echo "[DEPLOY] Old Commit: $OLD_COMMIT"
    echo "[DEPLOY] New Commit: $NEW_COMMIT"

    # Kiểm tra xem package.json có thay đổi không
    if [ "$OLD_COMMIT" = "none" ] || [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
        echo "[DEPLOY] Commit không hợp lệ hoặc không có thay đổi."
    else
        if git diff --name-only $OLD_COMMIT $NEW_COMMIT | grep -q -E 'package\.json|package-lock\.json'; then
            echo "[DEPLOY] package.json thay đổi, tiến hành npm install..."
            npm install --omit=dev --prefer-offline
        else
            echo "[DEPLOY] Không có thư viện mới, BỎ QUA npm install (Tiết kiệm Process)!"
        fi
    fi
fi

# Chạy các script migration
echo "[DEPLOY] Chạy các lệnh migration..."
node scripts/fix-products.js || echo "migration failed"
node scripts/send-price-panel.js || echo "send price failed"

# Báo cho cPanel restart Litespeed/Passenger Node app
echo "[DEPLOY] Kích hoạt restart bot..."
mkdir -p tmp
touch tmp/restart.txt

echo "[DEPLOY] Smart deploy completed successfully!"
