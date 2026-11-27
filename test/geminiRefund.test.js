import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { quoteGeminiRefund, previewGeminiRefunds, applyGeminiRefunds, getRefundCase,
  submitRefundBank, requireRefundOwner, readRefundBank, claimRefundNotice, finishRefundNotice,
  previewRefundFeeChange,proposeRefundFeeChange } from '../src/services/geminiRefundService.js';
import { recordPaidOrderRefund } from '../src/services/paidOrderRefundService.js';
import { crc16, buildRefundVietQR } from '../src/utils/refundVietQR.js';

const order = { order_code: 'CN_123456', guild_id: 'shop', customer_id: 'buyer', product_name: 'Gemini 12m',
  status: 'WARRANTY_OPEN', payment_status: 'PAID', amount_paid: 100000, total_amount: 100000,
  completed_at: '2026-01-01T00:00:00.000Z', expiry_at: '2026-04-11T00:00:00.000Z',
  status_changed_at: '2026-01-11T00:00:00.000Z' };
const event = (at, state, old = 'COMPLETED') => ({ created_at: `${at} 00:00:00`, new_status: state, old_status: old });
const history = [event('2026-01-11', 'WARRANTY_OPEN')];
const receipt = [{ amount: 100000, provider: 'PAYOS' }];

describe('Gemini refund accounting', () => {
  it('uses actual paid price and freezes at warranty opening, with 30% of original price', () => {
    expect(quoteGeminiRefund(order, history, receipt)).toMatchObject({ paid: 100000, usageDeduction: 10000,
      fee: 30000, refund: 60000, usedMs: 10 * 86400000 });
  });
  it('excludes earlier warranty downtime and tolerates SQL second precision', () => {
    const h = [event('2026-01-03', 'WARRANTY_OPEN'), event('2026-01-05', 'COMPLETED', 'WARRANTY_OPEN'), ...history];
    expect(quoteGeminiRefund({ ...order, status_changed_at: '2026-01-11T00:00:00.800Z' }, h, receipt))
      .toMatchObject({ usageDeduction: 8000, refund: 62000, downtimeMs: 2 * 86400000 + 800 });
  });
  it.each([
    [{ ...order, amount_paid: 90000 }, history, receipt],
    [order, history, [{ amount: 90000 }]],
    [order, [], receipt],
    [{ ...order, completed_at: null }, history, receipt],
    [{ ...order, status: 'COMPLETED' }, history, receipt],
    [{ ...order, product_name: 'Nitro' }, history, receipt],
    [order, [event('2026-01-02', 'REFUNDED'), ...history], receipt],
    [order, history, receipt, [{ type: 'REFUND', amount: -1000 }]],
  ])('blocks unverified or already-refunded orders', (...args) => expect(() => quoteGeminiRefund(...args)).toThrow());
});

