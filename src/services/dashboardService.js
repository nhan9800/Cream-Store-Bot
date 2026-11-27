import { db } from '../database/db.js';
import { listFlags } from './blacklistService.js';
import { getRecentStaffLogs } from './staffLogService.js';
import { getStaffKpis } from './orderService.js';
import { getRefundSummary } from './refundLedgerService.js';

function summaryStmt() {
  return db.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      SUM(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) AS pending_payment,
      SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status = 'WARRANTY_OPEN' THEN 1 ELSE 0 END) AS warranty_open,
      -- Doanh thu: chỉ tính đơn đã PAID + KHÔNG bị hủy
      COALESCE(SUM(CASE WHEN payment_status = 'PAID' AND status != 'CANCELLED' THEN amount_paid ELSE 0 END), 0) AS revenue_paid,
      COUNT(DISTINCT customer_id) AS customers
    FROM orders
    WHERE guild_id = ?
  `);
}

function topProductsStmt() {
  return db.prepare(`
    SELECT product_name, COUNT(*) AS total_orders
    FROM orders
    WHERE guild_id = ?
      AND status != 'CANCELLED'
    GROUP BY product_name
    ORDER BY total_orders DESC, product_name ASC
    LIMIT ?
  `);
}

export function getDashboardData(guildId) {
  const summary = summaryStmt().get(guildId) ?? {};
  const refunds = getRefundSummary(db, { guildId });
  summary.revenue_gross = summary.revenue_paid ?? 0;
  summary.revenue_refunded = refunds.refunded;
  summary.revenue_paid = (summary.revenue_paid ?? 0) - refunds.refunded;
  summary.blacklisted = listFlags(guildId, 100).filter((item) => Number(item.is_blacklisted) === 1).length;
  return {
    summary,
    topProducts: topProductsStmt().all(guildId, 5),
    recentLogs: getRecentStaffLogs(guildId, 8),
    kpis: getStaffKpis(guildId, 3),
  };
}
