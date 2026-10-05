// Use the registered Express route, not a role claimed by the caller.
export function requiresSystemAdmin(routePath) {
  return /^\/api\/bot\/admin\/(?:data(?:\/|$)|settings(?:\/|$)|ai-knowledge(?:\/|$))/i.test(String(routePath || ''));
}
