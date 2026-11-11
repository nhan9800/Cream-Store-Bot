import { createHash, randomUUID } from 'node:crypto';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createDopermindClient, DopermindError } from './dopermindClient.js';
import { createCdkVietnamClient, CdkVietnamError } from './cdkVietnamClient.js';

const LEASE_MS = 120000;
const MAX_QUANTITY = 10;
const MAX_ATTEMPTS = 5;
const NO_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });
const RETRY_STATES = ['PENDING', 'WAITING_STOCK', 'WAITING_SUPPLIER_FUNDS', 'UNKNOWN', 'RECONCILING', 'SUBMITTING', 'DELIVERY_PENDING', 'DELIVERING'];
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const orderCodeValid = value => typeof value === 'string' && /^CN_\d{6,20}$/.test(value);
const QUOTE_ID = /^[a-f0-9-]{36}$/i;

export class SupplierAutobuyOrderError extends Error {
  constructor(code) {
    super('Không thể xử lý AutoBuy ở trạng thái hiện tại. Vui lòng tải lại hoặc liên hệ shop.');
    this.name = 'SupplierAutobuyOrderError';
    this.code = code;
  }
}
const fail = code => { throw new SupplierAutobuyOrderError(code); };

// Normal order names are reused by legacy public Markdown cards. Keep supplier
// markup/mentions inert there; the exact reviewed name remains in the intent.
function publicOrderProductName(name) {
  const plain = String(name).replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/@/g, '＠').replace(/</g, '‹').replace(/>/g, '›')
    .replace(/(https?):\/\//gi, '$1:\u200b//');
  return `\\[AutoBuy\\] ${plain.replace(/[\\`*_~|[\]()#]/g, '\\$&')}`;
}

function publicQuote(quoteId, quote) {
  return { quoteId, productKey: quote.productKey, productName: quote.productName, quantity: quote.quantity,
    unitPriceVnd: quote.unitPriceVnd, totalPriceVnd: quote.totalPriceVnd, expiresAt: quote.expiresAt,
    termLabel: quote.termText, warrantyLabel: quote.warrantyText, accountForm: quote.accountForm, category: quote.category,
    comparisonDisclosure: typeof quote.comparisonDisclosure === 'string' ? quote.comparisonDisclosure : null };
}

function validateQuote(quote, key, quantity, now) {
  if (!quote || quote.productKey !== key || quote.quantity !== quantity
    || typeof quote.productName !== 'string' || !quote.productName.trim() || quote.productName.length > 500
    || !integer(quote.unitPriceVnd, 1) || !integer(quote.totalPriceVnd, 1)
    || !integer(quote.unitCostVnd, 1) || !integer(quote.maxUnitCostVnd, 1)
    || quote.unitCostVnd > quote.maxUnitCostVnd || quote.unitPriceVnd <= quote.maxUnitCostVnd
    || BigInt(quote.unitPriceVnd) * BigInt(quantity) !== BigInt(quote.totalPriceVnd)
    || typeof quote.termsFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(quote.termsFingerprint)
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now
    || !Number.isFinite(Date.parse(quote.createdAt)) || Date.parse(quote.createdAt) > now
    || !(integer(quote.durationDays, 1) || integer(quote.durationMonths, 1))
    || typeof quote.termText !== 'string' || typeof quote.warrantyText !== 'string') fail('QUOTE_INVALID');
  return quote;
}

function safeOrder(order, intent) {
  return { orderCode: order.order_code, productName: intent.product_name, quantity: intent.quantity,
    totalAmount: order.total_amount, totalPriceVnd: order.total_amount, status: order.status,
    paymentStatus: order.payment_status, deliveryStatus: intent.status, createdAt: order.created_at,
    termLabel: intent.term_text, warrantyLabel: intent.warranty_text,
    hasDelivery: ['PURCHASED', 'DELIVERY_PENDING', 'DELIVERING', 'DELIVERED'].includes(intent.status) && Boolean(intent.encrypted_payload),
    retryAt: intent.retry_at, errorCode: intent.last_error };
}

async function defaultSendDelivery(client, order, items, requestId) {
  const customer = await client.users.fetch(order.customer_id);
  if (customer?.id !== order.customer_id) fail('DELIVERY_OWNER_MISMATCH');
  const channel = await customer.createDM();
  const attachment = Buffer.from(`Đơn hàng: ${order.order_code}\n\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n\n')}`, 'utf8');
  const message = await channel.send({ content: `AutoBuy ${order.order_code} — sản phẩm của bạn được đính kèm trong tệp riêng tư.`,
    files: [{ attachment, name: `${order.order_code}-autobuy.txt` }], allowedMentions: NO_MENTIONS,
    nonce: createHash('sha256').update(`supplier-delivery:${requestId}`).digest('hex').slice(0, 24), enforceNonce: true });
  if (!message?.id || !channel?.id) fail('DELIVERY_RECEIPT_MISSING');
  return { messageId: message.id, channelId: channel.id };
}

