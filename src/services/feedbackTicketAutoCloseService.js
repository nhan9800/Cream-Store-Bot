import { config } from '../config.js';
import {
  closeTicketIfOpen, getTicketById, getDueAutoCloseTickets, getFeedbackAutoCloseState,
  scheduleMissingFeedbackTicketAutoCloses, scheduleTicketAutoClose, unscheduleTicketAutoClose,
} from './ticketService.js';
import { archiveTicketConversation } from './ticketClosureService.js';
import { getLatestTicketTranscriptMetadata } from './transcriptService.js';
import { emitStaffLog } from './staffLogService.js';
import { setOrderStatus } from './orderService.js';
import { updateOrderLogMessage } from './notificationService.js';

export const FEEDBACK_CLOSE_POLL_MS = 5_000;
let timer = null;
let enabled = false;
let generation = 0;
let activeRun = null;
let lastRun = null;

export function getFeedbackTicketAutoCloseStatus() {
  return { running: enabled, busy: Boolean(activeRun), pollIntervalMs: FEEDBACK_CLOSE_POLL_MS,
    delayMinutes: config.autoCloseCompletedTicketMinutes, lastRun };
}

function freshDueTicket(ticket, runGeneration) {
  if (runGeneration !== generation) return null;
  const current = getTicketById(ticket.id);
  if (!current || current.guild_id !== config.guildId || current.status !== 'OPEN'
    || Number(current.keep_open_requested) === 1 || !current.auto_close_at
    || current.auto_close_at !== ticket.auto_close_at
    || Date.parse(current.auto_close_at) > Date.now()) return null;
  if (!getFeedbackAutoCloseState(current).eligible) {
    unscheduleTicketAutoClose(current.id);
    return null;
  }
  return current;
}

function retryLater(ticket, runGeneration) {
  // Never reset a Keep Open selection, a new deadline, or a new order which
  // arrived while Discord/transcript I/O was in flight.
  const current = freshDueTicket(ticket, runGeneration);
  if (current) scheduleTicketAutoClose(current.id, 1);
  return 'deferred';
}

async function closeDueTicket(client, ticket, runGeneration) {
  if (!freshDueTicket(ticket, runGeneration)) return 'skipped';
  let channel;
  try {
    channel = await client.channels.fetch(ticket.channel_id);
  } catch (error) {
    // Missing access/timeouts do not prove a Discord channel was deleted.
    if (Number(error?.code) === 10003
      && getLatestTicketTranscriptMetadata({ ticketId: ticket.id, ticketCode: ticket.ticket_code })
      && freshDueTicket(ticket, runGeneration)) {
      return closeTicketIfOpen(ticket.id, client.user.id).closed ? 'closed' : 'skipped';
    }
    return retryLater(ticket, runGeneration);
  }
  if (!channel || channel.guild?.id !== ticket.guild_id) return retryLater(ticket, runGeneration);
  if (!freshDueTicket(ticket, runGeneration)) return 'skipped';

  const archive = await archiveTicketConversation({ guild: channel.guild, ticket, channel, closedById: client.user.id });
  if (!archive.archived) return retryLater(ticket, runGeneration);

  // Read the persisted ticket again: Keep Open/manual close/rescheduling can
  // happen during transcript export even when linked orders have not changed.
  if (!freshDueTicket(ticket, runGeneration)) return 'skipped';
  const reason = `Tự động đóng Ticket ${ticket.ticket_code} sau khi feedback`;
  try {
    await channel.delete(reason);
  } catch (error) {
    if (Number(error?.code) !== 10003) {
      if (!channel.isThread?.()) return retryLater(ticket, runGeneration);
      if (!freshDueTicket(ticket, runGeneration)) return 'skipped';
      try { await channel.setArchived(true, reason); }
      catch { return retryLater(ticket, runGeneration); }
    }
  }
  const closed = closeTicketIfOpen(ticket.id, client.user.id);
  if (!closed.closed) return 'skipped';
  // An audit delivery must not hold up the next customer's due ticket.
  emitStaffLog(client, { guildId: ticket.guild_id, actorId: client.user.id, targetId: ticket.customer_id,
    action: 'TICKET_CLOSE', detail: 'Auto-close ticket sau thời gian feedback',
    relatedTicketCode: ticket.ticket_code, relatedOrderCode: ticket.related_order_code ?? null,
  }).catch(() => null);
  if (ticket.ticket_type === 'WARRANTY' && ticket.related_order_code) {
    const order = setOrderStatus(ticket.related_order_code, 'COMPLETED');
    if (order) updateOrderLogMessage(channel.guild, order).catch(() => null);
  }
  return 'closed';
}

export function processFeedbackTicketAutoCloses(client) {
  if (activeRun) return activeRun;
  const runGeneration = generation;
  activeRun = (async () => {
    const repaired = scheduleMissingFeedbackTicketAutoCloses(config.guildId, 100, config.autoCloseCompletedTicketMinutes);
    const due = getDueAutoCloseTickets(config.guildId, 20);
    const report = { at: new Date().toISOString(), repaired: repaired.length, scanned: due.length,
      closed: 0, skipped: 0, deferred: 0, failed: 0 };
    let next = 0;
    // A slow transcript for one ticket does not delay all other due tickets.
    await Promise.all(Array.from({ length: Math.min(2, due.length) }, async () => {
      while (next < due.length) {
        const ticket = due[next++];
        try { report[await closeDueTicket(client, ticket, runGeneration)] += 1; }
        catch (error) {
          retryLater(ticket, runGeneration);
          report.failed += 1;
          console.warn('[FEEDBACK-AUTO-CLOSE] Retry deferred:', error?.code || error?.name || 'CLOSE_FAILED');
        }
      }
    }));
    lastRun = report;
    return { ...report };
  })().finally(() => { activeRun = null; });
  return activeRun;
}

export function startFeedbackTicketAutoClose(client) {
  if (enabled) return;
  enabled = true;
  const startedGeneration = ++generation;
  const run = async () => {
    if (!enabled || startedGeneration !== generation) return;
    try { await processFeedbackTicketAutoCloses(client); }
    catch (error) { console.warn('[FEEDBACK-AUTO-CLOSE] Poll failed:', error?.code || error?.name || 'POLL_FAILED'); }
    finally {
      if (enabled && startedGeneration === generation) timer = setTimeout(run, FEEDBACK_CLOSE_POLL_MS);
    }
  };
  timer = setTimeout(run, FEEDBACK_CLOSE_POLL_MS);
}

export function stopFeedbackTicketAutoClose() {
  enabled = false;
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = null;
}
