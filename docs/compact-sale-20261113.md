# Compact sale update · 13 November 2026

This owner-requested update edits the three existing price cards in promotion
channel `1515008584549797979`. Their IDs stay unchanged:

- `1570837979306528850`
- `1570837982162853989`
- `1570837985631412446`

It sends no new post, deletes nothing, leaves the announcement unchanged, and
sets an empty allowed-mentions list on every edit. Member is not pinged again.

`readCompactSaleRanking(database)` uses real all-time Store1 orders that are
`COMPLETED`, `PAID`, fully paid for a positive amount, and not supplier
fulfillment. An existing canonical product ID is authoritative. A historical
null ID can match only a unique exact active product name, with duration used
to disambiguate duplicate names. Cancelled, refunded, free, underpaid,
other-store, inactive and ambiguous products do not create popularity.
`virtual_purchase_count` is never used.

The default selection keeps at most six products and at most two from one
product family. A reviewed release can freeze the selection with numeric
`selection` IDs. An empty real purchase history stops the bestseller preview;
the code does not label an invented manual selection as popular.

`prepareCompactSale({dbInstance,E,selection,priceOverrides})` is read-only.
Optional `priceOverrides` project reductions in memory, bounded to 3% and
5,000 VND per product. The integration separately authorizes and applies any
retail changes; the renderer does not modify catalog prices. The preview hash
contains selected current price/terms and exact payloads, excluding changing
order counts. The private ranking projection includes CTV prices for the
operator; prepared/public results deliberately omit that field.

One shared custom-emoji allocator spans all three cards, including headings,
product rows, price rows, warranty rows and buttons. Final REST normalization
must retain distinct verified custom IDs with no Unicode decoration. Missing
artwork stops preparation before any message edit.

`updateCompactSale(client,{dbInstance,E,selection,expectedPreviewHash,editMessage})`
requires the exact reviewed preview. It verifies the fixed guild/channel,
bot author, original relaunch markers and permissions before editing. The
injected edit function supplies the narrow owner-authorized PATCH grant for
the paused marketing channel; historical automatic campaigns remain paused.

Additive SQLite tables preserve the immutable desired payload and each prior
message presentation. After a lost PATCH receipt, a rerun reads the same
message: an exact desired presentation is recorded as complete without another
edit. An exact saved prior presentation can be edited idempotently. Any other
external edit stops recovery instead of being overwritten. Real Discord.js
messages are verified after each edit, including component text, buttons,
links, emoji, V2 flag and empty mentions.

`getCompactSalePublicationHealth({dbInstance})` only reads existing tables.
It reports three stable links and current verification evidence. The earlier
shop-relaunch journal stays unchanged as historical publication evidence.

The code-controlled `compactSaleRelease20261113.js` starts in `preview` phase.
`runCompactSaleRelease()` is restricted to exact Store1 plus `.env`, and waits
for the verified custom-emoji pack. It proposes cuts for at most three selected
products: 3% rounded down to 1,000 VND and capped at 5,000 VND. A product needs
a known positive CTV price, and its proposed retail price must stay at least
1,000 VND above that reference. CTV is a retail-floor proxy, not proof of the
shop's actual import cost or profit margin.

Only the protected hosting preview log contains CTV values and purchase counts.
`getCompactSaleReleaseHealth()` exposes their public product projection and
hashes without either field. Preview does not mutate prices. After review, the
integration updates the canonical catalog and fixes `selection` plus
`expectedPreviewHash` in `publish` phase. The release only validates those
current prices; it does not subtract the proposed discount again on restart.
New edits expire after 23:30 Asia/Saigon on 14 November 2026 (16:30 UTC). An already-completed journal still
returns its existing links read-only after the deadline.

The protected production preview selected IDs `178,114,153,154,173,156`:
Netflix Slot, Nitro Trial 3 months, CapCut 1 month, CapCut 7 days, Nitro Login
Mail Bao Sống 2 months and GearUP 3 months. The reviewed release freezes that
selection and its projected hash. The canonical Nitro Trial price is reduced
from 65,000 to 64,000 VND, and Nitro Mail Bao Sống from 140,000 to 136,000 VND;
the other four prices stay as reviewed. Restart seeding preserves those prices
without applying another discount.