/** Durable state is isolated from account-stock delivery and from the old supplier. */
export function createSupplierAutobuyOrderService({
  db, getQuote, createOrder, markOrderCompleted, saveDelivery = () => {}, encrypt, decrypt,
  providerFactory = createDopermindClient, enabled = () => false, customerBlocked = () => false,
  sendDelivery = defaultSendDelivery, now = Date.now, id = randomUUID,
  notifyCompletion = async () => {},
  reconcileInvoices = async client => (await import('./supplierAutobuyInvoiceService.js')).reconcileSupplierInvoices(client),
} = {}) {
  if (!db?.prepare || !db?.transaction || [getQuote, createOrder, markOrderCompleted, encrypt, decrypt,
    providerFactory, enabled, customerBlocked, sendDelivery, notifyCompletion, reconcileInvoices, now, id].some(fn => typeof fn !== 'function')) fail('INVALID_CONFIGURATION');
  let initialized = false;
  let hasWalletLedger = false;
  let workerTimer = null;
  let workerClient = null;
  let workerRunning = false;
  let workTail = Promise.resolve();
  const running = new Map();
  let health = Object.freeze({ enabled: false, workerRunning: false, busy: false, lastRunAt: null, processed: 0 });
  const timestamp = () => new Date(now()).toISOString();
  const nextRetry = (minutes = 2) => new Date(now() + minutes * 60000).toISOString();
  const active = () => enabled() === true;
  function assertEncryptionReady() {
    try {
      const probe = 'supplier-storage-check';
      const encrypted = encrypt(probe);
      if (!encrypted?.startsWith('enc:v1:') || decrypt(encrypted) !== probe) fail('ENCRYPTION_UNAVAILABLE');
    } catch { fail('ENCRYPTION_UNAVAILABLE'); }
  }
  function init() {
    if (initialized) return;
    db.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_quotes (
      quote_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      product_key TEXT NOT NULL, quantity INTEGER NOT NULL, quote_json TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, order_code TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS supplier_autobuy_intents (
      order_code TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, guild_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE, product_key TEXT NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL,
      sale_amount INTEGER NOT NULL, max_unit_cost INTEGER NOT NULL, request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
      term_text TEXT NOT NULL, warranty_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      encrypted_payload TEXT, supplier_order_code TEXT, charged_unit_cost INTEGER, charged_total_cost INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT, retry_at TEXT NOT NULL,
      last_error TEXT, dm_channel_id TEXT, dm_message_id TEXT, delivery_kind TEXT, delivered_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(order_code) REFERENCES orders(order_code), FOREIGN KEY(quote_id) REFERENCES supplier_autobuy_quotes(quote_id));
      CREATE INDEX IF NOT EXISTS idx_supplier_autobuy_due ON supplier_autobuy_intents(status,retry_at,lease_until);
      CREATE INDEX IF NOT EXISTS idx_supplier_autobuy_customer ON supplier_autobuy_intents(guild_id,customer_id,created_at);`);
    db.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_completion_notices (
      order_code TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'PENDING',attempted_at TEXT,finished_at TEXT,last_error TEXT,
      FOREIGN KEY(order_code) REFERENCES orders(order_code));`);
    initialized = true;
    hasWalletLedger = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wallet_transactions'").get());
  }
  function context(guildId, customerId, requireEnabled = true) {
    if (guildId !== STORE_ONE_GUILD_ID || !snowflake(customerId)) fail('INVALID_CONTEXT');
    if (requireEnabled && !active()) fail('AUTOBUY_DISABLED');
    if (customerBlocked(guildId, customerId)) fail('CUSTOMER_BLOCKED');
  }
  const orderByCode = code => db.prepare('SELECT * FROM orders WHERE order_code=?').get(code) ?? null;
  const intentByCode = code => db.prepare('SELECT * FROM supplier_autobuy_intents WHERE order_code=?').get(code) ?? null;
  function owned(guildId, customerId, code) {
    context(guildId, customerId, false); init();
    if (!orderCodeValid(code)) fail('ORDER_NOT_FOUND');
    const intent = intentByCode(code); const order = orderByCode(code);
    if (!intent || !order || intent.guild_id !== guildId || intent.customer_id !== customerId
      || order.guild_id !== guildId || order.customer_id !== customerId || order.fulfillment_mode !== 'SUPPLIER') fail('ORDER_NOT_FOUND');
    return { intent, order };
  }
  function paid(order, intent) {
    return Boolean(intent) && order?.guild_id === STORE_ONE_GUILD_ID && order.guild_id === intent.guild_id && order.customer_id === intent.customer_id
      && order.fulfillment_mode === 'SUPPLIER' && order.payment_status === 'PAID' && ['PROCESSING', 'COMPLETED'].includes(order.status)
      && integer(order.amount_paid, 1) && order.amount_paid >= intent.sale_amount && order.total_amount === intent.sale_amount
      && order.quantity === intent.quantity && !customerBlocked(order.guild_id, order.customer_id)
      && (!hasWalletLedger || !db.prepare("SELECT 1 FROM wallet_transactions WHERE guild_id=? AND customer_id=? AND related_code=? AND amount>0 AND type IN ('REFUND','ORDER_REFUND','REFUND_ORDER') LIMIT 1")
        .get(order.guild_id, order.customer_id, order.order_code));
  }
  function decoded(intent) {
    if (!intent.encrypted_payload?.startsWith('enc:v1:')) fail('DELIVERY_UNAVAILABLE');
    let value;
    try { value = JSON.parse(decrypt(intent.encrypted_payload)); } catch { fail('DELIVERY_UNAVAILABLE'); }
    if (!Array.isArray(value?.items) || value.items.length !== intent.quantity || value.items.some(x => typeof x !== 'string' || !x.trim())) fail('DELIVERY_UNAVAILABLE');
    return value.items;
  }
  async function prepareSupplierCheckout({ guildId, customerId, productKey, quantity = 1 } = {}) {
    context(guildId, customerId); init();
    if (typeof productKey !== 'string' || !productKey || productKey.length > 200 || !integer(quantity, 1) || quantity > MAX_QUANTITY) fail('INVALID_QUANTITY');
    const quote = validateQuote(await getQuote(productKey, quantity, { force: true }), productKey, quantity, now());
    const quoteId = id(); if (!QUOTE_ID.test(quoteId)) fail('QUOTE_INVALID');
    db.prepare(`INSERT INTO supplier_autobuy_quotes(quote_id,guild_id,customer_id,product_key,quantity,quote_json,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(quoteId, guildId, customerId, productKey, quantity, JSON.stringify(quote), timestamp(), quote.expiresAt);
    return publicQuote(quoteId, quote);
  }
  async function confirmSupplierCheckout({ guildId, customerId, quoteId, ticketId, ticketChannelId, orderLogChannelId } = {}) {
    context(guildId, customerId); init();
    if (typeof quoteId !== 'string' || !QUOTE_ID.test(quoteId)) fail('QUOTE_NOT_FOUND');
    const quoteRow = db.prepare('SELECT * FROM supplier_autobuy_quotes WHERE quote_id=? AND guild_id=? AND customer_id=?').get(quoteId, guildId, customerId);
    if (!quoteRow) fail('QUOTE_NOT_FOUND');
    if (quoteRow.order_code) return { ...orderByCode(quoteRow.order_code), orderCode: quoteRow.order_code, quoteId, reused: true };
    if (Date.parse(quoteRow.expires_at) <= now()) fail('QUOTE_EXPIRED');
    const saved = JSON.parse(quoteRow.quote_json);
    const current = validateQuote(await getQuote(quoteRow.product_key, quoteRow.quantity, { force: true }), quoteRow.product_key, quoteRow.quantity, now());
    if (current.termsFingerprint !== saved.termsFingerprint) fail('QUOTE_CHANGED');
    return db.transaction(() => {
      const row = db.prepare('SELECT * FROM supplier_autobuy_quotes WHERE quote_id=?').get(quoteId);
      if (row.order_code) return { ...orderByCode(row.order_code), orderCode: row.order_code, quoteId, reused: true };
      if (Date.parse(row.expires_at) <= now()) fail('QUOTE_EXPIRED');
      const ticket = db.prepare("SELECT * FROM tickets WHERE id=? AND guild_id=? AND customer_id=? AND channel_id=? AND status='OPEN'")
        .get(ticketId, guildId, customerId, ticketChannelId);
      if (!ticket || !snowflake(ticketChannelId) || !snowflake(orderLogChannelId)) fail('TICKET_REQUIRED');
      const order = createOrder({ guildId, customerId, ticketId, ticketChannelId, orderLogChannelId,
        productId: null, productName: publicOrderProductName(saved.productName), serviceType: 'other', quantity: saved.quantity,
        totalAmount: saved.totalPriceVnd, durationMonths: saved.durationMonths ?? 0, durationDays: saved.durationDays ?? null,
        note: `AutoBuy · ${saved.termText} · ${saved.warrantyText}`, createdById: customerId });
      if (!orderCodeValid(order?.order_code)) fail('ORDER_CREATE_FAILED');
      db.prepare("UPDATE orders SET fulfillment_mode='SUPPLIER',product_id=NULL WHERE order_code=?").run(order.order_code);
      const requestId = `cenar-${id()}`;
      if (!/^cenar-[a-f0-9-]{36}$/i.test(requestId)) fail('REQUEST_INVALID');
      const request = JSON.stringify({ product_key: saved.productKey, quantity: saved.quantity, request_id: requestId });
      const time = timestamp();
      db.prepare(`INSERT INTO supplier_autobuy_intents(order_code,quote_id,guild_id,customer_id,request_id,product_key,product_name,quantity,
        sale_amount,max_unit_cost,request_json,request_hash,term_text,warranty_text,retry_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.order_code, quoteId, guildId, customerId, requestId, saved.productKey,
        saved.productName, saved.quantity, saved.totalPriceVnd, saved.maxUnitCostVnd, request,
        createHash('sha256').update(request).digest('hex'), saved.termText, saved.warrantyText, time, time, time);
      db.prepare('UPDATE supplier_autobuy_quotes SET order_code=? WHERE quote_id=?').run(order.order_code, quoteId);
      return { ...orderByCode(order.order_code), orderCode: order.order_code, quoteId, reused: false };
    }).immediate();
  }
  function getSupplierQuoteForCustomer({ guildId, customerId, quoteId } = {}) {
    context(guildId, customerId); init();
    if (typeof quoteId !== 'string' || !QUOTE_ID.test(quoteId)) fail('QUOTE_NOT_FOUND');
    const row = db.prepare('SELECT * FROM supplier_autobuy_quotes WHERE quote_id=? AND guild_id=? AND customer_id=?').get(quoteId, guildId, customerId);
    if (!row) fail('QUOTE_NOT_FOUND');
    if (!row.order_code && Date.parse(row.expires_at) <= now()) fail('QUOTE_EXPIRED');
    return { ...publicQuote(quoteId, JSON.parse(row.quote_json)), orderCode: row.order_code ?? null };
  }
  function getSupplierOrderForCustomer({ guildId, customerId, orderCode } = {}) {
    const { order, intent } = owned(guildId, customerId, orderCode); return safeOrder(order, intent);
  }
  function listSupplierOrdersForCustomer({ guildId, customerId, limit = 10 } = {}) {
    context(guildId, customerId, false); init();
    if (!integer(limit, 1) || limit > 25) fail('INVALID_LIMIT');
    return db.prepare('SELECT order_code FROM supplier_autobuy_intents WHERE guild_id=? AND customer_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?')
      .all(guildId, customerId, limit).map(row => getSupplierOrderForCustomer({ guildId, customerId, orderCode: row.order_code }));
  }
  function getSupplierDeliveryForCustomer({ guildId, customerId, orderCode } = {}) {
    const { order, intent } = owned(guildId, customerId, orderCode);
    if (!paid(order, intent) || !['PURCHASED', 'DELIVERY_PENDING', 'DELIVERING', 'DELIVERED'].includes(intent.status)) fail('DELIVERY_UNAVAILABLE');
    return { orderCode, productName: intent.product_name, items: decoded(intent) };
  }
  function completeDelivery(orderCode, receipt, kind, lease = null) {
    return db.transaction(() => {
      const intent = intentByCode(orderCode); const order = orderByCode(orderCode);
      if (!intent || !paid(order, intent)) fail('ORDER_NOT_DELIVERABLE');
      if (intent.status === 'DELIVERED') return { handled: true, delivered: true, completedNow: false, reused: true, updated: order };
      if (lease && intent.lease_token !== lease) fail('LEASE_LOST');
      if (!['PURCHASED', 'DELIVERY_PENDING', 'DELIVERING'].includes(intent.status)) fail('DELIVERY_UNAVAILABLE');
      decoded(intent);
      db.prepare(`UPDATE supplier_autobuy_intents SET status='DELIVERED',dm_channel_id=?,dm_message_id=?,delivery_kind=?,delivered_at=?,
        last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE order_code=?`).run(receipt.channelId ?? null, receipt.messageId ?? null, kind, timestamp(), timestamp(), orderCode);
      saveDelivery(orderCode, 'SYSTEM_SUPPLIER', null, null, null, null, null, 'Đã giao AutoBuy riêng tư', receipt.channelId ?? null, receipt.messageId ?? null);
      const updated = order.status === 'COMPLETED' ? order : markOrderCompleted(orderCode, 'SYSTEM_SUPPLIER');
      db.prepare('INSERT OR IGNORE INTO supplier_autobuy_completion_notices(order_code) VALUES(?)').run(orderCode);
      return { handled: true, delivered: true, completedNow: order.status !== 'COMPLETED', reused: false, updated };
    }).immediate();
  }
  async function processCompletionNotices(client, limit = 3) {
    if (!client) return;
    const notices = db.prepare("SELECT n.order_code FROM supplier_autobuy_completion_notices n JOIN orders o ON o.order_code=n.order_code WHERE n.status='PENDING' AND o.status='COMPLETED' AND o.guild_id=? LIMIT ?")
      .all(STORE_ONE_GUILD_ID, limit);
    for (const { order_code: code } of notices) {
      // sendCompletedFlow contains non-idempotent public/DM sends. Claim before
      // invocation, and leave uncertain attempts for /sua-don rather than spam.
      const claim = db.prepare("UPDATE supplier_autobuy_completion_notices SET status='ATTEMPTED',attempted_at=? WHERE order_code=? AND status='PENDING'").run(timestamp(), code);
      if (!claim.changes) continue;
      try {
        await notifyCompletion(client, orderByCode(code));
        db.prepare("UPDATE supplier_autobuy_completion_notices SET status='SENT',finished_at=? WHERE order_code=?").run(timestamp(), code);
      } catch {
        db.prepare("UPDATE supplier_autobuy_completion_notices SET status='FAILED',finished_at=?,last_error='COMPLETION_NOTICE_FAILED' WHERE order_code=?").run(timestamp(), code);
      }
    }
  }
  function acknowledgeSupplierDeliveryRetrieval({ guildId, customerId, orderCode, messageId, channelId } = {}) {
    const { order, intent } = owned(guildId, customerId, orderCode);
    if (!paid(order, intent)) fail('ORDER_NOT_DELIVERABLE');
    if (!snowflake(messageId)) fail('DELIVERY_RECEIPT_MISSING');
    return completeDelivery(orderCode, { messageId, channelId: snowflake(channelId) ? channelId : null }, 'EPHEMERAL');
  }
  async function validateSupplierOrderForPayment({ guildId, customerId, orderCode } = {}) {
    context(guildId, customerId);
    const { order, intent } = owned(guildId, customerId, orderCode);
    if (order.payment_status === 'PAID') return safeOrder(order, intent);
    if (order.status !== 'PENDING_PAYMENT' || order.payment_status !== 'UNPAID') fail('ORDER_NOT_PAYABLE');
    // Refuse customer invoices/debits if purchased credentials could not be
    // encrypted and read back, rather than discovering that after payment.
    assertEncryptionReady();
    const row = db.prepare('SELECT quote_json FROM supplier_autobuy_quotes WHERE quote_id=?').get(intent.quote_id);
    const quote = await getQuote(intent.product_key, intent.quantity, { force: true });
    if (quote?.termsFingerprint !== JSON.parse(row.quote_json).termsFingerprint) fail('QUOTE_CHANGED');
    const provider = providerFactory();
    const products = await provider.getStock({ productKey: intent.product_key });
    const product = Array.isArray(products) && products.find(item => item.productKey === intent.product_key);
    if (!product || product.name !== quote.productName || !integer(product.priceVnd, 1)
      || product.priceVnd !== quote.unitCostVnd || product.priceVnd > intent.max_unit_cost) fail('QUOTE_CHANGED');
    const hasMethods = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_autobuy_payment_methods'").get());
    const reservations = db.prepare(`SELECT i.product_key,i.quantity FROM supplier_autobuy_intents i JOIN orders o ON o.order_code=i.order_code
      ${hasMethods ? 'LEFT JOIN supplier_autobuy_payment_methods m ON m.order_code=i.order_code' : ''}
      WHERE i.guild_id=? AND i.order_code!=? AND i.encrypted_payload IS NULL
      AND o.fulfillment_mode='SUPPLIER' AND o.status NOT IN ('COMPLETED','CANCELLED','REFUNDED')
      AND (o.payment_status='PAID' ${hasMethods ? "OR (o.payment_status='UNPAID' AND m.order_code IS NOT NULL)" : ''})`)
      .all(guildId, orderCode);
    let reservedQuantity = 0n;
    for (const reservation of reservations) {
      if (!integer(reservation.quantity, 1)) fail('RESERVATION_INVALID');
      if (reservation.product_key === intent.product_key) reservedQuantity += BigInt(reservation.quantity);
    }
    if (product.unlimited !== true && (!integer(product.stock)
      || BigInt(product.stock) < BigInt(intent.quantity) + reservedQuantity)) fail('OUT_OF_STOCK');
    // Customer payment is allowed before the shop funds its source wallet.
    // Only the paid purchase worker checks source balance immediately before
    // POST, retaining the paid order until the owner supplies enough funds.
    return safeOrder(order, intent);
  }
  async function runFulfillment(client, code, { allowReconcile = false } = {}) {
    init(); const initial = intentByCode(code);
    if (!initial) return { handled: false, delivered: false };
    if (!active()) return { handled: true, delivered: false, status: 'DISABLED' };
    const initialOrder = orderByCode(code);
    if (!paid(initialOrder, initial)) return { handled: true, delivered: false, status: 'AWAITING_PAYMENT_OR_REVIEW' };
    if (initial.status === 'DELIVERED') return { handled: true, delivered: true, completedNow: false, reused: true, updated: initialOrder };
    if (initialOrder.status === 'COMPLETED' && !initial.encrypted_payload) {
      // Staff may have fulfilled/completed outside this engine. A late payment
      // retry is never permission to buy again without a durable receipt.
      db.prepare("UPDATE supplier_autobuy_intents SET status='REVIEW',last_error='MANUAL_COMPLETION_UNVERIFIED',updated_at=? WHERE order_code=?")
        .run(timestamp(), code);
      return { handled: true, delivered: false, status: 'REVIEW' };
    }
    if (!RETRY_STATES.includes(initial.status) && initial.status !== 'PURCHASED') return { handled: true, delivered: false, status: initial.status };
    if (initial.lease_until && Date.parse(initial.lease_until) > now()) return { handled: true, delivered: false, status: 'BUSY' };
    if (Date.parse(initial.retry_at) > now()) return { handled: true, delivered: false, status: initial.status };
    const purchaseExists = Boolean(initial.encrypted_payload);
    const reconcile = !purchaseExists && ['UNKNOWN', 'RECONCILING', 'SUBMITTING'].includes(initial.status);
    if (reconcile && !allowReconcile) return { handled: true, delivered: false, status: 'WAITING_RECONCILIATION' };
    if (!purchaseExists && initial.attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE supplier_autobuy_intents SET status='REVIEW',last_error='MAX_ATTEMPTS',updated_at=? WHERE order_code=?").run(timestamp(), code);
      return { handled: true, delivered: false, status: 'REVIEW' };
    }
    const lease = id();
    const claimed = db.transaction(() => {
      const order = orderByCode(code); const intent = intentByCode(code);
      if (!paid(order, intent) || intent.status !== initial.status || Boolean(intent.encrypted_payload) !== purchaseExists) return null;
      const changed = db.prepare(`UPDATE supplier_autobuy_intents SET status=?,lease_token=?,lease_until=?,updated_at=?
        WHERE order_code=? AND status=? AND (lease_until IS NULL OR lease_until<=?)`).run(purchaseExists ? 'DELIVERING' : 'SUBMITTING', lease,
        new Date(now() + LEASE_MS).toISOString(), timestamp(), code, initial.status, timestamp());
      return changed.changes === 1 ? { order, intent } : null;
    }).immediate();
    if (!claimed) return { handled: true, delivered: false, status: 'BUSY' };
    const pending = (status, error, minutes = 2) => {
      db.prepare(`UPDATE supplier_autobuy_intents SET status=?,last_error=?,retry_at=?,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE order_code=? AND lease_token=?`).run(status, error, nextRetry(minutes), timestamp(), code, lease);
      return { handled: true, delivered: false, status };
    };
    let submissionStarted = false;
    try {
      if (!purchaseExists) {
        // Check encryption before any financial side effect.
        assertEncryptionReady();
        const provider = providerFactory();
        const products = await provider.getStock({ productKey: initial.product_key });
        const product = products.find(item => item.productKey === initial.product_key);
        // A crashed UNKNOWN request may never have reached the provider. A
        // same-ID replay can therefore be the first actual purchase; retain the
        // cost ceiling even when this delays an older receipt's reconciliation.
        if (!product) return pending(reconcile ? 'REVIEW' : 'WAITING_STOCK', 'PRODUCT_UNAVAILABLE', 5);
        if (product.priceVnd > initial.max_unit_cost || !integer(product.priceVnd, 1)) return pending('REVIEW', 'PRICE_CHANGED');
        if (!reconcile) {
          if (!product.unlimited && product.stock < initial.quantity) return pending('WAITING_STOCK', 'INSUFFICIENT_STOCK', 5);
          const wallet = await provider.getBalance();
          if (wallet.currency !== 'VND' || !integer(wallet.balanceVnd) || BigInt(wallet.balanceVnd) < BigInt(product.priceVnd) * BigInt(initial.quantity)) {
            return pending('WAITING_SUPPLIER_FUNDS', 'INSUFFICIENT_SUPPLIER_BALANCE', 5);
          }
        }
        if (!paid(orderByCode(code), intentByCode(code))) return pending('BLOCKED', 'ORDER_NOT_DELIVERABLE');
        if (createHash('sha256').update(initial.request_json).digest('hex') !== initial.request_hash) return pending('REVIEW', 'REQUEST_INTEGRITY_FAILED');
        const request = JSON.parse(initial.request_json);
        if (request.product_key !== initial.product_key || request.quantity !== initial.quantity || request.request_id !== initial.request_id) return pending('REVIEW', 'REQUEST_INTEGRITY_FAILED');
        db.prepare('UPDATE supplier_autobuy_intents SET attempts=attempts+1,updated_at=? WHERE order_code=? AND lease_token=?').run(timestamp(), code, lease);
        submissionStarted = true;
        const receipt = await provider.createOrder({ productKey: initial.product_key, quantity: initial.quantity,
          requestId: initial.request_id, maxUnitCostVnd: initial.max_unit_cost });
        if (receipt.requestId !== initial.request_id || receipt.productKey !== initial.product_key || receipt.quantity !== initial.quantity
          || !Array.isArray(receipt.items) || receipt.items.length !== initial.quantity || !integer(receipt.unitPriceVnd, 1)
          || !integer(receipt.totalAmountVnd, 1) || BigInt(receipt.unitPriceVnd) * BigInt(initial.quantity) !== BigInt(receipt.totalAmountVnd)
          || receipt.items.some(item => typeof item !== 'string' || !item.trim())) return pending('UNKNOWN', 'RECEIPT_INVALID');
        const encrypted = encrypt(JSON.stringify({ items: receipt.items, providerOrderCode: receipt.orderCode, createdAt: receipt.createdAt }));
        if (!encrypted?.startsWith('enc:v1:')) fail('ENCRYPTION_UNAVAILABLE');
        const overCost = receipt.unitPriceVnd > initial.max_unit_cost;
        const stored = db.prepare(`UPDATE supplier_autobuy_intents SET encrypted_payload=?,supplier_order_code=?,charged_unit_cost=?,charged_total_cost=?,
          status=?,last_error=?,updated_at=? WHERE order_code=? AND lease_token=?`).run(encrypted, receipt.orderCode,
          receipt.unitPriceVnd, receipt.totalAmountVnd, overCost ? 'REVIEW' : 'DELIVERING', overCost ? 'PRICE_LIMIT_EXCEEDED' : null, timestamp(), code, lease);
        if (stored.changes !== 1) fail('LEASE_LOST');
        if (overCost) return pending('REVIEW', 'PRICE_LIMIT_EXCEEDED');
      }
      const intent = intentByCode(code); const order = orderByCode(code);
      if (!paid(order, intent)) return pending('BLOCKED', 'ORDER_NOT_DELIVERABLE');
      const items = decoded(intent);
      let deliveryTimer;
      let delivery;
      try {
        delivery = await Promise.race([sendDelivery(client, order, items, intent.request_id), new Promise((_, reject) => {
          deliveryTimer = setTimeout(() => reject(new SupplierAutobuyOrderError('DELIVERY_TIMEOUT')), 15000);
        })]);
      } finally { clearTimeout(deliveryTimer); }
      if (!snowflake(delivery?.messageId) || !snowflake(delivery?.channelId)) fail('DELIVERY_RECEIPT_MISSING');
      return completeDelivery(code, delivery, 'DM', lease);
    } catch (error) {
      const current = intentByCode(code);
      if (current?.encrypted_payload) return pending(current.status === 'REVIEW' ? 'REVIEW' : 'DELIVERY_PENDING', current.status === 'REVIEW' ? 'PRICE_LIMIT_EXCEEDED' : 'DELIVERY_RETRY');
      if (error instanceof SupplierAutobuyOrderError) return pending('REVIEW', ['ENCRYPTION_UNAVAILABLE', 'REQUEST_INTEGRITY_FAILED'].includes(error.code) ? error.code : 'LOCAL_REVIEW_REQUIRED');
      if (error instanceof DopermindError || error instanceof CdkVietnamError) {
        const providerCode = error.providerCode;
        if (providerCode === 'NOT_ENOUGH_STOCK' || providerCode === 'OUT_OF_STOCK') return pending('WAITING_STOCK', 'INSUFFICIENT_STOCK', 5);
        if (providerCode === 'INSUFFICIENT_BALANCE') return pending('WAITING_SUPPLIER_FUNDS', 'INSUFFICIENT_SUPPLIER_BALANCE', 5);
        if (['PRICE_CHANGED', 'API_REQUEST_CONFLICT', 'API_ORDER_MANUALLY_FULFILLED', 'PRODUCT_LOCKED', 'IDEMPOTENCY_CONFLICT'].includes(providerCode)) return pending('REVIEW', providerCode);
        if (['ORDER_HISTORY_PENDING', 'ORDER_FULFILLMENT_PENDING', 'DELIVERY_REVIEW'].includes(providerCode)) return pending('RECONCILING', providerCode, 3);
        if (error.outcome === 'NOT_SUBMITTED') return pending('PENDING', 'PROVIDER_UNAVAILABLE', 2);
        if (error.outcome === 'REJECTED') return pending('REVIEW', 'PROVIDER_REJECTED');
      }
      if (!submissionStarted) return pending('PENDING', 'PROVIDER_UNAVAILABLE');
      return pending('UNKNOWN', 'SUBMISSION_UNCERTAIN');
    }
  }
  function fulfillSupplierOrder(client, code, options) {
    if (running.has(code)) return running.get(code);
    if (running.size >= 25) return Promise.resolve({ handled: true, delivered: false, status: 'QUEUED' });
    const task = workTail.then(() => runFulfillment(client, code, options));
    running.set(code, task); workTail = task.catch(() => {});
    void task.then(result => { if (result.completedNow) return processCompletionNotices(client); }).catch(() => {});
    void task.finally(() => running.delete(code)).catch(() => {});
    return task;
  }
  async function processPendingSupplierOrders(client, limit = 3) {
    init(); if (!active()) return { processed: 0 };
    if (!integer(limit, 1) || limit > 5) fail('INVALID_LIMIT');
    const placeholders = RETRY_STATES.map(() => '?').join(',');
    const due = db.prepare(`SELECT i.order_code FROM supplier_autobuy_intents i JOIN orders o ON o.order_code=i.order_code
      WHERE i.status IN (${placeholders}) AND i.retry_at<=? AND (i.lease_until IS NULL OR i.lease_until<=?)
      AND o.guild_id=? AND o.fulfillment_mode='SUPPLIER' AND o.payment_status='PAID' AND o.status='PROCESSING'
      ORDER BY i.retry_at,i.created_at LIMIT ?`).all(...RETRY_STATES, timestamp(), timestamp(), STORE_ONE_GUILD_ID, limit);
    health = Object.freeze({ ...health, enabled: active(), busy: true });
    let processed = 0;
    try {
      for (const row of due) {
        try { await fulfillSupplierOrder(client, row.order_code, { allowReconcile: true }); } catch { /* Durable state drives the next pass. */ }
        processed++;
      }
      await processCompletionNotices(client, limit);
      return { processed };
    } finally { health = Object.freeze({ enabled: active(), workerRunning, busy: false, lastRunAt: timestamp(), processed }); }
  }
  function startSupplierAutobuyWorker(client) {
    init(); if (workerRunning || !active()) return health;
    workerRunning = true; workerClient = client;
    health = Object.freeze({ ...health, enabled: true, workerRunning: true });
    const tick = async () => {
      if (!workerRunning) return;
      if (active()) {
        try { await reconcileInvoices(workerClient); } catch { /* Uncertain invoices retain their durable reservations. */ }
      }
      try { await processPendingSupplierOrders(workerClient, 3); } catch { /* No raw financial/provider logs. */ }
      if (workerRunning) { workerTimer = setTimeout(tick, 60000); workerTimer.unref?.(); }
    };
    workerTimer = setTimeout(tick, 0); workerTimer.unref?.();
    return health;
  }
  function stopSupplierAutobuyWorker() {
    workerRunning = false; clearTimeout(workerTimer); workerTimer = null; workerClient = null;
    health = Object.freeze({ ...health, workerRunning: false }); return health;
  }
  return Object.freeze({ init, prepareSupplierCheckout, confirmSupplierCheckout, getSupplierQuoteForCustomer, getSupplierOrderForCustomer,
    listSupplierOrdersForCustomer, getSupplierDeliveryForCustomer, acknowledgeSupplierDeliveryRetrieval,
    validateSupplierOrderForPayment, fulfillSupplierOrder, processPendingSupplierOrders,
    startSupplierAutobuyWorker, stopSupplierAutobuyWorker, processCompletionNotices, getHealth: () => health });
}

