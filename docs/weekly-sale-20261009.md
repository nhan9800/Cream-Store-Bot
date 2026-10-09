# Weekly Drop · 2026-10-09

Owner authorized a replacement weekly sale after pausing automatic marketing. `weeklySale20261009.js` holds 30 owner-supplied offers in three Components V2 panels: connection, work/creation, entertainment/learning. Three original PNG/SVG application emojis accompany live custom brand icons. Every message uses empty allowed mentions.

This is an explicit one-shot operator publication, never called by bootstrap/scheduler. Automatic giveaways, daily story pings and price-board resends remain paused. The production REST boundary is unchanged. The isolated publisher has no HTTP/commerce/event handlers and uses `data/manual-weekly-sale-20261009.sqlite` as a local publication ledger, never a production database. Re-running the same revision does not resend a completed board. Discord operation markers recover accepted sends after interrupted responses; recognized previous sale posts are archived before cleanup. There is no daily message for this board-only operation.

Run only for an owner-authorized campaign:

```powershell
node scripts/publish-weekly-sale-20261009.js --publish --env-file '<protected local environment file>'
```

The script verifies three public messages, no pings and no daily chapter, and writes public evidence to `scratch/weekly-sale-20261009-evidence.json`. Preserve the local ledger with the project backup.

Sale quotations are distinct from regular catalog/website checkout prices. This request does not change checkout catalog rows or order totals. Nitro mail wording follows the new owner instruction (including 99k/1-day variant); staff must confirm its specific mail/Trial policy before payment. MoMo ~2% is a shop-reported statistic, not an independently established guarantee. JSON durations remain unspecified until ticket confirmation.

Current official [Google Antigravity model documentation](https://antigravity.google/docs/models) lists Claude Opus 5.5/Sonnet 5.5 for Google AI Pro non-trial subscriptions. The panel accurately names Antigravity and the non-trial condition, rather than implying these are Gemini models or unlimited usage. [Google One plans](https://one.google.com/about/google-ai-plans/) describes 5 TB on Google AI Pro. Copy uses a short seasonal story and clear purchase steps, inspired by the campaign structure on [KATINAT's news page](https://katinat.vn/category/tin-tuc-su-kien/); no copied slogan, invented percentage discount, stock scarcity or countdown.

Focused tests: `weeklySale20261009.test.js`, `promotionRebuildService.test.js`, `marketingPause.test.js`, `priceBoardResendPause.test.js`, `discordEmojiBoundary.test.js`.
