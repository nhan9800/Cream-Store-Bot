import { createHash } from 'node:crypto';

const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const noMentions = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });
const hash = value => createHash('sha256').update(value).digest('hex');
const rejected = error => [400, 401, 403, 404, 413, 429].includes(Number(error?.status))
  || [50001, 50007, 50013].includes(Number(error?.code));
const transientSqlite = error => typeof error?.code === 'string' && /^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z0-9_]+)?$/.test(error.code);
const failure = code => Object.assign(new Error('Chưa thể giao AutoBuy riêng tư. Vui lòng xem trạng thái đơn.'), { code });
const emptyHealth = () => ({ status: 'UNINITIALIZED', checkedAt: null, journalAttempts: 0, preparing: 0, sending: 0,
  unknown: 0, sent: 0, retry: 0, vetoed: 0, review: 0, legacyUnknown: 0, legacyRecovered: 0, completionRetry: 0 });
let publishedHealth = Object.freeze(emptyHealth());
export const getSupplierAutobuyDeliveryHealth = () => publishedHealth;

async function customerDm(client, customerId, strict = false) {
  const customer = await client?.users.fetch(customerId);
  if (customer?.id !== customerId) throw failure('DELIVERY_OWNER_MISMATCH');
  const channel = await customer.createDM();
  const recipient = channel?.recipientId ?? channel?.recipient?.id;
  if (!snowflake(channel?.id) || (recipient !== undefined && recipient !== customerId)
    || (channel.type !== undefined && channel.type !== 1)
    || (strict && (channel.type !== 1 || !snowflake(recipient) || recipient !== customerId))) throw failure('DELIVERY_OWNER_MISMATCH');
  return channel;
}

export async function sendSupplierDeliveryDm(client, order, _items, _requestId, controls) {
  const channel = await customerDm(client, order.customer_id);
  if (controls?.beforeSend?.({ channelId: channel.id }) !== true) throw failure('DELIVERY_VETOED');
  const sent = await channel.send(controls.payload);
  if (!snowflake(sent?.id) || (sent.channelId !== undefined && sent.channelId !== channel.id)
    || (sent.author?.id !== undefined && sent.author.id !== client.user?.id)) throw failure('DELIVERY_RECEIPT_INVALID');
  return { messageId: sent.id, channelId: channel.id };
}

