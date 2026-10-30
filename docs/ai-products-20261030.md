# AI catalog · owner update 2026-10-30

Catalog version `CENAR-CATALOG-V3.23`; bot SQLite is authoritative for Discord,
website product API and AI knowledge. Add two distinct stable SKUs and update
Claude Pro using its existing `claude-pro-1-month` identity.

| Product | Price collected | Subscription | Warranty | Delivery |
|---|---:|---|---|---|
| ChatGPT Plus UPI Pay |130,000 VND|1 month nominal|12 hours|Shop supplies account|
| Claude Pro |520,000 VND|1 month|Full month; locked accounts excluded|Customer's own account|
| Claude Pro x5 |2,000,000 VND|1 month|7 days|Customer's own account|

Owner confirmed x5 arithmetic: the shop retains the100USD API allocation and
refunds700,000VND; net cost is1,300,000VND. Checkout remains2,000,000VND. The API
allocation is not customer inventory/credit and is not recorded as a free API
pack. This catalog change does not transfer/refund money; staff handles the
promised refund. No new refund automation or eligibility conditions are inferred.

The UPI offer reports the shop's observation that most accounts last2weeks or
longer. This observation is attributed to the shop; warranty remains12hours.

Own-account products retain manual staff fulfillment. The supplied UPI product
uses the existing exact-SKU stock boundary. Existing120k ChatGPT/two-day warranty
and supplied-account Claude x5 variants remain separate. Seeding is idempotent,
keeps the old Claude Pro ID and does not modify historical order snapshots.

Price panels show the exact short warranty and locked-account exception instead
of the old blanket full-warranty label. The two new offers include their detailed
conditions in Vietnamese and English. Website already consumes description,
warranty_policy and activation_method from the same live API; no frontend release
is needed. AI reads the same catalog and understands warranty stated in hours.

The paused promotion manifest is updated as data only. Public price panels must
be deliberately refreshed silently/in place; do not enable recurring price-board
resends, restart campaigns, ping roles, or send a new announcement.

Regression checks cover metadata/prices, refund arithmetic and API ownership,
one-month duration versus12-hour/7-day warranty, unique selectors, Discord limits,
English terms, current AI knowledge/quantity, migration idempotency and unchanged
old order data. Required CI and real website/Discord verification remain release
gates; local SQLite is not evidence of production catalog changes.
