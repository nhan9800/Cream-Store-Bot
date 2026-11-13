import { createHash } from 'node:crypto';
import { MessageFlags } from 'discord.js';

// Deliberate owner-authorized release. Never enable the historical campaign timers.
export const SHOP_RELAUNCH = Object.freeze({
  revision: 'CENAR-SHOP-RELAUNCH-20261113',
  guildId: '1282637033340403754', channelId: '1515008584549797979',
  memberRoleId: '1282638730812854345', supportChannelId: '1514607020098191393',
  announcementChannelId: '1514598369597587546', autobuyChannelId: '1569729564115206214',
  priceForumId: '1568246895812280350', dateLabel: '13/11/2026',
});

const themes = [
  { title: 'GÓC DISCORD · LÊN GU CỦA BẠN', slot: 'brand_nitro', color: 0xB6A0F5,
    lead: 'Nitro, nâng cấp máy chủ và trang trí hồ sơ. Chọn đúng gói đang cần, xem rõ giá trước khi đặt.' },
  { title: 'BÀN LÀM VIỆC · THÊM CÔNG CỤ', slot: 'icon_brain', color: 0x78D2BC,
    lead: 'AI, dựng video và lưu trữ — từng lựa chọn có giá riêng, điều kiện riêng.' },
  { title: 'KHOẢNG NGHỈ · CHỌN NHỊP RIÊNG', slot: 'brand_spotify', color: 0xEDBA77,
    lead: 'Một playlist, bộ phim hoặc góc sáng tạo mới. Chọn thời hạn hợp nhu cầu của bạn.' },
];
const groups = [
  [0, 'brand_nitro', 'NITRO BOOST', p => /nitro/i.test(p.name)],
  [0, 'brand_boost', 'NÂNG CẤP MÁY CHỦ', p => /server.?boost|boost.?server/i.test(p.name)],
  [0, 'promo_decor', 'DECOR & GIFT', p => p.service_type === 'decor' || /decor/i.test(p.name)],
  [1, 'brand_chatgpt', 'CHATGPT', p => /chat\s*gpt/i.test(p.name)],
  [1, 'brand_gemini', 'GEMINI & GOOGLE ONE', p => /gemini/i.test(p.name)],
  [1, 'brand_claude', 'CLAUDE', p => /claude/i.test(p.name)],
  [1, 'brand_adobe', 'ADOBE', p => /adobe/i.test(p.name)],
  [1, 'brand_capcut', 'CAPCUT PRO', p => /capcut/i.test(p.name)],
  [1, 'brand_office', 'OFFICE & LƯU TRỮ', p => /office|onedrive/i.test(p.name)],
  [2, 'brand_spotify', 'SPOTIFY PREMIUM', p => /spotify/i.test(p.name)],
  [2, 'brand_youtube', 'YOUTUBE PREMIUM', p => /youtube/i.test(p.name)],
  [2, 'brand_netflix', 'NETFLIX', p => /netflix/i.test(p.name)],
  [2, 'icon_heart', 'LOCKET', p => /locket/i.test(p.name)],
  [2, 'icon_store', 'DỊCH VỤ KHÁC', () => true],
];
const token = /^<a?:[A-Za-z0-9_]+:\d{17,20}>$/;
// Product logos may live in limited guild slots. Every alternative is still a
// live custom icon from the sourced application pack; never use Unicode.
const customAlternatives = Object.freeze({
  brand_nitro: 'icon_gem', brand_boost: 'icon_fire', promo_decor: 'icon_sparkle',
  brand_chatgpt: 'icon_brain', brand_gemini: 'icon_sparkle', brand_claude: 'icon_brain',
  brand_adobe: 'icon_book', brand_capcut: 'music_play', brand_office: 'icon_doc',
  brand_spotify: 'music_wave', brand_youtube: 'music_play', brand_netflix: 'music_play',
});
const plain = value => String(value || '').replace(/<a?:\w+:\d+>/g, '')
  .replace(/\p{Extended_Pictographic}|[\uFE0F\u200D]/gu, '').replace(/@/g, '＠')
  .replace(/[\r\n]+/g, ' ').replace(/([\\`*_~|<>])/g, '\\$1').trim();
const money = value => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
export const shopRelaunchHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function readShopRelaunchProducts(database) {
  const read = guild => database.prepare(`SELECT * FROM product_catalog WHERE guild_id = ? AND is_active = 1
    ORDER BY sort_order ASC, id ASC`).all(guild);
  const web = read('WEB');
  const products = web.length ? web : read(SHOP_RELAUNCH.guildId);
  return products.map(p => ({
    id: Number(p.id), key: String(p.product_key || p.id), name: String(p.name),
    price: Number(p.price), originalPrice: Number(p.original_price || 0),
    durationMonths: Number(p.duration_months), service_type: String(p.service_type || ''),
    warranty: String(p.warranty_policy || ''), category: String(p.service_type || ''),
  })).filter(p => Number.isSafeInteger(p.price) && p.price > 0);
}

function checkedEmoji(E, slot) {
  const primary = E?.(slot);
  const value = token.test(primary || '') ? primary : customAlternatives[slot] ? E?.(customAlternatives[slot]) : '';
  if (!token.test(value || '')) throw Object.assign(new Error(`RELAUNCH_CUSTOM_EMOJI_MISSING:${slot}`), { code: 'RELAUNCH_CUSTOM_EMOJI_MISSING' });
  return value;
}

function productLine(product, priceEmoji) {
  const price = product.originalPrice > product.price
    ? `~~${money(product.originalPrice)}~~ **${money(product.price)}**` : `**${money(product.price)}**`;
  const warranty = product.warranty ? ` · ${plain(product.warranty).slice(0, 75)}` : '';
  return `${priceEmoji} ${plain(product.name).slice(0, 130)} — ${price}${warranty}`;
}

function buttons(E) {
  const button = (slot, label, url) => {
    const match = checkedEmoji(E, slot).match(/^<(a?):(\w+):(\d+)>$/);
    return { type: 2, style: 5, label, url,
      emoji: { id: match[3], name: match[2], animated: match[1] === 'a' } };
  };
  return { type: 1, components: [
    button('ticket_open', 'Mở ticket chọn gói', `https://discord.com/channels/${SHOP_RELAUNCH.guildId}/${SHOP_RELAUNCH.supportChannelId}`),
    button('icon_store', 'Bảng giá đầy đủ', `https://discord.com/channels/${SHOP_RELAUNCH.guildId}/${SHOP_RELAUNCH.priceForumId}`),
    button('icon_web', 'Mua trên website', 'https://cenarstore.xyz/products'),
  ] };
}

