// This is only a fixed routing hint, never proof of OAuth consent. The target
// child still verifies the cookie, HMAC, expiry and application ID before doing
// any token exchange or role mutation. Both apps may share a registered URI.
export function resolveOAuthCallbackStore(requestUrl) {
  try {
    const url = new URL(requestUrl, 'http://localhost');
    if (url.pathname !== '/oauth/callback' || url.searchParams.getAll('state').length !== 1) return 'store1';
    const state = url.searchParams.get('state');
    if (!state || state.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(state)) return 'store1';
    const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8'));
    return payload?.v === 1 && payload.store === 'store2' && /^\d{17,20}$/.test(String(payload.clientId || ''))
      ? 'store2'
      : 'store1';
  } catch {
    return 'store1';
  }
}
