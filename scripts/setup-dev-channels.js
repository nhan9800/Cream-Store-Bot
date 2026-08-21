import { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { STORE_ONE_CHANNEL_NAMES } from '../src/config/storeOneChannelAesthetic.js';
dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const dbPath = 'data/shopbot.sqlite';
const db = new Database(dbPath);

// Retrieve guild config from database
const guildId = '1282637033340403754';
const config = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
db.close();

if (!config) {
  console.error('❌ Guild config not found in database!');
  process.exit(1);
}

// Emoji mapping helper
const fallbackEmojis = {
  icon_settings:      '<:gearup:1515216203453432002>',
  icon_price:         '<:money:1442876095442714748>',
  icon_duration:      '<a:redload:1459179959158571119>',
  icon_crown:         '<:Platinum:1485905566130765908>',
  icon_star:          '<a:sao:1481149556753305600>',
  icon_fire:          '<a:tsm_fire:1327553120842158111>',
  icon_gem:           '<:Diamond:1485905790903783465>',
  icon_gift:          '<a:starxoay:1481141954346483845>',
  icon_sparkle:       '<a:starxoay:1481141954346483845>',
  status_check:       '<a:tickgreen:1384069022831874169>',
  status_cross:       '<a:tick_red51:1384069065626222632>',
  status_warn:        '<a:Dotyellow:1481134440725090315>',
  order_product:      '<a:Arrow2:1367139234833498113>',
  panel_support:      '<a:starxoay:1481141954346483845>',
  brand_discord:      '<:10194purpleween:1384901794475282523>',
  brand_gemini:       '<:tsm_gemini:1481157054210248864>'
};

function getEmoji(guild, key) {
  const match = key.match(/^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/);
  if (match) {
    const emojiId = match[2];
    const emoji = guild.emojis.cache.get(emojiId);
    if (emoji) return emoji.toString();
  }
  
  const fallback = fallbackEmojis[key];
  if (fallback) {
    const fMatch = fallback.match(/^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/);
    if (fMatch) {
      const emojiId = fMatch[2];
      const emoji = guild.emojis.cache.get(emojiId);
      if (emoji) return emoji.toString();
    }
    return fallback;
  }
  return '';
}

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.error('❌ Guild not found!');
      client.destroy();
      return;
    }
    console.log(`✅ Logged in as ${client.user.tag} and connected to Guild: ${guild.name}`);

    const E = (key) => getEmoji(guild, key);
    const parentCategoryId = '1514606994256957600'; 

    const channelsToCreate = [
      { name: STORE_ONE_CHANNEL_NAMES.devBot, topic: 'Dịch vụ thiết kế và lập trình Bot Discord chuyên nghiệp - Cenar Store' },
      { name: STORE_ONE_CHANNEL_NAMES.devWeb, topic: 'Dịch vụ thiết kế và phát triển Website chuyên nghiệp, uy tín - Cenar Store' }
    ];

    const createdChannels = {};

    for (const chanData of channelsToCreate) {
      let channel = guild.channels.cache.find(c => c.name === chanData.name && c.parentId === parentCategoryId);
      if (!channel) {
        console.log(`Creating channel ${chanData.name}...`);
        channel = await guild.channels.create({
          name: chanData.name,
          type: ChannelType.GuildText,
          parent: parentCategoryId,
          topic: chanData.topic,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
            },
            {
              id: config.support_role_id || '1514606974912958485',
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            },
            {
              id: config.manager_role_id || '1514606974912958485',
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            }
          ]
        });
        console.log(`✅ Channel ${chanData.name} created! ID: ${channel.id}`);
      } else {
        console.log(`Channel ${chanData.name} already exists. ID: ${channel.id}`);
      }
      createdChannels[chanData.name] = channel;

      const messages = await channel.messages.fetch({ limit: 100 });
      if (messages.size > 0) {
        console.log(`Clearing ${messages.size} messages from #${channel.name}...`);
        for (const msg of messages.values()) {
          await msg.delete().catch(() => null);
        }
      }
    }

    const actionButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:create:ORDER')
        .setLabel('🛒 Đặt Hàng Ngay')
        .setStyle(ButtonStyle.Primary)
        .setEmoji({ id: '1348626032747614268', name: 'cr_carttt' }),
      new ButtonBuilder()
        .setCustomId('ticket:create:SUPPORT')
        .setLabel('💬 Tư Vấn Dịch Vụ')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji({ id: '1481141954346483845', name: 'starxoay' })
    );

    // 1. DEV-BOT
    const devBotChannel = createdChannels['💻｜dev-bot'];
    
    await devBotChannel.send([
      `# ${E('icon_settings')} DEVELOPMENT SERVICES BOT — CENAR STORE`,
      `> ${E('icon_sparkle')} **Dịch vụ thiết kế và lập trình Bot Discord theo yêu cầu chuyên nghiệp**`,
      `-# Mang lại trải nghiệm tương tác tốt nhất cho cộng đồng của bạn với công nghệ hiện đại và mượt mà.`,
      `─────────────────────────────────────────`
    ].join('\n'));

    await devBotChannel.send([
      `### ${E('icon_star')} GÓI 1: KHỞI ĐẦU — STARTUP BOT`,
      `> **${E('icon_price')} Giá khởi điểm:** \`500.000 VND\``,
      `> **${E('icon_duration')} Thời hạn bàn giao:** \`2 - 3 ngày\``,
      `> **${E('icon_settings')} Tính năng & Quyền lợi:**`,
      `> * ${E('status_check')} Thiết kế đầy đủ các tính năng cơ bản cần thiết cho máy chủ.`,
      `> * ${E('status_check')} Quản trị thành viên, tự động hóa vai trò, tin nhắn chào mừng/tạm biệt.`,
      `> * ${E('status_check')} Lệnh giải trí cơ bản, tiện ích, tương tác thông minh.`,
      `> * ${E('icon_gift')} **ƯU ĐÃI ĐẶC BIỆT:** Tặng kèm **14x Boost Server Level 3 trong 1 tháng**!`,
      `> * ${E('icon_fire')} *Lời khuyên:* Gói khởi đầu hoàn hảo giúp nâng cấp máy chủ của bạn trở nên sống động và chuyên nghiệp hơn bao giờ hết, vừa có bot xịn và server boost ngập tràn!`
    ].join('\n'));

    await devBotChannel.send([
      `### ${E('icon_gem')} GÓI 2: CHUYÊN NGHIỆP — PRO DESIGN & DEV`,
      `> **${E('icon_price')} Giá gói:** \`800.000 VND\``,
      `> **${E('icon_duration')} Thời hạn bàn giao:** \`3 - 5 ngày\` | ${E('icon_settings')} **Bảo hành:** \`1 tháng\``,
      `> **${E('icon_settings')} Tính năng & Quyền lợi:**`,
      `> * ${E('status_check')} Lập trình bot độc quyền từ A - Z hoàn toàn theo ý tưởng của bạn.`,
      `> * ${E('status_check')} Thiết kế & Setup trọn gói hệ thống kênh, vai trò máy chủ Discord chuẩn chỉ.`,
      `> * ${E('status_check')} Tích hợp các hệ thống quản lý nâng cao, âm nhạc chất lượng cao, mini-games.`,
      `> * ${E('status_check')} Hỗ trợ tối ưu hóa hiển thị, phân quyền chặt chẽ chống phá server.`,
      `> * ${E('icon_fire')} *Lời khuyên:* Lựa chọn tối ưu cho những chủ server mong muốn một hệ sinh thái chuyên nghiệp, đồng bộ hoàn hảo từ hình thức đến tính năng một cách chỉn chu nhất!`
    ].join('\n'));

    await devBotChannel.send({
      content: [
        `### ${E('icon_crown')} GÓI 3: THƯỢNG HẠNG — ULTRA VIP BOT`,
        `> **${E('icon_price')} Giá gói:** \`1.500.000 VND\``,
        `> **${E('icon_duration')} Thời hạn bàn giao:** \`5 - 7 ngày\` | ${E('icon_settings')} **Bảo hành:** \`TRỌN ĐỜI (Lifetime)\``,
        `> **${E('icon_settings')} Tính năng & Quyền lợi:**`,
        `> * ${E('status_check')} Phát triển các tính năng siêu đặc biệt, hệ thống quản lý, API tích hợp riêng.`,
        `> * ${E('status_check')} Tối ưu hiệu năng cực độ, bảo mật tuyệt đối, hoạt động ổn định 24/7.`,
        `> * ${E('status_check')} **Hỗ trợ fix lỗi vĩnh viễn** nếu phát sinh bất kỳ lỗi nào từ phía mã nguồn bot.`,
        `> * ${E('status_check')} Ưu tiên nâng cấp và cập nhật tính năng mới theo xu hướng Discord.`,
        `> * ${E('icon_fire')} *Lời khuyên:* Đỉnh cao của dịch vụ thiết kế! Sở hữu một "trợ lý vạn năng" hoạt động bền bỉ mãi mãi cùng sự đồng hành trọn đời từ đội ngũ dev của Cenar Store.`,
        `\n`,
        `-# Nhấn nút bên dưới để tạo ticket trao đổi trực tiếp với đội ngũ Developer của chúng tôi!`
      ].join('\n'),
      components: [actionButtons]
    });
    
    console.log('✅ Sent dev-bot pricing panels!');

    // 2. DEV-WEB
    const devWebChannel = createdChannels['🌐｜dev-web'];

    await devWebChannel.send([
      `# ${E('icon_settings')} WEBSITE DEVELOPMENT SERVICES — CENAR STORE`,
      `> ${E('icon_sparkle')} **Giải pháp thiết kế và phát triển Website chuyên nghiệp, uy tín**`,
      `-# Biến ý tưởng kinh doanh của bạn thành một trang web bán hàng hiện đại, thu hút hàng triệu khách hàng.`,
      `─────────────────────────────────────────`
    ].join('\n'));

    await devWebChannel.send([
      `### ${E('icon_star')} GÓI 1: KHỞI NGHIỆP — STARTUP WEB`,
      `> **${E('icon_price')} Giá gói:** khoảng \`1.000.000 VND\``,
      `> **${E('icon_duration')} Thời hạn hoàn thành:** \`3 - 5 ngày\` | ${E('icon_settings')} **Bảo hành:** \`3 tháng\``,
      `> **${E('icon_settings')} Tính năng & Quyền lợi:**`,
      `> * ${E('status_check')} Hỗ trợ thiết lập toàn bộ từ mua tên miền, hosting đến cấu hình source code.`,
      `> * ${E('status_check')} Giao diện tối ưu thiết bị di động, hiển thị sản phẩm đẹp mắt và trực quan.`,
      `> * ${E('status_check')} Tích hợp cổng thanh toán tự động tiện lợi (VietQR, thẻ cào, momo).`,
      `> * ${E('status_check')} Bàn giao toàn bộ thông tin quản trị hệ thống, hướng dẫn sử dụng chi tiết.`,
      `> * ${E('icon_fire')} *Lời khuyên:* Bước đệm vững chắc cho hành trình khởi nghiệp của bạn! Sở hữu ngay một website bán hàng tự động 24/7 chỉ với mức đầu tư cực kỳ tiết kiệm.`
    ].join('\n'));

    await devWebChannel.send([
      `### ${E('icon_gem')} GÓI 2: YÊU CẦU — CUSTOM PRO WEB`,
      `> **${E('icon_price')} Giá gói:** khoảng \`2.500.000 VND\``,
      `> **${E('icon_duration')} Thời hạn hoàn thành:** \`5 - 7 ngày\` | ${E('icon_settings')} **Bảo hành:** \`6 tháng\``,
      `> **${E('icon_settings')} Tính năng & Quyền lợi:**`,
      `> * ${E('status_check')} Thiết kế giao diện độc quyền theo yêu cầu, tạo dấu ấn thương hiệu riêng biệt.`,
      `> * ${E('status_check')} Tự do tích hợp tất cả các tính năng đặc thù (quản lý kho, thống kê doanh thu, hệ thống API).`,
      `> * ${E('status_check')} Tốc độ tải trang siêu nhanh, bảo mật nâng cao chống spam/DDoS.`,
      `> * ${E('status_check')} Hỗ trợ bảo trì định kỳ, cập nhật vá lỗi bảo mật liên tục.`,
      `> * ${E('icon_fire')} *Lời khuyên:* Hiện thực hóa mọi mong muốn của bạn! Website được may đo riêng biệt, tích hợp full tính năng giúp tạo nên sự khác biệt đột phá so với đối thủ.`
    ].join('\n'));

    await devWebChannel.send({
      content: [
        `### ${E('icon_crown')} GÓI 3: TINH TÚ — ENTERPRISE ELITE WEB`,
        `> **${E('icon_price')} Giá gói:** khoảng \`5.000.000 VND\``,
        `> **${E('icon_duration')} Thời hạn hoàn thành:** \`7 - 10 ngày\` | ${E('icon_settings')} **Bảo hành:** \`TRỌN ĐỜI (Lifetime)\``,
        `> **${E('icon_settings')} Tính năng & Quyền lợi:**`,
        `> * ${E('status_check')} Toàn bộ những công nghệ tinh tú, hiện đại nhất được áp dụng vào website.`,
        `> * ${E('status_check')} Tích hợp các hệ thống tự động hóa nâng cao, đồng bộ đa nền tảng, SEO tối ưu chuẩn Google.`,
        `> * ${E('status_check')} Hiệu năng đỉnh cao, xử lý hàng vạn truy cập đồng thời không giật lag.`,
        `> * ${E('status_check')} **Hỗ trợ kỹ thuật trọn đời (Lifetime Support)**, nâng cấp tính năng ưu tiên hàng đầu.`,
        `> * ${E('icon_fire')} *Lời khuyên:* Đỉnh cao công nghệ số! Gói dịch vụ tối thượng mang lại một sản phẩm website hoàn mỹ nhất, bền bỉ vĩnh viễn cùng sự đồng hành trọn đời từ Cenar Store.`,
        `\n`,
        `> ${E('status_warn')} **LƯU Ý CỰC KỲ QUAN TRỌNG:**`,
        `> **"Giá tiền luôn đi liền với chất lượng phục vụ!"**`,
        `> Hãy cực kỳ cảnh giác với những lời chào mời *nhận dev web giá rẻ*. Một số đối tượng lừa đảo thường dụ dỗ bằng giá rẻ, sau đó "mang con bỏ chợ", cài mã độc chiếm đoạt tài sản hoặc phá hoại công việc của bạn. Quý khách hãy sáng suốt lựa chọn các đơn vị uy tín như **Cenar Store** để được bảo hành và hỗ trợ kỹ thuật trọn gói tốt nhất!`,
        `\n`,
        `-# Nhấn nút bên dưới để tạo ticket trao đổi trực tiếp với đội ngũ Developer của chúng tôi!`
      ].join('\n'),
      components: [actionButtons]
    });

    console.log('✅ Sent dev-web pricing panels!');

  } catch (err) {
    console.error('Error during execution:', err.message);
  }
  client.destroy();
});

client.login(process.env.BOT_TOKEN).catch(console.error);
