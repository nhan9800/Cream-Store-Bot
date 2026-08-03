import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tickets: [], nextId: 1 }));

vi.mock('../src/database/db.js', () => {
  const db = {
    transaction: (callback) => callback,
    prepare: (sql) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT 1 FROM tickets WHERE ticket_code=')) {
        return { get: (ticketCode) => state.tickets.find((ticket) => ticket.ticket_code === ticketCode) ? { found: 1 } : undefined };
      }
      if (normalized.includes('WHERE client_request_id=?')) {
        return { get: (requestId) => state.tickets.find((ticket) => ticket.client_request_id === requestId) };
      }
      if (normalized.includes("support_source='WEBSITE_AI'")) {
        return {
          get: (guildId, customerId) => [...state.tickets].reverse().find((ticket) => (
            ticket.guild_id === guildId
            && ticket.customer_id === customerId
            && ticket.ticket_type === 'SUPPORT'
            && ticket.support_source === 'WEBSITE_AI'
            && ticket.status === 'OPEN'
          )),
        };
      }
      if (normalized.startsWith('INSERT INTO tickets')) {
        return {
          run: (...values) => {
            const [
              ticketCode,
              guildId,
              channelId,
              customerId,
              openedById,
              ticketType,
              relatedOrderCode,
              ticketSubject,
              supportSource,
              clientRequestId,
              lastActivityAt,
              createdAt,
            ] = values;
            const ticket = {
              id: state.nextId++,
              ticket_code: ticketCode,
              guild_id: guildId,
              channel_id: channelId,
              customer_id: customerId,
              opened_by_id: openedById,
              ticket_type: ticketType,
              related_order_code: relatedOrderCode,
              ticket_subject: ticketSubject,
              support_source: supportSource,
              client_request_id: clientRequestId,
              last_activity_at: lastActivityAt,
              created_at: createdAt,
              status: 'OPEN',
            };
            state.tickets.push(ticket);
            return { lastInsertRowid: ticket.id };
          },
        };
      }
      if (normalized === 'SELECT * FROM tickets WHERE id=?') {
        return { get: (id) => state.tickets.find((ticket) => ticket.id === Number(id)) };
      }
      return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
    },
  };
  return { db, nowIso: () => '2026-08-03T00:00:00.000Z' };
});

vi.mock('../src/utils/id.js', () => ({ randomDigits: vi.fn(() => '123456') }));

const { reserveWebsiteSupportTicket } = await import('../src/services/ticketService.js');

describe('website support ticket reservation', () => {
  beforeEach(() => {
    state.tickets.length = 0;
    state.nextId = 1;
  });

  it('returns the same ticket when a click is submitted twice with the same request ID', () => {
    const input = {
      guildId: 'guild-1',
      customerId: '1138315103821889566',
      contact: 'nhan98_.',
      clientRequestId: 'support_request_123456',
    };

    const first = reserveWebsiteSupportTicket(input);
    const second = reserveWebsiteSupportTicket(input);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.ticket.id).toBe(first.ticket.id);
    expect(state.tickets).toHaveLength(1);
    expect(first.ticket.support_source).toBe('WEBSITE_AI');
  });

  it('reuses the open Website AI ticket even when the browser sends a new request ID', () => {
    const first = reserveWebsiteSupportTicket({
      guildId: 'guild-1',
      customerId: '1138315103821889566',
      contact: 'nhan98_.',
      clientRequestId: 'support_request_first',
    });
    const second = reserveWebsiteSupportTicket({
      guildId: 'guild-1',
      customerId: '1138315103821889566',
      contact: 'nhan98_.',
      clientRequestId: 'support_request_second',
    });

    expect(second.reused).toBe(true);
    expect(second.ticket.ticket_code).toBe(first.ticket.ticket_code);
    expect(state.tickets).toHaveLength(1);
  });
});
