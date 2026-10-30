import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const previous = Object.fromEntries(['ENV_FILE', 'DATABASE_PATH', 'GUILD_ID', 'AUTO_CLOSE_COMPLETED_TICKET_MINUTES'].map(k => [k, process.env[k]]));
  process.env.ENV_FILE = '.env.feedback-close-worker-test-missing';
  process.env.DATABASE_PATH = `./data/test-feedback-close-worker-${process.pid}-${Date.now()}.sqlite`;
  process.env.GUILD_ID = '900000000000000040';
  process.env.AUTO_CLOSE_COMPLETED_TICKET_MINUTES = '2';
  return { previous, database: process.env.DATABASE_PATH, archive: vi.fn(), metadata: vi.fn(),
    log: vi.fn(), reconcile: vi.fn(), backup: vi.fn(), noop: vi.fn() };
});
vi.mock('../src/services/ticketClosureService.js', () => ({ archiveTicketConversation: fixture.archive }));
vi.mock('../src/services/transcriptService.js', async original => ({ ...await original(), getLatestTicketTranscriptMetadata: fixture.metadata }));
vi.mock('../src/services/staffLogService.js', async original => ({ ...await original(), emitStaffLog: fixture.log }));
vi.mock('../src/services/paymentService.js', async original => ({ ...await original(), reconcileRecentPayOSPayments: fixture.reconcile }));
vi.mock('../src/services/backupService.js', async original => ({ ...await original(), backupDatabase: fixture.backup }));
vi.mock('../src/services/customerRoleSyncService.js', async original => ({ ...await original(), processPendingCustomerRoles: fixture.noop }));

import { db, initDatabase } from '../src/database/db.js';
import { config } from '../src/config.js';
import { createTicket, getTicketById, scheduleTicketAutoClose, keepTicketOpen, closeTicket } from '../src/services/ticketService.js';
import { publishFeedback } from '../src/services/feedbackService.js';
import { startScheduler, stopScheduler } from '../src/services/schedulerService.js';
import { processFeedbackTicketAutoCloses, startFeedbackTicketAutoClose, stopFeedbackTicketAutoClose,
  getFeedbackTicketAutoCloseStatus } from '../src/services/feedbackTicketAutoCloseService.js';

const customer = '900000000000000041', admin = '900000000000000042';
let sequence = 0;
const channels = new Map();
const client = { user: { id: '900000000000000043' }, channels: { fetch: vi.fn(async id => channels.get(id)) } };

function orderFor(ticket, { reviewed = true, status = 'COMPLETED', feedbackAt = new Date().toISOString() } = {}) {
  const code = `CN_WORKER_${++sequence}`;
  db.prepare(`INSERT INTO orders(order_code,guild_id,ticket_id,ticket_channel_id,customer_id,product_name,
    quantity,total_amount,amount_paid,payment_status,status,completed_at,feedback_submitted_at,created_at,updated_at,order_log_channel_id,created_by_id)
    VALUES(?,?,?,?,?,'Fixture product',1,100000,100000,'PAID',?,?,?,?,?,'ORDER_LOG','STAFF')`)
    .run(code, config.guildId, ticket.id, ticket.channel_id, customer, status, new Date().toISOString(),
      reviewed ? feedbackAt : null, new Date().toISOString(), new Date().toISOString());
  return db.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
}
function ticketFixture({ reviewed = true, due = true, feedbackAt } = {}) {
  const id = `900000000000${String(++sequence).padStart(6, '0')}`;
  const ticket = createTicket({ guildId: config.guildId, channelId: id, customerId: customer, openedById: customer });
  const order = orderFor(ticket, { reviewed, feedbackAt });
  if (due) scheduleTicketAutoClose(ticket.id, 0);
  const channel = { id, guild: { id: config.guildId }, delete: vi.fn(async () => {}),
    isTextBased: () => true, send: vi.fn(async () => ({})) };
  channels.set(id, channel);
  return { ticket: getTicketById(ticket.id), order, channel };
}

