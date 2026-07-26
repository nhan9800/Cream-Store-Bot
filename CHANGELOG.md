# Changelog - Cream Store Bot (`Cream-Store-Bot-main`)

All notable changes to this project will be documented in this file.

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
