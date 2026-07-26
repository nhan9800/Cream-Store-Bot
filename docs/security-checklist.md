# Security Audit & Checklist - Cenar Store

## Authentication & API Protection
- [x] **Rate Limiting**: Public endpoint `/api/public/orders/:code` protected via `orderLookupLimiter` (10 requests / 15 minutes per IP).
- [x] **IDOR & PII Redaction**: Sensitive customer information (`customer_email`, `customer_id`, `delivery_info`) stripped from public API responses unless valid `x-bot-api-key` is supplied.
- [x] **Anonymized Activity Feed**: Customer names and emails masked via `anonymizeCustomerName` and `anonymizeCustomerEmail` in public `/api/public/activity` endpoint.
- [x] **PayOS Signature Verification**: Webhook payloads authenticated against `PAYOS_CHECKSUM_KEY` via HMAC-SHA256 signature verification before processing state changes.

## Database & Transaction Hardening
- [x] **Atomic Transactions**: Webhook order completion and stock claims executed inside SQLite transactions (`db.transaction()`) to prevent race conditions or double-delivery.
- [x] **Audit Logging**: Every order state change automatically recorded in `order_status_history` table with timestamps, previous status, new status, and actor.
