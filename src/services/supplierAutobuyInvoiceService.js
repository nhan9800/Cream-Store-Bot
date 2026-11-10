import { db } from '../database/db.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { supplierSalesConfigured } from './supplierAutobuyCatalogService.js';

/** Release only provider-confirmed terminal invoices, never a guessed local TTL. */
export function createSupplierInvoiceReconciler({ database = db, enabled = supplierSalesConfigured, now = Date.now,
  sync = async args => (await import('./paymentService.js')).syncPaymentStatusFromPayOS(args),
} = {}) {
  let initialized = false, flight = null;
  async function reconcile(client, limit = 3) {
    if (!enabled()) return { scanned: 0, synced: 0 };
    if (flight) return flight;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('INVALID_LIMIT');
    if (!initialized) {
      database.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_invoice_checks(order_code TEXT PRIMARY KEY,checked_at TEXT NOT NULL)`);
      initialized = true;
    }
    const methods = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_autobuy_payment_methods'").get();
    if (!methods) return { scanned: 0, synced: 0 };
    flight = Promise.resolve().then(async () => {
      const cutoff = new Date(now() - 300000).toISOString();
      const rows = database.prepare(`SELECT o.order_code FROM orders o JOIN supplier_autobuy_payment_methods m ON m.order_code=o.order_code
        LEFT JOIN supplier_autobuy_invoice_checks c ON c.order_code=o.order_code
        WHERE o.guild_id=? AND o.fulfillment_mode='SUPPLIER' AND o.status='PENDING_PAYMENT' AND o.payment_status='UNPAID'
        AND m.method='PAYOS' AND (c.checked_at IS NULL OR c.checked_at<=?)
        ORDER BY COALESCE(c.checked_at,''),o.created_at LIMIT ?`).all(STORE_ONE_GUILD_ID, cutoff, limit);
      let synced = 0;
      for (const row of rows) {
        // Also covers an uncertain creation with no saved payment_link_id:
        // the standard lookup uses the original persisted payos_order_code.
        database.prepare('INSERT INTO supplier_autobuy_invoice_checks VALUES (?,?) ON CONFLICT(order_code) DO UPDATE SET checked_at=excluded.checked_at')
          .run(row.order_code, new Date(now()).toISOString());
        try { if ((await sync({ client, orderCode: row.order_code })).synced) synced++; }
        catch { /* Keep funds reserved on timeouts, 404s and identity mismatch. */ }
      }
      return { scanned: rows.length, synced };
    }).finally(() => { flight = null; });
    return flight;
  }
  return { reconcile };
}
const singleton = createSupplierInvoiceReconciler();
export const reconcileSupplierInvoices = (client, limit) => singleton.reconcile(client, limit);