describe('Persistent refund intake', () => {
  let db;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-refund-key-not-production';
    db = new Database(':memory:');
    db.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,product_name TEXT,
      status TEXT,payment_status TEXT,amount_paid INTEGER,total_amount INTEGER,completed_at TEXT,expiry_at TEXT,
      status_changed_at TEXT,updated_at TEXT,fulfillment_mode TEXT,duration_months INTEGER,duration_days INTEGER);
      CREATE TABLE payment_events(id INTEGER PRIMARY KEY,order_code TEXT,provider TEXT,transaction_id TEXT,amount INTEGER);
      CREATE TABLE wallet_transactions(id INTEGER PRIMARY KEY,related_code TEXT,type TEXT,amount INTEGER);
      CREATE TABLE order_fulfillments(order_code TEXT,status TEXT,lease_until TEXT);`);
    db.prepare(`INSERT INTO orders (${Object.keys(order).join(',')}) VALUES (${Object.keys(order).map(() => '?').join(',')})`).run(...Object.values(order));
    db.prepare('INSERT INTO payment_events(order_code,provider,transaction_id,amount) VALUES (?,?,?,?)').run(order.order_code, 'PAYOS', 'test-receipt', 100000);
    previewGeminiRefunds(db, 'shop');
    db.prepare('INSERT INTO order_status_history(order_code,old_status,new_status,created_at) VALUES (?,?,?,?)')
      .run(order.order_code, 'COMPLETED', 'WARRANTY_OPEN', history[0].created_at);
  });
  afterEach(() => db.close());
  const apply = () => applyGeminiRefunds(db, { guildId: 'shop', actorId: 'manager', fingerprint: previewGeminiRefunds(db, 'shop').fingerprint })[0];
  const submit = (row, customerId = 'buyer') => submitRefundBank(db, { id: row.id, customerId,
    bank: { bin: '970422', shortName: 'MB' }, account: '0123456789', name: 'NGUYEN VAN A', accepted: 'ĐỒNG Ý' });
  it('is guild-scoped, rejects stale previews and applies with preserved receipt', () => {
    expect(previewGeminiRefunds(db, 'other').ready).toHaveLength(0);
    const old = previewGeminiRefunds(db, 'shop').fingerprint;
    db.prepare('UPDATE orders SET total_amount=90000').run();
    expect(() => applyGeminiRefunds(db, { guildId: 'shop', actorId: 'manager', fingerprint: old })).toThrow();
    db.prepare('UPDATE orders SET total_amount=100000').run();
    const row = apply();
    expect(row.stage).toBe('AWAITING_DETAILS');
    expect(row.active).toBe(true);
    expect(db.prepare('SELECT payment_status,amount_paid,status FROM orders').get())
      .toEqual({ payment_status: 'PAID', amount_paid: 100000, status: 'REFUND_PENDING' });
    expect(() => applyGeminiRefunds(db, { guildId: 'shop', actorId: 'manager', fingerprint: old })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM order_refund_cases').get().n).toBe(1);
  });
  it('encrypts bank details, prevents another user and freezes accepted payout', () => {
    const row = apply();
    expect(() => submit(row, 'other')).toThrow();
    const saved = submit(row);
    expect(saved.bank_encrypted).toMatch(/^enc:v1:/);
    expect(saved.bank_encrypted).not.toContain('0123456789');
    expect(readRefundBank(saved)).toMatchObject({ account: '0123456789', bankBin: '970422' });
    expect(() => submit(row)).toThrow();
    expect(() => requireRefundOwner(db, row.id, 'other')).toThrow();
  });
  it('requires explicit acceptance and valid bank data', () => {
    const row = apply();
    expect(() => submitRefundBank(db, { id: row.id, customerId: 'buyer', accepted: 'no' })).toThrow();
    expect(() => submitRefundBank(db, { id: row.id, customerId: 'buyer', accepted: 'ĐỒNG Ý', bank: null })).toThrow();
  });
  it('stale QR and intake become unusable after an order is reopened', () => {
    const row = submit(apply());
    db.prepare("UPDATE orders SET status='COMPLETED'").run();
    expect(() => requireRefundOwner(db, row.id, 'buyer')).toThrow();
    expect(() => readRefundBank(getRefundCase(db, row.id))).toThrow();
  });
  it('does not record payout before intake or with a mismatched amount', () => {
    const row = apply();
    const record = amount => recordPaidOrderRefund(db, { orderCode: order.order_code, guildId: 'shop', actorId: 'manager', action: 'REFUNDED', amount });
    expect(() => record(60000)).toThrow();
    submit(row);
    expect(() => record(100000)).toThrow();
    record(60000);
    expect(getRefundCase(db, row.id)).toMatchObject({ active: false, stage: 'PAID', orderStatus: 'REFUNDED' });
  });
  it('marks withdrawals invalid and never retries an uncertain DM send', () => {
    const row = apply();
    expect(claimRefundNotice(db, row.id)).toBe(true);
    expect(claimRefundNotice(db, row.id)).toBe(false);
    finishRefundNotice(db, row.id, null);
    expect(claimRefundNotice(db, row.id)).toBe(false);
    recordPaidOrderRefund(db, { orderCode: order.order_code, guildId: 'shop', actorId: 'manager', action: 'WITHDRAW_REFUND' });
    expect(getRefundCase(db, row.id)).toMatchObject({ active: false, stage: 'INVALIDATED' });
  });
  it('rolls back an entire batch when fulfillment is in flight', () => {
    db.prepare("INSERT INTO order_fulfillments VALUES (?, 'SENDING', '2099-01-01T00:00:00Z')").run(order.order_code);
    expect(() => apply()).toThrow();
    expect(db.prepare('SELECT status FROM orders').get().status).toBe('WARRANTY_OPEN');
    expect(db.prepare('SELECT count(*) AS n FROM order_refund_cases').get().n).toBe(0);
  });
  const propose = (row, feePercent = 40) => {
    const p = previewRefundFeeChange(db,{orderCode:row.order_code,guildId:'shop',feePercent});
    return proposeRefundFeeChange(db,{orderCode:row.order_code,guildId:'shop',feePercent,actorId:'manager',fingerprint:p.fingerprint});
  };
  it.each([29,41,30.5,NaN])('rejects a fee outside the 30–40 percent policy (%s)', feePercent => {
    const row=apply(); expect(()=>propose(row,feePercent)).toThrow();
  });
  it('keeps an accepted old quote and bank details usable while a higher proposal awaits consent', () => {
    const row=submit(apply()); const saved=propose(row).row;
    expect(saved.quote).toEqual(row.quote);
    expect(saved.quote_revision).toBe(1); expect(saved.accepted_quote_revision).toBe(1);
    expect(saved.pendingQuote).toMatchObject({feeBps:4000,fee:40000,refund:50000});
    expect(saved.pending_quote_revision).toBe(2);
    expect(readRefundBank(saved)).toEqual(readRefundBank(row));
    expect(db.prepare('SELECT amount_paid,payment_status,status FROM orders').get())
      .toEqual({amount_paid:100000,payment_status:'PAID',status:'REFUND_PENDING'});
  });
  it('accepts only the current proposal revision, then switches amount and consent together', () => {
    const old=submit(apply()); const row=propose(old).row;
    expect(()=>submit(row)).toThrow('Bảng tính đã thay đổi');
    const accepted=submitRefundBank(db,{id:row.id,customerId:'buyer',revision:2,bank:{bin:'970422',shortName:'MB'},
      account:'0123456789',name:'NGUYEN VAN A',accepted:'ĐỒNG Ý'});
    expect(accepted).toMatchObject({quote_revision:2,accepted_quote_revision:2,pendingQuote:null,stage:'READY_TO_PAY'});
    expect(accepted.quote.refund).toBe(50000);
    const history=db.prepare('SELECT revision,state FROM order_refund_quote_history ORDER BY revision').all();
    expect(history).toEqual([{revision:1,state:'ACCEPTED'},{revision:2,state:'ACCEPTED'}]);
    const record=amount=>recordPaidOrderRefund(db,{orderCode:row.order_code,guildId:'shop',actorId:'manager',action:'REFUNDED',amount});
    expect(()=>record(60000)).toThrow(); record(50000);
  });
  it('preserves and migrates an existing 10% accepted agreement when proposing 30%', () => {
    let row=apply(); const legacy={...row.quote,feeBps:1000,fee:10000,refund:80000};
    db.prepare('UPDATE order_refund_cases SET quote_json=?').run(JSON.stringify(legacy));
    db.prepare('UPDATE order_refund_quote_history SET quote_json=?').run(JSON.stringify(legacy));
    row=submit(row);
    const changed=propose(row,30).row;
    expect(changed.quote).toEqual(legacy); expect(changed.pendingQuote.refund).toBe(60000);
    expect(changed.accepted_at).toBe(row.accepted_at);
    expect(readRefundBank(changed)).toMatchObject({account:'0123456789'});
  });
  it('is idempotent and rejects a stale manager preview after customer acceptance', () => {
    const row=apply(); const p=previewRefundFeeChange(db,{orderCode:row.order_code,guildId:'shop',feePercent:40});
    submit(row);
    expect(()=>proposeRefundFeeChange(db,{orderCode:row.order_code,guildId:'shop',feePercent:40,actorId:'manager',fingerprint:p.fingerprint})).toThrow('vừa thay đổi');
    expect(propose(row,40).changed).toBe(true); expect(propose(row,40).changed).toBe(false);
    expect(db.prepare('SELECT count(*) AS n FROM order_refund_quote_history').get().n).toBe(2);
  });
  it('can withdraw an unaccepted proposal without changing the accepted agreement', () => {
    const row=submit(apply()); propose(row,40); const result=propose(row,30).row;
    expect(result.pendingQuote).toBeNull(); expect(result.quote).toEqual(row.quote);
    expect(result.accepted_quote_revision).toBe(1);
    expect(db.prepare("SELECT state FROM order_refund_quote_history WHERE revision=2").get().state).toBe('WITHDRAWN');
  });
});

describe('Local VietQR', () => {
  it('matches the standard CRC vector and public VietQR example checksum', () => {
    expect(crc16('123456789')).toBe('29B1');
    expect(crc16('00020101021238570010A00000072701270006970415011300110019324180208QRIBFTTA530370454061200005802VN62170813ung ho lu lut6304')).toBe('C15C');
  });
  it('encodes exact account, original zeroes, amount, order reference and verifiable checksum', () => {
    const qr = buildRefundVietQR({ bankBin: '970422', account: '00123456789', amount: 80000, orderCode: 'CN_123456' });
    const parse = s => { const out = {}; for (let i = 0; i < s.length;) { const id = s.slice(i,i+2), len = Number(s.slice(i+2,i+4)); out[id] = s.slice(i+4,i+4+len); i += 4+len; } return out; };
    const p = parse(qr);
    expect(p['54']).toBe('80000');
    expect(parse(parse(p['38'])['01'])).toEqual({ '00': '970422', '01': '00123456789' });
    expect(parse(p['62'])['08']).toBe('HOAN CN123456');
    expect(qr.slice(-4)).toBe(crc16(qr.slice(0,-4)));
    expect(() => buildRefundVietQR({ bankBin: 'bad', account: '1', amount: 0 })).toThrow();
  });
});
