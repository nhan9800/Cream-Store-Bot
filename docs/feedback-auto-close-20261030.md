# Close reviewed order tickets without waiting for maintenance

Customer and manager-on-behalf feedback already shared a persisted two-minute deadline. Execution was at the end of the default five-minute maintenance cycle, after payment reconciliation and numerous Discord reminder calls. A slow maintenance request could leave a reviewed ticket open long after its displayed deadline.

`feedbackTicketAutoCloseService.js` now polls persisted deadlines every five seconds independently of maintenance. Two due tickets can archive concurrently; duplicate polls share an active run. Closing still requires all linked non-cancelled/non-refunded orders completed and reviewed. There is no new review publication, deadline override or marketing timer.

Before deleting a channel, save/reuse its transcript and reread ticket status, Keep Open, deadline and linked orders. A Keep Open selection, manual close, reschedule, new order or stopped worker during export prevents deletion. Failed archive/deletion defers one minute without resetting Keep Open. Only Discord Unknown Channel10003 plus a saved transcript permits closing a missing-channel record; permission errors remain retryable. Threads retain the archive fallback.

Restart repair derives a missing deadline from the latest completed feedback plus the configured delay. Recent feedback keeps its remaining grace period; overdue eligible tickets can proceed on the next poll. Keep Open and pending orders remain excluded.

Public health includes only aggregate `feedbackTicketAutoClose` status: running/busy, pollIntervalMs5000, configured delayMinutes, last run time and counters. No ticket/order/customer IDs, messages, filenames or errors are exposed.

Validation: `npm test -- test/feedbackTicketAutoClose.test.js tests/feedback-ticket-auto-close.test.js test/feedbackDiscordSync.test.js tests/regression.test.js`. The main regression publishes a local admin-on-behalf review, stalls payment reconciliation forever, proves no closure before120seconds, then verifies closure at120seconds with fake timers. Disabling the independent worker hook makes that assertion fail. Discord and transcript I/O are mocked; no production review/ticket is created or deleted by tests. Normal closure runs shortly after the deadline; Discord/transcript latency and safe retries may add delay.
