import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from '../src/config.js';
import { roleColorsFor } from '../src/config/roleColors.js';
import { initDatabase } from '../src/database/db.js';
import { autoSetupPartnerAndCtv, PARTNER_CTV_IDS } from '../src/services/autoSetupService.js';

const APPLY = process.argv.includes('--apply');

const ROLE_DESIGN = Object.freeze({
  '1348638945793019945': { name: 'Cenar Executive', emoji: 'cenar_admin' },
  '1282650552110678069': { name: 'Cenar Care', emoji: 'cenar_support' },
  '1348638944740376680': { name: 'Cenar Concierge', emoji: 'cenar_staff' },
  '1513388521862336683': { name: 'CENAR · SIGNATURE', emoji: 'star' },
  '1489653862699897064': { name: 'Cenar Darling', emoji: '13221snoopyhearts' },
  '1406921057646018663': { name: 'Cenar Sugar', emoji: '68923neonheart' },
  '1483690185115046039': { name: 'Cenar Sister', emoji: '13221snoopysparkles' },
  '1282637901565399051': { name: 'Cenar Rose', emoji: 'purple_heart_glow' },
  '1522844528237740066': { name: 'Cenar Partner', emoji: 'cenar_partner' },
  '1522844530242748446': { name: 'Cenar CTV', emoji: 'cenar_ctv' },
  '1513388523590385714': { name: 'CENAR · CLIENT TIERS', emoji: 'Platinum' },
  '1282637775291551776': { name: 'Cenar Ruby · 8M+', emoji: 'radiant' },
  '1282637814571466808': { name: 'Cenar Diamond · 5M+', emoji: 'Diamond' },
  '1282637470139420694': { name: 'Cenar Elite · 3M+', emoji: 'Ascendant' },
  '1282637168149532724': { name: 'Cenar Gold · 1M+', emoji: 'Gold' },
  '1513388525121437736': { name: 'CENAR · COMMUNITY', emoji: 'cr_green' },
  '1282637103045279820': { name: 'Cenar Patron', emoji: 'cenar_wallet' },
  '1282638730812854345': { name: 'Cenar Member', emoji: 'cenar_verified' },
  '1451978651162771596': { name: 'Cenar Feedback Pending', emoji: 'cenar_cooldown' },
  '1513388526312362108': { name: 'CENAR · SYSTEM', emoji: 'cr_blackbox' },
  '1282638601066123325': { name: 'Cenar Automations', emoji: 'chatgopete' },
  '1468389308426616895': { name: 'Cenar Restricted', emoji: 'decu' },
});

// Chỉ đổi icon đầu tên. Phần chữ sau icon được giữ nguyên theo cấu trúc server.
const CHANNEL_DESIGN = Object.freeze({
  // Categories
  '1514606974912958485': '🍇 ｜ ──・ THÔNG TIN CHUNG',
  '1514606994256957600': '🍓 ｜ ──・ CỬA HÀNG CENAR',
  '1524057147858751688': '🍋・Cẩm Nang Hướng Dẫn',
  '1514607006852579328': '🍏 ｜ ──・ PHÒNG TRÒ CHUYỆN',
  '1514607018382721135': '🥝 ｜ ──・ TRUNG TÂM HỖ TRỢ',
  '1531297028695658576': '🥭 ｜ SẢN PHẨM PREMIUM',
  '1514607024476917872': '🍍 ｜ ──・ KHU VỰC QUẢN TRỊ',
  '1514620828078309538': '🍊 ｜ ── TICKET BẢO HÀNH',
  '1514620831534153789': '🍐 ｜ ── TICKET HỖ TRỢ',
  '1514620835317415987': '🍎 ｜ ── TICKET KHIẾU NẠI',
  '1514620839084167289': '🍑 ｜ ── TICKET MUA HÀNG',
  '1514625270169210970': '🍉 ｜ ── TICKET HỢP TÁC',

  // Public / store / guide channels
  '1514597981666672691': '🍈｜điều-khoản',
  '1514598369597587546': '🍌｜thông-báo',
  '1514606977878200360': '🍒｜chào-mừng',
  '1514606981040836751': '🥥｜tạm-biệt',
  '1514606987839672563': '🥑｜sự-kiện',
  '1514606991212019785': '🍅｜xác-minh',
  '1514606995842273280': '🍆｜bảng-giá',
  '1514606999386587206': '🥔｜đánh-giá',
  '1514607003102740520': '🥕｜bảng-vinh-danh',
  '1514607026247045121': '🌽｜log-đơn-hàng',
  '1514620623685685390': '🌶️｜lịch-sử-mua-hàng',
  '1515008584549797979': '🥒｜khuyến-mãi',
  '1522130462456414220': '🥬｜cày-thuê-valorant',
  '1526895735067381841': '🥦｜dev-bot',
  '1526895739085656216': '🍄｜dev-web',
  '1530800546179711037': '🥜・thuê-sim-online',
  '1530821462590492672': '🌰・nap-the-tu-dong',
  '1530830075241435197': '🍞・bang-chiet-khau',
  '1531206050383134842': '🥐・su-kien',
  '1524057149783937214': '🥖・hướng-dẫn-nitro',
  '1524057155022491679': '🥨・hướng-dẫn-youtube',
  '1524057160860958820': '🥯・hướng-dẫn-spotify',
  '1524057165067849811': '🥞・hướng-dẫn-netflix',
  '1524080488233435336': '🧀・boost-server',
  '1524232964928438455': '🍖・log-boost-server',
  '1519182567151239188': '🍗｜thảo-luận',
  '1514607014633017525': '🥩｜lệnh-bot',
  '1514607011663188009': '🥓｜hình-ảnh',
  '1514607020098191393': '🍔｜hỗ-trợ',
  '1531297030767644925': '🍟・claude-api',
  '1531297033317777408': '🍕・locket-gold',
  '1514607029610877069': '🌭｜log-nhân-viên',
  '1514607032760799313': '🥪｜kênh-nhắc-nhở',
  '1517266176302907433': '🌮｜log-bao-hanh',
  '1515472218199429293': '🌯｜làm-đơn',

  // Voice and forum channels
  '1514863091333206106': '🥙・Ngôi Nhà Hạnh Phúc',
  '1528767549972676658': '🥚・Public',
  '1535374962569781299': '🍳・Mua m',
  '1531203088222916740': '🥘・Nem',
});

