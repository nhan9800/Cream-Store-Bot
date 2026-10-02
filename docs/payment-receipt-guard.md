# Order payment receipt guard

An order can be marked paid only when a positive integer receipt covers its
current database total. A missing, invalid or short receipt raises
`OrderPaymentError` before payment events, fulfillment jobs, purchaser roles,
stock delivery or confirmation messages are created. Do not replace the actual
receipt with the invoice value or raise it to the purchase total.

PayOS reconciliation checks the invoice identity and uses `amountPaid` from
the provider's GET response. `amount` is the invoice amount. When an older
response omits `amountPaid`, only valid distinct transaction references can
provide a received total. An explicit zero or invalid `amountPaid` cannot fall
back to a more favorable invoice/transaction value.

Staff manual confirmation remains an explicit declaration that the stated
amount has been received. It must pass the same amount guard.

## Read-only incident inspection

`GET /api/bot/payment-audit/:code` requires the server's bot API key. It returns
an explicit diagnostic projection: purchase/receipt values, provider state,
generic staff/system actions and price edits. It does not return customer or
staff identifiers, account credentials, bank details, transaction identifiers
or raw payment payloads. It makes no database or payment mutations.

For a wallet purchase, the projection also reports the selected debit, ledger
balance before/after it, reconciliation with the current stored balance and a
bounded recent activity/topup receipt view. A bank topup can be smaller than a
purchase when prior wallet credit covers the difference. Missing historical
ledger entries must not be treated as proof of an unpaid purchase.

The `Read-only payment incident audit` workflow accepts an order code and a
base64 DER RSA public key of at least 2048 bits. It uses operational GitHub
secrets to call the endpoint and encrypts the result with AES-256-GCM and
RSA-OAEP-SHA256 before writing `ENCRYPTED_AUDIT` to the log. Keep the private
key on the operator's machine. Never print plaintext diagnostics in public
Actions logs.

A short historical receipt is evidence to investigate, not automatic authority
to cancel a delivered purchase, refund a payment or contact a customer. Compare
price edits, all receipts and the current matching provider invoice first.

Reference: <https://payos.vn/docs/api/> (GET payment request fields).
