import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const keys = ['ENV_FILE','DATABASE_PATH','GUILD_ID','UNPAID_ORDER_TICKET_HOURS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.ENV_FILE = '.env.pending-ticket-close-test-absent';
  process.env.DATABASE_PATH = `./data/test-pending-ticket-close-${process.pid}-${Date.now()}.sqlite`;
  process.env.GUILD_ID = '900000000000000050';
  process.env.UNPAID_ORDER_TICKET_HOURS = '24';
  return { previous, database: process.env.DATABASE_PATH, archive: vi.fn(), log: vi.fn(), notify: vi.fn(), update: vi.fn() };
});
vi.mock('../src/services/ticketClosureService.js', () => ({ archiveTicketConversation: fixture.archive }));
vi.mock('../src/services/staffLogService.js', async original => ({ ...await original(), emitStaffLog: fixture.log }));
vi.mock('../src/services/notificationService.js', async original => ({ ...await original(), sendOrderCancelledFlow: fixture.notify, updateOrderLogMessage: fixture.update }));
import { db, initDatabase } from '../src/database/db.js';
import { config } from '../src/config.js';
import { createTicket, getTicketById, getOpenTicketByCustomer, keepTicketOpen, touchTicket } from '../src/services/ticketService.js';
import { processPendingPaymentTickets, getPendingPaymentTicketPolicy, buildPaymentReminderV2 } from '../src/services/ticketAutoCloseService.js';

