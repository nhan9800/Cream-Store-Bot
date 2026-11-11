# Supplier AutoBuy — Dopermind / CDK Việt Nam

This describes the implementation and owner's updated prepayment policy as of 2026-11-11. It does not establish that a revision is deployed, the production flag is enabled, or a real paid purchase has been tested. Verify the release record, exact live commit, health and Discord panel separately. Read-only connection success is distinct from purchase/delivery evidence.

The owner explicitly allows customer payment before funding the supplier wallet. This supersedes the earlier rule that required supplier funds before issuing an invoice or debiting a customer wallet. A paid order waits durably for shop funding when necessary, then resumes automatically; customer payment is not a promise of immediate delivery while this wait is displayed.

AutoBuy is a separate Store1 Discord catalog. The existing 59 products, manual orders, account-stock delivery and website catalog retain their existing source. Supplier products are not silently inserted into `product_catalog` or substituted into an old order.

## Configuration and startup

Store1 hosting configuration uses:

```dotenv
SUPPLIER_AUTOBUY_PROVIDER=dopermind
DOPERMIND_API_KEY=
# For the CDK Việt Nam source instead:
# SUPPLIER_AUTOBUY_PROVIDER=cdkvietnam
# CDKVIETNAM_API_KEY=
SUPPLIER_AUTOBUY_ENABLED=false
```

Keep the key in protected hosting configuration, never source, CLI arguments or Discord. The example deliberately defaults to closed sales. After release checks, `SUPPLIER_AUTOBUY_ENABLED=true` explicitly opts in. Both canonical Store1 guild `1282637033340403754` and `ENV_FILE=.env` are required. Store2 stays disabled despite inherited launcher environment. Missing keys, unsupported providers and a false flag do not enable this purchase flow. Environment-file edits require a normal restart; editing the file is not a hot reload.

After the process owns its HTTP port, `src/bootstrap.js` starts one bounded read-only balance/stock probe. If sales are configured, it loads reviewed offers and starts the durable worker. `setSalesEnabled()` promotes the panel only with a `CONNECTED` provider probe, a running worker and an available reviewed offer. A valid zero balance does not prevent prepayment. Supplier failure does not block Discord, HTTP or legacy commerce startup. This readiness snapshot is a startup result; payment rechecks stock, prices, terms and safe storage, while supplier funds are checked before first purchase submission.

The existing bot-owned read-only channel/panel is persisted and reused under Cửa hàng Cenar. Inaccessible, foreign or ambiguous saved targets degrade instead of creating duplicates. Closed mode shows preparation/status information; open mode exposes **Danh mục & giá** and a private commerce flow. Automatic marketing, price-board resends and role/everyone pings remain paused.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `dopermindClient.js` / `cdkVietnamClient.js` | Fixed-origin bounded transports, strict read/purchase schemas, provider-specific idempotency and no generated purchase IDs or automatic POST retry. |
| `supplierAutobuyRuntime.js` | One cached Store1 startup probe and safe readiness metadata. |
| `supplierAutobuyCatalogService.js` | Reviewed policy plus live cost/stock; integer sale prices, expiring private quotes and audited Admin overrides. |
| `supplierAutobuyCheckoutService.js` | Private owned ticket, durable payment-method choice, current terms/stock/storage preflight and wallet/PayOS prepayment integration. |
| `supplierAutobuyInvoiceService.js` | Bounded reconciliation of claimed unpaid PayOS invoices; releases their local stock reservation only after a matching authoritative terminal result. |
| `supplierAutobuyOrderService.js` | Durable quotes/intents, paid eligibility, provider idempotency, leased fulfillment, encrypted goods, retrieval and completion records. |
| `supplierAutobuyHandlers.js` / `supplierAutobuyPanelService.js` | Markdown, Components V2 separators and sourced custom emoji; private catalog/quantity/quote/payment/order/delivery controls. |
| `autoDeliveryService.js` | Routes `fulfillment_mode='SUPPLIER'` to this engine; legacy stock workers exclude supplier orders. |

