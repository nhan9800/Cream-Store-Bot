# Shop relaunch · 13 November 2026

The owner requested new custom-emoji announcements, a promotional price board mentioning Member, and shop improvements. This release publishes three catalog-driven price cards in promotion channel `1515008584549797979`, followed by one silent announcement in `1514598369597587546`. Only the first price card mentions Member `1282638730812854345`. It adds no recurring timer and deletes or edits no prior posts. Historical automatic marketing and automatic price-board publication remain paused.

The live `product_catalog` is the price source, with active WEB rows taking precedence over guild rows, matching checkout. Only positive integer prices are shown. A crossed-out price is shown only if the same row's `original_price` is greater than its current price. Decor/Gift tiers are summarized by their real count and lowest current price and link to the full price forum. No new discounts, supplier stock claims or delivery guarantees are inferred. The announcement explains that prepaid AutoBuy orders can wait for shop supplier funding.

The Discord card also highlights the lowest existing offer for each Decor/Gift
form, including its own recorded original price where applicable. These are
catalog examples, not newly created discounts.

`prepareShopRelaunch({dbInstance,E})` is read-only and returns public `priceManifest`, `priceHash`, `payloadHash`, and `payloads`. Every decorative token and button icon must be a verified custom emoji from `E` before publication. The runtime release uses an exact reviewed `expectedPriceHash`; changed prices stop the release before a ledger or message is written.

`publishShopRelaunch(client,{dbInstance,E,expectedPriceHash,sendMessage})` accepts an injected exact-send authorization wrapper for the paused REST boundary. Each payload carries a stable numeric nonce and `enforceNonce:true`. SQLite stores immutable payload snapshots and records the attempt before dispatch. Reruns locate exact revision/part markers in paginated bot-authored history. A lost response is recovered from the accepted message without repeating Member's ping. If a send is uncertain and no matching message exists, the release stops with `RELAUNCH_SEND_UNCERTAIN` for operator investigation. It never blindly repeats an uncertain send.

Every accepted or recovered message is fetched/verified against its exact text, channel, author, V2 flag, custom emoji and mentions. Health reports part links, text hashes, custom/native emoji counts and allowed roles. A missing or modified prior message stops verification; it is not automatically recreated.

Preview from the server without logging in or modifying SQLite:

```sh
node scripts/publish-shop-relaunch-20261113.js --catalog-db data/shopbot.sqlite
```

Explicit isolated publication, after reviewing that manifest:

```sh
node scripts/publish-shop-relaunch-20261113.js --catalog-db data/shopbot.sqlite --publish --env-file .env --expected-price-hash <reviewed-64-character-hash>
```

The production bootstrap may instead call the same publisher once through its code-controlled release phase after icon setup. `getShopRelaunchPublicationHealth({dbInstance})` only reads existing tables and returns `not_started` without creating them.