const customer = '900000000000000051';
const client = { user: { id: '900000000000000052' }, channels: { fetch: vi.fn() } };
const channels = new Map(); let sequence = 0;
const hour = 3600000;
function addOrder(ticket, options = {}) {
  const code = `CN_${600000 + ++sequence}`;
  const createdAt = new Date(Date.now() - (options.ageHours ?? 24) * hour).toISOString();
  db.prepare(`INSERT INTO orders(order_code,guild_id,ticket_id,ticket_channel_id,customer_id,product_name,quantity,
    total_amount,amount_paid,payment_status,status,created_at,updated_at,order_log_channel_id,created_by_id,
    payment_reminder_sent_at,processing_reminder_sent_at,payment_link_id,payment_cancel_reason)
    VALUES(?,?,?,?,?,'Fixture',1,100000,?,?,?,?,?,'LOG','STAFF',?,?,?,?)`)
    .run(code, config.guildId, ticket.id, ticket.channel_id, customer, options.paid ? 100000 : 0,
      options.paymentStatus || (options.paid ? 'PAID' : 'UNPAID'), options.status || 'PENDING_PAYMENT', createdAt, createdAt,
      options.firstWarning ?? new Date(Date.now()-23*hour).toISOString(), options.finalWarning ?? new Date(Date.now()-22*hour).toISOString(),
      options.paymentLinkId ?? null, options.cancelReason ?? null);
  return db.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
}
function ticketFixture(options = {}) {
  const channelId = `900000000000${String(++sequence).padStart(6,'0')}`;
  let ticket = createTicket({ guildId: config.guildId, customerId: customer, channelId, openedById: customer, ticketType: options.ticketType || 'ORDER' });
  const createdAt = new Date(Date.now() - (options.ageHours ?? 24)*hour).toISOString();
  db.prepare('UPDATE tickets SET created_at=?,last_activity_at=? WHERE id=?').run(createdAt, createdAt, ticket.id);
  ticket = getTicketById(ticket.id);
  const order = addOrder(ticket, options);
  const channel = { id: channelId, guild: { id: config.guildId }, send: vi.fn(async () => ({ id: 'sent' })), delete: vi.fn(async () => {}) };
  channels.set(channelId, channel);
  return { ticket, order, channel };
}
beforeAll(() => initDatabase());
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')); vi.clearAllMocks(); channels.clear();
  fixture.archive.mockReset().mockResolvedValue({ archived: true }); fixture.log.mockResolvedValue({});
  fixture.notify.mockResolvedValue({}); fixture.update.mockResolvedValue({});
  client.channels.fetch.mockReset().mockImplementation(async id => channels.get(id));
});
afterEach(() => {
  vi.useRealTimers();
  db.prepare('DELETE FROM orders WHERE guild_id=?').run(config.guildId);
  db.prepare('DELETE FROM tickets WHERE guild_id=?').run(config.guildId);
});
afterAll(() => {
  db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(fixture.database + suffix), { force: true });
  for (const [key,value] of Object.entries(fixture.previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

describe('24-hour unpaid Discord ORDER ticket policy', () => {
  it('reports the exact running retention policy and keeps invoice validity separate', () => {
    expect(getPendingPaymentTicketPolicy()).toEqual({ idleHours: 24, activityBasis: 'LATEST_ORDER_OR_HUMAN_TICKET_ACTIVITY', invoiceExpirySeparate: true });
    expect(config.payosExpireMinutes).toBe(60);
  });
  it.each([0.25, 0.6, 23.999])('does not use old 15/20/10-minute warning timestamps to close an existing %.3fh ticket', async ageHours => {
    const { ticket, channel, order } = ticketFixture({ ageHours });
    await processPendingPaymentTickets(client);
    expect(channel.delete).not.toHaveBeenCalled(); expect(fixture.archive).not.toHaveBeenCalled();
    expect(getTicketById(ticket.id).status).toBe('OPEN');
    expect(db.prepare('SELECT status FROM orders WHERE order_code=?').get(order.order_code).status).toBe('PENDING_PAYMENT');
  });
  it('closes at the persisted 24-hour boundary only after transcript export', async () => {
    const { ticket, channel, order } = ticketFixture({ ageHours: 23.999 });
    await processPendingPaymentTickets(client); await vi.advanceTimersByTimeAsync(3600); await processPendingPaymentTickets(client);
    expect(fixture.archive).toHaveBeenCalledOnce(); expect(channel.delete).toHaveBeenCalledOnce();
    expect(fixture.archive.mock.invocationCallOrder[0]).toBeLessThan(channel.delete.mock.invocationCallOrder[0]);
    expect(getTicketById(ticket.id).status).toBe('CLOSED');
    expect(db.prepare('SELECT status,payment_status FROM orders WHERE order_code=?').get(order.order_code)).toEqual({ status:'CANCELLED', payment_status:'CANCELLED' });
    expect(fixture.archive.mock.calls[0][0].minimumCreatedAt).toBe(new Date().toISOString());
  });
  it('claims a closed ticket before Discord deletion so a simultaneous purchase cannot reuse it', async () => {
    const { ticket, channel } = ticketFixture();
    channel.delete.mockImplementationOnce(async () => {
      expect(getTicketById(ticket.id).status).toBe('CLOSED');
      expect(getOpenTicketByCustomer(config.guildId, customer, 'ORDER')).toBeNull();
    });
    await processPendingPaymentTickets(client); expect(channel.delete).toHaveBeenCalledOnce();
  });
  it.each([{ status:'CANCELLED', paymentLinkId:'expired-invoice' },
    { status:'CANCELLED', paymentLinkId:'expired-invoice',cancelReason:'Thanh toán PayOS đã hết hạn' },
    { status:'CANCELLED', paymentLinkId:'cancelled-invoice',cancelReason:'Thanh toán bị hủy (PayOS)' },
    { status:'CANCELLED', paymentLinkId:'cancelled-invoice',cancelReason:'Thanh toán PayOS bị hủy' },
    { status:'PENDING_PAYMENT', paymentStatus:'CANCELLED' }])('keeps expired/cancelled provider invoices for the full ticket window: %j', async state => {
    const { ticket, channel } = ticketFixture({ ...state, ageHours: 1 });
    await processPendingPaymentTickets(client); expect(channel.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(23*hour); await processPendingPaymentTickets(client);
    expect(channel.delete).toHaveBeenCalledOnce(); expect(getTicketById(ticket.id).status).toBe('CLOSED');
  });
  it('does not claim manually cancelled orders as an unpaid cleanup candidate', async () => {
    const { ticket, channel } = ticketFixture({ status:'CANCELLED', paymentStatus:'CANCELLED', cancelReason:'Customer requested cancellation' });
    await processPendingPaymentTickets(client); expect(channel.delete).not.toHaveBeenCalled(); expect(getTicketById(ticket.id).status).toBe('OPEN');
  });
  it('extends retention 24h after new human activity and the latest sibling order', async () => {
    const active = ticketFixture(), sibling = ticketFixture();
    touchTicket(active.ticket.id); addOrder(sibling.ticket, { ageHours: 0 });
    await processPendingPaymentTickets(client); expect(fixture.archive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24*hour-1); await processPendingPaymentTickets(client);
    expect(active.channel.delete).not.toHaveBeenCalled(); expect(sibling.channel.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await processPendingPaymentTickets(client);
    expect(active.channel.delete).toHaveBeenCalledOnce(); expect(sibling.channel.delete).toHaveBeenCalledOnce();
  });
  it.each(['WARRANTY','SUPPORT'])('does not close a %s ticket', async ticketType => {
    const { channel } = ticketFixture({ ticketType }); await processPendingPaymentTickets(client);
    expect(fixture.archive).not.toHaveBeenCalled(); expect(channel.delete).not.toHaveBeenCalled();
  });
  it.each([{ paid:true }, { paymentStatus:'FREE' }, { status:'PROCESSING' }, { status:'WARRANTY_OPEN' }, { status:'COMPLETED' }])('preserves a ticket with a protected sibling order: %j', async state => {
    const { ticket, channel } = ticketFixture(); addOrder(ticket, state); await processPendingPaymentTickets(client);
    expect(fixture.archive).not.toHaveBeenCalled(); expect(channel.delete).not.toHaveBeenCalled();
  });
  it.each(['keep','paid','reply','sibling'])('rechecks %s changes that happen while the transcript is exporting', async action => {
    const { ticket, channel, order } = ticketFixture();
    fixture.archive.mockImplementationOnce(async () => {
      if (action === 'keep') keepTicketOpen(ticket.id);
      if (action === 'paid') db.prepare("UPDATE orders SET payment_status='PAID',amount_paid=total_amount,status='PROCESSING' WHERE order_code=?").run(order.order_code);
      if (action === 'reply') touchTicket(ticket.id);
      if (action === 'sibling') addOrder(ticket, { ageHours:0 });
      return { archived:true };
    });
    await processPendingPaymentTickets(client); expect(channel.delete).not.toHaveBeenCalled(); expect(getTicketById(ticket.id).status).toBe('OPEN');
    expect(db.prepare('SELECT status FROM orders WHERE order_code=?').get(order.order_code).status).toBe(action === 'paid' ? 'PROCESSING' : 'PENDING_PAYMENT');
  });
  it('honors persisted administrator Keep Open before any transcript or deletion', async () => {
    const { ticket, channel } = ticketFixture(); keepTicketOpen(ticket.id); await processPendingPaymentTickets(client);
    expect(fixture.archive).not.toHaveBeenCalled(); expect(channel.delete).not.toHaveBeenCalled();
  });
  it('preserves unpaid state when transcript fails and retries without overlapping cleanup', async () => {
    const { ticket, channel, order } = ticketFixture(); fixture.archive.mockResolvedValueOnce({ archived:false });
    const run = processPendingPaymentTickets(client); expect(processPendingPaymentTickets(client)).toBe(run); await run;
    expect(channel.delete).not.toHaveBeenCalled(); expect(getTicketById(ticket.id).status).toBe('OPEN');
    expect(db.prepare('SELECT status FROM orders WHERE order_code=?').get(order.order_code).status).toBe('PENDING_PAYMENT');
    await processPendingPaymentTickets(client); expect(channel.delete).toHaveBeenCalledOnce();
  });
  it('does not mark closed if Discord deletion fails, and retries the archived cancellation later', async () => {
    const { ticket, channel } = ticketFixture(); channel.delete.mockRejectedValueOnce(new Error('missing permission'));
    await processPendingPaymentTickets(client); expect(getTicketById(ticket.id).status).toBe('OPEN');
    await processPendingPaymentTickets(client); expect(getTicketById(ticket.id).status).toBe('CLOSED');
    expect(channel.delete).toHaveBeenCalledTimes(2);
  });
  it('keeps its closure claim when Discord confirms the archived channel is already gone', async () => {
    const { ticket, channel } = ticketFixture();
    channel.delete.mockRejectedValueOnce(Object.assign(new Error('Unknown channel'),{code:10003}));
    await processPendingPaymentTickets(client);
    expect(fixture.archive).toHaveBeenCalledOnce(); expect(getTicketById(ticket.id).status).toBe('CLOSED');
  });
  it('preserves a new Keep Open request while undoing its own failed Discord deletion claim', async () => {
    const { ticket, channel } = ticketFixture();
    channel.delete.mockImplementationOnce(async () => { keepTicketOpen(ticket.id); throw new Error('missing permission'); });
    await processPendingPaymentTickets(client);
    expect(getTicketById(ticket.id)).toMatchObject({ status:'OPEN',keep_open_requested:1,closed_at:null,closed_by_id:null });
    await processPendingPaymentTickets(client); expect(channel.delete).toHaveBeenCalledOnce();
  });
  it('does not overwrite a different administrator closure while reverting a failed deletion claim', async () => {
    const { ticket, channel } = ticketFixture();
    channel.delete.mockImplementationOnce(async () => {
      db.prepare("UPDATE tickets SET closed_by_id='ADMIN_OTHER' WHERE id=?").run(ticket.id);
      throw new Error('missing permission');
    });
    await processPendingPaymentTickets(client);
    expect(getTicketById(ticket.id)).toMatchObject({status:'CLOSED',closed_by_id:'ADMIN_OTHER'});
  });
  it('does not cancel a linked order on Unknown Channel without transcript proof', async () => {
    const { ticket, order } = ticketFixture(); client.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown'),{code:10003}));
    await processPendingPaymentTickets(client); expect(getTicketById(ticket.id).status).toBe('OPEN');
    expect(db.prepare('SELECT status FROM orders WHERE order_code=?').get(order.order_code).status).toBe('PENDING_PAYMENT');
  });
  it('uses real close timestamps and distinguishes ticket retention from a shorter invoice deadline', async () => {
    const { channel } = ticketFixture({ ageHours:0.25, firstWarning:null, finalWarning:null });
    db.prepare('UPDATE orders SET payment_reminder_sent_at=NULL,processing_reminder_sent_at=NULL').run();
    await processPendingPaymentTickets(client);
    const content = channel.send.mock.calls[0][0].components.map(c => JSON.stringify(c.toJSON())).join('');
    expect(content).toContain('<t:'); expect(content).toContain('24'); expect(content).toContain('QR');
    expect(content).not.toContain('20 phút');
    const english = buildPaymentReminderV2({ guildId:'1070676180103086132',customerId:customer,orderCode:'CN_123456',deadlineAt:Date.now()+10*60000,stage:'final' });
    expect(JSON.stringify(english.components.map(c=>c.toJSON()))).toContain('QR/payment links may expire earlier');
  });
});
