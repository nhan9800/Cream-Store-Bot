import { deliverTranscript } from './notificationService.js';
import {
  exportTicketTranscript,
  getLatestTicketTranscriptMetadata,
} from './transcriptService.js';

/**
 * Persist a ticket conversation before its Discord channel is removed.
 * Existing archives make the operation idempotent, which lets staff retry a
 * partially completed close without producing duplicate transcript records.
 */
export async function archiveTicketConversation({
  guild,
  ticket,
  channel,
  closedById,
  exportOptions = {},
  deliver = deliverTranscript,
} = {}) {
  if (!ticket?.id) {
    return { archived: false, reused: false, error: 'Ticket is missing a persisted id' };
  }

  const existing = getLatestTicketTranscriptMetadata({ ticketId: ticket.id, ticketCode: ticket.ticket_code });
  if (existing) {
    return { archived: true, reused: true, transcript: existing, delivery: null };
  }

  if (!channel?.messages?.fetch) {
    return { archived: false, reused: false, error: 'Discord ticket channel is unavailable' };
  }

  const transcriptResult = await exportTicketTranscript(channel, exportOptions).catch((error) => ({
    savedToDisk: false,
    archiveId: null,
    messageCount: 0,
    error: error?.message || 'Transcript export failed',
  }));
  if (!transcriptResult?.savedToDisk || !transcriptResult.archiveId) {
    return {
      archived: false,
      reused: false,
      transcriptResult,
      error: transcriptResult?.error || transcriptResult?.fetchErrorMessage || 'Transcript archive was not persisted',
    };
  }

  let delivery = null;
  if (guild && typeof deliver === 'function') {
    delivery = await deliver({ guild, ticket, transcriptResult, closedById }).catch((error) => ({
      delivered: false,
      reason: error?.message || 'Transcript delivery failed',
    }));
  }

  const metadata = getLatestTicketTranscriptMetadata({ ticketId: ticket.id, ticketCode: ticket.ticket_code });

  return {
    archived: true,
    reused: false,
    transcriptResult,
    transcript: metadata || {
      id: transcriptResult.archiveId,
      archiveCode: transcriptResult.archiveCode,
      ticketId: ticket.id,
      ticketCode: ticket.ticket_code,
      messageCount: transcriptResult.messageCount,
      partial: Boolean(transcriptResult.partial),
      createdAt: new Date().toISOString(),
      expiresAt: null,
      mirrored: Boolean(delivery?.mirrored),
    },
    delivery,
  };
}
