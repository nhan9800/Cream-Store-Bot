# Gemini warranty refund desk

Owner policy confirmed 2026-11-27: reconcile Gemini orders currently in warranty, deduct the used service and an additional 10% of the original paid price. This is disclosed as a processing-cost deduction; the implementation does not claim independent evidence of tax paid.

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
3. The customer sees the original price, service dates, used duration, previous warranty downtime, both deductions and remaining amount. They may contact the shop to dispute the quote without providing bank information.
4. The customer alone can submit the modal. It requires bank code, account, account-holder name and explicit `ĐỒNG Ý` acceptance. It never requests cards, passwords or OTPs. Details are AES-GCM encrypted with the existing `ENCRYPTION_KEY`; they are not logged or published. Bank details are frozen after acceptance to avoid a stale payout QR.
5. Manager **Xem tiến độ** sees pending cases. **Xem QR** (`ma_don`) returns a staff-only ephemeral QR and itemized quote. QR encoding/rendering happens locally; no customer account is sent to a QR image API. The bank name is customer-declared: verify the beneficiary in the banking app before paying.
6. Only after the actual transfer, `/quanly-don` → **Xác nhận đã hoàn tiền bên ngoài bot** records the exact accepted payout. The Gemini case must be active and ready, and the amount must equal the frozen quote. Original incoming receipt fields remain intact. Repeated confirmation is idempotent.

## Sources and verification

- Bank BIN directory snapshot: <https://api.vietqr.io/v2/banks>, 2026-11-27, 48 transfer-supported banks; only public routing metadata is bundled.
- NAPAS VietQR TLV account format and public independent checksum vector: <https://github.com/subiz/vietqr>. The local implementation encodes account transfer, VND, exact amount and order reference; CRC-16/CCITT-FALSE is covered by known vectors and decoded field assertions.
- Focused checks: `npm test -- test/geminiRefund.test.js test/geminiRefundInteraction.test.js test/orderLiveProgress.test.js test/orderStateMachine.test.js`, then `npm run smoke`. Use synthetic data for intake/QR tests. Never populate someone else's bank information merely to test production.
