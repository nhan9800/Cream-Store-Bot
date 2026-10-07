# Cenar Circle

Revision: `CENAR-MEMBERSHIP-20261007`.

## Stable membership data

| Historical key | Public name | Confirmed spending | Existing role ID |
| --- | --- | --- | --- |
| vip | Cenar Select | 1,000,000 VND | 1282637168149532724 |
| elite | Cenar Signature | 3,000,000 VND | 1282637470139420694 |
| diamond | Cenar Prestige | 5,000,000 VND | 1282637814571466808 |
| ruby | Cenar Sovereign | 8,000,000 VND | 1282637775291551776 |
| active | Cenar Patron | Paid purchase or eligible service activity | 1282637103045279820 |
| explorer | Cenar Explorer | Verified member | 1282638730812854345 |

`membershipProgram.js` supplies the role service, account progress, both honor-board paths and `/dac-quyen`. Keys, spending thresholds, role permissions, hierarchy and historical grants are preserved. Original six PNG badges total about 29 KB; regenerate with `node scripts/generate-membership-assets.mjs`.

Role eligibility counts positive fully paid, noncancelled/nonrefunded orders and eligible service spending. Purchaser roles stack; durable sync jobs retry Discord errors and absent members on rejoin. Payment paths never claim a role was granted before Discord confirms it.

## Benefits

New Store 1 orders receive priority 100/200/300/400 at Select/Signature/Prestige/Sovereign based on valid paid history. Existing product VIP bonus and other stores' legacy behavior remain. Existing orders are not rewritten. Refunds affect the next priority calculation. Queue priority does not override payment or delivery checks and does not guarantee a response time.

Completed-order loyalty remains one point per 10,000 VND. Advice and campaign-specific voucher requests are described with staff confirmation; no invented automatic discount, point multiplier or monthly gifted account is promised.

## Presentation recovery

Startup UI maintenance refreshes only the six existing role IDs, using `ROLE_ICONS` and `ENHANCED_ROLE_COLORS` when present. It preserves permissions and positions. Missing application emojis under the owned `cenar_member26_` prefix are recreated. Appearance failures remain retryable after the existing catalog/Boost repairs.

The public read-only `đặc-quyền-thành-viên` guide and its bot-owned message are reused through an additive `system_settings` ledger. Human posts are not deleted. `/dac-quyen` renders the same guide without role pings. Aggregate status is available as `membershipPresentation` in health; no customer identifiers are exposed.

After release, verify the exact live commit, six IDs/names/icons/colors, one public guide, feature flags, role-sync queue and hosting quota. A waiting `MEMBER_NOT_FOUND` job means the customer must join with the linked Discord account; it is not a failed role grant.
