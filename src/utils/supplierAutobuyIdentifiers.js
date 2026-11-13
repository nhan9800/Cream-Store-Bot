// Provider identities remain distinct end-to-end. CDK numeric IDs must retain
// their namespace when carried by Discord select values and custom IDs.
export function isSupplierAutobuyProductKey(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return true;
  if (!/^cdkvietnam:[1-9]\d*$/.test(value)) return false;
  return Number.isSafeInteger(Number(value.slice('cdkvietnam:'.length)));
}
