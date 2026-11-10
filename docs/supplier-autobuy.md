# DaiPhuc supplier autobuy — preparation

Status: **not enabled**. The owner requested an additional Discord autobuy channel on 2026-11-10. Existing products, orders, manual fulfillment and website checkout remain unchanged.

## Verified provider contract

Source: [DaiPhuc Partner Purchase API](https://docs-tele.ryan-zola.dev/docs), [OpenAPI](https://docs-tele.ryan-zola.dev/openapi.json), read 2026-11-10.

- Fixed origin `https://docs-tele.ryan-zola.dev` and HTTP Bearer authentication.
- Read account `/v1/me`, catalog `/v1/products`, orders `/v1/orders?limit=50`, a single order `/v1/orders/{order_id}` and logs `/v1/orders/{order_id}/logs`.
- Purchase `POST /v1/orders` with `product_id` (1–100 characters), `quantity` (1–100, default 1), `inputs` object. The documented optional `Idempotency-Key` is mandatory in our client.
- Purchases use a prepaid Telegram wallet. The provider issues no webhooks; order status must be polled.
- The schema does **not** define response properties, currency, status enum, price guarantees, idempotency retention, product input schemas or delivered payload format. Do not invent these mappings.
- Provider health returned 200. The owner's supplied identifier returned 401 `Invalid or revoked API key` for the two read-only account/catalog endpoints. No paid purchase was sent.

## Credential setup and read-only diagnostics

Configure the full secret in hosting environment `DAIPHUC_PARTNER_API_KEY`, or a gitignored environment file. Do not pass it in CLI arguments, source, Discord messages or issue bodies. Configuring this variable does not enable a checkout or worker.

Run `npm run check:autobuy-api` from the bot repository. It reads only account/catalog and prints bounded structural metadata, not account values, balances, product inputs or raw provider errors. An authenticated response proves connectivity, not purchase/delivery readiness.

## Code prepared

- `src/services/daiphucPartnerClient.js`: fixed-origin bounded requests, safe errors, required purchase idempotency key and no automatic retries. Response objects remain uninterpreted until the real contract is confirmed.
- `src/services/supplierPricingService.js`: pure integer-VND margin/fee/comparable-retail policy, stale-quote handling and price reconfirmation. It creates no catalog rows or invoices.
- `scripts/check-daiphuc-partner.js`: read-only credential and response-shape diagnostics, no Discord/SQLite startup.

These modules are deliberately not connected to scheduler/payment callbacks. Do not advertise this preparation as a functioning autobuy channel.

Validation on 2026-11-10: `npm test -- test/daiphucPartnerClient.test.js test/supplierPricingService.test.js test/daiphucPartnerDiagnostic.test.js` passed all137 tests (67 transport,54 pricing,16 diagnostics). Requests in tests are mocked. Independent review caught and fixed arbitrary dictionary-key leakage in the diagnostic report. `git diff --check` and the diagnostic CLI help also passed. No Discord channel, catalog mapping, production deployment or paid supplier request has been made in this preparation.

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
