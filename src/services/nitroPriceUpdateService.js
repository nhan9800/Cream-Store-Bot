import { ChannelType } from 'discord.js';
import { config } from '../config.js';
import { STORE_FORUMS } from '../config/storeForums202611.js';
import { getActiveProducts } from './productCatalogService.js';
import { getGuildConfig } from './guildConfigService.js';
import { getCoreEmojiPackStatus } from './coreEmojiPackService.js';
import { buildPriceForumEntries } from './autoSetupPriceBoardService.js';
import { listForumPosts } from './forumPublicationService.js';
import { withOwnerMessageEdit } from '../utils/manualAnnouncementWrite.js';
import { formatCurrency } from '../utils/formatters.js';

export const NITRO_RENEWAL_KEY = 'discord-nitro-boost-12-months-auto-renew-2-months';
const noMentions = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });
let health = Object.freeze({ status: 'NOT_STARTED' });
const flights = new WeakMap();
export const getNitroPriceUpdateHealth = () => ({ ...health });
const fail = code => { throw Object.assign(new Error('Nitro price update requires review'), { code }); };

function canonicalProduct(guildId) {
  const product = getActiveProducts(guildId).find(row => row.product_key === NITRO_RENEWAL_KEY);
  if (!product || product.price !== 650000 || product.duration_months !== 12 || product.is_active !== 1) fail('NITRO_CATALOG_CHANGED');
  return product;
}
function hasOffer(message, product) {
  const text = [], controls = [];
  const visit = value => {
    const node = value?.toJSON?.() || value;
    if (!node || typeof node !== 'object') return;
    if (typeof node.content === 'string') text.push(node.content);
    if (node.custom_id === 'product:select') controls.push(...(node.options || []).map(option => option.value));
    for (const child of node.components || []) visit(child);
  };
  for (const component of message?.components || []) visit(component);
  return controls.includes(String(product.id)) && text.some(shown => shown.includes(product.name)
    && shown.includes(`**Giá bán:** \`${formatCurrency(650000)}\``)
    && shown.includes('**Thời hạn:** `12 tháng`') && shown.includes(product.description));
}

/** Edit only the existing Nitro starter. This never creates posts or transactions. */
export function runNitroPriceUpdate(client, { guildId = config.guildId, envFile = process.env.ENV_FILE } = {}) {
  if (guildId !== STORE_FORUMS.guildId || config.guildId !== guildId || envFile !== '.env' || process.env.ENV_FILE !== '.env') {
    return Promise.resolve({ status: 'SKIPPED_OTHER_STORE' });
  }
  if (!client?.isReady?.() || client.user?.id !== config.clientId || getCoreEmojiPackStatus(client).status !== 'ready') {
    return Promise.resolve({ status: 'NOT_READY' });
  }
  if (flights.has(client)) return flights.get(client);
  const task = (async () => {
    try {
      canonicalProduct(guildId);
      const guild = await client.guilds.fetch(guildId);
      if (guild?.id !== guildId || guild.client?.user?.id !== client.user.id) fail('NITRO_GUILD_UNVERIFIED');
      const forum = await guild.channels.fetch(STORE_FORUMS.priceForumId);
      if (forum?.id !== STORE_FORUMS.priceForumId || forum.type !== ChannelType.GuildForum || forum.guildId !== guildId) fail('NITRO_FORUM_UNVERIFIED');
      const entry = buildPriceForumEntries(guildId, getGuildConfig(guildId)).find(row => row.key === 'nitro');
      if (entry?.payloads?.length !== 1) fail('NITRO_LAYOUT_REVIEW');
      const posts = await listForumPosts(forum);
      const matches = [...posts.values()].filter(post => post.name === entry.name && post.ownerId === client.user.id
        && post.parentId === forum.id && post.guildId === guildId);
      if (matches.length !== 1) fail('NITRO_POST_UNVERIFIED');
      const thread = matches[0];
      if (thread.archived) await thread.setArchived(false);
      const starter = await thread.messages.fetch({ message: thread.id, force: true });
      if (starter?.id !== thread.id || starter.channelId !== thread.id || starter.author?.id !== client.user.id || starter.webhookId) fail('NITRO_MESSAGE_UNVERIFIED');
      const product = canonicalProduct(guildId);
      const expected = { status: 'CURRENT', channelId: thread.id, messageId: starter.id,
        url: `https://discord.com/channels/${guildId}/${thread.id}/${starter.id}`,
        productKey: NITRO_RENEWAL_KEY, price: 650000, totalMonths: 12, renewalCycleMonths: 2 };
      if (hasOffer(starter, product)) { health = Object.freeze(expected); return getNitroPriceUpdateHealth(); }
      // Rendering uses the final canonical catalog after all awaited reads.
      const currentEntry = buildPriceForumEntries(guildId, getGuildConfig(guildId)).find(row => row.key === 'nitro');
      if (currentEntry?.name !== entry.name || currentEntry.payloads.length !== 1) fail('NITRO_LAYOUT_REVIEW');
      const payload = { ...currentEntry.payloads[0], allowedMentions: noMentions };
      const updated = await withOwnerMessageEdit({ rest: client.rest, channelId: thread.id, messageId: starter.id }, () => starter.edit(payload));
      if (updated?.id !== starter.id || updated.channelId !== thread.id || updated.author?.id !== client.user.id || !hasOffer(updated, product)) fail('NITRO_UPDATE_UNVERIFIED');
      health = Object.freeze({ ...expected, status: 'UPDATED' });
    } catch (error) {
      health = Object.freeze({ status: 'REVIEW_REQUIRED', code: /^NITRO_[A-Z_]+$/.test(error?.code || '') ? error.code : 'NITRO_UPDATE_FAILED' });
    }
    console.log('[NITRO-PRICE-UPDATE]', JSON.stringify(health));
    return getNitroPriceUpdateHealth();
  })().finally(() => flights.delete(client));
  flights.set(client, task); return task;
}
