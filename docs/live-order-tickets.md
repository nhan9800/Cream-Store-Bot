# Live order tickets

Website checkout creates a private order ticket. New website orders store `fulfillment_mode=MANUAL` in the checkout transaction before payment: receiving payment queues staff work and cannot consume account stock. Repeated checkout requests retain their original order/mode; historical orders and Discord purchase routing retain LEGACY behavior.

Admin opens Cenar Care or selects an order in Admin Orders -> **Mở ticket để xử lý**. A ticket containing several orders exposes an order selector. The progress editor publishes QUEUED/PREPARING/WAITING_CUSTOMER/DELIVERING plus a customer-visible note of up to500 characters. It never marks a payment received or completes an order. Staff continues delivery in the existing ticket and `/giaohang`; that command completes only after successful DM send, and refuses wrong-guild/cancelled/refunded/failed orders.

`order_progress_events` is additive and durable, with actor/request IDs retained privately. Current staff account/session/MFA policy and exact configured-guild order lookup protect GET/PUT `/api/bot/admin/orders/:code/progress`. Same request/payload retries reuse the event; another editor's stale version conflicts. Unpaid, ended or closed/mismatched tickets are read-only. No progress note is broadcast into a public Discord channel.

Authenticated order details include an explicit public progress projection: actual creation/payment/completion timestamps, recent30 progress events and terminal status. No staff identity, request ID or credentials is included in this projection. All events remain stored; the displayed history is bounded. Staff order status remains the canonical source for completion/refund/warranty.

Website order/progress/chat refresh after completed requests every4 seconds while visible. Refresh occurs on return to the tab or network restoration; at most one request per resource is active, with12-second timeout. This is polling, not instantaneous push. Transient errors retain a labelled last snapshot;401/403/404 clear private data. Changing order cancels/ignores the old request. Chat does not force-scroll while reading history; archived transcripts stay read-only.

Tests: `npm test -- test/orderLiveProgress.test.js test/paymentFulfillmentReliability.test.js test/deliverySubscription.test.js tests/web-api-authorization.test.js`. Website E2E: `e2e/live-order-ticket.spec.ts` and existing Admin mobile transcript/scroll coverage. This release does not add arbitrary file fulfillment or supplier purchases.

## Manual delivery consistency

`/giaohang` rechecks ownership and payment/status after opening the customer's DM.
Credentials are built in memory; a rejected send does not set `delivered_at` or
publish credentials on the website. After Discord confirms a message, SQLite
records the receipt and completes only the unchanged order snapshot. Cancellation,
refund, reassignment or a competing edit holds completion and subscription creation
for staff review. Positive Discord receipt IDs and the original contract snapshot
are committed to the private `manual_delivery_receipts` journal, without credentials.
On conflict, the current order's credentials, delivery timestamp and receipt remain
untouched. Completion also rejects cancelled/refunded/failed orders at
the service boundary; the existing explicit admin unpaid-completion override remains.

Discord and SQLite cannot commit atomically. An accepted DM cannot be recalled by
a concurrent cancellation; an uncertain remote send must be checked by staff
before manually sending again. This path does not automatically resend. Subscription
backfill skips terminal and unpaid orders and does not alter existing subscriptions.

Regression: `test/giaohangDeliveryRace.test.js` uses only synthetic SQLite orders and
mocked Discord I/O, including cancellation/refund during the remote calls.
