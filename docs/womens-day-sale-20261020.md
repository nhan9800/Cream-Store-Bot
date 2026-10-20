# Cenar · 20/10/2026

Owner requested 29 sale offers and a separate Vietnamese Women's Day greeting.
The campaign uses original Vietnamese copy and three new licensed emoji.gg
application emoji (credits in `assets/campaigns/womens-day-20261020/SOURCES.md`).

## Publication

`src/campaigns/womensDay20261020.js` holds exact prices, account/warranty terms,
three compact Components V2 sale panels, a notice and the separate greeting.
The old 09/10 sale panels and notice are edited in place, retaining their links.
No messages are deleted. Prior JSON/Pro x5 and Duolingo offers are not copied into
the owner's new list. ChatGPT 4-month account type is not invented; only its
supplied full warranty is listed. The MoMo reliability percentage is attributed
to the shop's own report.

The isolated publisher uses REST only. It does not start another Gateway client,
load runtime config/SQLite, change regular checkout prices, or enable marketing
schedulers. It requires the exact bot, guild, channels and previous message IDs.
All five messages use empty allowed mentions. The old @everyone notice becomes
a silent updated sale link; this operation sends no new mass notification.

```powershell
node scripts/publish-womens-day-20261020.js --preview --env-file '<protected local environment path>'
node scripts/publish-womens-day-20261020.js --publish --env-file '<protected local environment path>'
```

Publication is date-limited to 2026-10-20 in Asia/Ho_Chi_Minh. An exclusive local
lock prevents concurrent sends. Existing application emoji are reused by name;
the greeting is reconciled by its marker across full paginated history and a
stable Discord nonce. Re-running edits the same IDs rather than posting again.
Public pre-edit messages and publication evidence are retained outside Git in
`../recovery-backups/womens-day-20261020/`; local previews are in
`scratch/womens-day-20261020/`. Never commit environment values or the live DB.

## Checks

`test/womensDay20261020.test.js` asserts all 29 prices, exact 15-day/full/no
warranty variants, 1–3-day Nitro fulfillment, the two-year combo, removal of
retired offers, Discord component/text limits, custom emoji presence and silent
mentions. Marketing and price-board pause tests must remain green.

References: [emoji.gg](https://emoji.gg/),
[KATINAT seasonal campaign structure](https://katinat.vn/category/tin-tuc-su-kien/),
[Discord messages](https://docs.discord.com/developers/resources/message),
[application emoji](https://docs.discord.com/developers/resources/emoji).