let defaultServicePromise;
let defaultServiceInstance;
async function defaultService() {
  if (!defaultServicePromise) defaultServicePromise = Promise.all([
    import('../database/db.js'), import('../config.js'), import('./supplierAutobuyCatalogService.js'),
    import('./orderService.js'), import('../utils/crypto.js'), import('./blacklistService.js'),
  ]).then(([{ db }, { config }, catalog, orders, crypto, blacklist]) => {
    defaultServiceInstance = createSupplierAutobuyOrderService({ db, getQuote: catalog.getSupplierQuote,
      createOrder: orders.createOrder, markOrderCompleted: orders.markOrderCompleted, saveDelivery: orders.saveDelivery,
      encrypt: crypto.encrypt, decrypt: crypto.decrypt,
      providerFactory: () => process.env.SUPPLIER_AUTOBUY_PROVIDER === 'cdkvietnam'
        ? createCdkVietnamClient({ apiKey: process.env.CDKVIETNAM_API_KEY })
        : createDopermindClient({ apiKey: process.env.DOPERMIND_API_KEY }),
      enabled: () => catalog.supplierSalesConfigured(process.env, config.guildId),
      customerBlocked: (guildId, customerId) => Boolean(blacklist.getCustomerFlag(guildId, customerId).is_blacklisted),
      notifyCompletion: async (client, order) => {
        const guild = await client.guilds.fetch(order.guild_id);
        if (!guild) fail('COMPLETION_GUILD_UNAVAILABLE');
        const notifications = await import('./notificationService.js');
        await notifications.updateOrderLogMessage(guild, order);
        await notifications.sendCompletedFlow({ guild, order, actorId: 'SYSTEM_SUPPLIER' });
      } });
    defaultServiceInstance.init(); return defaultServiceInstance;
  }).catch(error => { defaultServicePromise = null; throw error; });
  return defaultServicePromise;
}

