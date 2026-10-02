import {
  getEmoji, parseDiscordEmoji, resolveLiveCustomEmoji,
} from '../services/emojiService.js';

/**
 * Resolve at call time so an existing builder immediately uses new artwork
 * after inventory refresh or rejects an emoji deleted since it was created.
 * Missing/unverified emoji remain empty under the Cenar custom-only policy.
 */
export function createEmojiResolver(guildId) {
  const fn = (slot, fallback = '') => getEmoji(guildId, slot)
    || resolveLiveCustomEmoji(fallback, guildId)
    || '';
  fn.component = (slot) => {
    const parsed = parseDiscordEmoji(fn(slot));
    return parsed ? { id: parsed.id, name: parsed.name, animated: parsed.animated } : null;
  };
  return fn;
}

/** Never send an unverified ID to Discord component builders. */
export function normalizeButtonEmoji(value, { guildId } = {}) {
  const parsed = parseDiscordEmoji(resolveLiveCustomEmoji(value, guildId));
  return parsed ? { id: parsed.id, name: parsed.name, animated: parsed.animated } : null;
}

/** Attach the first actually live emoji; missing artwork leaves the button usable. */
export function withButtonEmoji(button, ...candidates) {
  for (const candidate of candidates) {
    const emoji = normalizeButtonEmoji(candidate);
    if (!emoji) continue;
    button.setEmoji(emoji);
    break;
  }
  return button;
}