/** Metadata-only evidence. Credentials remain exclusively in the encrypted intent. */
export function createSupplierDeliveryService({ db, now = Date.now, id } = {}) {
  let initialized = false;
  const stamp = () => new Date(now()).toISOString();
  function publishHealth() {
    try {
      const health = { ...emptyHealth(), status: 'READY', checkedAt: stamp() };
      const statuses = { PREPARING: 'preparing', SENDING: 'sending', UNKNOWN: 'unknown', SENT: 'sent', RETRY: 'retry', VETOED: 'vetoed', REVIEW: 'review' };
      for (const row of db.prepare('SELECT status,message_format,last_error,COUNT(*) AS n FROM supplier_autobuy_delivery_attempts GROUP BY status,message_format,last_error').all()) {
        health.journalAttempts += row.n;
        if (statuses[row.status]) health[statuses[row.status]] += row.n;
        if (row.message_format === 'LEGACY' && row.status === 'UNKNOWN') health.legacyUnknown += row.n;
        if (row.message_format === 'LEGACY' && row.status === 'SENT') health.legacyRecovered += row.n;
        if (row.last_error === 'DELIVERY_COMPLETION_RETRY') health.completionRetry += row.n;
      }
      publishedHealth = Object.freeze(health);
    } catch { publishedHealth = Object.freeze({ ...emptyHealth(), status: 'UNAVAILABLE', checkedAt: stamp() }); }
  }
  function init() {
    if (initialized) return;
    db.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_delivery_attempts(
      attempt_id TEXT PRIMARY KEY,order_code TEXT NOT NULL,request_id TEXT NOT NULL,provider TEXT NOT NULL,
      guild_id TEXT NOT NULL,customer_id TEXT NOT NULL,product_key TEXT NOT NULL,payload_hash TEXT NOT NULL,
      lease_token TEXT NOT NULL,status TEXT NOT NULL,nonce TEXT NOT NULL,file_name TEXT NOT NULL,file_size INTEGER NOT NULL,
      content TEXT NOT NULL,channel_id TEXT,message_id TEXT,created_at TEXT NOT NULL,send_started_at TEXT,finished_at TEXT,last_error TEXT);
      CREATE INDEX IF NOT EXISTS idx_supplier_delivery_order ON supplier_autobuy_delivery_attempts(order_code,created_at);`);
    const columns = db.prepare('PRAGMA table_info(supplier_autobuy_delivery_attempts)').all();
    if (!columns.some(column => column.name === 'message_format')) db.exec("ALTER TABLE supplier_autobuy_delivery_attempts ADD COLUMN message_format TEXT NOT NULL DEFAULT 'CURRENT'");
    if (!columns.some(column => column.name === 'discovery_after')) db.exec('ALTER TABLE supplier_autobuy_delivery_attempts ADD COLUMN discovery_after TEXT');
    initialized = true;
    publishHealth();
  }
  const byId = attempt => db.prepare('SELECT * FROM supplier_autobuy_delivery_attempts WHERE attempt_id=?').get(attempt);
  const latest = code => db.prepare('SELECT * FROM supplier_autobuy_delivery_attempts WHERE order_code=? ORDER BY rowid DESC LIMIT 1').get(code);
  function update(attempt, status, error = null) {
    db.prepare("UPDATE supplier_autobuy_delivery_attempts SET status=?,last_error=?,finished_at=? WHERE attempt_id=? AND status NOT IN ('SENT','REVIEW')")
      .run(status, error, stamp(), attempt);
    publishHealth();
  }
  async function discover(client, row) {
    const legacy = row.message_format === 'LEGACY';
    if ((!legacy && !snowflake(row.channel_id)) || !snowflake(client?.user?.id)) return null;
    const channel = await customerDm(client, row.customer_id, legacy);
    if ((row.channel_id && channel.id !== row.channel_id) || typeof channel.messages?.fetch !== 'function') return null;
    const expectedChannel = row.channel_id ?? channel.id;
    const matches = [];
    let before, complete = false;
    const earliest = Date.parse(legacy ? row.discovery_after : row.send_started_at ?? row.created_at) - 1000;
    if (!Number.isFinite(earliest)) return null;
    for (let page = 0; page < 5; page++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!batch || typeof batch.values !== 'function') return null;
      const messages = [...batch.values()];
      if (messages.length > 100) return null;
      let oldest = Infinity, next;
      for (const message of messages) {
        if (!snowflake(message?.id) || !Number.isFinite(message.createdTimestamp)) return null;
        oldest = Math.min(oldest, message.createdTimestamp);
        if (!next || BigInt(message.id) < BigInt(next)) next = message.id;
        const attachments = message.attachments?.values ? [...message.attachments.values()] : [];
        if (message.author?.id === client.user.id && !message.webhookId && message.channelId === expectedChannel
          && message.createdTimestamp >= earliest && message.content === row.content
          && (!legacy || (message.nonce !== undefined && message.nonce !== null && String(message.nonce) === row.nonce))
          && (message.nonce === undefined || message.nonce === null || String(message.nonce) === row.nonce)
          && attachments.length === 1 && attachments[0].name === row.file_name && attachments[0].size === row.file_size) matches.push(message);
      }
      if (messages.length < 100 || oldest < earliest) { complete = true; break; }
      if (!next || (before && BigInt(next) >= BigInt(before))) return null;
      before = next;
    }
    if (!complete || matches.length !== 1) return null;
    return { channelId: expectedChannel, messageId: matches[0].id };
  }
  async function deliver({ client, order, intent, lease, freshPurchase, beforeSend, complete, sendDelivery = sendSupplierDeliveryDm, items }) {
    init();
    const bytes = Buffer.from(`Đơn hàng: ${order.order_code}\n\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n\n')}`, 'utf8');
    const payloadHash = hash(bytes), nonce = hash(`supplier-delivery:${intent.provider}:${intent.request_id}`).slice(0, 24);
    const fileName = `${order.order_code}-autobuy-${nonce}-${payloadHash.slice(0, 12)}.txt`;
    const legacyNonce = hash(`supplier-delivery:${intent.request_id}`).slice(0, 24), legacyFileName = `${order.order_code}-autobuy.txt`;
    const legacyAfter = Number.isFinite(Date.parse(intent.created_at)) && Date.parse(intent.created_at) <= now() ? intent.created_at : null;
    const content = `AutoBuy ${order.order_code} — sản phẩm của bạn được đính kèm trong tệp riêng tư.`;
    const same = row => row && row.request_id === intent.request_id && row.provider === intent.provider && row.guild_id === intent.guild_id
      && row.customer_id === intent.customer_id && row.product_key === intent.product_key && row.payload_hash === payloadHash;
    let attempt, closed = false;
    const deadlineAt = now() + 15000;
    const recordReceipt = (row, receipt, guarded) => {
      if (!snowflake(receipt?.messageId) || !snowflake(receipt?.channelId)) {
        update(row.attempt_id, 'UNKNOWN', 'DELIVERY_RECEIPT_INVALID'); return { outcome: 'UNKNOWN' };
      }
      // Record positive evidence before any completion guard can reject it.
      const valid = same(row) && (!row.channel_id || row.channel_id === receipt.channelId) && guarded;
      db.prepare('UPDATE supplier_autobuy_delivery_attempts SET status=?,channel_id=?,message_id=?,finished_at=?,last_error=? WHERE attempt_id=?')
        .run(valid ? 'SENT' : 'REVIEW', receipt.channelId, receipt.messageId, stamp(), valid ? null : 'DELIVERY_RECEIPT_REVIEW', row.attempt_id);
      publishHealth();
      if (!valid) return { outcome: 'REVIEW' };
      try { return { outcome: 'SENT', result: complete(receipt) }; }
      catch (error) {
        if (transientSqlite(error)) {
          db.prepare("UPDATE supplier_autobuy_delivery_attempts SET last_error='DELIVERY_COMPLETION_RETRY' WHERE attempt_id=?").run(row.attempt_id);
          publishHealth();
          return { outcome: 'RETRY', errorCode: 'DELIVERY_COMPLETION_RETRY' };
        }
        db.prepare("UPDATE supplier_autobuy_delivery_attempts SET status='REVIEW',last_error='DELIVERY_RECEIPT_REVIEW' WHERE attempt_id=?").run(row.attempt_id);
        publishHealth();
        return { outcome: 'REVIEW' };
      }
    };
    const work = async () => {
      let existing = latest(order.order_code);
      if (existing && !same(existing)) return { outcome: 'REVIEW' };
      if (existing?.status === 'UNKNOWN' && existing.message_format === 'CURRENT' && !existing.channel_id && !existing.send_started_at) {
        db.prepare("UPDATE supplier_autobuy_delivery_attempts SET message_format='LEGACY',nonce=?,file_name=?,discovery_after=? WHERE attempt_id=? AND status='UNKNOWN' AND channel_id IS NULL AND send_started_at IS NULL")
          .run(legacyNonce, legacyFileName, legacyAfter, existing.attempt_id);
        existing = byId(existing.attempt_id); publishHealth();
      }
      if (existing?.status === 'SENT') return recordReceipt(existing, { messageId: existing.message_id, channelId: existing.channel_id }, true);
      if (existing?.status === 'REVIEW') return { outcome: 'REVIEW' };
      if (existing && ['SENDING', 'UNKNOWN'].includes(existing.status)) {
        update(existing.attempt_id, 'UNKNOWN', 'DELIVERY_UNKNOWN');
        const receipt = await discover(client, existing);
        return receipt ? recordReceipt(existing, receipt, true) : { outcome: 'UNKNOWN' };
      }
      const attemptId = id();
      const createAttempt = retry => db.transaction(() => {
        const current = latest(order.order_code);
        if (current?.attempt_id !== existing?.attempt_id) return null;
        // Only this live, fresh-purchase call proves it has not invoked any DM
        // transport. Never infer that from a persisted legacy/UNKNOWN intent.
        if (retry && (current || !freshPurchase || closed || now() >= deadlineAt || beforeSend() !== true
          || closed || now() >= deadlineAt)) return null;
        if (current?.status === 'PREPARING') update(current.attempt_id, 'VETOED', 'DELIVERY_PREPARATION_REPLACED');
        const status = !current && !freshPurchase ? 'UNKNOWN' : 'PREPARING';
        const legacy = status === 'UNKNOWN';
        db.prepare(`INSERT INTO supplier_autobuy_delivery_attempts(attempt_id,order_code,request_id,provider,guild_id,customer_id,product_key,
          payload_hash,lease_token,status,nonce,file_name,file_size,content,created_at,message_format,discovery_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(attemptId, order.order_code, intent.request_id, intent.provider, intent.guild_id, intent.customer_id, intent.product_key,
            payloadHash, lease, status, legacy ? legacyNonce : nonce, legacy ? legacyFileName : fileName, bytes.length, content, stamp(),
            legacy ? 'LEGACY' : 'CURRENT', legacy ? legacyAfter : null);
        return byId(attemptId);
      }).immediate();
      try { attempt = createAttempt(false); }
      catch (error) {
        if (existing || !freshPurchase || !transientSqlite(error) || closed || now() >= deadlineAt) throw error;
        // One metadata-only retry, same identity, before any Discord/source
        // call. The already-encrypted supplier receipt remains durable.
        attempt = createAttempt(true);
      }
      publishHealth();
      if (!attempt) return { outcome: 'UNKNOWN' };
      if (attempt.status === 'UNKNOWN') {
        const receipt = await discover(client, attempt);
        return receipt ? recordReceipt(attempt, receipt, true) : { outcome: 'UNKNOWN' };
      }
      if (closed || now() >= deadlineAt) {
        update(attempt.attempt_id, 'VETOED', 'DELIVERY_TIMEOUT_BEFORE_SEND');
        return { outcome: 'RETRY' };
      }
      let admitted = false;
      const controls = { payload: { content, files: [{ attachment: bytes, name: fileName }], allowedMentions: noMentions, nonce, enforceNonce: true },
        beforeSend: ({ channelId } = {}) => {
          const committed = db.transaction(() => {
            const row = byId(attempt.attempt_id);
            if (closed || now() >= deadlineAt || admitted || !snowflake(channelId) || row?.status !== 'PREPARING'
              || latest(order.order_code)?.attempt_id !== row.attempt_id) return false;
            if (beforeSend() !== true || closed || now() >= deadlineAt) return false;
            return db.prepare("UPDATE supplier_autobuy_delivery_attempts SET status='SENDING',channel_id=?,send_started_at=? WHERE attempt_id=? AND status='PREPARING'")
              .run(channelId, stamp(), row.attempt_id).changes === 1;
          }).immediate();
          // COMMIT itself can block or fail. Until it succeeds and the live
          // deadline still holds, channel.send has not been admitted.
          if (!committed || closed || now() >= deadlineAt) return false;
          admitted = true;
          return true;
        } };
      try {
        const receipt = await sendDelivery(client, order, items, intent.request_id, controls);
        return recordReceipt(byId(attempt.attempt_id), receipt, admitted);
      } catch (error) {
        const row = byId(attempt.attempt_id);
        if (['SENT', 'REVIEW'].includes(row?.status)) return { outcome: row.status };
        const safeRetry = !admitted || rejected(error);
        update(attempt.attempt_id, safeRetry ? 'RETRY' : 'UNKNOWN', safeRetry ? 'DELIVERY_RETRY' : 'DELIVERY_UNKNOWN');
        return { outcome: safeRetry ? 'RETRY' : 'UNKNOWN' };
      }
    };
    let timer;
    const operation = work().catch(() => ({ outcome: 'UNKNOWN' }));
    try {
      return await Promise.race([operation, new Promise(resolve => {
        timer = setTimeout(() => {
          closed = true;
          try {
            const row = attempt && byId(attempt.attempt_id);
            if (row?.status === 'PREPARING') update(row.attempt_id, 'VETOED', 'DELIVERY_TIMEOUT_BEFORE_SEND');
            if (row?.status === 'SENDING') update(row.attempt_id, 'UNKNOWN', 'DELIVERY_TIMEOUT');
            resolve({ outcome: row?.status === 'PREPARING' ? 'RETRY' : 'UNKNOWN' });
          } catch { resolve({ outcome: 'UNKNOWN' }); }
        }, Math.max(0, deadlineAt - now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  return { init, deliver };
}