Interactions require Store1, the saved channel, current bot and current customer. Public entry buttons require the exact saved panel; private controls require an ephemeral bot message. Arguments are validated and every quote/order/delivery resolves ownership from server data. Price editing requires a freshly fetched manager and service-side authorization. Source strings are untrusted data: public copy is escaped, mentions suppressed and raw provider errors hidden.

## Provider and diagnostics

Current documentation: [Dopermind API](https://api-gateway-production-be99.up.railway.app/api-docs) and [CDK Việt Nam API](https://api.cdkvietnam.com/docs?lang=vi). Both fixed HTTPS origins use Bearer authentication:

- `GET /v1/balance`: integer VND balance/timestamp, retained privately.
- `GET /v1/stock`, optionally `product_key`: normalized variants. Duplicate names retain distinct keys; `unlimited:true` permits stock `-1` without inventing a finite quantity.
- `POST /v1/orders`: documented `product_key`, `quantity`, persisted `request_id`. Shop checkout limits quantity to 10. Receipts must match product/request/quantity, one nonempty item per unit and consistent integer costs.

CDK Việt Nam uses numeric provider products exposed internally as namespaced keys (`cdkvietnam:<id>`):

- `GET /v1/products?after=0&limit=100`: paged VND catalog with live stock, delivery mode and quantity prices.
- `GET /v1/balance`: read-only VND wallet check.
- `POST /v1/orders`: `{product_id, quantity, max_total}` with the persisted `Idempotency-Key` header. HTTP 201 is a delivered receipt. HTTP 202/`DELIVERY_REVIEW` keeps the exact provider order ID, then the worker polls `GET /v1/orders/ord_...` before any further purchase; a response without an order ID stays in shop review and is never replaced by a new purchase.
- `GET /v1/orders/ord_...`: the worker uses the exact persisted provider order ID to reconcile a 202 delivery before it can encrypt or send any item.

The default deadline is 10 seconds including body reads, with a 4 MiB limit and redirects rejected. Per-key short private stock caches bound traffic. Cached stock/balance is not a provider reservation. Dopermind unknown results use its documented same-ID replay; CDK Việt Nam delivery-review results are reconciled by exact provider order ID when available, with no replacement purchase.

`npm run check:autobuy-api -- --json` and `check:dopermind-api` are read-only diagnostics. They report safe statuses/counts/currency, not wallet values, credentials, costs, goods or raw errors. They neither purchase nor enable sales. `check:daiphuc-api` and `DAIPHUC_PARTNER_API_KEY` are historical-provider diagnostics only; neither credential may be sent to the other provider. The CDK adapter is read-only until the reviewed Store1 flag is enabled and still does not perform a purchase during diagnostics.

## Reviewed prices and disclosure

[supplierAutobuyPricingPolicy.json](../src/data/supplierAutobuyPricingPolicy.json) and the [dated pricing review](supplier-autobuy-pricing-20261110.md) record all 101 key decisions, official sources, FX and comparison caveats. The initial review approves 31 SKUs and closes 70; stock remains dynamic. Earlier exclusions of Claude API/Gateway, Gemini 18 months and Spotify 3 months remain. Opaque credits, free/trial/Edu offers and unclear licenses/activation conditions are not opened merely because the supplier lists them.

```text
sale = ceil_to_1,000_VND((live_import_cost + product_markup + handling_reserve) / (1 - fee_reserve_rate))
net_profit = sale - live_import_cost - handling_reserve - ceil(sale * fee_reserve_rate)
```

The Dopermind policy currently uses a 3% reserve; the CDK Việt Nam policy uses a separate 1% reserve. These are shop planning reserves, not claims about PayOS's actual fee. Fixed per-product markups follow reviewed tiers of 20k/30k/50k/100k/150k/250k, with separate handling reserves. Sale prices must retain at least 20,000đ net profit after both reserves and stay strictly below the dated reference cap and commerce amount limit. Cost changes recalculate the price or close the offer; new keys or changed source names require review.

All current references are **BENCHMARK**, not verified identical retail SKUs. Supplied accounts, links, region, short access periods and personal direct subscriptions differ. Preserve the comparison disclosure in confirmation. Never turn a benchmark into the crossed-out original price of the same item, claim an exact discount percentage, promise matching account ownership, or fabricate official daily pricing by dividing a monthly fee. Period differences are explicit. BHF/BH2T/KBH retain the source label; unspecified warranty does not become BHF. Proton 14–28 days uses only the minimum 14 days for expiry handling.

References expire after 30 days. Missing/expired evidence, unprofitable prices or unknown terms fail closed; update evidence and policy through review/release before reopening. The manifest's bank conversion is dated, not a promise about current tax, FX or checkout fees.

**Admin · Sửa giá** persists supplier-key overrides with actor/revision/time in `supplier_autobuy_price_overrides` and an audit event in `supplier_autobuy_price_events`. Cap and minimum-profit checks still apply; overrides cannot activate excluded products. A revision invalidates old quote fingerprints. Paid amounts remain unchanged. These overrides do not rewrite the legacy website checkout catalog.

## Quote and payment lifecycle

1. Public offers expose sale/availability/terms/form/comparison information. Costs, profit, reserves, balances and credentials stay server-side.
2. Selection persists an owned quote and exact terms fingerprint. Its expiry is no later than 60 seconds after its stock snapshot. Cost, price, terms or override revision change the fingerprint; timestamps alone do not.
3. Confirmation rechecks the fingerprint, creates/reuses a private ORDER ticket, then transactionally binds one quote to one `SUPPLIER` order and intent. Persisted creation attempts/topic lookup prevent duplicate channels after uncertain Discord creation. Repeated confirmation returns the same order.
4. Before debit/invoice, checkout durably chooses a payment method and checks owned immutable terms, safe encryption/storage and current catalog/finite-stock availability. Chosen unpaid invoices and active paid orders without stored goods retain local quantity reservations so another customer cannot pay for the same last finite item. This preflight does not require or consume supplier wallet funds; a zero balance permits an otherwise valid PayOS invoice or customer-wallet payment. No supplier balance is shown publicly.
5. Wallet payment uses the existing atomic ledger/status transaction; PayOS uses signed full-payment verification. Both low-level payment paths enforce the supplier method choice. A safely failed fresh preflight or insufficient customer wallet can release a new unused choice; an uncertain PayOS invoice keeps its lock. Never delete that lock to switch methods after an unknown response.
6. Paid callbacks route to the supplier engine. Unpaid/underpaid/cancelled/refunded/wrong-store/restricted orders cannot purchase. Stock, confirmed cost ceiling and supplier funds are rechecked before first submission. An unfunded paid order keeps its normal order state `PROCESSING` and durable fulfillment state `WAITING_SUPPLIER_FUNDS`; it is not marked delivered, refunded or unpaid. The owner funds the supplier wallet separately. A later due worker pass rechecks the original paid intent and resumes purchase/delivery automatically without requiring another customer payment or a new order.

Quantity reservations are local admission control, not provider escrow or a promise that supplier funds are reserved. There is no monetary admission reservation requiring the supplier wallet to cover unpaid invoices. Other wallet use, source stock or a price change can delay a paid order. Staff must monitor waiting/review states and top up or reconcile through normal procedures; the bot does not top up the supplier wallet from a customer account by itself.

The worker also checks claimed unpaid PayOS invoices in batches of up to three, throttled to one lookup per order per five minutes in `supplier_autobuy_invoice_checks`. An uncertain invoice with no saved link is looked up by its original persisted PayOS order code. A matching provider `EXPIRED`/`CANCELLED` response cancels only a still-pending, still-unpaid local order with the same invoice identity inside an immediate SQLite transaction. A payment webhook that committed meanwhile wins; a replaced invoice cannot be cancelled by an older response. Timeouts, 404s, identity mismatch and guessed local expiry retain the quantity reservation. This is PayOS reconciliation, not a new Dopermind lookup API. Supplier VietQR fallback and invoice regeneration are blocked so an uncertain payment identity cannot be replaced.

Initial processing-log publication has its own durable send-attempt claim in `supplier_autobuy_order_notices`. Repeated confirmation does not repost it; an uncertain or failed send requires the normal staff repair flow rather than repeated public messages. The log uses sale/order data, never supplier costs or goods.

## Private QR display and ticket retention

PayOS invoices display a locally generated PNG in the customer's ephemeral order card, together with the persisted order amount and invoice deadline. Rendering uses the stored EMV/VietQR text or an allowlisted HTTPS PayOS checkout link; it never fetches a remote QR image. The source data and attachment stay in the owned private interaction. A failed follow-up status read does not hide an invoice that was just created, and local rendering failure retains the existing safe checkout link rather than creating another invoice.

Opening an owned order recovers only its already-persisted invoice metadata. It does not create a payment link, debit the customer or buy from the supplier; recovery remains available while new sales are paused. Paid, cancelled, refunded and completed orders do not recover payment metadata. The presentation also hides QR/link/payment controls for expired invoices and instructs the customer not to pay an old code. Local QR expiry is display protection; only authoritative matching PayOS reconciliation releases a reservation. New payment attempts retain ownership, term/price/stock/storage and payment-method guards, but intentionally do not require a funded supplier wallet under the prepayment policy.

Unpaid Discord ORDER tickets now have a separate idle-retention policy: `UNPAID_ORDER_TICKET_HOURS` defaults to 24 and is bounded to 24–168 hours. The deadline is measured from the latest ticket creation, human ticket message or eligible sibling-order creation. Bot reminders do not extend it. A PayOS invoice can expire earlier without shortening ticket retention; its expiry is not permission to show or pay the old QR. Persisted Keep Open requests, paid/free/processing/completed/warranty work and non-ORDER support tickets prevent this unpaid-ticket cleanup. Manual cancellations are not automatically treated as provider-expiry cleanup candidates.

Before removal, the worker requires a persisted transcript fresh for the current close attempt, then rechecks the full linked-order/activity state after archive I/O. It transactionally cancels only eligible pending orders and claims the ticket closed before dispatching Discord deletion, so a new AutoBuy confirmation cannot bind to a channel being removed. Failed deletion conditionally reopens only that exact closure claim without overwriting a later Admin transition or Keep Open request. Transcript failure or missing channel access alone does not cancel/delete the ticket. External payment or a message can still arrive after deletion is dispatched; late payments remain recorded for staff reconciliation, not silently repurchased or lost. The 24-hour ticket rule does not extend PayOS invoice validity or create a new payment identity.

The same retention predicate also guards feedback-triggered closure on shared ORDER tickets. An older completed/feedbacked order cannot start or restore its short close timer while an unpaid provider-expired/cancelled sibling still has time remaining; invalid persisted retention dates keep that sibling blocking. Once retention is due, normal feedback eligibility applies. Tickets containing only completed/feedbacked orders retain the existing two-minute policy. Restart repair uses ascending ticket-ID pagination so protected early candidates do not hide eligible later tickets; expanded payment/date fields used by this check remain internal and are not added to public feedback or health responses.

## Durable purchase and delivery

Before POST, persist the store/customer/local order/product/quantity, cost ceiling, terms, stable `cenar-<UUID>` request ID, exact serialized request and SHA-256 hash. Immediate SQLite claims, two-minute leases, serialized per-process work and coalesced calls prevent concurrent submission. The worker scans due paid intents in bounded batches approximately once a minute, using durable retry times.

When a balance read confirms insufficient supplier funds before submission, the engine stores `WAITING_SUPPLIER_FUNDS` with a future retry time, clears its lease and makes no purchase POST. This waiting check does not increment submission attempts or replace the request ID. It survives restart and can repeat until the owner funds the source; the next due pass still enforces paid/not-cancelled/not-refunded eligibility, stock and the original cost ceiling. Waiting uses the persisted retry schedule, not an immediate polling loop. Paid waiting orders are protected from the 24-hour **unpaid** ticket cleanup and from feedback closure while processing. Once goods are stored, DM/retrieval retries use those goods without checking out or charging again.

Timeout, network loss, malformed response, pending history or a crashed submitting lease may mean money was already spent. Preserve `UNKNOWN`/`RECONCILING` and the original payload/ID. Replays use the identical request; the same order never receives a fresh purchase ID. Conflicts/manual-fulfillment errors require review. Five submission attempts lead to staff review rather than an endless loop. Restarting or retrying delivery cannot reset the intent. Unknown purchases are not automatically refunded.

The cost ceiling is checked before POST and against its receipt; it is not an undocumented field sent to the provider. An unexpectedly higher charge retains encrypted goods and charged totals for review. Never discard that receipt or buy again. Same-ID replay at a now-higher cost is also held to avoid a first purchase above the original ceiling.

Encryption is checked before submission. Validated goods are encrypted with the existing key in `supplier_autobuy_intents`, never account-stock rows/public logs/health. Private DM attachment failures retry from that stored payload without repurchase. The paid owner can also retrieve an ephemeral attachment through **Đơn của tôi → Nhận hàng riêng**. Completion is acknowledged only after Discord returns a private message receipt, then records delivery and uses existing completion/feedback flow. A separate durable claim prevents repeated uncertain completion notices.

Quote, intent, completion-notice, payment-method, ticket-create and override/audit tables are recovery data, not disposable caches. Preserve SQLite, encryption keys, environment files, backups and history. Do not clear requests/leases/payment rows to make a stuck order look new.

## Health and verification

`/api/health` and `/store2/api/health` expose the exact commit and cached aggregate `supplierAutobuy`, `supplierAutobuyPanel`, `supplierAutobuyCatalog`, `supplierAutobuyOrders` snapshots. Store2 must stay disabled. Health reads make no provider requests and expose no costs, balances, goods or customer identities. Discord readiness does not prove a paid supplier order.

Focused suites cover transport/schema/rates; policy caps/margins/freshness; owner/Admin boundaries; ticket uncertainty; wallet/PayOS locks; zero-source-balance prepayment and finite-stock reservations; paid funds-wait/restart/resume; idempotency/leases; malformed receipts; DM retry and completion deduplication. Run affected suites plus required full CI, dependency/security and smoke checks before exact-SHA production promotion. Then verify both live health endpoints and the retained Discord panel. Record any explicitly authorized paid test separately; mocked fulfillment/read diagnostics are not real purchases.

External limits remain: provider idempotency retention, source warranty/eligibility and retail equivalence are not proved by a purchase response; unknown receipts may need provider/staff reconciliation; DM outages delay delivery; local code cannot make upstream price changes atomic; reference expiry closes offers. Activation does not authorize recurring marketing or historical bulk purchases.

## Pause and rollback

Set `SUPPLIER_AUTOBUY_ENABLED=false` and restart normally to stop new quotes/confirmations/payment attempts and worker submissions. Already purchased goods remain owner-retrievable, with status/history preserved. Issued external invoices may still be paid after pausing: retain and reconcile those payments. Cancel eligible unpaid invoices through normal provider-aware workflows when winding down; the flag does not revoke links.

Prefer flag-off on the current supplier-aware version during investigation. Once supplier orders exist, a source rollback must preserve `SUPPLIER` routing/exclusion guards or use another tested supplier-aware revision. Blindly reverting to connection-only code could expose a paid supplier order to legacy stock handling. Preserve additive tables and all recovery data. Do not restore an old database over newer orders, rotate the encryption key, replace request IDs or drop tables as rollback. Use normal backups/tested-source/exact-SHA promotion; installer rollback does not prove later business failures were recovered.
