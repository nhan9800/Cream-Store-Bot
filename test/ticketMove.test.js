import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTicketMove, findOrderCodes, movedChannelName, planTicketMove, TicketMoveError,
} from '../src/services/ticketMoveService.js';

let db;
const ticket = (extra = {}) => ({ id: 1, ticket_code: 'TKT_AB12CD', guild_id: 'shop', channel_id: '900', customer_id: 'buyer',
  ticket_type: 'SUPPORT', related_order_code: null, support_source: 'DISCORD_SUPPORT', status: 'OPEN', ...extra });

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY, guild_id TEXT, customer_id TEXT, product_name TEXT, status TEXT);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY, ticket_code TEXT, guild_id TEXT, channel_id TEXT, customer_id TEXT, ticket_type TEXT,
      related_order_code TEXT, support_source TEXT, status TEXT);`);
  const add = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?)');
  add.run('CN_111111', 'shop', 'buyer', 'YouTube Premium 6 Tháng', 'COMPLETED');
  add.run('CN_222222', 'shop', 'buyer', 'Netflix Slot 1 Tháng', 'PROCESSING');
  add.run('CN_333333', 'shop', 'someone-else', 'Canva Pro', 'COMPLETED');
  add.run('CN_444444', 'other-shop', 'buyer', 'Canva Pro', 'COMPLETED');
  const t = ticket();
  db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)').run(t.id, t.ticket_code, t.guild_id, t.channel_id, t.customer_id,
    t.ticket_type, t.related_order_code, t.support_source, t.status);
});
afterEach(() => db.close());

const plan = (extra = {}) => planTicketMove(db, { ticket: ticket(), guildId: 'shop', targetType: 'WARRANTY', ...extra });

describe('/chuyen-ticket planning', () => {
  it('reads order codes the way customers type them', () => {
    expect(findOrderCodes('mã đơn cn-111111 nha, với CN 222222 và CN_111111, sdt 0123456789')).toEqual(['CN_111111', 'CN_222222']);
  });

  it('moves a support ticket to warranty using the only order code of this customer found in the ticket', () => {
    const p = plan({ messageCodes: ['CN_111111', 'CN_333333', 'CN_444444', 'CN_999999'] });
    expect(p).toMatchObject({ targetType: 'WARRANTY', orderCode: 'CN_111111', detected: true, unchanged: false, releaseWarranty: null });
    const moved = applyTicketMove(db, { ticket: ticket(), plan: p });
    expect(moved).toMatchObject({ ticket_type: 'WARRANTY', related_order_code: 'CN_111111', support_source: 'DISCORD_ORDER' });
    expect(movedChannelName({ ticket: ticket(), channelName: 'ticket-ab12cd', targetType: 'WARRANTY', orderCode: 'CN_111111' })).toBe('bao-hanh-111111');
  });

  it('asks staff to choose when the customer mentioned several of their orders, and never guesses', () => {
    expect(() => plan({ messageCodes: ['CN_111111', 'CN_222222'] })).toThrow(/nhiều đơn/);
    expect(() => plan({ messageCodes: [] })).toThrow(/ma_don/);
    expect(() => plan({ messageCodes: ['CN_333333'] })).toThrow(/ma_don/);
  });

  it('refuses orders of another customer or shop, unfinished orders and a second open warranty ticket', () => {
    expect(() => plan({ orderCode: 'CN_333333' })).toThrow(/không thuộc khách/);
    expect(() => plan({ orderCode: 'CN_444444' })).toThrow(/Không tìm thấy/);
    expect(() => plan({ orderCode: 'abc' })).toThrow(TicketMoveError);
    expect(() => plan({ orderCode: 'CN_222222' })).toThrow(/đã hoàn thành/);
    db.prepare("INSERT INTO tickets VALUES (2,'TKT_X','shop','901','buyer','WARRANTY','CN_111111','DISCORD_ORDER','OPEN')").run();
    expect(() => plan({ orderCode: 'cn_111111' })).toThrow(/<#901>/);
  });

  it('refuses closed, website and booking tickets', () => {
    expect(() => planTicketMove(db, { ticket: ticket({ status: 'CLOSED' }), guildId: 'shop', targetType: 'ORDER' })).toThrow(/đã đóng/);
    expect(() => planTicketMove(db, { ticket: ticket({ channel_id: 'web-tkt-1' }), guildId: 'shop', targetType: 'ORDER' })).toThrow(/website/);
    expect(() => planTicketMove(db, { ticket: ticket({ ticket_type: 'BOOKING' }), guildId: 'shop', targetType: 'ORDER' })).toThrow(/Booking/);
    expect(() => planTicketMove(db, { ticket: ticket(), guildId: 'other-shop', targetType: 'ORDER' })).toThrow(/không phải ticket/);
  });

  it('hands the order back when a warranty ticket is moved out, and keeps product ticket names', () => {
    const warranty = ticket({ ticket_type: 'WARRANTY', related_order_code: 'CN_111111' });
    const p = planTicketMove(db, { ticket: warranty, guildId: 'shop', targetType: 'COMPLAINT' });
    expect(p).toMatchObject({ releaseWarranty: 'CN_111111', orderCode: 'CN_111111', fromLabel: 'Bảo hành' });
    expect(movedChannelName({ ticket: warranty, channelName: 'bao-hanh-111111', targetType: 'COMPLAINT' })).toBe('ticket-ab12cd');
    expect(movedChannelName({ ticket: warranty, channelName: 'nitro-ab12cd', targetType: 'ORDER' })).toBe('nitro-ab12cd');
    expect(planTicketMove(db, { ticket: warranty, guildId: 'shop', targetType: 'WARRANTY', orderCode: 'CN_111111' }).unchanged).toBe(true);
  });
});
