# DaiPhuc supplier autobuy — hosting connection diagnostics

Status: **read-only connection integrated; purchasing disabled**. The owner requested an additional Discord autobuy channel and explicitly authorized deployment and testing from hosting on 2026-11-10. Existing products, orders, manual fulfillment and website checkout remain unchanged.

## Verified provider contract

Source: [DaiPhuc Partner Purchase API](https://docs-tele.ryan-zola.dev/docs), [OpenAPI](https://docs-tele.ryan-zola.dev/openapi.json), read 2026-11-10.

- Fixed origin `https://docs-tele.ryan-zola.dev` and HTTP Bearer authentication.
- Read account `/v1/me`, catalog `/v1/products`, orders `/v1/orders?limit=50`, a single order `/v1/orders/{order_id}` and logs `/v1/orders/{order_id}/logs`.
- Purchase `POST /v1/orders` with `product_id` (1–100 characters), `quantity` (1–100, default 1), `inputs` object. The documented optional `Idempotency-Key` is mandatory in our client.
- Purchases use a prepaid Telegram wallet. The provider issues no webhooks; order status must be polled.
- The schema does **not** define response properties, currency, status enum, price guarantees, idempotency retention, product input schemas or delivered payload format. Do not invent these mappings.
- Before deployment, public health returned200 and the exact owner-supplied value returned401 `Invalid or revoked API key` for account/catalog. The same account rejection was reproduced directly through the provider's Swagger UI. This establishes rejection, not whether the value is expired, revoked or an identifier. No paid purchase was sent.

## Credential setup and read-only diagnostics

The owner-supplied value is already stored under `DAIPHUC_PARTNER_API_KEY` in hosting `/home/container/.env` and was freshly verified without exposing it. Do not pass credentials in CLI arguments, source, Discord messages or issue bodies. Configuring this variable does not enable a checkout or purchase worker.

Run `npm run check:autobuy-api` from the bot repository. It reads only account/catalog and prints bounded structural metadata, not account values, balances, product inputs or raw provider errors. An authenticated response proves connectivity, not purchase/delivery readiness.

After the bot acquires its HTTP port, `supplierAutobuyRuntime` starts one asynchronous probe per process. It requires both the canonical Store1 guild and `ENV_FILE=.env`. This double guard matters: the launcher passes root environment variables to both child stores, even when Store2 loads its own file. Store2 must report out-of-scope and make no supplier requests.

The hosted probe calls only fixed-origin GET `/health`, `/v1/me` and `/v1/products`, once each, with bounded timeouts and no retries. It does not depend on the result of another endpoint. A401 or supplier outage does not interrupt Discord startup or commerce.

Read `/api/health` and `/store2/api/health` for the cached `supplierAutobuy` snapshot and exact `commitSha`. Public output contains only fixed status codes, timestamps and request outcomes. It excludes credentials, balances, customer details, raw provider errors and catalog data. Reading health never sends another supplier request. `purchasesEnabled:false` and `schemaMapped:false` remain explicit even when all three GETs succeed.

Environment files are read at process startup; editing them is not a hot reload. The existing VibeHost Console input targets running-process stdin, not a verified shell. Do not claim a hosting network test from a local CLI invocation. The startup probe's completed timestamp on the deployed revision provides the hosting execution evidence.

## Code prepared

- `src/services/daiphucPartnerClient.js`: fixed-origin bounded requests, safe errors, required purchase idempotency key and no automatic retries. Response objects remain uninterpreted until the real contract is confirmed.
- `src/services/supplierPricingService.js`: pure integer-VND margin/fee/comparable-retail policy, stale-quote handling and price reconfirmation. It creates no catalog rows or invoices.
- `scripts/check-daiphuc-partner.js`: read-only credential and response-shape diagnostics, no Discord/SQLite startup.
- `src/services/supplierAutobuyRuntime.js`: Store1-only, one-time startup connection probe and immutable public status snapshot; no purchase operation is exposed.

Only the read-only runtime is connected to startup and health. No supplier purchase is connected to scheduler/payment callbacks. Do not advertise this connection diagnostic as a functioning autobuy sales channel.

The foundation has137 mocked tests for transport, margin rules and CLI diagnostics. Runtime tests additionally cover store isolation, bounded failures, private-data exclusion, concurrent starts and cached health reads. Startup and Express integration tests verify that a stalled/rejected supplier probe cannot block commerce or alter Discord readiness. Deployment must pass the repository's full CI and exact-SHA production promotion gates; verify both live health endpoints after rollout. No channel/catalog mutation or paid test purchase is part of this release.

Rollback uses a tested source revert through normal `main` promotion. There is no database migration to reverse; preserve databases and environment files. The supervisor backs up both databases and rolls back installation failures, but post-boot runtime failures require an explicit source rollback rather than assuming automatic recovery.

## Pricing rules for actual offers

The owner's suggested uplift ranges are 20–50k, 100k, 150k and 250k. Choose a tier using verified supplier cost, payment fees and a configured reserve; preserve positive minimum net profit. A low import price does not establish final margin if fees or taxes are unknown.

Compare only the same plan, term, region/currency, ownership/account form and entitlements with a dated official product-price URL. Shared profiles, trials, account-provided plans and personal full-price subscriptions are not interchangeable comparisons. If the selling price cannot stay strictly below the comparable official retail price while meeting the profit floor, leave that offer unavailable. Do not invent original prices or discount claims. Confirm any changed quote before a new payment; existing paid-order amounts are immutable.

No real product, fee schedule, import price, official comparison or selling price has been configured yet.

## Remaining integration after authentication

1. Inspect authenticated catalog and one documented/sandbox order sample for exact response types, status transitions, inputs, costs, currency, stock, warranty and delivery format. Obtain provider documentation for missing terms; no speculative real-money test purchase.
2. Create an explicit supplier-offer mapping, separated from the 59 existing products. Only owner-approved current offerings and future orders use supplier fulfillment.
3. Persist exact store/customer/local-order/provider-product/quantity/inputs hash/cost/retail snapshots and a stable idempotency key **before** submission. Use the existing full-payment verification and wallet ledger, with atomic single-worker claims.
4. A timed-out or malformed purchase response is an unknown outcome. Reconcile the original intent/provider order; never issue a fresh key, buy again, declare delivery or automatically refund an uncertain purchase. Provider idempotency retention and lookup behavior need verification.
5. Poll known provider order IDs with bounded reads; encrypt customer inputs and delivered payloads with the existing encryption key. Separate delivery-notification retry from purchase submission. Release the payload only to the correct customer; mark complete only after durable delivery.
6. Add one dedicated public channel with existing sourced custom emoji and Components V2 separators, ephemeral product/quote selection, private receipt/delivery, and freshly checked Admin price controls. Persist channel/panel IDs and setup idempotently. No everyone ping or recurring marketing is implied.
7. Test duplicate payment/clicks, price changes, restart/unknown POST, supplier wallet/stock shortage, wrong-customer access and blocked DMs. Complete CI/deployment/live read-only proofs before activating sellable offers.

Existing manual/stock delivery is not a supplier retry engine. In particular, `autoDeliveryService.js` account-stock data and `order_delivery_items.stock_id` must not be repurposed for arbitrary provider payloads.
