# Gemini warranty refund desk

Owner policy confirmed 2026-11-27: reconcile Gemini orders currently in warranty, deduct the used service and an additional **30% of the original paid price by default**. Managers may propose an integer **30–40% per order** using `phan_tram_phi`. This is disclosed as an additional shop-cost deduction; the implementation does not claim independent evidence of tax paid. The earlier10% quotes are historical agreements and are never silently replaced.

Notification correction, 2026-11-27: only Gemini **18-month** orders originating from warranty are included in DM/ticket announcements. Use stored order duration and the refund transition's original warranty status, not a guessed plan from its display name. The owner explicitly chose to keep the other four existing refund cases/statuses for separate shop review; do not withdraw or recalculate them. `/hoan-tien`, manager QR and the all-case status list remain available for that separate review. Existing notices outside the campaign are corrected in place without another ping.

## Accounting and states

`/gemini-refund` → **Xem đối soát** reads original `payment_events`, paid amount, completion/expiry and status history. Mismatched receipts, missing dates, supplier/Booking invoices or previously refunded orders require separate review. Proration uses actual elapsed milliseconds over the recorded calendar service interval and excludes recorded warranty downtime. It stops at the current warranty opening, never at the date the shop gets around to processing. Deductions round down to VND; refunds cannot be negative or exceed the receipt.

**Chuyển các đơn đã đối soát** requires the exact preview fingerprint. The immediate SQLite transaction rechecks all inputs and opens immutable quotes with canonical `orders.status=REFUND_PENDING`. The refund case adds these explicit stages without introducing an unguarded commerce status:

- `AWAITING_DETAILS`: chờ thông tin nhận hoàn.
- `READY_TO_PAY`: customer accepted the itemized quote and supplied bank details; chờ shop chuyển hoàn.
- `PAID`: manager recorded the completed external transfer.
- `INVALIDATED`: the request was withdrawn. Reopened orders also make their old intake and QR ineligible.

No command executes a bank transfer. Existing delivery/fulfillment guards continue to see `REFUND_PENDING`.

## Customer and staff flow

1. Manager previews, then applies the unchanged preview using its `ma_doi_soat`.
2. **Gửi hồ sơ cho khách** sends one private offer per case. Claim-before-send and a stable Discord nonce prevent blind retries on timeouts. Blocked or uncertain DMs are listed privately; the customer can use `/hoan-tien ma_don` in the same shop.
   If Discord returns 20026, stop further DM attempts for the process. **Gửi hồ sơ trong ticket riêng** posts once into an already open WARRANTY/ORDER ticket matching both order and customer. It requires a private text channel, explicit access for the buyer and only configured staff/administrative additional viewers. It neither changes permissions nor creates new channels, and never posts a quote in a shared channel. Separate claimed/receipt state prevents repeat ticket notices after restarts or ambiguous send failures.
3. The customer sees the original price, service dates, used duration, previous warranty downtime, both deductions and remaining amount. They may contact the shop to dispute the quote without providing bank information.
4. The customer alone can submit the modal. It requires bank code, account, account-holder name and explicit `ĐỒNG Ý` acceptance of the displayed percentage and amount. It never requests cards, passwords or OTPs. Details are AES-GCM encrypted with the existing `ENCRYPTION_KEY`; they are not logged or published. A revision carried by the button/modal must match the latest review; stale submissions fail without changing the agreed amount or bank data.
5. Manager **Xem tiến độ** sees pending cases. **Xem QR** (`ma_don`) returns a staff-only ephemeral QR and itemized quote. QR encoding/rendering happens locally; no customer account is sent to a QR image API. The bank name is customer-declared: verify the beneficiary in the banking app before paying.
6. Only after the actual transfer, `/quanly-don` → **Xác nhận đã hoàn tiền bên ngoài bot** records the exact accepted payout. The Gemini case must be active and ready, and the amount must equal the frozen quote. Original incoming receipt fields remain intact. Repeated confirmation is idempotent.

## Changing the additional deduction

1. `/gemini-refund` → **Xem điều chỉnh khấu trừ theo đơn**, `ma_don`, optional `phan_tram_phi`30–40 (default30). Preview preserves the original paid amount, frozen service cutoff and actual-used deduction; only the additional deduction changes.
2. **Đề xuất điều chỉnh khấu trừ theo đơn** requires the same order, percentage and exact preview `ma_doi_soat`. An immediate transaction rechecks the fingerprint, records a PROPOSED revision in `order_refund_quote_history`, and stores it separately from the active quote. Repeat application does not create duplicate revisions. A manager can replace an unaccepted proposal; proposing the current agreed rate withdraws a pending change.
3. The existing eligible18-month private-ticket notice is edited in place, without another ping. Its native ComponentsV2 sections show old and proposed amounts, itemized accounting and explicit customer choice, with distinct custom emoji and no Unicode substitutes. **Cập nhật giao diện hồ sơ 18 tháng đã gửi** retries presentation-only refreshes; message identity, bot authorship and private ticket access are rechecked. Matching render hashes skip redundant edits.
4. Customer acceptance atomically adopts that exact revision and encrypted recipient details. An already accepted earlier quote remains valid until the customer agrees to the new proposal. While a proposal is pending, staff QR and external-payout amount checks continue to use the earlier accepted quote and visibly identify the pending change. No bank transfer is executed by these actions.
5. Initial rollout updates proposals only for the two18-month campaign cases. The other four existing cases retain their earlier quotes/statuses for separate shop review. Generic manager per-order controls do not trigger a notification outside the18-month scope.

## Sources and verification

- Bank BIN directory snapshot: <https://api.vietqr.io/v2/banks>, 2026-11-27, 48 transfer-supported banks; only public routing metadata is bundled.
- NAPAS VietQR TLV account format and public independent checksum vector: <https://github.com/subiz/vietqr>. The local implementation encodes account transfer, VND, exact amount and order reference; CRC-16/CCITT-FALSE is covered by known vectors and decoded field assertions.
- Focused checks: `npm test -- test/geminiRefund.test.js test/geminiRefundInteraction.test.js test/refundTicketNotice.test.js test/refundPresentation.test.js test/geminiRefundNoticeScope.test.js test/orderLiveProgress.test.js test/orderStateMachine.test.js`, then `npm run smoke`. Use synthetic data for intake/QR tests. Never populate someone else's bank information merely to test production.
