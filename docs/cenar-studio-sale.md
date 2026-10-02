# Cenar Atelier · Trạm Thu Dịu

Current revision: `CENAR-SALE-REVISION:AUTUMN-ATELIER-20261002`.

## Presentation and prices

- Original seasonal collection for Cenar: copper accents, a cream/deep teal banner and four new custom campaign emojis. It does not copy another brand's artwork or text.
- Contextual design read: editorial seasonal collection. Dials: variance 6, motion 0 (Discord static messages), density 5. Audit found reused decorations, missing old ChatGPT sale rows and incomplete product coverage. New art and complete prices address those findings without changing website navigation or checkout.
- `src/campaigns/promotionCatalog202610.js` is a data-only manifest: 29 original owner-supplied sale rows, 10 new AI rows and 44 remaining catalog rows, covering 77 active catalog keys. Sale-only variants stay separate when their account/duration/warranty was not specified.
- Eight current sections are generated from the manifest. Long sections split by complete row and keep source labels. Each payload reserves room below Discord's 4,000 text characters and 40 component limit for the durable cutover marker.
- `SALE` means the owner provided that program price. `CATALOG` means current catalog price with no separate program price. Neither implies a fabricated discount. Program prices are selected and confirmed through tickets; website checkout uses its displayed price.
- The ten new AI tiers preserve account form and warranty scope. Pro 200/500 warranties and the 120k account tier require confirmation. Claude x5 is one month; BHF/FBH means full warranty. Pro 100/200/500 and x5 are shop tier names, not provider quota or account quantity guarantees.
- Recovered 130k/390k/79k/150k/250k promotional ChatGPT offers remain separate from new tiers. JSON offers without a supplied duration require confirmation. Claude API is 85k for the first day plus 5k each additional day; source-code repair is from 500k, not a fixed quote.
- Artwork lives in `assets/campaigns/`. The October 2026 banner is attached only that calendar month. Later refreshes remove the old attachment and use their native monthly title/palette. New raster art has not been prepared for every month.

## Cutover, story and restart behavior

- Both publishers await `rebuildPromotionCampaign()` for the current revision. `preparePromotionRebuild()` validates local assets, syncs new emojis without retiring old ones, and provides silent board/daily payloads and the public manifest.
- The durable service archives recognized historic sale messages, publishes the complete new board and today's chapter, then cleans recognized old bot sale posts. It never calls the legacy commerce sale reset or removes unrelated announcements/member messages. Partial failure retries the same job.
- Once `DONE`, restart does not repeat historic cutover. Normal startup refreshes existing board IDs; the independent timer checks for one chapter from 09:00 Asia/Ho_Chi_Minh.
- Each newly posted daily chapter mentions `@everyone` once with Discord's explicit allowed-mention setting. The eight board parts, historic cutover, content edits and restarts stay silent. Member-role mentions are disabled by default; explicit manual options remain supported. The bot requires Discord's Mention Everyone permission for a fresh notified daily post.
- The publisher rechecks today's chapter after the potentially slow board refresh. New create requests use the same guild/date nonce (`cs` + base36 guild ID + local calendar date, at most 25 characters) and `enforceNonce: true`; edits omit both fields. Discord returns the previously accepted message for a repeated author/nonce within its documented few-minute window, protecting concurrent processes and immediate accepted-send retries. The date marker/history check remains the durable restart guard. [Discord Create Message](https://docs.discord.com/developers/resources/message#create-message)
- Three original seven-chapter arcs feature a friend-group postcard, a rainy-day reading corner and an autumn journal. Each Monday-Sunday week shares one premise, including across month boundaries.
- Old-revision daily posts are edited silently. Same-date bot duplicates are removed only after the canonical post is current or its edit succeeds. Failed deletion rejects the attempt for retry; Discord's already-deleted response is accepted.
- Compatibility marker remains `CENAR-STORY-FLASH-SALE-V1-PART-N`; the parser accepts multiple digits. Daily markers remain `CENAR-DAILY-FLASH-SALE:YYYY-MM-DD` and `STORY-WEEK:YYYY-MM-DD`.

## Verification

`npm test -- test/dailyColorSale2026.test.js test/promotionBoard2026.test.js test/promotionCatalog202610.test.js test/promotionRebuildService.test.js --hookTimeout=30000`

Verify restored/new prices, source labels, full manifest coverage, warranty/account terms, API daily pricing, safe message budgets, banner/emoji use, cutover barrier/recovery, weekly continuity and silent idempotency. After deployment inspect real Discord and the durable job: complete current parts, one current daily chapter, all four new emojis, the uploaded banner, archived historic evidence and zero remaining recognized old sale posts. Process health alone is insufficient publication evidence.