export function buildShopRelaunchPayloads({ products, E }) {
  if (!products?.length) throw Object.assign(new Error('RELAUNCH_CATALOG_EMPTY'), { code: 'RELAUNCH_CATALOG_EMPTY' });
  const priceEmoji = checkedEmoji(E, 'icon_price');
  const announce = checkedEmoji(E, 'icon_announce');
  const shield = checkedEmoji(E, 'warranty_shield');
  const check = checkedEmoji(E, 'status_check');
  const actions = buttons(E);
  const assigned = new Set();
  const pages = [];
  for (const [themeIndex, theme] of themes.entries()) {
    const sections = [];
    for (const [groupTheme, slot, title, matches] of groups) {
      if (groupTheme !== themeIndex) continue;
      const entries = products.filter(p => !assigned.has(p.id) && matches(p));
      if (!entries.length) continue;
      const heading = `## ${checkedEmoji(E, slot)} ${title}`;
      if (slot === 'promo_decor') {
        entries.forEach(p => assigned.add(p.id));
        const highlights = [/Acc Có Nitro/i, /Acc Không Nitro/i, /Dạng Gift/i, /Combo Gift/i]
          .map(pattern => entries.filter(p => pattern.test(p.name)).sort((a, b) => a.price - b.price)[0]).filter(Boolean);
        sections.push(`${heading}\n${priceEmoji} **${entries.length} lựa chọn Decor/Gift** · từ **${money(Math.min(...entries.map(p => p.price)))}**\n`
          + highlights.map(product => productLine(product, priceEmoji)).join('\n')
          + '\n-# Chọn đúng dạng tài khoản hoặc Gift. Xem toàn bộ mức giá tại Bảng giá đầy đủ.');
        continue;
      }
      let section = heading;
      for (const product of entries) {
        assigned.add(product.id);
        const line = productLine(product, priceEmoji);
        if (section.length + line.length > 2500) { sections.push(section); section = `${heading} · tiếp`; }
        section += `\n${line}`;
      }
      sections.push(section);
    }
    if (!sections.length) continue;
    const title = `# ${checkedEmoji(E, theme.slot)} ${theme.title}\n> ${theme.lead}`;
    let page = { theme, sections: [title] };
    for (const section of sections) {
      if (page.sections.join('\n').length + section.length > 3050) {
        pages.push(page); page = { theme, sections: [title] };
      }
      page.sections.push(section);
    }
    pages.push(page);
  }
  const opening = `<@&${SHOP_RELAUNCH.memberRoleId}>\n# ${announce} CENAR STORE · MỞ MỘT NHỊP MỚI\n`
    + `**BẢNG GIÁ & ƯU ĐÃI HIỆN CÓ · ${SHOP_RELAUNCH.dateLabel}**\n`
    + 'Shop đang cải thiện trải nghiệm mua hàng: chia bảng giá theo nhu cầu, ghi rõ lựa chọn và tập trung hỗ trợ trong ticket riêng.\n'
    + `${check} Giá lấy trực tiếp từ danh mục đang mở bán. Chỉ những gói có giá gốc cao hơn mới hiển thị giá gạch ngang.`;
  const cards = pages;
  cards[0].sections.unshift(opening);
  cards.at(-1).sections.push(`${shield} **Chọn kỹ trước khi mua**\nNitro Trial chỉ dành cho tài khoản đáp ứng điều kiện. Gói CDK/Claude có điều kiện kích hoạt và hoàn tiền riêng; đọc đầy đủ trong ticket. Giá và bảo hành được xác nhận tại bước đặt hàng.`);
  return cards.map((card, index) => {
    const marker = `${SHOP_RELAUNCH.revision}:PART-${index + 1}`;
    const components = [];
    card.sections.forEach((content, i) => {
      if (i) components.push({ type: 14, divider: true, spacing: 1 });
      components.push({ type: 10, content });
    });
    if (index === cards.length - 1) components.push({ type: 14, divider: true, spacing: 1 },
      { type: 10, content: `${check} **CHỌN GÓI → XEM ĐIỀU KIỆN → ĐẶT MUA**\nGiữ mã đơn để tra cứu và hỗ trợ. Thông tin tài khoản chỉ trao đổi trong ticket riêng.` });
    components.push(actions, { type: 10, content: `-# ${marker} · ${index + 1}/${cards.length}` });
    const payload = { flags: MessageFlags.IsComponentsV2,
      components: [{ type: 17, accent_color: card.theme.color, components }],
      allowedMentions: { parse: [], roles: index === 0 ? [SHOP_RELAUNCH.memberRoleId] : [], users: [], repliedUser: false },
      nonce: String(BigInt(`0x${shopRelaunchHash(marker).slice(0, 15)}`)), enforceNonce: true };
    let chars = 0, count = 0;
    const visit = c => { count++; chars += c.content?.length || 0; for (const child of c.components || []) visit(child); };
    payload.components.forEach(visit);
    if (chars > 4000 || count > 40) throw Object.assign(new Error('RELAUNCH_DISCORD_LIMIT'), { code: 'RELAUNCH_DISCORD_LIMIT' });
    return payload;
  });
}

