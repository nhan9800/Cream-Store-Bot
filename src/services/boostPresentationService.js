import {
  ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';

export const BOOST_PRESENTATION_VERSION = 'CENAR-BOOST-UI-V2-20261002';
export const BOOST_PRESENTATION_COLORS = Object.freeze({ teal: 0x184A49, copper: 0xBA7045 });
export const BOOST_SILENT_MENTIONS = Object.freeze({ parse: [], roles: [], users: [], repliedUser: false });

export function boostPresentationPanel(color, sections, actions = null) {
  const panel = new ContainerBuilder().setAccentColor(color);
  sections.filter(Boolean).forEach((text, index) => {
    if (index) panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  });
  if (actions?.components?.length) panel.addActionRowComponents(actions);
  return panel;
}

function flatten(components) {
  return components.flatMap((component) => [component, ...flatten(component.components || [])]);
}

/**
 * Recompose a historical boost event from its original presentation only.
 * The caller supplies verified emoji replacements; customer values, financial
 * status, action text, dates and button IDs are never looked up from live orders.
 * Return null for an unsupported or oversized log so the repair service can
 * preserve its original embed and only repair emoji references.
 */
export function buildHistoricalBoostLogPayload(embed, { components = [], normalizeText = (text) => String(text ?? '') } = {}) {
  if (!embed || embed.author || embed.url || embed.image || embed.thumbnail || embed.footer?.icon_url
    || components.some((component) => component.type !== 1)) return null;
  const title = normalizeText(embed.title || 'BOOST SERVER · NHẬT KÝ');
  const fields = (embed.fields || []).map((field) => `### ${normalizeText(field.name)}\n${normalizeText(field.value)}`);
  const timestamp = embed.timestamp ? Date.parse(embed.timestamp) : null;
  if (embed.timestamp && !Number.isFinite(timestamp)) return null;
  const footer = [embed.footer?.text ? normalizeText(embed.footer.text) : null,
    timestamp !== null ? `Thời điểm ghi nhận: <t:${Math.floor(timestamp / 1000)}:F>` : null].filter(Boolean).join('\n');
  if ([title, embed.description ? normalizeText(embed.description) : '', ...fields, footer].join('\n').length > 3900) return null;
  const cards = [boostPresentationPanel(embed.color ?? BOOST_PRESENTATION_COLORS.teal,
    [`## ${title}`, embed.description ? normalizeText(embed.description) : null])];
  if (fields.length) cards.push(boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, fields));
  if (footer) cards.push(boostPresentationPanel(BOOST_PRESENTATION_COLORS.copper, [`-# ${footer}`]));
  let json;
  try { json = cards.map((card) => card.toJSON()); } catch { return null; }
  const all = flatten([...json, ...components]);
  if (all.length > 40 || all.filter((item) => item.type === 10).reduce((sum, item) => sum + item.content.length, 0) > 4000) return null;
  return {
    content: null, embeds: [], components: [...cards, ...components],
    flags: MessageFlags.IsComponentsV2, allowedMentions: BOOST_SILENT_MENTIONS,
  };
}