export const prepareSupplierCheckout = async input => (await defaultService()).prepareSupplierCheckout(input);
export const confirmSupplierCheckout = async input => (await defaultService()).confirmSupplierCheckout(input);
export const getSupplierQuoteForCustomer = async input => (await defaultService()).getSupplierQuoteForCustomer(input);
export const getSupplierOrderForCustomer = async input => (await defaultService()).getSupplierOrderForCustomer(input);
export const listSupplierOrdersForCustomer = async input => (await defaultService()).listSupplierOrdersForCustomer(input);
export const getSupplierDeliveryForCustomer = async input => (await defaultService()).getSupplierDeliveryForCustomer(input);
export const acknowledgeSupplierDeliveryRetrieval = async input => (await defaultService()).acknowledgeSupplierDeliveryRetrieval(input);
export const validateSupplierOrderForPayment = async input => (await defaultService()).validateSupplierOrderForPayment(input);
export const fulfillSupplierOrder = async (client, code) => (await defaultService()).fulfillSupplierOrder(client, code);
export const processPendingSupplierOrders = async (client, limit) => (await defaultService()).processPendingSupplierOrders(client, limit);
export const startSupplierAutobuyWorker = async client => (await defaultService()).startSupplierAutobuyWorker(client);
export const stopSupplierAutobuyWorker = () => defaultServiceInstance?.stopSupplierAutobuyWorker();
export const getSupplierAutobuyOrderHealth = () => defaultServiceInstance?.getHealth()
  ?? Object.freeze({ enabled: false, workerRunning: false, busy: false, lastRunAt: null, processed: 0 });
