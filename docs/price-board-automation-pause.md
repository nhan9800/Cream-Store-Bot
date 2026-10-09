# Automatic price-board resend paused · 2026-10-09

The owner requested that the bot stop sending the price board again. `AUTOMATIC_PRICE_BOARD_PAUSED=true` now stops startup publication and emoji/interface refresh before any Discord channel is fetched or written. The price-related announcement hook also returns `paused`, so posting an announcement cannot silently trigger a second board.

The manual `/product sync` path passes `automatic:false` and remains available for a deliberate future rebuild. Existing price-board messages, catalog rows, order data and customer checkout are not deleted or changed by this switch. The publication status is exposed as `paused` with owner-request reason.

Focused test: `test/priceBoardResendPause.test.js`. Existing startup/interface tests cover the refresh orchestration and the full release gate must pass before deployment.
