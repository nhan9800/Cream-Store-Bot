const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value, fallback = null) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

export function addYoutubeCalendarMonths(value, amount = 1) {
  const source = validDate(value);
  if (!source) throw new Error('Ngày gia hạn YouTube không hợp lệ.');
  const months = Math.max(0, Number.parseInt(String(amount), 10) || 0);
  if (months === 0) return source.toISOString();
  const day = source.getUTCDate();
  const target = new Date(source.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function maskYoutubeGmail(value) {
  const email = String(value || '').trim();
  const [local, domain] = email.split('@');
  if (!local || !domain) return email ? `${email.slice(0, 2)}***` : 'Chưa có Gmail';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export function maskYoutubePaymentAccount(value) {
  const clean = String(value || '').replace(/\s+/g, '').trim();
  if (!clean) return 'Chưa lưu tài khoản nhận tiền';
  return `•••• ${clean.slice(-4)}`;
}

export function calculateYoutubeMembership(row, now = new Date()) {
  const current = validDate(now, new Date());
  const totalMonths = Math.max(1, Number.parseInt(String(row?.total_months ?? row?.totalMonths ?? 1), 10) || 1);
  const cycleMonths = Math.max(1, Number.parseInt(String(row?.cycle_months ?? row?.cycleMonths ?? 1), 10) || 1);
  const totalCycles = Math.max(1, Math.ceil(totalMonths / cycleMonths));
  const paidCycles = Math.min(totalCycles, Math.max(0, Number.parseInt(String(row?.paid_cycles ?? row?.paidCycles ?? 0), 10) || 0));
  const remainingCycles = Math.max(0, totalCycles - paidCycles);
  const paidMonths = Math.min(totalMonths, paidCycles * cycleMonths);
  const remainingMonths = Math.max(0, totalMonths - paidMonths);
  const sourceCostPerCycle = Math.max(0, Number(row?.source_cost_per_cycle ?? row?.sourceCostPerCycle ?? 0) || 0);
  const salePrice = Math.max(0, Number(row?.sale_price ?? row?.salePrice ?? 0) || 0);
  const expectedSourceCost = totalCycles * sourceCostPerCycle;
  const sourceCostPaid = paidCycles * sourceCostPerCycle;
  const remainingSourceCost = remainingCycles * sourceCostPerCycle;
  const expectedMargin = salePrice - expectedSourceCost;
  const paymentProgressPercent = Math.min(100, Math.max(0, Math.round((paidCycles / totalCycles) * 100)));
  const nextPayment = validDate(row?.next_source_payment_at ?? row?.nextSourcePaymentAt);
  const customerExpiry = validDate(row?.customer_expiry_at ?? row?.customerExpiryAt);
  const reminderDays = Math.max(1, Number.parseInt(String(row?.reminder_days_before ?? row?.reminderDaysBefore ?? 7), 10) || 7);
  const rawDays = nextPayment ? (nextPayment - current) / DAY_MS : null;
  const daysUntilPayment = rawDays == null ? null : rawDays > 0 ? Math.ceil(rawDays) : 0;
  const overdueDays = rawDays != null && rawDays < 0 ? Math.max(1, Math.floor(Math.abs(rawDays)) + 1) : 0;
  const daysUntilExpiry = customerExpiry ? Math.max(0, Math.ceil((customerExpiry - current) / DAY_MS)) : null;

  let dueState = 'HEALTHY';
  if (remainingCycles === 0) dueState = 'FULLY_PAID';
  else if (overdueDays > 0) dueState = 'OVERDUE';
  else if (daysUntilPayment != null && daysUntilPayment <= 1) dueState = 'URGENT';
  else if (daysUntilPayment != null && daysUntilPayment <= reminderDays) dueState = 'DUE_SOON';

  return {
    totalMonths,
    cycleMonths,
    totalCycles,
    paidCycles,
    remainingCycles,
    paidMonths,
    remainingMonths,
    sourceCostPerCycle,
    salePrice,
    expectedSourceCost,
    sourceCostPaid,
    remainingSourceCost,
    expectedMargin,
    paymentProgressPercent,
    daysUntilPayment,
    overdueDays,
    daysUntilExpiry,
    dueState,
  };
}

export function resolveYoutubeReminderStage(membership, now = new Date()) {
  const progress = calculateYoutubeMembership(membership, now);
  if (progress.remainingCycles === 0 || progress.daysUntilPayment == null) return null;
  if (progress.overdueDays > 0) return 'OVERDUE';
  if (progress.daysUntilPayment <= 1) return 'DUE_1D';
  if (progress.daysUntilPayment <= 3) return 'DUE_3D';
  return 'DUE_7D';
}

export function shouldSendYoutubeReminder(membership, stage, now = new Date()) {
  if (!stage || membership?.status !== 'ACTIVE') return false;
  const current = validDate(now, new Date());
  const snoozedUntil = validDate(membership?.snoozed_until ?? membership?.snoozedUntil);
  if (snoozedUntil && snoozedUntil > current) return false;
  const nextPayment = membership?.next_source_payment_at ?? membership?.nextSourcePaymentAt;
  const reminderFor = membership?.reminder_for_payment_at ?? membership?.reminderForPaymentAt;
  const reminderStage = membership?.reminder_stage ?? membership?.reminderStage;
  if (reminderFor !== nextPayment) return true;
  if (reminderStage !== stage) return true;
  if (stage !== 'OVERDUE') return false;
  const lastSent = validDate(membership?.reminder_sent_at ?? membership?.reminderSentAt);
  return !lastSent || (current - lastSent) >= DAY_MS;
}