export function buildShopRelaunchNotice({ boardIds, E }) {
  if (!boardIds?.length || boardIds.some(id => !/^\d{17,20}$/.test(String(id)))) throw new Error('RELAUNCH_BOARD_IDS_INVALID');
  const marker = `${SHOP_RELAUNCH.revision}:NOTICE`;
  const announce = checkedEmoji(E, 'icon_announce');
  const check = checkedEmoji(E, 'status_check');
  const cart = checkedEmoji(E, 'icon_cart');
  const components = [
    { type: 10, content: `# ${announce} CENAR STORE · ĐỔI DIỆN MẠO, DỄ CHỌN HƠN\nBảng giá vừa được chia theo nhu cầu: Discord, công cụ làm việc và giải trí. Giao diện dùng emoji custom của shop; giá lấy từ danh mục đang mở bán.` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `${check} **Xem rõ gói · đọc điều kiện · giữ mã đơn**\n[Khám phá bảng giá mới](https://discord.com/channels/${SHOP_RELAUNCH.guildId}/${SHOP_RELAUNCH.channelId}/${boardIds[0]})\n${cart} **Khu AutoBuy:** <#${SHOP_RELAUNCH.autobuyChannelId}> — luồng chọn gói và tạo thanh toán đã được cập nhật. Xem giá và điều kiện trước khi xác nhận. Đơn thanh toán trước có thể chờ shop nạp vốn nhà cung cấp; theo dõi trạng thái đơn và mở ticket riêng khi cần hỗ trợ.` },
    buttons(E), { type: 10, content: `-# ${marker}` },
  ];
  return { flags: MessageFlags.IsComponentsV2, components: [{ type: 17, accent_color: 0x78D2BC, components }],
    allowedMentions: { parse: [], roles: [], users: [], repliedUser: false },
    nonce: String(BigInt(`0x${shopRelaunchHash(marker).slice(0, 15)}`)), enforceNonce: true };
}

export function prepareShopRelaunch({ dbInstance, E }) {
  const priceManifest = readShopRelaunchProducts(dbInstance);
  const payloads = buildShopRelaunchPayloads({ products: priceManifest, E });
  return { revision: SHOP_RELAUNCH.revision, priceManifest, priceHash: shopRelaunchHash(priceManifest),
    payloadHash: shopRelaunchHash(payloads), payloads };
}
