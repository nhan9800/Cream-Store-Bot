# API Codex/Claude credit · 2026-10-07

Owner confirmed +60,000 VND per reference pack and **no day limit; usage ends when credit is exhausted**.

| USD credit | VND price |
|---:|---:|
|10|70,000|
|30|90,000|
|50|110,000|
|100|155,000|
|200|250,000|
|500|530,000|

`src/config/apiCreditCatalog.js` supplies the six authoritative catalog rows and current promotion listings. `duration_months=0`, no daily pricing metadata; existing order duration storage preserves zero and completion does not generate expiry. AI checkout uses nullish defaults so zero stays zero. Labels explicitly describe exhausted credit rather than unlimited usage. Retire the exact old `claude-api-100m` row without deleting historical products/orders. Seed is idempotent; no stock quantities copied from reference screenshots.

`src/services/apiCreditPanel.js` builds the compact Discord Components V2 panel. Startup edits the existing premium message, silently. The selector uses actual catalog IDs and normal catalog checkout; forged/inactive choices are rejected. A submitted legacy 85k modal returns the current selector without creating an order. Models and instructions are provider-dependent, not a static invented model list. API tokens remain private. Original full-usage warranty is retained until credit is exhausted.

The public board, private pricing, model guide and policy use verified custom icons with Discord Markdown; each selector option also has a custom icon. See [premium panel presentation](premium-discord-panels.md) for layout, publication and test contracts.

Website variants are grouped together, display their exact price and no-day-limit terms, including the cart and account orders. Unspecified API stock shows “Đang nhận đơn”, not a made-up count. Do not migrate prior daily orders automatically.

## Artwork

Created with the built-in ImageGen tool (no CLI or API-key fallback). Final optimized asset: `assets/products/claude/api-credit-banner-20261007.webp`, 1440×480, 44,832 bytes; matching website asset under `public/images/products/`. Original PNG remains in the owner's Codex generated-images folder. No new runtime dependency. Wide layout replaces the large old gold graphic.

Final generation prompt:

> Use case: ads-marketing. Create a NEW premium product banner for Cenar Store's API Codex / Claude credit packages. Very wide 3:1 landscape composition, intended for a compact Discord product card and website product catalog. A sophisticated macro product illustration: one sculptural precision-machined graphite compute core, floating above a dark matte surface, connected by two fine sculpted light ribbons in soft mint and warm coral-copper. Elegant engineering details and realistic brushed-metal surfaces, restrained studio lighting, deep near-black green charcoal background, generous negative space, crisp focal subject that stays readable when displayed at 600 pixels wide. Contemporary, calm, refined digital storefront visual. Full-bleed wide banner, no surrounding UI or card border. No text, no letters, no numbers, no logos, no watermark, no starburst, no wireframe globe, no mesh network, no purple glow. Keep the object and lighting arranged within the central horizontal third so the image works well as a wide low-height banner.
