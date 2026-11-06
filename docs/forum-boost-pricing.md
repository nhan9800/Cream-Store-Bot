# Purchase-guide and price forums

Owner-authorized November 6, 2026. `storeForums202611.js` records the verified Store1 forum/post IDs. The purchase-guide forum contains Nitro, YouTube, Spotify, Netflix and the operational Boost panel. Old channels are archived with their original histories and private support threads; staff logs remain private and separate.

`/setup-guide` reuses existing forum posts. `/product sync` deliberately updates native price forum posts by stable title, including archived posts, without deleting customer replies or creating another set. Automatic price-board resends remain paused. Public publication diagnostics understand forum posts.

Server Boost only offers 14 Boosts for three months. Historical one-month rows and orders remain stored, inactive for new sales. A fresh Admin/manager permission check protects both the **Sửa Giá · Admin** button and modal submission. Enter an integer VND amount, such as `320000`. Concurrent stale edits are rejected. The override is persisted in `system_settings` and reapplied by catalog seeding; the catalog and dedicated Boost order flow read the same price. Existing orders/invoices retain their saved amount. A stale purchase modal asks the customer to confirm the new price before creating an order.

Price edits refresh the operational Boost panel and its price forum post. A failed Discord refresh reports that the catalog price was saved and tells the Admin to retry `/boost-server refresh` / `/product sync`. Affiliate prices and separately confirmed ticket-sale quotes are independent of the retail price editor.
