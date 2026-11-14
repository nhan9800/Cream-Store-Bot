import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { auditOrderIntegrityPage } from '../src/services/orderIntegrityAuditService.js';

const databases = [];
function fixture() {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,order_code TEXT,guild_id TEXT,customer_id TEXT,
    ticket_id INTEGER,ticket_channel_id TEXT,quantity INTEGER,total_amount INTEGER,amount_paid INTEGER,payment_provider TEXT,
    payment_status TEXT,status TEXT,created_at TEXT,paid_at TEXT,delivered_at TEXT,completed_at TEXT,expiry_at TEXT,
    credential_password TEXT);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT);
    CREATE TABLE subscription_accounts(id INTEGER PRIMARY KEY,related_order_code TEXT,guild_id TEXT,status TEXT,
    purchase_date TEXT,expiry_at TEXT,total_duration_months INTEGER,renewal_cycle_months INTEGER,times_renewed INTEGER,
    renewal_mode TEXT,next_renewal_at TEXT,gmail_password TEXT);
    CREATE TABLE youtube_sources(id INTEGER PRIMARY KEY,guild_id TEXT);
    CREATE TABLE youtube_memberships(id INTEGER PRIMARY KEY,related_order_code TEXT,guild_id TEXT,status TEXT,
    started_at TEXT,customer_expiry_at TEXT,total_months INTEGER,cycle_months INTEGER,paid_cycles INTEGER,
    next_source_payment_at TEXT,source_id INTEGER,customer_gmail TEXT);
    CREATE TABLE spotify_families(id INTEGER PRIMARY KEY,guild_id TEXT);
    CREATE TABLE spotify_family_members(id INTEGER PRIMARY KEY,related_order_code TEXT,status TEXT,
    joined_at TEXT,member_expiry_at TEXT,family_id INTEGER);
    CREATE TABLE wallet_transactions(guild_id TEXT,customer_id TEXT,related_code TEXT,type TEXT,amount INTEGER);`);
  const add = (id, overrides = {}) => {
    db.prepare('INSERT OR IGNORE INTO tickets VALUES(?,?,?,?)').run(id, 'store', 'private-customer', `private-channel-${id}`);
    const row = { id, order_code: `CN_TEST${id}`, guild_id: 'store', customer_id: 'private-customer',
      ticket_id: id, ticket_channel_id: `private-channel-${id}`, quantity: 1, total_amount: 100000, amount_paid: 100000, payment_provider: 'PAYOS',
      payment_status: 'PAID', status: 'PROCESSING', created_at: '2026-11-01 00:00:00',
      paid_at: '2026-11-01T00:00:00Z', delivered_at: null, completed_at: null, expiry_at: null,
      credential_password: 'never-return-this-secret', ...overrides };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO orders(${keys.join(',')}) VALUES(${keys.map(key => `@${key}`).join(',')})`).run(row);
  };
  return { db, add };
}
afterEach(() => databases.splice(0).forEach(db => db.close()));

