# Read-only order integrity audit

`GET /api/bot/order-integrity-audit` uses the existing service API key. It is not
a public website-proxy route and does not accept a claimed staff role as a
replacement for that key. No provider calls, Discord calls, decryption or data
repair occur in this endpoint.

Each request scans up to 500 `orders` rows in one SQLite read transaction.
The initial response fixes the maximum order ID; callers pass `snapshot_id`
and the returned `lastId` as `after_id` until `hasMore` is false. The hosting
workflow verifies monotonically advancing cursors and that the total scanned
matches the bounded order count. Newer orders are outside that run. Pages are
separate read snapshots, so concurrent edits can be observed at different times.

Checks cover malformed amounts/quantities/dates, normalized duplicate codes,
ticket identity links, paid/status contradictions, wallet debit evidence and
linked subscription/YouTube/Spotify progress, dates and guild references.
Supported FREE orders and the WEB YouTube-source fallback are respected.
Only anomalous order references, scalar amounts/statuses, rule codes and
affected linked-record IDs are returned; credentials and customer identities
are excluded. Counts refer to orders carrying a rule, not the number of
individual linked rows.

All flags require review. A manual completion override, imported legacy data,
an old missing receipt or a valid exception can explain a flag. Local records
do not establish provider settlement, fulfillment received/read by a customer,
or permission to change balances, paid status or customer service duration.
Unlinked service profiles and separate OTP/top-up/boost inventories are not
part of this `orders` scan; code regression checks for those workflows are
reported separately.

The website's `Read-only full order integrity audit` workflow uses its existing
verified SSH connection, reads runtime credentials on the host and scans both
stores. It encrypts the whole minimal report using the operator's RSA public
key and AES-GCM before logging numbered chunks. The private decryption key
stays in the operator's ignored local workspace. Missing/truncated chunks or
incomplete pagination must fail verification, never produce a complete report.
