import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, { ENV_FILE: '.env.supplier-invoice-test-absent', DATABASE_PATH: `./data/test-supplier-invoice-${process.pid}.sqlite` }));
import { db } from '../src/database/db.js';
import { createSupplierInvoiceReconciler } from '../src/services/supplierAutobuyInvoiceService.js';
const databases = [];
const guild = '1282637033340403754';
function fixture() {
  const database = new Database(':memory:'); databases.push(database);
  database.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,fulfillment_mode TEXT,status TEXT,payment_status TEXT,created_at TEXT);
    CREATE TABLE supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT);
    INSERT INTO orders VALUES('CN_123456','${guild}','SUPPLIER','PENDING_PAYMENT','UNPAID','2026-01-01T00:00:00Z');
    INSERT INTO supplier_autobuy_payment_methods VALUES('CN_123456','PAYOS');`);
  let clock = Date.parse('2026-11-10T16:00:00Z');
  const sync = vi.fn(async () => ({ synced: false }));
  const reconciler = createSupplierInvoiceReconciler({ database, enabled: () => true, sync, now: () => clock });
  return { database, sync, reconciler, advance: n => clock += n };
}
afterEach(() => { for (const d of databases.splice(0)) d.close(); });
afterAll(() => { db.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + s, { force: true }); });
describe('supplier invoice reservation reconciliation', () => {
  it('looks up old/uncertain PayOS claims without requiring a stored payment link', async () => {
    const { sync, reconciler } = fixture(); sync.mockResolvedValue({ synced: true });
    expect(await reconciler.reconcile({})).toEqual({ scanned: 1, synced: 1 });
    expect(sync).toHaveBeenCalledExactlyOnceWith({ client: {}, orderCode: 'CN_123456' });
  });
  it('coalesces concurrent passes and throttles each claim to five minutes', async () => {
    const { sync, reconciler, advance } = fixture();
    await Promise.all([reconciler.reconcile({}), reconciler.reconcile({})]); expect(sync).toHaveBeenCalledTimes(1);
    await reconciler.reconcile({}); expect(sync).toHaveBeenCalledTimes(1);
    advance(300001); await reconciler.reconcile({}); expect(sync).toHaveBeenCalledTimes(2);
  });
  it('retains a reservation after timeout/404 rather than releasing based on local age', async () => {
    const { sync, reconciler, database } = fixture(); sync.mockRejectedValue(new Error('provider unavailable'));
    expect(await reconciler.reconcile({})).toEqual({ scanned: 1, synced: 0 });
    expect(database.prepare('SELECT status FROM orders').get().status).toBe('PENDING_PAYMENT');
  });
  it.each([['fulfillment_mode', 'MANUAL'], ['guild_id', '1070676180103086132'], ['payment_status', 'PAID'], ['status', 'CANCELLED']])('does not poll ineligible %s=%s', async (field, value) => {
    const { sync, reconciler, database } = fixture(); database.prepare(`UPDATE orders SET ${field}=?`).run(value);
    expect(await reconciler.reconcile({})).toEqual({ scanned: 0, synced: 0 }); expect(sync).not.toHaveBeenCalled();
  });
  it('does not poll wallet claims or a disabled instance', async () => {
    const { database, sync, reconciler } = fixture(); database.prepare("UPDATE supplier_autobuy_payment_methods SET method='WALLET'").run();
    await reconciler.reconcile({});
    await createSupplierInvoiceReconciler({ database, enabled: () => false, sync }).reconcile({});
    expect(sync).not.toHaveBeenCalled();
  });
});
