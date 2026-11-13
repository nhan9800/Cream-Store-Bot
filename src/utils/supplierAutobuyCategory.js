import { createHash } from 'node:crypto';

const STABLE_KEY = /^c_[a-f0-9]{24}$/;
export const isSupplierCategoryKey = value => typeof value === 'string' && STABLE_KEY.test(value);
// A display filter identity, never authorization or a price/product identity.
export const supplierCategoryKey = name => `c_${createHash('sha256').update(String(name).trim()).digest('hex').slice(0, 24)}`;

/** Recover old numeric selections from their original bot-authored menu. */
export function resolveSupplierCategorySelection(message, value, customerId) {
  if (value === '0') return 0;
  if (isSupplierCategoryKey(value)) return value;
  if (!/^[1-9]\d{0,3}$/.test(value || '')) return null;
  const pending = [...(message?.components || [])];
  try {
    for (let inspected = 0; pending.length && inspected < 100; inspected++) {
      const node = pending.shift();
      const item = typeof node?.toJSON === 'function' ? node.toJSON() : node;
      if (item?.type === 3 && item.custom_id === `supplier-autobuy:category:${customerId}`) {
        const matching = (item.options || []).filter(option => option.value === value && typeof option.label === 'string' && option.label.trim());
        return matching.length === 1 ? supplierCategoryKey(matching[0].label) : null;
      }
      if (Array.isArray(item?.components)) pending.push(...item.components);
    }
  } catch { /* Missing or unreadable old metadata cannot select another group. */ }
  return null;
}