beforeAll(() => {
  initDatabase();
  db.prepare(`INSERT INTO guild_settings(guild_id,ticket_category_id,order_log_channel_id,feedback_channel_id,manager_role_id,updated_at)
    VALUES(?,'CATEGORY','ORDER_LOG','FEEDBACK','MANAGER',?)`)
    .run(config.guildId, new Date().toISOString());
});
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
  vi.clearAllMocks();channels.clear();
  fixture.archive.mockReset().mockResolvedValue({ archived: true });
  fixture.metadata.mockReset().mockReturnValue(null);
  fixture.log.mockResolvedValue({});
  fixture.backup.mockResolvedValue({ overallStatus: 'ok', telegram: { status: 'skipped' }, googleDrive: { status: 'skipped' } });
  fixture.noop.mockResolvedValue({ scanned: 0 });
});
afterEach(() => {
  stopScheduler();stopFeedbackTicketAutoClose();vi.clearAllTimers();vi.useRealTimers();
  db.prepare('DELETE FROM feedbacks WHERE guild_id=?').run(config.guildId);
  db.prepare('DELETE FROM orders WHERE guild_id=?').run(config.guildId);
  db.prepare('DELETE FROM tickets WHERE guild_id=?').run(config.guildId);
});
afterAll(() => {
  db.close();for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(fixture.database + suffix), { force: true });
  for (const [key,value] of Object.entries(fixture.previous)) { if (value === undefined) delete process.env[key];else process.env[key]=value; }
});

