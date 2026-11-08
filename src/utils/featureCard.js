import { MessageFlags } from 'discord.js';
import { countDiscordComponents, normalizeDiscordV2Layout } from './discordLayout.js';

const SUPPORTED_EMBED_KEYS = new Set(['type', 'title', 'description', 'url', 'timestamp', 'color', 'footer', 'image', 'thumbnail', 'author', 'fields']);
const json = value => value?.toJSON?.() || value;
const text = content => ({ type: 10, content });
const spacer = (spacing = 2) => ({ type: 14, divider: true, spacing });
const safeLink = url => typeof url === 'string' && /^https?:\/\/[^\s<>]+$/i.test(url);
const safeMedia = url => safeLink(url) || (typeof url === 'string' && /^attachment:\/\/[^\s<>]+$/.test(url));
const link = (label, url) => `[${label.replace(/([\\[\]])/g, '\\$1')}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
const onlyKeys = (value, keys) => value == null || (typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)));
const MENTION = /<@!?\d+>|<@&\d+>|@(?:everyone|here)\b/;

function hasActiveMentions(allowed) {
  // Do not infer API/client defaults from an empty or partially specified
  // policy. Only an explicit empty parse array and no targets prove silence.
  return Boolean(allowed && (!Array.isArray(allowed.parse) || allowed.parse.length
    || allowed.users?.length || allowed.roles?.length));
}

function withThumbnail(components, url) {
  return url ? [{ type: 9, components, accessory: { type: 11, media: { url } } }] : components;
}

function appendGroup(target, group, spacing = 2) {
  if (!group.length) return;
  if (target.length) target.push(spacer(spacing));
  target.push(...group);
}

function convertEmbed(embed) {
  if (!embed || typeof embed !== 'object' || Object.keys(embed).some(key => !SUPPORTED_EMBED_KEYS.has(key))) return null;
  if (embed.type && embed.type !== 'rich') return null;
  if (!onlyKeys(embed.author, ['name', 'url', 'icon_url']) || !onlyKeys(embed.footer, ['text', 'icon_url'])
    || !onlyKeys(embed.image, ['url']) || !onlyKeys(embed.thumbnail, ['url'])) return null;
  if (embed.url && !safeLink(embed.url)) return null;
  if (embed.author?.url && !safeLink(embed.author.url)) return null;
  for (const url of [embed.author?.icon_url, embed.thumbnail?.url, embed.image?.url, embed.footer?.icon_url]) {
    if (url && !safeMedia(url)) return null;
  }
  if (embed.color != null && (!Number.isInteger(embed.color) || embed.color < 0 || embed.color > 0xffffff)) return null;
  if (embed.fields && (!Array.isArray(embed.fields) || embed.fields.length > 25)) return null;
  const components = [];
  if (embed.author?.name) {
    const author = embed.author.url ? link(embed.author.name, embed.author.url) : embed.author.name;
    appendGroup(components, withThumbnail([text(`-# ${author}`)], embed.author.icon_url), 1);
  }
  const header = [];
  if (embed.title) header.push(text(`## ${embed.url ? link(embed.title, embed.url) : embed.title}`));
  if (embed.description) header.push(text(embed.description));
  if (!embed.title && embed.url) header.push(text(link('Mở liên kết', embed.url)));
  // A thumbnail is never discarded just because the source embed has no title.
  if (embed.thumbnail?.url && !header.length) return null;
  appendGroup(components, withThumbnail(header, embed.thumbnail?.url));
  for (const field of embed.fields || []) {
    if (!onlyKeys(field, ['name', 'value', 'inline']) || typeof field?.name !== 'string' || typeof field.value !== 'string') return null;
    // Source values stay literal, including multiline quotes/code/customer text.
    appendGroup(components, [text(`### ${field.name}\n${field.value}`)]);
  }
  if (embed.image?.url) appendGroup(components, [{ type: 12, items: [{ media: { url: embed.image.url } }] }]);
  const footer = [];
  if (embed.footer?.text) footer.push(`-# ${embed.footer.text}`);
  if (embed.timestamp) {
    const milliseconds = Date.parse(embed.timestamp);
    if (!Number.isFinite(milliseconds)) return null;
    footer.push(`-# <t:${Math.floor(milliseconds / 1000)}:f>`);
  }
  if (embed.footer?.icon_url && !footer.length) return null;
  if (footer.length) appendGroup(components, withThumbnail([text(footer.join('\n'))], embed.footer?.icon_url), 1);
  if (!components.length) return null;
  return { type: 17, ...(embed.color != null ? { accent_color: embed.color } : {}), components };
}

