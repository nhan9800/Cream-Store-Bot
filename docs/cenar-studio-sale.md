# Cenar Studio · Bàn Làm Việc Có Gu

Current content revision: `CENAR-SALE-REVISION:AI-WORKBENCH-20261002`.

## Published presentation

- Four Components V2 messages: connection, AI, creative/storage tools, entertainment. Existing part IDs are updated; the fourth part is added silently during migration.
- October uses mint, coral, lilac and warm gold. Other months retain their own themes.
- Ten new AI offers replace the old ChatGPT promotional rows. Other supplied sale prices remain unchanged; ordinary catalog and promotional prices remain separate.
- All ten AI offers last one month. KBH means no warranty, BHF/FBH means full warranty. Package warranty and account warranty are described separately. Unspecified Pro 200/500 warranty and the 120k account tier must be confirmed in the ticket.
- No invented original price, discount percentage, stock countdown, expiry date or provider usage entitlement is shown.
- The existing three custom campaign emojis are synchronized automatically; the existing custom brand emojis are reused.

## Story and restart behavior

- One original story runs Monday through Sunday, with seven distinct chapters. The story stays consistent across a month boundary.
- The independent scheduler checks every minute and posts one daily chapter from 09:00 Asia/Ho_Chi_Minh. New posts mention only the configured member role.
- Startup refreshes the four-part price board. A daily post already published for today with an older content revision is edited in place without mentions. Restart/retry then recognizes the current revision and sends no duplicate daily post.
- The logical board marker remains `CENAR-STORY-FLASH-SALE-V1-PART-1` through `-PART-4`; content revision is separate so existing message IDs survive changes.
- Daily markers remain `CENAR-DAILY-FLASH-SALE:YYYY-MM-DD`, alongside `STORY-WEEK:YYYY-MM-DD` and the content revision.
- Member messages and unrelated bot messages are preserved. Only recognized duplicate/retired board messages and daily posts older than 45 days are cleaned up.

## Verification

`npm test -- test/dailyColorSale2026.test.js test/promotionBoard2026.test.js --hookTimeout=30000`

Focused checks cover exact prices/warranty distinctions, four-part message budgets, week/month continuity, duplicate prevention, silent revision and interrupted-edit retry.

After deployment, verify exactly one current board part for each number 1–4, one current-date daily post with the new revision, all three campaign emojis, and the actual public AI prices. A healthy process alone does not prove Discord publication succeeded.
