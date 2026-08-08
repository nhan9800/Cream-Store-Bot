# Changelog - Cream Store Bot (`Cream-Store-Bot-main`)

All notable changes to this project will be documented in this file.

## [2.1.0] - 2026-08-08

### Added

- Partner review mode for communities below 500 members, with Admin review instead of automatic rejection.
- Safe `/partner-post` publishing with per-user rolling quotas: Partner role twice and everyone once per 24 hours.
- Dedicated Partner broadcast channel, approval directory, Components V2 audit logs and automatic Partner role grants.
- Dedicated CTV category with recruitment, review, chat, private order log and paginated Components V2 price channels.
- `/ctv-price add`, `/ctv-price set` and `/ctv-price publish` for custom-emoji CTV catalog management.
- Automatic CTV order logging for every order created through the shared order service.
- Live server aesthetic migration for custom role icons and fruit-themed channel/category prefixes.

### Changed

- Partner and CTV user/admin notifications now use custom-emoji Components V2 cards.
- Partner mentions are sent by the bot only after quota validation; direct role/everyone mention permission is denied.
- CTV pricing supports a dedicated `ctv_price` while keeping the retail price intact.
- Duplicate legacy Partner, CTV and Explorer roles are migrated into canonical roles.

## [2.0.0] - 2026-07-26
### Added
- Order State Machine (`src/services/orderStateMachine.js`) enforcing valid lifecycle transitions and logging audit history.
- Database backup and recovery scripts (`scripts/backup-database.sh`, `scripts/restore-database.sh`, `scripts/verify-backup.sh`).
- Automated CI and Production Deploy workflows (`.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`).
- Rate limiting middleware (`orderLookupLimiter`) for public order lookup endpoints.
- PII sanitization helpers (`anonymizeCustomerName`, `anonymizeCustomerEmail`) for public activity feeds.
- Edit announcement button (`announcement:edit`) for `/thongbao` command.
- Public `/api/health` endpoint for uptime monitoring.

### Changed
- Hardened PayOS Webhook idempotency and signature verification within atomic database transactions (`db.transaction()`).
- Refactored order service status updates to record state transitions into `order_status_history` table automatically.