describe('read-only, complete order integrity audit', () => {
  it('handles an empty database and rejects invalid pagination', () => {
    const { db } = fixture();
    expect(auditOrderIntegrityPage(db)).toMatchObject({ totalOrders: 0, scanned: 0, hasMore: false, findings: [] });
    for (const options of [{ limit: 0 }, { limit: 501 }, { afterId: -1 }, { snapshotId: NaN }]) {
      expect(() => auditOrderIntegrityPage(db, options)).toThrow('INVALID_AUDIT_PAGE');
    }
  });
  it('scans every order once using a fixed upper bound, including gaps and healthy rows', () => {
    const { db, add } = fixture();
    [1, 3, 4, 8, 10].forEach(id => add(id));
    const first = auditOrderIntegrityPage(db, { limit: 2 });
    add(11);
    const second = auditOrderIntegrityPage(db, { limit: 2, afterId: first.lastId, snapshotId: first.snapshotId });
    const third = auditOrderIntegrityPage(db, { limit: 2, afterId: second.lastId, snapshotId: first.snapshotId });
    expect(first.snapshotId).toBe(10);
    expect(first.totalOrders).toBe(5);
    expect([first.scanned, second.scanned, third.scanned]).toEqual([2, 2, 1]);
    expect([first.lastId, second.lastId, third.lastId]).toEqual([3, 8, 10]);
    expect(third.hasMore).toBe(false);
    expect(first.findings.concat(second.findings, third.findings)).toEqual([]);
  });
  it('runs with SQLite query_only and projects flags without customer IDs or credentials', () => {
    const { db, add } = fixture();
    add(1, { amount_paid: 1, status: 'COMPLETED', completed_at: null });
    db.pragma('query_only=ON');
    const before = db.serialize();
    const result = auditOrderIntegrityPage(db);
    expect(result.findings[0].flags).toEqual(expect.arrayContaining(['PAID_AMOUNT_BELOW_TOTAL', 'COMPLETION_TIME_MISSING']));
    expect(JSON.stringify(result)).not.toMatch(/private-customer|credential_password|never-return/);
    expect(db.serialize()).toEqual(before);
  });
  it('flags wallet debit contradictions without treating a free order as a missing payment', () => {
    const { db, add } = fixture();
    add(1, { payment_provider: 'WALLET' });
    add(2, { payment_provider: 'WALLET', total_amount: 0, amount_paid: 0 });
    db.prepare('INSERT INTO wallet_transactions VALUES(?,?,?,?,?)').run('store', 'private-customer', 'CN_TEST1', 'PAY_ORDER', -20000);
    const result = auditOrderIntegrityPage(db);
    expect(result.findings.map(row => row.orderCode)).toEqual(['CN_TEST1']);
    expect(result.counts.WALLET_DEBIT_NEEDS_REVIEW).toBe(1);
  });
  it('reviews active obligations on terminal orders and bounded YouTube progress', () => {
    const { db, add } = fixture();
    add(1, { status: 'REFUNDED' });
    db.prepare('INSERT INTO youtube_sources VALUES(?,?)').run(1, 'other-store');
    db.prepare('INSERT INTO youtube_memberships VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(1, ' cn_test1 ', 'store', 'ACTIVE', '2026-11-01', '2026-10-01', 3, 2, 3, '2026-12-01', 1, 'private@email.test');
    const result = auditOrderIntegrityPage(db);
    expect(result.findings[0].flags).toEqual(expect.arrayContaining([
      'ACTIVE_SERVICE_ON_TERMINAL_ORDER', 'YOUTUBE_PROGRESS_INVALID', 'YOUTUBE_DATES_INVALID',
      'YOUTUBE_SOURCE_GUILD_MISMATCH', 'YOUTUBE_FULLY_COVERED_HAS_NEXT_DUE',
    ]));
    expect(result.findings[0].linkedRecords[0]).toMatchObject({ kind: 'youtube', id: 1 });
    expect(JSON.stringify(result)).not.toContain('private@email.test');
  });
  it('accepts the one-time zero cycle and valid Spotify/schema fields', () => {
    const { db, add } = fixture(); add(1);
    db.prepare('INSERT INTO subscription_accounts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(1, 'CN_TEST1', 'WEB', 'ACTIVE', '2026-11-01', '2027-11-01', 12, 0, 0, 'one_time', null, 'never-return-password');
    db.prepare('INSERT INTO spotify_families VALUES(?,?)').run(1, 'store');
    db.prepare('INSERT INTO spotify_family_members VALUES(?,?,?,?,?,?)')
      .run(1, 'CN_TEST1', 'ACTIVE', '2026-11-01', '2027-11-01', 1);
    expect(auditOrderIntegrityPage(db).findings).toEqual([]);
  });
  it('accepts FREE fulfillment and the supported WEB YouTube source fallback', () => {
    const { db, add } = fixture();
    add(1, { payment_status: 'FREE', status: 'COMPLETED', completed_at: '2026-11-01T01:00:00Z' });
    db.prepare('INSERT INTO youtube_sources VALUES(?,?)').run(1, 'WEB');
    db.prepare('INSERT INTO youtube_memberships VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(1, 'CN_TEST1', 'store', 'ACTIVE', '2026-11-01', '2027-11-01', 12, 1, 1, '2026-12-01', 1, 'hidden@example.test');
    expect(auditOrderIntegrityPage(db).findings).toEqual([]);
  });
  it('reports ambiguous codes differing only by case or whitespace', () => {
    const { db, add } = fixture(); add(1); add(2, { order_code: ' cn_test1 ' });
    expect(auditOrderIntegrityPage(db).findings.map(row => row.flags))
      .toEqual([['NORMALIZED_ORDER_CODE_DUPLICATE'], ['NORMALIZED_ORDER_CODE_DUPLICATE']]);
  });
  it('reports exact ticket candidates without revealing channel/customer identities', () => {
    const { db, add } = fixture(); add(1, { ticket_id: 99 });
    const result = auditOrderIntegrityPage(db);
    expect(result.findings[0].ticketEvidence).toEqual({ virtualTicketChannel: false,
      channelMatchesReference: false, exactCandidateCount: 1, uniqueCandidateId: 1 });
    expect(JSON.stringify(result)).not.toMatch(/private-channel|private-customer/);
  });
});