/**
 * Explicit opt-in for source-owned feature replies. Never install this as an
 * automatic legacy/history converter: setting IsComponentsV2 is irreversible.
 * The caller owns the selected renderer and any edit migration of its message.
 * Unsupported/oversized input stays in its original supported embed format.
 */
export function buildLegacyFeatureCard(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.embeds) || !payload.embeds.length) return payload;
  if (payload.poll || payload.stickers || payload.sticker_ids || payload.tts || payload.voice_message) return payload;
  const flags = Number(payload.flags?.bitfield ?? payload.flags ?? 0);
  if (!Number.isSafeInteger(flags) || (flags & MessageFlags.IsComponentsV2)) return payload;
  try {
    const rows = (payload.components || []).map(json);
    // Opt-in supports legacy interactive rows only; pre-existing V2 shapes and
    // future component families must be handled by their own feature renderer.
    if (rows.some(row => row.type !== 1 || !Array.isArray(row.components) || row.components.length > 5
      || !row.components.length || !(row.components.every(child => child.type === 2)
        || (row.components.length === 1 && [3, 5, 6, 7, 8].includes(row.components[0].type))))) return payload;
    const cards = payload.embeds.map(embed => convertEmbed(json(embed)));
    if (cards.some(card => !card)) return payload;
    const components = [...(payload.content ? [text(payload.content)] : []), ...cards, ...rows];
    let characters = 0;
    let valid = true;
    const shownAttachments = new Set();
    let embedMentions = false;
    const visit = node => {
      if (node.type === 10) {
        if (typeof node.content !== 'string' || !node.content.length || node.content.length > 4000) valid = false;
        else characters += node.content.length;
      }
      for (const url of [node.media?.url, node.file?.url, ...(node.items || []).map(item => item.media?.url)]) {
        if (url?.startsWith('attachment://')) shownAttachments.add(url.slice('attachment://'.length));
      }
      for (const child of node.components || []) visit(child);
      if (node.accessory) visit(node.accessory);
    };
    components.forEach(visit);
    const findMentions = node => {
      if (node.type === 10 && MENTION.test(node.content)) embedMentions = true;
      for (const child of node.components || []) findMentions(child);
    };
    cards.forEach(findMentions);
    const allowed = payload.allowedMentions ?? payload.allowed_mentions;
    // Mentions inside legacy embeds were display-only. TextDisplay mentions
    // can notify members, so a layout upgrade must never activate new pings.
    // Explicit ambiguous policies and implicit content mentions keep the
    // original representation rather than guessing notification recipients.
    if ((!allowed && typeof payload.content === 'string' && MENTION.test(payload.content))
      || (hasActiveMentions(allowed) && embedMentions)) return payload;
    // Unlike legacy messages, V2 does not automatically display attachments.
    // Keep the original payload if conversion would hide even one document.
    for (const attachment of [...(payload.attachments || []), ...(payload.files || [])]) {
      const name = attachment?.filename || attachment?.name;
      if (!name || !shownAttachments.has(name)) return payload;
    }
    if (!valid || characters > 4000 || countDiscordComponents(components) > 40) return payload;
    return normalizeDiscordV2Layout({ ...payload, content: null, embeds: [], components,
      ...(!allowed ? { allowedMentions: { parse: [] } } : {}),
      flags: flags | MessageFlags.IsComponentsV2 | (payload.ephemeral === true ? MessageFlags.Ephemeral : 0) });
  } catch {
    // Conversion may not make a previously valid feature response unavailable.
    return payload;
  }
}