async function migrateRoleMembers(guild, sourceId, targetId) {
  const source = guild.roles.cache.get(sourceId);
  const target = guild.roles.cache.get(targetId);
  if (!source || !target) return;
  for (const member of source.members.values()) {
    if (APPLY) await member.roles.add(target, `Migrate duplicate role ${sourceId}`).catch(() => null);
  }
  if (APPLY && source.editable) await source.delete(`Merged into ${targetId}`).catch(() => null);
  console.log(`[ROLE-MERGE] ${source.name} (${sourceId}) -> ${target.name} (${targetId}) · ${source.members.size} members`);
}

async function emojiIconBuffer(emoji) {
  const response = await fetch(emoji.imageURL({ extension: 'png', size: 128 }));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function run() {
  initDatabase();
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(config.botToken);
  await ready;
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) throw new Error(`Không tìm thấy guild ${config.guildId}.`);
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.emojis.fetch();
  const enhancedRoleColors = guild.features.includes('ENHANCED_ROLE_COLORS');
  if (APPLY) {
    await guild.members.fetch().catch((error) => console.warn(`[MEMBER-FETCH] ${error.message}`));
    await autoSetupPartnerAndCtv(client);
    await guild.roles.fetch();
    await guild.channels.fetch();
  }

  // Các role trùng được hợp nhất vào role chuẩn trước khi trang trí.
  await migrateRoleMembers(guild, '1535606863545245716', '1282638730812854345');

  for (const [roleId, design] of Object.entries(ROLE_DESIGN)) {
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      console.log(`[ROLE-SKIP] missing ${roleId}`);
      continue;
    }
    const emoji = guild.emojis.cache.find((item) => item.name === design.emoji);
    const colors = roleColorsFor(roleId, { enhanced: enhancedRoleColors });
    console.log(`[ROLE] ${role.name} -> ${design.name} · icon=${design.emoji} · colors=${JSON.stringify(colors)}`);
    if (!APPLY || !role.editable) continue;
    await role.edit({ name: design.name, colors, mentionable: false, reason: 'Cenar vivid role gradients' });
    if (emoji) {
      const icon = await emojiIconBuffer(emoji);
      await role.setIcon(icon, `Custom role icon :${emoji.name}:`).catch((error) => {
        console.warn(`[ROLE-ICON] ${role.id}: ${error.message}`);
      });
    }
  }

  for (const [channelId, desiredName] of Object.entries(CHANNEL_DESIGN)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      console.log(`[CHANNEL-SKIP] missing ${channelId}`);
      continue;
    }
    console.log(`[CHANNEL] ${channel.name} -> ${desiredName}`);
    if (APPLY && channel.name !== desiredName) {
      await channel.setName(desiredName, 'Cenar fruit channel aesthetic v2').catch((error) => {
        console.warn(`[CHANNEL-RENAME] ${channel.id}: ${error.message}`);
      });
    }
  }

  const partnerRole = guild.roles.cache.get(PARTNER_CTV_IDS.partnerRole);
  const ctvRole = guild.roles.cache.get(PARTNER_CTV_IDS.ctvRole);
  console.log(JSON.stringify({
    apply: APPLY,
    guild: { id: guild.id, name: guild.name },
    roleIconsFeature: guild.features.includes('ROLE_ICONS'),
    enhancedRoleColors,
    partnerRole: partnerRole ? { id: partnerRole.id, name: partnerRole.name, icon: Boolean(partnerRole.icon) } : null,
    ctvRole: ctvRole ? { id: ctvRole.id, name: ctvRole.name, icon: Boolean(ctvRole.icon) } : null,
  }, null, 2));
  client.destroy();
}

run().catch((error) => {
  console.error('[AESTHETIC-V2]', error);
  process.exitCode = 1;
});
