// A payment lookup's amount is the invoice value. Only amountPaid or the
// associated transaction receipts can establish what the bank received.
export function getPayOSReceivedAmount(info) {
  if (info?.amountPaid !== undefined && info?.amountPaid !== null) return info.amountPaid;
  if (!Array.isArray(info?.transactions) || !info.transactions.length) return null;
  const seen = new Set();
  let amount = 0;
  for (const transaction of info.transactions) {
    const value = Number(transaction?.amount);
    const reference = String(transaction?.reference || '').trim();
    if (!reference || !Number.isSafeInteger(value) || value <= 0) return null;
    if (seen.has(reference)) continue;
    seen.add(reference);
    amount += value;
  }
  return Number.isSafeInteger(amount) ? amount : null;
}

export function getStoredPayOSReceivedAmount(rawPayload) {
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if ('amountPaid' in payload || 'transactions' in payload || 'invoiceAmount' in payload) {
    return getPayOSReceivedAmount(payload);
  }
  return payload.amount;
}
