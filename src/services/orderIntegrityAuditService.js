// Read-only database evidence. Never infer provider settlement, change an order,
// decrypt credentials, fetch Discord, or contact a payment/supplier API here.
const integer = value => Number.isSafeInteger(value);
const instant = value => {
  if (!value) return null;
  const normalized = String(value).replace(' ', 'T');
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized) ? `${normalized}Z` : normalized);
  return Number.isFinite(ms) ? ms : null;
};
const terminal = status => ['CANCELLED', 'REFUNDED'].includes(status);

export function auditOrderIntegrityPage(database, { afterId = 0, snapshotId = null, limit = 250 } = {}) {
  if (!integer(afterId) || afterId < 0 || (snapshotId !== null && (!integer(snapshotId) || snapshotId < 0))
    || !integer(limit) || limit < 1 || limit > 500) throw new Error('INVALID_AUDIT_PAGE');
  return database.transaction(() => {
    const upper = snapshotId ?? database.prepare('SELECT COALESCE(MAX(id),0) AS id FROM orders').get().id;
    const totalOrders = database.prepare('SELECT COUNT(*) AS count FROM orders WHERE id <= ?').get(upper).count;
    const duplicateCodes = new Set(database.prepare(`SELECT UPPER(TRIM(order_code)) AS code
      FROM orders WHERE id<=? AND TRIM(COALESCE(order_code,''))<>'' GROUP BY UPPER(TRIM(order_code))
      HAVING COUNT(*)>1`).all(upper).map(row => row.code));
    const orders = database.prepare(`SELECT o.id,o.order_code,o.guild_id,o.customer_id,o.quantity,
      o.total_amount,o.amount_paid,o.payment_provider,o.payment_status,o.status,
      o.created_at,o.paid_at,o.delivered_at,o.completed_at,o.expiry_at,
      t.id AS existing_ticket,t.guild_id AS ticket_guild,t.customer_id AS ticket_customer
      FROM orders o LEFT JOIN tickets t ON t.id=o.ticket_id
      WHERE o.id>? AND o.id<=? ORDER BY o.id LIMIT ?`).all(afterId, upper, limit);
    const subscription = database.prepare(`SELECT id,guild_id,status,purchase_date,expiry_at,
      total_duration_months,renewal_cycle_months,times_renewed,renewal_mode,next_renewal_at
      FROM subscription_accounts WHERE UPPER(TRIM(related_order_code))=?`);
    const youtube = database.prepare(`SELECT m.id,m.guild_id,m.status,m.started_at,m.customer_expiry_at,
      m.total_months,m.cycle_months,m.paid_cycles,m.next_source_payment_at,s.guild_id AS source_guild
      FROM youtube_memberships m LEFT JOIN youtube_sources s ON s.id=m.source_id
      WHERE UPPER(TRIM(m.related_order_code))=?`);
    const spotify = database.prepare(`SELECT m.id,m.status,m.joined_at,m.member_expiry_at,f.guild_id AS family_guild
      FROM spotify_family_members m LEFT JOIN spotify_families f ON f.id=m.family_id
      WHERE UPPER(TRIM(m.related_order_code))=?`);
    const debits = database.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount
      FROM wallet_transactions WHERE guild_id=? AND customer_id=? AND related_code=?
      AND type IN ('PAYMENT','PAY_ORDER')`);
    const findings = [];
    const counts = {};
    const statuses = {};
    for (const order of orders) {
      const flags = new Set();
      const records = [];
      const flag = value => flags.add(value);
      const code = String(order.order_code || '').trim().toUpperCase();
      statuses[order.status] = (statuses[order.status] || 0) + 1;
      if (!code) flag('ORDER_CODE_MISSING');
      if (duplicateCodes.has(code)) flag('NORMALIZED_ORDER_CODE_DUPLICATE');
      if (!integer(order.quantity) || order.quantity <= 0) flag('QUANTITY_INVALID');
      if (![order.total_amount,order.amount_paid].every(value => integer(value) && value >= 0)) flag('AMOUNT_INVALID');
      if (order.payment_status === 'PAID' && order.amount_paid < order.total_amount) flag('PAID_AMOUNT_BELOW_TOTAL');
      if (order.payment_status === 'PAID' && order.status === 'PENDING_PAYMENT') flag('PAID_STILL_PENDING_PAYMENT');
      if (order.status === 'COMPLETED' && !['PAID', 'FREE'].includes(order.payment_status)) flag('COMPLETED_WITHOUT_PAYMENT_CLEARANCE');
      if (order.status === 'COMPLETED' && !order.completed_at) flag('COMPLETION_TIME_MISSING');
      if (!order.existing_ticket) flag('TICKET_MISSING');
      else {
        if (order.ticket_guild !== order.guild_id) flag('TICKET_GUILD_MISMATCH');
        if (order.ticket_customer !== order.customer_id) flag('TICKET_CUSTOMER_MISMATCH');
      }
      for (const key of ['created_at','paid_at','delivered_at','completed_at','expiry_at']) {
        if (order[key] && instant(order[key]) === null) flag(`INVALID_${key.toUpperCase()}`);
      }
      const delivered = instant(order.delivered_at), expires = instant(order.expiry_at);
      if (delivered !== null && expires !== null && expires <= delivered) flag('EXPIRY_NOT_AFTER_DELIVERY');
      if (order.payment_provider === 'WALLET' && order.payment_status === 'PAID' && order.total_amount > 0) {
        const ledger = debits.get(order.guild_id, order.customer_id, order.order_code);
        if (ledger.count !== 1 || -ledger.amount !== order.total_amount) flag('WALLET_DEBIT_NEEDS_REVIEW');
      }
      const linked = [
        ...subscription.all(code).map(row => ({ kind: 'subscription', row })),
        ...youtube.all(code).map(row => ({ kind: 'youtube', row })),
        ...spotify.all(code).map(row => ({ kind: 'spotify', row })),
      ];
      for (const { kind, row } of linked) {
        const issues = [];
        const add = value => { issues.push(value); flag(value); };
        const guild = kind === 'spotify' ? row.family_guild : row.guild_id;
        if (!guild || (order.guild_id !== 'WEB' && guild !== order.guild_id)) add('LINKED_SERVICE_GUILD_MISMATCH');
        if (row.status === 'ACTIVE' && terminal(order.status)) add('ACTIVE_SERVICE_ON_TERMINAL_ORDER');
        if (row.status === 'ACTIVE' && !['PAID', 'FREE'].includes(order.payment_status)) add('ACTIVE_SERVICE_WITHOUT_PAYMENT_CLEARANCE');
        if (kind === 'subscription') {
          const total = row.total_duration_months, cycle = row.renewal_cycle_months, renewed = row.times_renewed;
          if (!integer(total) || total < 1 || !integer(cycle) || cycle < 0
            || (row.renewal_mode === 'auto_cycle' && cycle < 1) || !integer(renewed) || renewed < 0) add('SUBSCRIPTION_PROGRESS_INVALID');
          const start = instant(row.purchase_date), end = instant(row.expiry_at);
          if (start === null || end === null || end <= start) add('SUBSCRIPTION_DATES_INVALID');
          if (row.renewal_mode === 'auto_cycle' && total > 0 && cycle > 0 && renewed >= 0) {
            const remains = cycle * (renewed + 1) < total;
            if (row.status === 'ACTIVE' && remains && !row.next_renewal_at) add('SUBSCRIPTION_NEXT_DUE_MISSING');
            if (!remains && row.next_renewal_at) add('SUBSCRIPTION_FULLY_COVERED_HAS_NEXT_DUE');
          }
        } else if (kind === 'youtube') {
          const total = row.total_months, cycle = row.cycle_months, paid = row.paid_cycles;
          if (!integer(total) || total < 1 || !integer(cycle) || cycle < 1 || !integer(paid)
            || paid < 0 || (cycle > 0 && paid > Math.ceil(total / cycle))) add('YOUTUBE_PROGRESS_INVALID');
          const start = instant(row.started_at), end = instant(row.customer_expiry_at);
          if (start === null || end === null || end <= start) add('YOUTUBE_DATES_INVALID');
          if (!row.source_guild || ![row.guild_id, 'WEB'].includes(row.source_guild)) add('YOUTUBE_SOURCE_GUILD_MISMATCH');
          if (total > 0 && cycle > 0 && paid >= 0) {
            if (row.status === 'ACTIVE' && paid * cycle < total && !row.next_source_payment_at) add('YOUTUBE_NEXT_DUE_MISSING');
            if (paid * cycle >= total && row.next_source_payment_at) add('YOUTUBE_FULLY_COVERED_HAS_NEXT_DUE');
          }
        } else {
          const start = instant(row.joined_at), end = instant(row.member_expiry_at);
          if (start === null || end === null || end <= start) add('SPOTIFY_MEMBER_DATES_INVALID');
        }
        if (issues.length) records.push({ kind, id: row.id, flags: issues });
      }
      if (flags.size) {
        for (const value of flags) counts[value] = (counts[value] || 0) + 1;
        findings.push({ id: order.id, orderCode: order.order_code, status: order.status,
          paymentStatus: order.payment_status, totalAmount: order.total_amount, recordedPaidAmount: order.amount_paid,
          flags: [...flags], linkedRecords: records });
      }
    }
    const lastId = orders.at(-1)?.id ?? afterId;
    const more = Boolean(database.prepare('SELECT 1 FROM orders WHERE id>? AND id<=? LIMIT 1').get(lastId, upper));
    return { version: 'ORDER-INTEGRITY-20261115', checkedAt: new Date().toISOString(), snapshotId: upper,
      totalOrders, afterId, lastId, scanned: orders.length, hasMore: more, counts, statuses, findings,
      limitations: ['LOCAL_RECORDS_ONLY', 'REVIEW_FLAGS_ARE_NOT_SETTLEMENT_PROOF', 'PAGES_ARE_SEPARATE_READ_SNAPSHOTS',
        'UNLINKED_SERVICE_PROFILES_NOT_IN_ORDER_SCAN'] };
  })();
}
