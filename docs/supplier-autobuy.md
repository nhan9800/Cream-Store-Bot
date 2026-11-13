# Supplier AutoBuy — Dopermind / CDK Việt Nam

This describes the implementation and owner's updated policies as of 2026-11-14. It does not establish that a revision is deployed, the production flag is enabled, or a real paid purchase has been tested. Verify the release record, exact live commit, health and Discord panel separately. Read-only connection success is distinct from purchase/delivery evidence.

### CDK storefront repair · 2026-11-13

CDK product identifiers retain their `cdkvietnam:<id>` namespace throughout the
catalog, quote and Admin price controls. Product arguments in Discord custom IDs
are URI-encoded and decoded exactly once before validation. This repairs the
case where provider/catalog health was ready but the storefront filtered out
every CDK offer or split its quantity control at the namespace colon.

Integration coverage exercises all 12 reviewed CDK products through paginated private
quotes, one owned SQLite order and payment-method selection. These checks do
not charge a customer, purchase supplier goods or claim a real paid delivery.

### Source catalog coverage

CDK and Dopermind have separate saved storefront channels, catalogs, policies,
credential/client instances and readiness probes. `SUPPLIER_AUTOBUY_PROVIDER`
retains the legacy default for diagnostics; an explicit trusted channel provider
can use either configured key. A CDK connection never grants Dopermind readiness.
The CDK source can
return more products than the reviewed sale manifest: unreviewed identity,
missing activation/warranty evidence, changed terms, supplier locks, stale
references or margin limits keep a source product out of sale. A stock count is
not authorization to sell that SKU.

Catalog health exposes aggregate `sourceCount`, `policyCount`, `reviewedCount`,
`availableCount`, `blockedCount`, `unreviewedCount`, `outOfStockCount`,
`lockedCount`, `manualDeliveryCount` and a fixed-code `blockedReasons` histogram.
No source costs, balances, goods, credentials or free-form provider explanations
are exposed. Operator review can read a separate cached metadata snapshot for
unreviewed names, delivery mode and descriptions; it is not a public-health
field and performs no extra provider request.

One shared durable worker uses the immutable `provider` saved on each quote and
purchase intent. Product keys, persisted request IDs, request JSON/hash, invoices
and purchase receipts retain their original identity. The additive database
migration identifies old CDK records from `cdkvietnam:<id>` and legacy Dopermind
records from their opaque keys, never the currently selected environment source.
Quote, order, payment and delivery APIs reject a supplied channel provider that
differs from the stored record before any financial side effect. Customer
history is filtered by the source channel, and a paused source cannot occupy the
ready source's bounded worker batch. CDK 202 receipts still poll their exact
saved source order ID; Dopermind uncertain requests still replay their original
request ID with the Dopermind client.

The CDK adapter follows every `next_after` page within a 5,000-product bound,
using the provider's documented 100-item page maximum. Invalid or repeating
cursors, duplicate IDs across pages and incomplete bounded scans reject the
read instead of silently returning a truncated catalog. Locked products are
excluded from pricing, new quotes and overrides before customer payment.

The owner explicitly allows customer payment before funding the supplier wallet. This supersedes the earlier rule that required supplier funds before issuing an invoice or debiting a customer wallet. A paid order waits durably for shop funding when necessary, then resumes automatically; customer payment is not a promise of immediate delivery while this wait is displayed.

AutoBuy is a separate Store1 Discord catalog. The existing 59 products, manual orders, account-stock delivery and website catalog retain their existing source. Supplier products are not silently inserted into `product_catalog` or substituted into an old order.

## Configuration and startup

Store1 hosting configuration uses:

```dotenv
SUPPLIER_AUTOBUY_PROVIDER=dopermind
DOPERMIND_API_KEY=
# Configure both keys to expose the two separate Store1 storefronts:
CDKVIETNAM_API_KEY=
SUPPLIER_AUTOBUY_ENABLED=false
```

Keep the key in protected hosting configuration, never source, CLI arguments or Discord. The example deliberately defaults to closed sales. After release checks, `SUPPLIER_AUTOBUY_ENABLED=true` explicitly opts in. Both canonical Store1 guild `1282637033340403754` and `ENV_FILE=.env` are required. Store2 stays disabled despite inherited launcher environment. Missing keys, unsupported providers and a false flag do not enable this purchase flow. Environment-file edits require a normal restart; editing the file is not a hot reload.

