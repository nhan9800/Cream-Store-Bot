# Premium Discord presentation · 2026-10-07

`locketProductPanel.js` renders Locket Gold as a seven-line Components V2 card with a small thumbnail instead of the full-width gallery. Price comes from the current catalog (`base_price ?? price`); full information stays in the existing private feature/policy actions. Purchase IDs and Username modal are retained.

`apiCreditPanel.js` shares Markdown pricing between the public board and private pricing selector. Each credit option and action uses verified custom artwork; model instructions and policy are private Components V2 replies. Instructions/check-token links are labeled buttons. Current prices, no day expiry, private delivery and warranty until exhausted are retained.

All icons resolve through `emojiHelper.js` against live guild/application inventory. No Unicode fallback, raw emoji aliases or static snowflakes. A temporarily missing asset must not invent an ID or disable checkout. `allowedMentions.parse=[]` on public panels and information replies prevents incidental mentions. Startup edits the existing premium publication ledger, silently.

Existing Store 1 messages:

- Locket: channel1531297033317777408 / message1531328356828844257.
- API: channel1531297030767644925 / message1531328348133920911.

Focused verification: `npx vitest run test/premiumProductPanels.test.js test/apiCreditCatalog.test.js --maxWorkers=1 --fileParallelism=false` (19 cases). Tests cover live artwork for every displayed icon/action/option, compact layout, catalog-backed prices, preserved action IDs, missing assets, private detail routing and no order creation from information/legacy actions. Production release still requires full CI and actual message verification; health readiness alone does not prove the optional startup publication has completed.
