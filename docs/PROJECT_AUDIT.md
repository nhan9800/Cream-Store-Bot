# Project Audit - Current Hosting Contract

## Bot

- Node.js launcher chạy trên VibeHost trong `/home/container`.
- Hai store có database SQLite riêng trong `/home/container/data`.
- Chỉ launcher lắng nghe allocation public `20022`; các cổng store là nội bộ.

## Website

- Website được triển khai trên hosting riêng và không chứa database bot.
- Website gọi bot qua `BOT_API_URL` và `BOT_API_KEY` ở server side.
- Source website và source bot có workflow độc lập; không copy chéo repository.

## Rủi ro cần kiểm soát

- Không làm mất `.env*` hoặc SQLite khi upload source.
- Không để lộ SFTP credential, Discord token, PayOS key hoặc `BOT_API_KEY`.
- Không bật auto-deploy nếu chưa có cơ chế restart/health-check đáng tin cậy.
- Dùng HTTPS custom domain cho webhook và API production.