After the process owns its HTTP port, `src/bootstrap.js` starts a bounded read-only balance/stock probe for each configured source, loads its reviewed offers and starts the shared durable worker once. `setSalesEnabled()` promotes each source panel only with its own `CONNECTED` probe, a running worker and an available reviewed offer. A valid zero balance does not prevent prepayment. Supplier failure does not block Discord, HTTP or legacy commerce startup. This readiness snapshot is a startup result; payment rechecks stock, prices, terms and safe storage, while the correct supplier's funds are checked before first purchase submission.

The existing bot-owned read-only channel/panel is persisted and reused under Cửa hàng Cenar. Inaccessible, foreign or ambiguous saved targets degrade instead of creating duplicates. Closed mode shows preparation/status information; open mode exposes **Danh mục & giá** and a private commerce flow. Automatic marketing, price-board resends and role/everyone pings remain paused.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `dopermindClient.js` / `cdkVietnamClient.js` | Fixed-origin bounded transports, strict read/purchase schemas, provider-specific idempotency and no generated purchase IDs or automatic POST retry. |
| `supplierAutobuyRuntime.js` | Independent cached Store1 startup probes and safe readiness metadata per source. |
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

Customer ticket receipts are separate from that staff log. Confirmation now
sends the existing supplier order's summary and controls into its verified
private ORDER ticket. `supplier_autobuy_ticket_notices` persists the exact
order, channel, message and send state. Repeated confirmation reuses the same
receipt; a lost send response is reconciled against bot-authored exact-order
controls before any retry. Definitive rejections remain retryable. Incomplete
history or uncertain absence never authorizes a blind duplicate send.

For a newly created order, the confirmation facade captures the private
channel's exact last-message ID before creating the order and stores it once
in the notice journal. Receipt discovery checks all markers on a fetched page
before stopping at that exact pre-order anchor. A long reused ticket therefore
does not require scanning its older unrelated history. Retries never advance
the anchor. Legacy NULL anchors, deleted anchors and overflow above an anchor
retain conservative discovery; attempts=0 and local timestamps do not prove
that a previous send was absent.

After custom artwork is ready, Store1 startup repairs open active supplier
orders missing their receipt. A coalesced background pass retries bounded
batches each minute and pauses while Discord disconnects. It only reads owned
order data and sends customer receipts: it creates no order, invoice, wallet
debit or source purchase. Closed, wrong-owner and unrelated support tickets
are excluded. A reused legacy ORDER ticket is accepted only through its exact
persisted supplier order/ticket/channel/customer links and private permissions.

Ticket controls support only the bound order's status, payment and private
delivery. The source comes from its saved supplier intent, including when both
sources share one customer ticket. Public controls require the exact saved bot
message; later ephemeral controls require the matching customer, channel and
order. Payment QR and delivered goods remain ephemeral. Browsing links return
to the correct saved storefront. Order cards render the product name once and
assign distinct verified custom artwork after final normalization; known
legacy escaped product snapshots are decoded once before safe presentation.

General PayOS reconciliation skips a supplier order with no saved invoice link
and no PayOS method reservation only when the authoritative method schema is
available. A persisted PayOS reservation still permits lookup by its original
numeric payment identity after a lost create-link receipt; legacy orders and
paid notification repair keep their previous behavior.

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

Encryption is checked before submission. Validated goods are encrypted with the existing key in `supplier_autobuy_intents`, never account-stock rows/public logs/health. Definitively rejected private DMs retry from that stored payload without repurchase. The paid owner can also retrieve an ephemeral attachment through **Đơn của tôi → Nhận hàng riêng**. Completion is acknowledged only after Discord returns a private message receipt, then records delivery and uses existing completion/feedback flow. A separate durable claim prevents repeated uncertain completion notices.

`supplier_autobuy_delivery_attempts` records metadata before a DM send. The
transport checks the current paid owner, immutable payload, live lease and
deadline after user/DM preparation, immediately before sending. A timed-out
preparation cannot later send goods. A late positive send receipt is retained
before completion checks; cancellation, refund or changed identity leaves it
for review. Unknown sends are reconciled through exact bot/customer/channel,
request and attachment markers, never blindly resent after Discord's short
nonce window. Existing encrypted payloads without trustworthy legacy send
evidence are held for review/retrieval rather than assumed unsent. The journal
contains no goods, source prices or credentials.

