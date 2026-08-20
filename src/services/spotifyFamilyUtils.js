const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_MONTH_DAYS = 30.4375;

function validDate(value, fallback = null) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

export function addCalendarMonths(value, amount = 1) {
  const source = validDate(value);
  if (!source) throw new Error('Ngày gia hạn không hợp lệ.');
  const months = Math.max(1, Number.parseInt(String(amount), 10) || 1);
  const day = source.getUTCDate();
  const target = new Date(source.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function maskPaymentCard(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'Chưa gán thẻ';
  const suffix = digits.slice(-4).padStart(4, '•');
  return `•••• ${suffix}`;
}

export function calculateFamilyProgress(family, activeMembers = 0, now = new Date()) {
  const current = validDate(now, new Date());
  const nextRenewal = validDate(family?.next_renewal_at, current);
  let cycleStart = validDate(family?.cycle_started_at);
  if (!cycleStart || cycleStart >= nextRenewal) {
    const renewalDay = nextRenewal.getUTCDate();
    cycleStart = new Date(nextRenewal.getTime());
    cycleStart.setUTCDate(1);
    cycleStart.setUTCMonth(cycleStart.getUTCMonth() - 1);
    const lastDay = new Date(Date.UTC(cycleStart.getUTCFullYear(), cycleStart.getUTCMonth() + 1, 0)).getUTCDate();
    cycleStart.setUTCDate(Math.min(renewalDay, lastDay));
  }

  const totalDays = Math.max(1, Math.ceil((nextRenewal - cycleStart) / DAY_MS));
  const rawRemaining = (nextRenewal - current) / DAY_MS;
  const daysRemaining = rawRemaining > 0 ? Math.ceil(rawRemaining) : 0;
  const overdueDays = rawRemaining < 0 ? Math.max(1, Math.floor(Math.abs(rawRemaining)) + 1) : 0;
  const elapsedDays = Math.min(totalDays, Math.max(0, totalDays - daysRemaining));
  const progressPercent = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
  const totalSlots = Math.max(1, Number.parseInt(String(family?.total_slots || 6), 10) || 6);
  const slotsUsed = Math.max(0, Number(activeMembers || 0));

  let dueState = 'HEALTHY';
  if (overdueDays > 0) dueState = 'OVERDUE';
  else if (daysRemaining <= 1) dueState = 'URGENT';
  else if (daysRemaining <= Math.max(1, Number(family?.reminder_days_before || 7))) dueState = 'DUE_SOON';

  return {
    cycleTotalDays: totalDays,
    elapsedDays,
    daysRemaining,
    overdueDays,
    progressPercent,
    dueState,
    slotsUsed,
    slotsAvailable: Math.max(0, totalSlots - slotsUsed),
    totalSlots,
  };
}

export function calculateMemberUsage(member, now = new Date()) {
  const current = validDate(now, new Date());
  const joinedAt = validDate(member?.joined_at, current);
  const expiryAt = validDate(member?.member_expiry_at);
  const daysUsed = Math.max(0, Math.floor((current - joinedAt) / DAY_MS));
  const monthsUsed = Math.round((daysUsed / AVERAGE_MONTH_DAYS) * 10) / 10;
  const purchasedMonths = Math.max(1, Number.parseInt(String(member?.purchased_months || 1), 10) || 1);
  const planDays = Math.max(1, Math.round(purchasedMonths * AVERAGE_MONTH_DAYS));
  const daysRemaining = expiryAt ? Math.max(0, Math.ceil((expiryAt - current) / DAY_MS)) : null;
  const progressPercent = Math.min(100, Math.max(0, Math.round((daysUsed / planDays) * 100)));
  return { daysUsed, monthsUsed, purchasedMonths, daysRemaining, progressPercent };
}

export function resolveFamilyReminderStage(family, now = new Date()) {
  const current = validDate(now, new Date());
  const due = validDate(family?.next_renewal_at);
  if (!due) return null;
  const days = Math.ceil((due - current) / DAY_MS);
  if (days <= 0) return 'OVERDUE';
  if (days <= 1) return 'DUE_1D';
  if (days <= 3) return 'DUE_3D';
  return 'DUE_7D';
}

export function shouldSendFamilyReminder(family, stage, now = new Date()) {
  if (!stage || family?.status !== 'ACTIVE') return false;
  const current = validDate(now, new Date());
  const snoozedUntil = validDate(family?.snoozed_until);
  if (snoozedUntil && snoozedUntil > current) return false;
  if (family?.reminder_for_renewal_at !== family?.next_renewal_at) return true;
  if (family?.reminder_stage !== stage) return true;
  if (stage !== 'OVERDUE') return false;
  const lastSent = validDate(family?.reminder_sent_at);
  return !lastSent || (current - lastSent) >= DAY_MS;
}
