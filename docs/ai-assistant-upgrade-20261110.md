# Shop AI understanding, 10 November 2026

The assistant now distinguishes product identity from benefits mentioned in a description. A Gemini offer mentioning Claude models or YouTube does not become a Claude or YouTube subscription. Nitro, Server Boost, profile decorations and development work have separate matching. Budget caps include the requested quantity unless the customer explicitly asks for a per-package budget.

Short price/warranty/duration questions reuse the latest customer product context. Corrections replace the earlier choice, ambiguous comparisons remain choices, and unavailable durations are explained before any purchase selector. The assistant prioritizes requests about existing payments, refunds, orders and staff assistance over purchase words in those messages.

Both the generated context and provider fallback carry current catalog price, subscription duration and each SKU's warranty. Perpetual items, day-based plans and project scope are distinct. Promotion quotes remain separate from checkout. This does not change the model, provider, catalog, order data or fulfillment policy.

Tool calls are checked against the exact tools offered for the current open ticket, guild and customer; product and quantity must match the server's resolution. The customer confirmation button remains required for an actual order. Sensitive credentials are redacted before model input and output. Support logging does not assert payment, refund, warranty approval or a staff response deadline.

Regression coverage: `test/aiCommerceUnderstanding.test.js`, `test/aiSupportAutomation.test.js`, `test/aiAssistantBehavior.test.js`, existing provider lifecycle and catalog tests. Scenario tests mock Discord and providers or use isolated synthetic SQLite. No customer conversations are sent as a production test.

Website `/api/ai-chat` is a separate implementation, released from the website repository. Its own prompt and fallback also require per-SKU policy; upgrading only this bot does not update that route.
