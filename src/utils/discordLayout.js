import { ComponentType, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';

export const DISCORD_MESSAGE_COMPONENT_LIMIT = 40;

const TEXT = ComponentType.TextDisplay;
const SECTION = ComponentType.Section;
const ROW = ComponentType.ActionRow;
const CONTAINER = ComponentType.Container;
const SEPARATOR = ComponentType.Separator;
const MEDIA = new Set([ComponentType.MediaGallery, ComponentType.File]);
const CONTENT = new Set([TEXT, SECTION, ...MEDIA]);
const CONTAINER_CHILDREN = new Set([ROW, ...CONTENT, SEPARATOR]);
const ROOT_CHILDREN = new Set([...CONTAINER_CHILDREN, CONTAINER]);
const SELECTS = new Set([
  ComponentType.StringSelect, ComponentType.UserSelect, ComponentType.RoleSelect,
  ComponentType.MentionableSelect, ComponentType.ChannelSelect,
]);
const json = value => value?.toJSON?.() || value;

/** Count actual components, including section accessories and buttons/selects.
 * Gallery items and select options are data, not additional components. */
export function countDiscordComponents(components = []) {
  return components.reduce((total, value) => {
    const node = json(value);
    if (!node || typeof node !== 'object') return total;
    return total + 1 + countDiscordComponents(node.components || [])
      + (node.accessory ? countDiscordComponents([node.accessory]) : 0);
  }, 0);
}

function supportedNode(value, parent) {
  const node = json(value);
  if (!node || !(parent === 'root' ? ROOT_CHILDREN : CONTAINER_CHILDREN).has(node.type)) return false;
  if (node.type === CONTAINER) {
    return Array.isArray(node.components) && node.components.every(child => supportedNode(child, 'container'));
  }
  if (node.type === SECTION) {
    const accessory = json(node.accessory);
    return Array.isArray(node.components) && node.components.length >= 1 && node.components.length <= 3
      && node.components.every(child => json(child)?.type === TEXT)
      && [ComponentType.Button, ComponentType.Thumbnail].includes(accessory?.type);
  }
  if (node.type === ROW) {
    const children = node.components?.map(json);
    return Array.isArray(children) && children.length >= 1 && children.length <= 5
      && (children.every(child => child?.type === ComponentType.Button)
        || (children.length === 1 && SELECTS.has(children[0]?.type)));
  }
  // Unknown/nested component shapes must not be decorated speculatively.
  return !node.components && !node.accessory;
}

function footer(node) {
  if (node?.type === SECTION) return node.components.length > 0 && node.components.every(footer);
  if (node?.type !== TEXT || typeof node.content !== 'string') return false;
  const lines = node.content.split('\n').filter(line => line.trim());
  return lines.length > 0 && lines.every(line => /^-#\s/.test(line));
}

function detailRow(node) {
  return node?.type === TEXT && typeof node.content === 'string' && !node.content.includes('\n')
    && /^(?:>\s*)?(?:<a?:\w+:\d+>\s*)?\*\*[^*\n]+\*\*\s*:?\s*\S/.test(node.content);
}

function separatorBetween(before, after) {
  if (!before || !after || before.type === SEPARATOR || after.type === SEPARATOR) return null;
  // Discord already spaces individual cards and adjacent button rows. Never
  // insert separators inside a Section or ActionRow; their topology is fixed.
  if (after.type === CONTAINER || (before.type === CONTAINER && after.type !== ROW)) return null;
  if (before.type === ROW) return null;
  if (!CONTENT.has(before.type) && before.type !== CONTAINER) return null;
  if (!CONTENT.has(after.type) && after.type !== ROW) return null;
  // A short section label belongs to the following paragraph (for example a
  // review's "Khách hàng chia sẻ" heading and the customer's literal comment).
  if (before.type === TEXT && after.type === TEXT && /^###[\t ]+[^\n]+$/.test(before.content)) return null;
  if (detailRow(before) && detailRow(after)) return null;
  const size = footer(after) ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Large;
  const divider = after.type !== ROW && !MEDIA.has(before.type) && !MEDIA.has(after.type);
  return new SeparatorBuilder().setDivider(divider).setSpacing(size).toJSON();
}

/**
 * Presentation-only rhythm for native Components V2 messages.
 *
 * It NEVER edits text/Markdown, embeds, images, files, interactions, mentions or
 * identifiers. Customer comments, delivered secrets, code fences and quotes
 * remain literal. Content grouping/Markdown belongs in each feature renderer.
 * Only native separators are added, or visible separator padding is improved.
 * Explicit invisible separators remain an intentional renderer decision.
 *
 * V2 edits sometimes omit flags: native component types are sufficient evidence.
 * Legacy content/embed messages and unsupported topology are left untouched.
 * A shared 40-component budget includes all nested controls and accessories;
 * when full, existing content/actions win and optional spacing is skipped.
 */
export function normalizeDiscordV2Layout(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.components)) return payload;
  if (payload.content || payload.embeds?.length) return payload;
  const components = payload.components.map(json);
  const flags = Number(payload.flags?.bitfield ?? payload.flags ?? 0);
  const nativeV2 = Boolean(flags & MessageFlags.IsComponentsV2)
    || components.some(node => node?.type !== ROW && ROOT_CHILDREN.has(node?.type));
  if (!nativeV2 || !components.every(node => supportedNode(node, 'root'))) return payload;
  const count = countDiscordComponents(components);
  if (count > DISCORD_MESSAGE_COMPONENT_LIMIT) return payload;
  let remaining = DISCORD_MESSAGE_COMPONENT_LIMIT - count;

  const sequence = values => {
    const nodes = values.map(value => {
      const node = json(value);
      return node.type === CONTAINER ? { ...node, components: sequence(node.components) } : node;
    });
    const result = [];
    for (let index = 0; index < nodes.length; index += 1) {
      let node = nodes[index];
      const before = nodes[index - 1];
      const after = nodes[index + 1];
      if (node.type === SEPARATOR && node.divider !== false
        && before && after && CONTENT.has(before.type) && CONTENT.has(after.type)) {
        node = { ...node, spacing: footer(after) ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Large };
      }
      const separator = separatorBetween(before, node);
      if (separator && remaining > 0) {
        result.push(separator);
        remaining -= 1;
      }
      result.push(node);
    }
    return result;
  };
  return { ...payload, components: sequence(components) };
}