`supplierAutobuyDelivery` in health is a cached aggregate of journal attempts,
including unknown sends, reviewed receipts and completion retries. Reading
health creates no journal or Discord/provider work. These are attempt counts,
not a complete count of paid orders. Legacy positive receipts are adopted only
from the verified customer's DM with the exact old request nonce and unique
message/attachment markers. This can use a still-cached `MESSAGE_CREATE` event;
it is not general recovery through REST history after a restart. Discord does
not include nonce in subsequent message fetches ([SDK contract](https://discord.js.org/docs/packages/discord.js/14.27.0/APIBaseMessageNoChannel:Interface#nonce)).
Missing nonce or uncertain discovery stays `UNKNOWN`; the paid owner can use
**Nhận hàng riêng**. The current request/payload-hash filename remains usable
for exact REST-history discovery without nonce. No attachment download is used.

A fresh purchase may retry its journal preparation once for SQLite BUSY/LOCKED
while the same live invocation proves no DM transport has been called. The
attempt ID stays fixed and paid ownership, lease and deadline are rechecked.
This is metadata recovery, not a source/Discord retry. If both writes fail,
the encrypted source receipt remains available through owned retrieval. A
process crash before a durable journal remains ambiguous and is held; no
persisted legacy/unknown row is assumed unsent.

Quote, intent, completion-notice, payment-method, ticket-create and override/audit tables are recovery data, not disposable caches. Preserve SQLite, encryption keys, environment files, backups and history. Do not clear requests/leases/payment rows to make a stuck order look new.

## Health and verification

### Interaction latency · 2026-11-14

Catalog navigation reads price overrides in one current SQLite batch per view
and reuses a priced read model only while source, overrides and reference
validity remain unchanged. Selected quotes re-evaluate their product and current
override; confirmation/payment retain forced source freshness. A failed forced
refresh is not hidden by an older cached source. Tests include direct changes
from a second SQLite connection.

Changing pages or opening read views edits the same verified owner-bound
ephemeral card, with serialized edits so an older response cannot overwrite a
newer selection. Public panels, order confirmation, payment and delivered files
remain separate private responses. Only an already-running public catalog read
is shared per client/provider; quotes, customer orders and payments are not.
Showing the Admin price button uses local permission hints; opening/submitting
the price control still requires a freshly fetched manager.

Controlled tests for 20 views of 103/500 products measure 20 batch reads instead
of 2,060/10,000 individual override reads. A synthetic quote path with 350ms
provider time and 250ms member-fetch time renders at 350ms instead of 600ms.
These are algorithm measurements, not a guarantee of upstream network latency.

`/api/health` and `/store2/api/health` expose the exact commit and cached aggregate `supplierAutobuy`, `supplierAutobuyPanel`, `supplierAutobuyCatalog`, `supplierAutobuyOrders` snapshots. Store2 must stay disabled. Health reads make no provider requests and expose no costs, balances, goods or customer identities. Discord readiness does not prove a paid supplier order.

Focused suites cover transport/schema/rates; policy caps/margins/freshness; owner/Admin boundaries; ticket uncertainty; wallet/PayOS locks; zero-source-balance prepayment and finite-stock reservations; paid funds-wait/restart/resume; idempotency/leases; malformed receipts; DM retry and completion deduplication. Run affected suites plus required full CI, dependency/security and smoke checks before exact-SHA production promotion. Then verify both live health endpoints and the retained Discord panel. Record any explicitly authorized paid test separately; mocked fulfillment/read diagnostics are not real purchases.

External limits remain: provider idempotency retention, source warranty/eligibility and retail equivalence are not proved by a purchase response; unknown receipts may need provider/staff reconciliation; DM outages delay delivery; local code cannot make upstream price changes atomic; reference expiry closes offers. Activation does not authorize recurring marketing or historical bulk purchases.

## Pause and rollback

Set `SUPPLIER_AUTOBUY_ENABLED=false` and restart normally to stop new quotes/confirmations/payment attempts and worker submissions. Already purchased goods remain owner-retrievable, with status/history preserved. Issued external invoices may still be paid after pausing: retain and reconcile those payments. Cancel eligible unpaid invoices through normal provider-aware workflows when winding down; the flag does not revoke links.

Prefer flag-off on the current supplier-aware version during investigation. Once supplier orders exist, a source rollback must preserve `SUPPLIER` routing/exclusion guards or use another tested supplier-aware revision. Blindly reverting to connection-only code could expose a paid supplier order to legacy stock handling. Preserve additive tables and all recovery data. Do not restore an old database over newer orders, rotate the encryption key, replace request IDs or drop tables as rollback. Use normal backups/tested-source/exact-SHA promotion; installer rollback does not prove later business failures were recovered.
