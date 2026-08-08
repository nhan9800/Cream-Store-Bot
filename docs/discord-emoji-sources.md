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

All command payloads pass through the custom-emoji resolver and the final
payload sanitizer. Native Unicode emoji are discarded instead of being used as
a fallback. Emoji inventory cleanup is content-hash based: no byte-identical
duplicates were found in the 178 existing guild emojis, so no existing asset
was deleted blindly.