describe('feedback closure deadlines and safety', () => {
  it('closes an admin-reviewed ticket at two minutes even while main maintenance is stuck', async () => {
    const { ticket, order, channel } = ticketFixture({ reviewed: false, due: false });
    const feedbackChannel = { id: 'FEEDBACK', isTextBased: () => true, send: vi.fn(async () => ({ id: 'REVIEW' })) };
    const guild = { id: config.guildId, channels: { fetch: async id => id === 'FEEDBACK' ? feedbackChannel : channel },
      members: { fetch: async id => ({ id, permissions: { has: () => id === admin },
        roles: { cache: { has: () => false }, remove: async () => {} } }) } };
    const result = await publishFeedback({ guild, userId: customer, actorId: admin, orderCode: order.order_code, stars: 5, content: 'Fixture customer feedback' });
    expect(result.onBehalf).toBe(true);
    expect(Date.parse(result.ticket.auto_close_at)-Date.now()).toBe(120_000);
    expect(db.prepare('SELECT customer_id FROM feedbacks WHERE order_code=?').get(order.order_code).customer_id).toBe(customer);
    fixture.reconcile.mockReturnValue(new Promise(() => {}));
    startScheduler(client);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(channel.delete).not.toHaveBeenCalled();
    expect(fixture.reconcile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.archive).toHaveBeenCalledOnce();expect(channel.delete).toHaveBeenCalledOnce();
    expect(getTicketById(ticket.id).status).toBe('CLOSED');
    expect(getFeedbackTicketAutoCloseStatus()).toMatchObject({ running: true, pollIntervalMs: 5000, delayMinutes: 2, lastRun: { closed: 1 } });
  });

  it.each([true, false])('honors Keep Open during transcript export, including failure (archived=%s)', async (archived) => {
    const { ticket, channel } = ticketFixture();
    fixture.archive.mockImplementationOnce(async () => { keepTicketOpen(ticket.id);return { archived }; });
    await processFeedbackTicketAutoCloses(client);
    expect(channel.delete).not.toHaveBeenCalled();
    expect(getTicketById(ticket.id)).toMatchObject({ status: 'OPEN', keep_open_requested: 1, auto_close_at: null });
  });

  it('cancels closure when a new linked order arrives during transcript export', async () => {
    const { ticket, channel } = ticketFixture();
    fixture.archive.mockImplementationOnce(async () => { orderFor(ticket, { status: 'PROCESSING', reviewed: false });return { archived: true }; });
    await processFeedbackTicketAutoCloses(client);
    expect(channel.delete).not.toHaveBeenCalled();expect(getTicketById(ticket.id).auto_close_at).toBeNull();
  });

  it('does not close a manually closed or rescheduled ticket using an old deadline', async () => {
    const first = ticketFixture(), second = ticketFixture();
    fixture.archive.mockImplementation(async ({ ticket }) => {
      if (ticket.id === first.ticket.id) closeTicket(ticket.id, admin);
      else scheduleTicketAutoClose(ticket.id, 2);
      return { archived: true };
    });
    await processFeedbackTicketAutoCloses(client);
    expect(first.channel.delete).not.toHaveBeenCalled();expect(second.channel.delete).not.toHaveBeenCalled();
    expect(getTicketById(first.ticket.id).closed_by_id).toBe(admin);
    expect(Date.parse(getTicketById(second.ticket.id).auto_close_at)-Date.now()).toBe(120_000);
  });

  it('preserves the channel when transcript fails and retries later', async () => {
    const { ticket, channel } = ticketFixture();fixture.archive.mockResolvedValueOnce({ archived: false });
    await processFeedbackTicketAutoCloses(client);
    expect(channel.delete).not.toHaveBeenCalled();expect(getTicketById(ticket.id).status).toBe('OPEN');
    expect(Date.parse(getTicketById(ticket.id).auto_close_at)-Date.now()).toBe(60_000);
    await vi.advanceTimersByTimeAsync(60_000);await processFeedbackTicketAutoCloses(client);
    expect(channel.delete).toHaveBeenCalledOnce();expect(getTicketById(ticket.id).status).toBe('CLOSED');
  });

  it('does not mistake missing access for a deleted channel, even with an archive', async () => {
    const { ticket } = ticketFixture();fixture.metadata.mockReturnValue({ id: 1 });
    client.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('Missing access'), { code: 50001 }));
    await processFeedbackTicketAutoCloses(client);expect(getTicketById(ticket.id).status).toBe('OPEN');
    await vi.advanceTimersByTimeAsync(60_000);
    client.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown channel'), { code: 10003 }));
    await processFeedbackTicketAutoCloses(client);expect(getTicketById(ticket.id).status).toBe('CLOSED');
  });

  it('archives a ticket thread if Discord refuses deletion after the transcript is saved', async () => {
    const { ticket, channel } = ticketFixture();
    channel.isThread = () => true;
    channel.delete.mockRejectedValueOnce(Object.assign(new Error('Cannot delete thread'), { code: 50013 }));
    channel.setArchived = vi.fn(async () => {});
    await processFeedbackTicketAutoCloses(client);
    expect(fixture.archive).toHaveBeenCalledOnce();expect(channel.setArchived).toHaveBeenCalledWith(true, expect.any(String));
    expect(getTicketById(ticket.id).status).toBe('CLOSED');
  });

  it('lets another due ticket close while one transcript is slow and deduplicates overlapping polls', async () => {
    const first = ticketFixture(), second = ticketFixture();let finish;
    fixture.archive.mockImplementation(async ({ ticket }) => ticket.id === first.ticket.id
      ? new Promise(resolve => { finish = resolve; }) : { archived: true });
    const run = processFeedbackTicketAutoCloses(client);
    expect(processFeedbackTicketAutoCloses(client)).toBe(run);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.channel.delete).not.toHaveBeenCalled();expect(second.channel.delete).toHaveBeenCalledOnce();
    finish({ archived: true });await run;
    expect(first.channel.delete).toHaveBeenCalledOnce();expect(second.channel.delete).toHaveBeenCalledOnce();
  });

  it('recovers a missing deadline using the most recent feedback rather than closing immediately', async () => {
    const { ticket, channel } = ticketFixture({ due: false, feedbackAt: new Date(Date.now()-80_000).toISOString() });
    orderFor(ticket, { feedbackAt: new Date(Date.now()-30_000).toISOString() });
    await processFeedbackTicketAutoCloses(client);
    expect(channel.delete).not.toHaveBeenCalled();expect(Date.parse(getTicketById(ticket.id).auto_close_at)-Date.now()).toBe(90_000);
    await vi.advanceTimersByTimeAsync(89_999);await processFeedbackTicketAutoCloses(client);expect(channel.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);await processFeedbackTicketAutoCloses(client);expect(channel.delete).toHaveBeenCalledOnce();
  });

  it('recovers an overdue deadline at startup and cancels an in-flight run when stopped', async () => {
    const first = ticketFixture({ due: false, feedbackAt: new Date(Date.now()-180_000).toISOString() });
    startFeedbackTicketAutoClose(client);await vi.advanceTimersByTimeAsync(5000);
    expect(first.channel.delete).toHaveBeenCalledOnce();stopFeedbackTicketAutoClose();
    const second = ticketFixture();fixture.archive.mockImplementationOnce(async () => { stopFeedbackTicketAutoClose();return { archived: true }; });
    await processFeedbackTicketAutoCloses(client);expect(second.channel.delete).not.toHaveBeenCalled();
    expect(getTicketById(second.ticket.id).status).toBe('OPEN');expect(getFeedbackTicketAutoCloseStatus().running).toBe(false);
  });
});
