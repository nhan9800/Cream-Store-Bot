/**
 * Normalize product labels before trying to infer their service.
 *
 * Some legacy Discord catalog entries intentionally spell brand names
 * phonetically (for example "Sờ Pót Ti Fy") so that the label is less
 * likely to be filtered by Discord.  Those labels still need to map to the
 * canonical service when an order is linked from the website.
 */
export function normalizeServiceSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSpotifyProductName(value) {
  const normalized = normalizeServiceSearch(value);
  if (!normalized) return false;
  if (normalized.includes('spotify')) return true;

  // Legacy/obfuscated labels: "Sờ Pót Ti Fy", including punctuation or
  // slightly different whitespace between the phonetic syllables.
  if (/(?:^|\s)(?:so\s+)?pot\s+ti\s+fy(?:$|\s)/.test(normalized)) return true;
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return compact.includes('sopottify') || compact.includes('pottify');
}
