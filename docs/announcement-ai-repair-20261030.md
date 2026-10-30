# Announcement and AI response repair · 2026-10-30

## /thongbao

The owner reported delayed button actions and occasional no-post after confirming.
Previously confirm passed through the shared `BUTTON_announcement` cooldown;
an initial failed `deferUpdate` also left the draft's publishing lock set forever.
Edits recreated independent previews, reset role choices and could mismatch images
when multiple drafts shared a user/channel. A send failure removed the embed that
later selection/toggle handlers expected.

`announcementDraftService.js` now routes all draft controls before the generic
cooldown and acknowledges before publication. Each command interaction creates a
separate owner/guild/channel-bound draft with a 15-minute lifetime. Editing uses
the same draft and preview, preserving images and selected roles. Old modal
revisions cannot overwrite newer content. At most 200 live drafts are retained;
expiry is checked on access, not via a timer per draft.

Confirm reserves a synchronous lock with cleanup even if the ACK fails. A real
accepted Discord message is retained independently of the ephemeral success
receipt, so a lost receipt cannot cause a second send. The draft ID is the stable
Discord nonce with `enforceNonce:true`. Transport/server uncertainty freezes
editing, permits immediate same-nonce retry only within 90 seconds, and blocks
later blind resends; the operator must inspect the channel. Discord's short nonce
window does not establish durable exactly-once publication. Drafts are in memory;
restart/expiry requires a fresh command. No startup replay or public test posts.

ManageMessages is checked on command and each action; everyone/here also require
the operator's MentionEveryone permission. Preview allowed mentions are empty.
Only the explicit publish payload allows selected roles/mass tags. User content,
attachments, pricing and the existing custom-emoji boundary are preserved.

## AI

- Ticket follow-ups such as `3t nhé`, `số lượng 2`, then `ok chốt` keep the latest
  product, duration and quantity. `1 hay 3 tháng` remains ambiguous until chosen.
  An unavailable requested duration cannot silently become another plan.
- Negated purchases cannot invoke deterministic order preparation or expose its
  model tool. Policy questions about warranty stay distinct from actual faults;
  monthly warranty terms are separate from subscription months.
- Keep one newest follow-up while a ticket response runs instead of discarding
  all concurrent customer input. Recheck current customer/AI status before the
  queued customer task. Public reply cooldown/suppression stays unchanged.
- Model history always includes the triggering message, is chronological and
  excludes later messages/other customers when serving the ticket owner. Existing
  redaction, bounded history and current catalog grounding remain in place.
- Use Gateway channel cache rather than fetching all guild channels on every
  answer. History reads fall back after 3 seconds. Provider attempts share a
  20-second completion budget, at most 10 seconds per provider (Gemini key rotation
  shares that provider signal). Body reads are included; empty outputs fall back.
  These are component deadlines, not an end-to-end Discord latency guarantee.
- Rejected provider bodies/raw SDK errors are not logged. Real payment, warranty,
  refund, fulfillment and catalog-revision decisions keep existing server guards.

## Verification and release gate

Regression tests cover actual dispatcher routing, ACK failure, double-click,
lost success receipt, failed-send preview recovery, image/role edit continuity,
draft isolation/permissions/expiry, uncertain retry, contextual plan selection,
negation, history isolation, response coalescing and provider body deadlines.

Initial full local suite: 151 files / 1067 tests passed; command smoke loaded 79
commands. New Oct30 release-gate audit required only compatible updates:
body-parser 1.20.6→1.20.9, undici 6.29.0→6.29.1 and qs override
6.16.0→6.16.1. Runtime audit then reports zero vulnerabilities. CI must verify
the final lockfile/source before promotion to bot-production.

Automatic marketing/pings/price-board resend remain paused. No deployment step
may overwrite SQLite, environment files, encrypted keys or backups.
