import { createHash } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { SHOP_RELAUNCH, readShopRelaunchProducts } from './shopRelaunch20261113.js';
import { createUniqueCustomEmojiResolver } from '../utils/uniqueCustomEmoji.js';
import { normalizeMessagePresentation } from '../utils/discordEmojiBoundary.js';

export const COMPACT_SALE = Object.freeze({
  revision: 'CENAR-COMPACT-SALE-20261113',
  guildId: SHOP_RELAUNCH.guildId,
  channelId: SHOP_RELAUNCH.channelId,
  messageIds: Object.freeze(['1570837979306528850', '1570837982162853989', '1570837985631412446']),
});
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => String(value || '').replace(/<a?:\w+:\d+>|:[A-Za-z_][A-Za-z0-9_]*:/g, '')
  .replace(/\p{Extended_Pictographic}|[\uFE0E\uFE0F\u200D]/gu, '').replace(/@/g, '＠')
  .replace(/[\r\n]+/g, ' ').replace(/([\\`*_~|<>])/g, '\\$1').trim();
const money = value => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
const nameKey = value => String(value || '').trim().toLocaleLowerCase('vi-VN');
const publicProduct = product => ({ id: product.id, key: product.key, name: product.name,
  price: product.price, originalPrice: product.originalPrice, durationMonths: product.durationMonths,
  category: product.category, service_type: product.service_type, warranty: product.warranty,
  completedUnits: product.completedUnits, completedOrders: product.completedOrders });
const stableProduct = ({ completedUnits, completedOrders, ...product }) => product;

function family(product) {
  const name = nameKey(product.name);
  for (const key of ['nitro', 'decor', 'chatgpt', 'gemini', 'claude', 'adobe', 'capcut', 'spotify', 'youtube', 'netflix', 'locket']) {
    if (name.includes(key)) return key;
  }
  return name.split(/[ (·]/)[0];
}

/** Private operator projection: CTV prices never enter public cards or health. */
export function readCompactSaleRanking(dbInstance) {
  const products = readShopRelaunchProducts(dbInstance);
  const byId = new Map(products.map(product => [product.id, product]));
  const byName = new Map();
  for (const product of products) {
    const key = nameKey(product.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(product);
  }
  const stats = new Map();
  const rows = dbInstance.prepare(`SELECT product_id, product_name, duration_months,
      SUM(COALESCE(quantity,1)) AS units, COUNT(*) AS orders
    FROM orders WHERE guild_id=? AND payment_status='PAID' AND status='COMPLETED'
      AND COALESCE(fulfillment_mode,'LEGACY')!='SUPPLIER'
      AND total_amount>0 AND amount_paid>=total_amount AND COALESCE(quantity,1)>0
    GROUP BY product_id, LOWER(TRIM(product_name)), duration_months`).all(COMPACT_SALE.guildId);
  for (const row of rows) {
    let product = row.product_id == null ? null : byId.get(Number(row.product_id));
    // A conflicting/stale non-null ID is not silently reassigned by name.
    if (!product && row.product_id == null) {
      let candidates = byName.get(nameKey(row.product_name)) || [];
      if (candidates.length > 1) candidates = candidates.filter(item => item.durationMonths === Number(row.duration_months));
      if (candidates.length === 1) [product] = candidates;
    }
    if (!product || !Number.isSafeInteger(row.units) || row.units < 1 || !Number.isSafeInteger(row.orders) || row.orders < 1) continue;
    const current = stats.get(product.id) || { completedUnits: 0, completedOrders: 0 };
    current.completedUnits += row.units;
    current.completedOrders += row.orders;
    if (Number.isSafeInteger(current.completedUnits) && Number.isSafeInteger(current.completedOrders)) stats.set(product.id, current);
  }
  const ctv = dbInstance.prepare('SELECT id,ctv_price FROM product_catalog').all();
  const ctvById = new Map(ctv.map(row => [Number(row.id), Number.isSafeInteger(row.ctv_price) && row.ctv_price > 0 ? row.ctv_price : null]));
  return products.filter(product => stats.has(product.id)).map(product => ({ ...product, ...stats.get(product.id),
    ctvPrice: ctvById.get(product.id) ?? null }))
    .sort((a, b) => b.completedUnits - a.completedUnits || b.completedOrders - a.completedOrders || a.id - b.id);
}

function selectProducts(ranking, selection) {
  if (selection !== undefined) {
    if (!Array.isArray(selection) || !selection.length || selection.length > 6
      || selection.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(selection).size !== selection.length) throw fail('COMPACT_SELECTION_INVALID');
    const byId = new Map(ranking.map(product => [product.id, product]));
    if (selection.some(id => !byId.has(id))) throw fail('COMPACT_SELECTION_NOT_PURCHASED');
    return selection.map(id => byId.get(id));
  }
  const chosen = [], families = new Map();
  for (const product of ranking) {
    const key = family(product);
    if ((families.get(key) || 0) >= 2) continue;
    chosen.push(product); families.set(key, (families.get(key) || 0) + 1);
    if (chosen.length === 6) break;
  }
  if (!chosen.length) throw fail('COMPACT_NO_COMPLETED_PRODUCTS');
  return chosen;
}

function projectedProducts(products, overrides) {
  const prices = overrides instanceof Map ? overrides : new Map(Object.entries(overrides || {}).map(([id, price]) => [Number(id), price]));
  if ([...prices.keys()].some(id => !products.some(product => product.id === id))) throw fail('COMPACT_PRICE_OVERRIDE_UNKNOWN');
  return products.map(product => {
    if (!prices.has(product.id)) return publicProduct(product);
    const price = prices.get(product.id), cut = product.price - price;
    if (!Number.isSafeInteger(price) || price < 1 || cut < 0 || cut > 5000 || cut * 100 > product.price * 3) throw fail('COMPACT_PRICE_CUT_TOO_LARGE');
    return publicProduct({ ...product, price,
      originalPrice: cut > 0 && !product.originalPrice ? product.price : product.originalPrice });
  });
}

function productSlot(product) {
  return ({ nitro: 'brand_nitro', decor: 'icon_sparkle', chatgpt: 'brand_chatgpt', gemini: 'brand_gemini', claude: 'icon_brain',
    capcut: 'brand_capcut', adobe: 'brand_adobe', spotify: 'music_wave', youtube: 'music_play', netflix: 'icon_video', locket: 'icon_heart' })[family(product)] || 'order_product';
}

function emojiAudit(payloads) {
  const ids = [], text = [];
  const visit = node => {
    if (node.content) { text.push(node.content); ids.push(...[...node.content.matchAll(/<a?:\w+:(\d+)>/g)].map(match => match[1])); }
    if (node.emoji?.id) ids.push(String(node.emoji.id));
    for (const child of node.components || []) visit(child);
  };
  payloads.forEach(payload => payload.components.forEach(visit));
  if (!ids.length || new Set(ids).size !== ids.length || /\p{Extended_Pictographic}/u.test(text.join('\n'))) throw fail('COMPACT_CUSTOM_EMOJI_NOT_UNIQUE');
  return { customEmojiCount: ids.length, uniqueEmojiCount: new Set(ids).size, nativeEmojiCount: 0 };
}

export function buildCompactSalePayloads({ products, E }) {
  if (!products?.length || products.length > 6) throw fail('COMPACT_SELECTION_INVALID');
  const unique = createUniqueCustomEmojiResolver(COMPACT_SALE.guildId, { seed: COMPACT_SALE.revision, resolver: E });
  const icon = (slot, purpose) => {
    const token = unique(slot, purpose);
    if (!/^<a?:\w+:\d{17,20}>$/.test(token || '')) throw fail('COMPACT_CUSTOM_EMOJI_NOT_READY');
    return token;
  };
  const titles = ['GÓI TIÊU BIỂU · DỄ CHỌN HƠN', 'GIÁ GỌN · NHU CẦU RÕ', 'CHỌN ĐÚNG GÓI · MUA RÕ ĐIỀU KIỆN'];
  const accents = [0xB6A0F5, 0x78D2BC, 0xEDBA77];
  const headers = ['icon_gem', 'icon_price', 'warranty_shield'];
  const payloads = titles.map((title, page) => {
    const components = [{ type: 10, content: `# ${icon(headers[page], `heading-${page}`)} ${title}` }];
    if (page === 0) components.push({ type: 10, content: 'Một số gói được chọn nhiều trong các đơn đã hoàn tất và thanh toán của shop. Bảng này giữ gọn các lựa chọn tiêu biểu; xem đầy đủ tại nút bên dưới.' });
    for (const product of products.slice(page * 2, page * 2 + 2)) {
      if (!Number.isSafeInteger(product.price) || product.price < 1 || !Number.isSafeInteger(product.completedUnits) || product.completedUnits < 1) throw fail('COMPACT_PRODUCT_INVALID');
      const price = product.originalPrice > product.price
        ? `~~${money(product.originalPrice)}~~ **${money(product.price)}**` : `**${money(product.price)}**`;
      const warranty = product.warranty ? `\n${icon('panel_warranty', `warranty-${product.id}`)} ${plain(product.warranty).slice(0, 130)}` : '';
      components.push({ type: 14, divider: true, spacing: 1 }, { type: 10,
        content: `## ${icon(productSlot(product), `product-${product.id}`)} ${plain(product.name).slice(0, 150)}\n`
          + `${icon('payment_money', `price-${product.id}`)} ${price}${warranty}` });
    }
    if (page === 2) components.push({ type: 14, divider: true, spacing: 1 }, { type: 10,
      content: `${icon('status_info', 'autobuy-copy')} **AutoBuy có khu riêng:** <#${SHOP_RELAUNCH.autobuyChannelId}>\nXem hình thức, thời hạn và bảo hành trước khi xác nhận. Đơn thanh toán trước có thể chờ shop bổ sung nguồn; theo dõi bằng mã đơn.` });
    const action = (slot, label, url, key) => {
      const emoji = unique.component(slot, key);
      if (!emoji) throw fail('COMPACT_CUSTOM_EMOJI_NOT_READY');
      return { type: 2, style: 5, label, url, emoji };
    };
    components.push({ type: 1, components: [
      action('ticket_open', 'Mở ticket chọn gói', `https://discord.com/channels/${COMPACT_SALE.guildId}/${SHOP_RELAUNCH.supportChannelId}`, `ticket-${page}`),
      action('icon_store', 'Xem toàn bộ bảng giá', `https://discord.com/channels/${COMPACT_SALE.guildId}/${SHOP_RELAUNCH.priceForumId}`, `prices-${page}`),
      action('icon_cart', 'Mở AutoBuy', `https://discord.com/channels/${COMPACT_SALE.guildId}/${SHOP_RELAUNCH.autobuyChannelId}`, `autobuy-${page}`),
    ] }, { type: 10, content: `-# ${SHOP_RELAUNCH.revision}:PART-${page + 1} · ${COMPACT_SALE.revision}:PART-${page + 1}` });
    return normalizeMessagePresentation({ flags: MessageFlags.IsComponentsV2,
      components: [{ type: 17, accent_color: accents[page], components }],
      allowedMentions: { parse: [], roles: [], users: [], repliedUser: false } }, COMPACT_SALE.guildId);
  });
  emojiAudit(payloads);
  for (const payload of payloads) {
    let count = 0, characters = 0;
    const walk = node => { count++; characters += node.content?.length || 0; for (const child of node.components || []) walk(child); };
    payload.components.forEach(walk);
    if (count > 40 || characters > 4000) throw fail('COMPACT_DISCORD_LIMIT');
  }
  return payloads;
}

export function prepareCompactSale({ dbInstance, E, selection, priceOverrides } = {}) {
  const ranking = readCompactSaleRanking(dbInstance);
  const chosen = selectProducts(ranking, selection);
  const selectedProducts = projectedProducts(chosen, priceOverrides);
  const payloads = buildCompactSalePayloads({ products: selectedProducts, E });
  const stable = selectedProducts.map(stableProduct);
  return { revision: COMPACT_SALE.revision, selection: chosen.map(product => product.id), selectedProducts,
    priceHash: hash(stable), previewHash: hash({ revision: COMPACT_SALE.revision, products: stable, payloads }),
    emojiAudit: emojiAudit(payloads), payloads };
}

export const compactSaleInternals = Object.freeze({ hash, emojiAudit, stableProduct });
