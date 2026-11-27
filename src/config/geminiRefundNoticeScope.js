/** Owner's Nov27 correction applies to notices, not existing refund decisions. */
export function isGemini18MonthRefundNotice(row) {
  return Boolean(row?.active && /gemini/i.test(row.productName || '')
    && row.durationMonths === 18 && !Number(row.durationDays || 0)
    && ['WARRANTY', 'WARRANTY_OPEN'].includes(row.refundFromStatus));
}
