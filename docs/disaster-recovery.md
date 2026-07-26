# Disaster Recovery Plan - Cenar Store

## Purpose
This document defines procedures for recovering from severe incidents (server hardware failure, database corruption, or malicious compromise).

## Recovery Time Objective (RTO) & Recovery Point Objective (RPO)
- **RTO**: < 15 minutes (using automated deployment workflows and backup scripts).
- **RPO**: < 6 hours (based on automated cron backups in `backups/`).

## Disaster Recovery Steps
1. **Provision New Host / Instance**:
   - Clone both repositories (`Cream-Store-Bot-main` and `cenar-website-main`).
2. **Restore Database State**:
   - Copy the latest verified `.sqlite` backup archive into `Cream-Store-Bot-main/data/shopbot.sqlite`.
   - Run `./scripts/verify-backup.sh` to validate schema integrity.
3. **Configure Secrets**:
   - Restore `.env` from secure secrets vault (including `BOT_API_KEY`, `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`).
4. **Start Services & Verify Health**:
   ```bash
   pm2 start ecosystem.config.js
   curl http://localhost:5000/api/health
   curl https://cenarstore.xyz/api/health
   ```
