export const SUPPLIER_PROVIDERS = Object.freeze(['cdkvietnam', 'dopermind']);

export const isSupplierProvider = value => SUPPLIER_PROVIDERS.includes(value);

// CDK identities are namespaced; the pre-existing Dopermind keys are opaque.
// Never infer an old paid order's source from the currently selected .env source.
export function supplierProviderForProductKey(key) {
  if (typeof key !== 'string' || !key || key.length > 200) return null;
  if (/^cdkvietnam:[1-9]\d*$/.test(key)) return 'cdkvietnam';
  if (key.includes(':')) return null;
  return 'dopermind';
}

export function configuredSupplierProvider(env = process.env) {
  return isSupplierProvider(env.SUPPLIER_AUTOBUY_PROVIDER) ? env.SUPPLIER_AUTOBUY_PROVIDER : null;
}
