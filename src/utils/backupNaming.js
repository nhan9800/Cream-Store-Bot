export function backupTagForEnvironment(envFile = '.env') {
  const normalized = String(envFile || '.env').trim();
  if (normalized === '.env') return 'store1';
  if (normalized === '.env.store2') return 'store2';
  return normalized
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'store1';
}
