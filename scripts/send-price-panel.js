import '../src/config.js';
import {
  Client, GatewayIntentBits, ChannelType, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import { getEmojiMap, resolveSelectMenuEmoji, resolveProductEmoji } from '../src/services/emojiService.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { config } from '../src/config.js';
import { formatCurrency } from '../src/utils/formatters.js';
import { fmt, subtext } from '../src/utils/embedHelpers.js';

const GUILD_ID = process.env.GUILD_ID;
const DRY = process.argv.includes('--dry');

// Nhóm bảng giá — mỗi nhóm 1 panel + 1 select (Discord giới hạn 25 mục/select)
const GROUPS = [
  { titleSlot: 'brand_nitro',   title: 'Discord Nitro & Server Boost',           match: (p) => ['nitro', 'boost', 'GAME'].includes(p.service_type) && !/decor/i.test(p.name) },
  { titleSlot: 'icon_art',      title: 'Decor Discord — Trang Trí Hồ Sơ',        match: (p) => p.service_type === 'decor' && /Acc /i.test(p.name) },
  { titleSlot: 'icon_gift',     title: 'Decor Discord — Gift & Combo',           match: (p) => p.service_type === 'decor' && /Gift/i.test(p.name) },
  { titleSlot: 'icon_brain',    title: 'AI & Phần Mềm Bản Quyền',                match: (p) => p.service_type === 'AI' },
  { titleSlot: 'brand_youtube', title: 'Giải Trí — YouTube · Spotify · Netflix', match: (p) => ['youtube', 'spotify', 'netflix', 'STREAMING'].includes(p.service_type) },
  { titleSlot: 'brand_gearup',  title: 'Tăng Tốc Game — GearUP Booster',         match: (p) => p.service_type === 'gearup' },
  { titleSlot: 'brand_discord', title: 'Dịch Vụ Setup & Custom',                 match: (p) => ['SERVICE', 'service'].includes(p.service_type) },
];

// Map emoji unicode còn sót trong DB → slot custom (mandate: chỉ emoji custom)
const UNICODE_TO_SLOT = {
  '✨': 'icon_sparkle',
  '🎨': 'icon_art',
  '🎁': 'icon_gift',
  '📦': 'order_product',
  '💎': 'icon_gem',
  '🎬': 'brand_netflix',
  '🎵': 'brand_spotify',
  '🤖': 'icon_brain',
};

// Sản phẩm dùng 1 lần / vĩnh viễn (không hiển thị "X tháng")
function getDurText(p) {
  if (p.price === 0 || ['SERVICE', 'service'].includes(p.service_type)) return 'Theo yêu cầu';
  if (isLifetimeProduct(p)) return 'Vĩnh viễn';
  return p.duration_months > 1 ? `${p.duration_months} tháng` : '1 tháng';
}

function isLifetimeProduct(p) {
  return p.service_type === 'decor';
}

function productEmoji(guildId, em, E, p) {
  // Nếu DB lưu slot key → dùng luôn
  if (em[p.emoji]) return em[p.emoji];
  // Nếu DB lưu unicode → quy đổi sang slot custom tương ứng
  const slot = UNICODE_TO_SLOT[p.emoji];
  if (slot && em[slot]) return em[slot];
  // Cuối cùng fallback về icon sản phẩm custom
  return E('order_product');
}

function productSelectEmoji(guildId, em, p) {
  if (em[p.emoji]) return resolveSelectMenuEmoji(guildId, p.emoji, em.order_product);
  const slot = UNICODE_TO_SLOT[p.emoji];
  if (slot) return resolveSelectMenuEmoji(guildId, slot, em.order_product);
  return resolveSelectMenuEmoji(guildId, 'order_product', em.order_product);
}

function buildGroupPanel(guildId, group, products) {
  const em = getEmojiMap(guildId);
  const E = createEmojiResolver(guildId);

  const container = new ContainerBuilder().setAccentColor(config.accentColorPrimary);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E(group.titleSlot)}  ${group.title}\n` +
      `> ${E('icon_sparkle')} ${fmt.b('Chính chủ — Bảo hành — Giao tự động 24/7')}\n` +
      subtext('Chọn sản phẩm ở dropdown bên dưới để đặt hàng ngay!')
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const lines = products.map((p) => {
    const emoji = productEmoji(guildId, em, E, p);
    const durText = getDurText(p);
    const hasSale = p.original_price > 0 && p.original_price > p.price;
    const priceText = p.price > 0
      ? (hasSale
          ? `~~${formatCurrency(p.original_price)}~~ → ${fmt.b(formatCurrency(p.price))}`
          : fmt.b(formatCurrency(p.price)))
      : `${E('icon_gift')} ${fmt.b('Thương lượng')}`;
    return `${emoji} ${fmt.b(p.name)}\n> ${E('payment_money')} ${priceText} ${fmt.b('·')} ${E('icon_duration')} ${durText}`;
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('icon_heart_purple')} ${products.length} sản phẩm · Cenar Store — Uy Tín & Chất Lượng`)
    )
  );

  const options = products.slice(0, 25).map((p) => {
    const durText = getDurText(p);
    const priceLabel = p.price > 0 ? formatCurrency(p.price) : 'Thương lượng';
    const opt = {
      label: `${p.name}`.slice(0, 100),
      description: `${priceLabel} · ${durText}`.slice(0, 100),
      value: `${p.id}`,
    };
    const emoji = productSelectEmoji(guildId, em, p);
    if (emoji) {
      opt.emoji = emoji;
    }
    return opt;
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('product:select')
      .setPlaceholder('Chọn sản phẩm muốn mua...')
      .addOptions(options)
  );

  return [container, selectRow];
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) { console.log('GUILD_NOT_FOUND', GUILD_ID); return; }

    await guild.channels.fetch();
    const chan = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name.includes('bảng-giá')
    );
    if (!chan) { console.log('PRICE_CHANNEL_NOT_FOUND'); return; }
    console.log('PRICE_CHANNEL =', `#${chan.name}`, chan.id);

    const all = getActiveProducts(GUILD_ID);
    console.log('TOTAL_PRODUCTS =', all.length);

    // Phân nhóm; sản phẩm không khớp nhóm nào dồn vào panel "Khác"
    const used = new Set();
    const panels = [];
    for (const g of GROUPS) {
      const items = all.filter((p) => !used.has(p.id) && g.match(p));
      items.forEach((p) => used.add(p.id));
      if (items.length) panels.push({ group: g, items });
    }
    const rest = all.filter((p) => !used.has(p.id));
    if (rest.length) panels.push({ group: { titleSlot: 'order_product', title: 'Sản Phẩm Khác' }, items: rest });

    console.log('PANELS:');
    for (const pn of panels) console.log(`  - ${pn.group.title}: ${pn.items.length}`);

    if (DRY) { console.log('DRY_RUN — không gửi.'); return; }

    // Xóa tin nhắn cũ của bot trong kênh để tránh trùng
    const old = await chan.messages.fetch({ limit: 50 }).catch(() => null);
    if (old) {
      for (const m of old.filter((m) => m.author.id === client.user.id).values()) {
        await m.delete().catch(() => null);
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    // Banner đầu kênh
    const E = createEmojiResolver(GUILD_ID);
    const header = new ContainerBuilder().setAccentColor(config.accentColorPrimary);
    header.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${E('stock_header')}  CENAR STORE — BẢNG GIÁ\n` +
        `> ${E('icon_sparkle')} ${fmt.b('Tài khoản bản quyền chính chủ — Giao tự động — Bảo hành trọn gói')}\n` +
        subtext('Cuộn xuống để xem từng danh mục và đặt hàng trực tiếp qua dropdown.')
      )
    );
    await chan.send({ components: [header], flags: MessageFlags.IsComponentsV2 });
    await new Promise((r) => setTimeout(r, 400));

    let sent = 0;
    for (const pn of panels) {
      const components = buildGroupPanel(GUILD_ID, pn.group, pn.items);
      await chan.send({ components, flags: MessageFlags.IsComponentsV2 });
      sent++;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log('SENT_PANELS', sent, 'vào #' + chan.name);
  } catch (e) {
    console.error('ERR', e.message, '\n', e.stack?.split('\n').slice(0, 4).join('\n'));
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(process.env.BOT_TOKEN);
