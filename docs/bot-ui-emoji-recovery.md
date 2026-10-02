# Bot interface and emoji recovery

Revision: `CENAR-UI-ICONS-20261002`.

## Artwork and resolution

The bot ships 57 original Cenar icon badges in `assets/emojis/ui26/`. Each badge
has a 128px PNG for Discord and an editable SVG. The Lucide glyph license is in
the same directory. `scripts/render-core-ui-emojis.mjs` regenerates the assets
using the website's existing React/Lucide/Sharp dependencies; it adds no bot
runtime dependency.

`coreEmojiPackService` uploads/reuses application emojis, maps the owned store's
semantic slots, and refreshes the catalog and Boost panel. It runs independently
of commerce startup and retries every minute. A successful inventory fetch
evicts deleted cache records; an unsuccessful fetch never prunes stored mappings.
Existing verified product brand artwork remains separate from the core pack.

`emojiService` resolves only emojis actually present in the target guild or the
bot's application inventory. The final Discord REST message boundary replaces
known old aliases and removes unavailable custom artwork from presentation
fields. Unavailable button artwork leaves its action usable. Code blocks,
credentials, URLs, IDs, component values, files and nonmessage requests are
preserved. There is no unverified custom-ID or Unicode fallback.

## Boost cards and historical logs

New Boost details, payment cards, logs and live panels use native Components V2
with distinct status, order details and actions. Cancelled or refunded orders
cannot expose a payment QR or cached payment link, including through old buttons.

`historicalBoostPresentationRepairService` edits existing bot-authored Boost log
messages in the configured channel. It requires one unambiguous order code and
matching database guild/customer/server identity. Original event title, status,
field values, actor, footer, timestamp and action IDs are retained. Current
database order status is never substituted for an earlier event. Complex legacy
cards retain their layout and receive conservative emoji correction only.

Additive tables `boost_log_presentation_repairs` and
`boost_log_presentation_repair_messages` retain cursors and retry state across
restarts. The scan is bounded at 20,000 messages; reaching that limit or failing
Discord access is reported as incomplete. Logs and orders are not deleted.

## Verification

The protected `GET /api/bot/catalog-publication-status` includes `botUi.icons`,
`botUi.refresh`, `botUi.historicalBoost` and a read-only full-history
`botUi.historicalBoostAudit`. These contain aggregate counts and safe error codes,
not private log text or customer/server identities.

Successful evidence requires all 57 icons available, interface refresh ready,
repair `DONE`, an actual complete Discord history scan and zero stale emoji
references. Journal `legacyEmojiCount` is the original repair count, not the
number of references remaining. A healthy HTTP endpoint alone is insufficient.

Use the website's main-only `catalog-publication-audit.yml` to inspect production
with host-held authentication. Results are encrypted before Actions logs. Keep
operator keys and decrypted evidence outside Git. Public campaign gallery media
is projected separately from top-level attachments because Discord stores Media
Gallery URL/dimensions on the component.
