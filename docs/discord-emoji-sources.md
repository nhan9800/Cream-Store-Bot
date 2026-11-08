# Discord emoji asset sources

The campaign emoji assets `cenar_sale_cake`, `cenar_sale_party`, and
`cenar_sale_gift` use artwork downloaded from Emoji.gg:

- https://emoji.gg/emoji/483370-birthdaycake
- https://emoji.gg/emoji/party
- https://emoji.gg/emoji/94416-birthdaygift

The assets are stored as Discord custom emoji and use the short `cenar_sale_*`
naming convention. Product-brand emoji assets already existed in the Cenar
Store Discord server and were not downloaded by this campaign.

## UI command set (2026-08-08)

The following assets were downloaded from Emoji.gg and uploaded to the Cenar
Store guild. They are used by the shared Components V2 resolver:

| Slot family | Server emoji | Source |
| --- | --- | --- |
| Verification / order identity | `cenar_verified` (`1535618654358736926`) | https://emoji.gg/emoji/462595-verified |
| Support / ticket open | `cenar_support` (`1535618659010224129`) | https://emoji.gg/emoji/55260-support |
| Staff / ticket claim | `cenar_staff` (`1535618674885402684`) | https://emoji.gg/emoji/398572-staff |
| Admin / settings | `cenar_admin` (`1535618678853337149`) | https://emoji.gg/emoji/4673-admin-yellow |
| Wallet / payment amount | `cenar_wallet` (`1535618682481545217`) | https://emoji.gg/emoji/575845-coquettepinkmoneybag |

## Partner and CTV set (2026-08-08)

The following six assets were selected from the [Emoji.gg catalog](https://emoji.gg/),
downloaded, renamed with stable `cenar_*` names, and uploaded to the Cenar Store guild.
They are intentionally separate so Partner/CTV panels do not repeat the same visual symbol.

| UI purpose | Server emoji |
| --- | --- |
| Partner identity | `cenar_partner` (`1535637391841173534`) |
| Partner approval | `cenar_partner_ok` (`1535637394207015003`) |
| CTV identity | `cenar_ctv` (`1535637396782317689`) |
| Rolling 24-hour quota | `cenar_cooldown` (`1535637399596699688`) |
| Broadcast / audit log | `cenar_announce` (`1535637405820911698`) |
| CTV pricing | `cenar_price` (`1535637409759494185`) |

All command payloads pass through the custom-emoji resolver and the final
payload sanitizer. Native Unicode emoji are discarded instead of being used as
a fallback. During the inventory pass, five unused name duplicates were
removed after checking code and slot references (`15` animated, lowercase
`gold`, the second `iron`, lowercase `diamond`, and the older `cr_grok`). The
server now has 184 emoji and no byte-identical duplicate group.

## Review card set (2026-11-08)

Dedicated `review_*` slots keep the review illustrations separate from the shared
core UI badges. Files live in `assets/emojis/review26/`; all six listings grant
the Emoji.gg Basic License for use as platform emoji without charging for access.

| Purpose | Server emoji | Source |
| --- | --- | --- |
| Review header | `cenar_review26_header` | https://emoji.gg/emoji/765447-message |
| Rating | `cenar_review26_star` | https://emoji.gg/emoji/52260-yellow-star |
| Customer | `cenar_review26_customer` | https://emoji.gg/emoji/9230-member |
| Order code | `cenar_review26_order` | https://emoji.gg/emoji/82162-receipt |
| Purchased product | `cenar_review26_product` | https://emoji.gg/emoji/79197-shopping-cart |
| Customer opinion | `cenar_review26_comment` | https://emoji.gg/emoji/408875-pencil |

Run `node scripts/sync-review-emojis.js --env-file <protected env path>` to inspect
missing artwork; add `--apply` to upload only missing names to Store 1. Existing
emoji are retained. The shared resolver verifies each ID against live inventory
and emits no Unicode fallback. Other guilds retain verified shared custom icons
when this dedicated pack has not been uploaded.

Discadia remains a reference only for this change: its directory returned an
anti-bot page and could not be safely validated or attributed automatically.
