import { decrypt, isEncrypted } from '../utils/crypto.js';

function clean(value, max = 500) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function canRequesterAccessOrder(order, identity = {}) {
  const role = String(identity.role || '').trim().toLowerCase();
  if (role === 'admin' || role === 'staff') return true;
  const discordId = String(identity.discordId || '').trim();
  const userId = String(identity.userId || '').trim();
  return Boolean(
    (discordId && discordId === String(order?.customer_id || ''))
    || (userId && userId === String(order?.created_by_id || '')),
  );
}

function deliveryFor(order) {
  const hasDelivery = Boolean(
    order?.credential_email
    || order?.credential_password
    || order?.credential_profile
    || order?.credential_pin
    || order?.delivery_login_url,
  );
  if (!hasDelivery) return null;

  const decrypted = (value) => {
    const result = decrypt(value);
    return isEncrypted(result) ? null : result;
  };
  return {
    email: clean(decrypted(order.credential_email), 254),
    password: clean(decrypted(order.credential_password), 500),
    profile: clean(decrypted(order.credential_profile), 160),
    pin: clean(decrypted(order.credential_pin), 80),
    activation_link: clean(order.delivery_login_url, 1_000),
    warranty_code: `BH-${String(order.order_code || '').slice(0, 48)}`,
    note: clean(order.claim_notes, 1_000),
  };
}

/**
 * Strict allowlist for customer order views. Raw database rows contain payment
 * metadata and encrypted credentials, so they must never be spread into an API
 * response.
 */
export function buildCustomerOrderView(order, { includeDelivery = false, includeOwnership = false } = {}) {
  const view = {
    order_code: clean(order?.order_code, 48),
    ...(includeOwnership ? {
      customer_id: clean(order?.customer_id, 64),
      created_by_id: clean(order?.created_by_id, 128),
    } : {}),
    product_name: clean(order?.product_name, 240),
    quantity: Number(order?.quantity) || 1,
    total_amount: Number(order?.total_amount) || 0,
    amount_paid: Number(order?.amount_paid) || 0,
    payment_provider: clean(order?.payment_provider, 40),
    payment_status: clean(order?.payment_status, 40),
    status: clean(order?.status, 40),
    status_changed_at: clean(order?.status_changed_at, 80),
    duration_months: Number(order?.duration_months) || null,
    duration_days: Number(order?.duration_days) || null,
    expiry_at: clean(order?.expiry_at, 80),
    paid_at: clean(order?.paid_at, 80),
    completed_at: clean(order?.completed_at, 80),
    delivered_at: clean(order?.delivered_at, 80),
    created_at: clean(order?.created_at, 80),
    updated_at: clean(order?.updated_at, 80),
    discord_sku_id: clean(order?.discord_sku_id, 80),
    discord_product_url: clean(order?.discord_product_url, 1_000),
    discord_original_price: Number(order?.discord_original_price) || null,
    discord_nitro_eligible: Number(order?.discord_nitro_eligible) === 1,
    ...(includeDelivery ? { delivered_account: deliveryFor(order) } : {}),
  };
  return view;
}
