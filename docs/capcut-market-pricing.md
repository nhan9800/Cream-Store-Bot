# CapCut market pricing

In Store1's Bảng giá forum, open CapCut Pro & Office 365 and choose **Sửa Giá CapCut · Admin**. A fresh manager/Admin permission check is required at the button, product picker and modal. Choose one of the three active CapCut checkout variants and enter an explicit whole VND amount (for example100000).

The bot updates the authoritative retail catalog and persists an override in system_settings, so the price survives restart/reseed and the website reads the same value. CTV rates, existing orders and invoices keep their stored amounts. An editor opened before another Admin's update is rejected; reopen it to review the current amount. Discord refresh edits the existing group post silently. If that refresh fails, the committed catalog price remains valid and Admin can retry /product sync.

CapCut purchases carry the customer's displayed unit price. New website orders require numeric item.expected_price; a missing, malformed or stale quote returns409 CAPCUT_PRICE_CHANGED with current_price/product_id before a new order or wallet debit. Discord purchase modals also validate the quote before and after awaited ticket work. Existing idempotency retries return the original order snapshot before checking today's market price.

The website displays a trusted updated quote and requires another explicit click; it never automatically resubmits a changed-price purchase. Lost responses preserve the same request key, including pending requests created before the frontend quote field was introduced. Deploy the backward-compatible website proxy/client first, then the bot guard/editor. This update changes neither the web checkout availability flag nor payment provider configuration.
