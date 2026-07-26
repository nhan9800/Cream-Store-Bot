# Rollback Procedures - Cenar Store

## Website Rollback (`cenar-website-main`)
1. In cPanel / Production server, revert to the previous known stable Git commit tag or sha:
   ```bash
   git checkout <stable-commit-sha>
   npm ci
   npm run build
   pm2 restart cenar-website
   ```
2. Check `/api/health` to confirm the storefront is active.

## Bot & Database Rollback (`Cream-Store-Bot-main`)
1. **Revert Application Code**:
   ```bash
   git checkout <stable-commit-sha>
   npm ci
   pm2 restart storebot
   ```
2. **Database Rollback** (If a schema migration or corruption occurred):
   - Locate the most recent backup in `backups/`:
   ```bash
   ls -lat backups/
   ```
   - Restore using the provided script:
   ```bash
   ./scripts/restore-database.sh backups/shopbot_2026-07-26_140000.sqlite
   ```
3. Verify Bot API and SQLite schema health:
   ```bash
   ./scripts/verify-backup.sh
   curl http://localhost:5000/api/health
   ```
