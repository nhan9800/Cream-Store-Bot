import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits as P } from 'discord.js';
vi.mock('../src/services/refundPresentation.js', () => ({ buildRefundOffer: () => ({ embeds: [{ title: 'Private quote' }], components: [] }) }));
import { ensureRefundCases } from '../src/services/geminiRefundService.js';
import { sendRefundTicketNotice, isPrivateRefundTicket, refreshRefundTicketNotice } from '../src/services/refundTicketNoticeService.js';

describe('private refund ticket notices', () => {
  let db, guild, channel, viewers, roles;
  const permit = value => ({ has: () => value });
  const overwrite = (id, type = 1) => ({ id, type, allow: permit(true) });
  const cfg = { support_role_id: 'support' };
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE orders(order_code TEXT,guild_id TEXT,status TEXT,status_changed_at TEXT,
      product_name TEXT,duration_months INTEGER,duration_days INTEGER);
      CREATE TABLE tickets(id INTEGER,channel_id TEXT,guild_id TEXT,customer_id TEXT,related_order_code TEXT,status TEXT,ticket_type TEXT);
      INSERT INTO orders VALUES ('CN_123456','shop','REFUND_PENDING','frozen','Gemini',18,NULL);
      INSERT INTO tickets VALUES (1,'private','shop','buyer','CN_123456','OPEN','WARRANTY');`);
    ensureRefundCases(db);
    db.prepare("INSERT INTO order_status_history(order_code,old_status,new_status) VALUES ('CN_123456','WARRANTY_OPEN','REFUND_PENDING')").run();
    db.prepare(`INSERT INTO order_refund_cases(id,order_code,guild_id,customer_id,quote_json,pending_status_at,created_at,updated_at)
      VALUES ('case','CN_123456','shop','buyer','{}','frozen','now','now')`).run();
    viewers = new Map([['buyer', { id: 'buyer', permissions: permit(false) }], ['staff', { id: 'staff', permissions: permit(true) }],
      ['stranger', { id: 'stranger', permissions: permit(false), roles: { cache: new Map() } }]]);
    roles = new Map([['support', { id: 'support', permissions: permit(false) }], ['members', { id: 'members', permissions: permit(false) }]]);
    guild = { id: 'shop', client: { user: { id: 'bot' } }, members: { fetch: vi.fn(id => Promise.resolve(viewers.get(id))) },
      roles: { everyone: { id: 'shop' }, fetch: vi.fn(id => Promise.resolve(roles.get(id))) },
      channels: { fetch: vi.fn(() => Promise.resolve(channel)) } };
    channel = { id: 'private', guildId: 'shop', type: 0, send: vi.fn().mockResolvedValue({ id: 'sent' }),
      permissionsFor: target => permit(target.id !== 'shop'),
      permissionOverwrites: { cache: new Map([['buyer', overwrite('buyer')], ['support', overwrite('support', 0)]]) } };
  });
  afterEach(() => db.close());
  const send = () => sendRefundTicketNotice(db, { id: 'case', guild, guildConfig: cfg });
  it('sends exactly once to the correct buyer ticket, with a limited mention', async () => {
    expect(await send()).toContain('Đã gửi');
    expect(channel.send.mock.lastCall[0]).toMatchObject({ allowedMentions: { users: ['buyer'], parse: [] } });
    expect(await send()).toContain('không gửi lại');
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT ticket_notice_state,ticket_notice_channel_id,ticket_notice_message_id FROM order_refund_cases').get())
      .toEqual({ ticket_notice_state: 'SENT', ticket_notice_channel_id: 'private', ticket_notice_message_id: 'sent' });
  });
  it('rejects channels visible to everyone and never changes permissions', async () => {
    channel.permissionsFor = () => permit(true);
    expect(await send()).toContain('Không tìm thấy ticket riêng'); expect(channel.send).not.toHaveBeenCalled();
  });
  it('rejects another guild, threads and missing explicit buyer access', async () => {
    channel.guildId = 'other'; expect(await isPrivateRefundTicket(channel, guild, 'buyer', cfg)).toBe(false);
    channel.guildId = 'shop'; channel.type = 11; expect(await isPrivateRefundTicket(channel, guild, 'buyer', cfg)).toBe(false);
    channel.type = 0; channel.permissionOverwrites.cache.delete('buyer');
    expect(await isPrivateRefundTicket(channel, guild, 'buyer', cfg)).toBe(false);
  });
  it('rejects an extra ordinary member or broadly visible member role', async () => {
    channel.permissionOverwrites.cache.set('stranger', overwrite('stranger'));
    expect(await send()).toContain('Không tìm thấy'); expect(channel.send).not.toHaveBeenCalled();
    channel.permissionOverwrites.cache.delete('stranger');
    channel.permissionOverwrites.cache.set('members', overwrite('members', 0));
    expect(await send()).toContain('Không tìm thấy'); expect(channel.send).not.toHaveBeenCalled();
  });
  it('allows staff and bot viewers but no unrelated customers', async () => {
    channel.permissionOverwrites.cache.set('staff', overwrite('staff'));
    channel.permissionOverwrites.cache.set('bot', overwrite('bot'));
    expect(await isPrivateRefundTicket(channel, guild, 'buyer', cfg)).toBe(true);
  });
  it.each(["UPDATE tickets SET customer_id='other'", "UPDATE tickets SET related_order_code='CN_000001'",
    "UPDATE tickets SET status='CLOSED'", "UPDATE tickets SET guild_id='other'"])
  ('does not route through an unrelated or closed database ticket', async sql => {
    db.exec(sql); await send(); expect(channel.send).not.toHaveBeenCalled();
  });
  it('does not send after a DM receipt or after the order has left refund review', async () => {
    db.exec("UPDATE order_refund_cases SET notice_state='SENT'"); await send(); expect(channel.send).not.toHaveBeenCalled();
    db.exec("UPDATE order_refund_cases SET notice_state='UNSENT'; UPDATE orders SET status='COMPLETED'");
    await send(); expect(channel.send).not.toHaveBeenCalled();
  });
  it('never blindly retries an ambiguous channel send', async () => {
    channel.send.mockRejectedValueOnce(new Error('network'));
    expect(await send()).toContain('không tự gửi lại');
    await send(); expect(channel.send).toHaveBeenCalledTimes(1);
  });
  it('claims once even if two managers start the same send concurrently', async () => {
    await Promise.all([send(), send()]); expect(channel.send).toHaveBeenCalledTimes(1);
  });
  it.each([6,12,24,null])('never sends or claims a notice for a non-18-month plan (%s)', async months => {
    db.prepare('UPDATE orders SET duration_months=?').run(months);
    expect(await send()).toContain('Ngoài phạm vi');
    expect(channel.send).not.toHaveBeenCalled();
    expect(db.prepare('SELECT stage,ticket_notice_state FROM order_refund_cases').get())
      .toEqual({ stage: 'AWAITING_DETAILS', ticket_notice_state: 'UNSENT' });
    expect(db.prepare('SELECT status FROM orders').get().status).toBe('REFUND_PENDING');
  });
  it('does not treat an ordinary completed purchase as a warranty refund announcement', async () => {
    db.exec("UPDATE order_status_history SET old_status='COMPLETED'");
    expect(await send()).toContain('Ngoài phạm vi'); expect(channel.send).not.toHaveBeenCalled();
  });
  it('refreshes the exact bot-owned ticket message in place, privately and idempotently',async()=>{
    const message={author:{id:'bot'},embeds:[{title:'HỒ SƠ HOÀN TIỀN · CN_123456'}],components:[],edit:vi.fn().mockResolvedValue({})};
    channel.messages={fetch:vi.fn().mockResolvedValue(message)};
    await send();
    const options={id:'case',guild,guildConfig:cfg};
    expect(await refreshRefundTicketNotice(db,options)).toContain('Đã cập nhật');
    expect(message.edit.mock.lastCall[0]).toMatchObject({content:null,embeds:[]});
    expect(await refreshRefundTicketNotice(db,options)).toContain('đã đúng phiên bản');
    expect(message.edit).toHaveBeenCalledTimes(1); expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT status FROM orders').get().status).toBe('REFUND_PENDING');
  });
  it('never edits another author or an outside-scope case',async()=>{
    const message={author:{id:'other'},embeds:[{title:'HỒ SƠ HOÀN TIỀN · CN_123456'}],components:[],edit:vi.fn()};
    channel.messages={fetch:vi.fn().mockResolvedValue(message)}; await send();
    await refreshRefundTicketNotice(db,{id:'case',guild,guildConfig:cfg}); expect(message.edit).not.toHaveBeenCalled();
    db.exec('UPDATE orders SET duration_months=24');
    expect(await refreshRefundTicketNotice(db,{id:'case',guild,guildConfig:cfg})).toContain('Ngoài phạm vi');
  });
});
