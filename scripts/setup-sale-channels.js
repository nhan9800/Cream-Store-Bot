import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../src/database/db.js';
import { upsertGuildConfig } from '../src/services/guildConfigService.js';
import { refreshSalePanel } from '../src/services/saleService.js';
import { STORE_ONE_CHANNEL_NAMES } from '../src/config/storeOneChannelAesthetic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Khởi chạy Database
initDatabase();

async function setupServer(envFile) {
  const envPath = path.resolve(projectRoot, envFile);
  console.log(`\n=== [SETUP] Chạy cấu hình từ ${envFile} ===`);
  
  if (!fs.existsSync(envPath)) {
    console.error(`Không tìm thấy file: ${envFile}`);
    return;
  }

  // Đọc file env cụ thể
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  const token = envConfig.BOT_TOKEN;
  const guildId = envConfig.GUILD_ID;

  if (!token || !guildId) {
    console.error(`Thiếu BOT_TOKEN hoặc GUILD_ID trong ${envFile}`);
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });

  await client.login(token);
  await new Promise(resolve => client.once('ready', resolve));
  console.log(`Bot đăng nhập thành công: ${client.user.tag}`);

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error(`Không tìm thấy Guild ID: ${guildId}`);
    client.destroy();
    return;
  }
  console.log(`Đang cấu hình server: ${guild.name}`);

  // Fetch roles để thiết lập quyền kênh
  const roles = await guild.roles.fetch();
  const everyoneRole = guild.roles.everyone;

  // Xác định vai trò Staff
  const founderRole = roles.find(r => r.name === 'Owner' || r.name.includes('Sáng Lập') || r.name.toLowerCase().includes('owner'));
  const managerRole = roles.find(r => r.name.includes('Admin Manager') || r.name.includes('Quản Trị') || r.name.toLowerCase().includes('manager') || r.name.toLowerCase().includes('admin'));
  const supportRole = roles.find(r => r.name.includes('Support Specialist') || r.name.includes('Ticket Agent') || r.name.includes('Hỗ Trợ') || r.name.toLowerCase().includes('support'));
  const techRole = roles.find(r => r.name.includes('Kỹ Thuật') || r.name.toLowerCase().includes('tech'));
  const shipperRole = roles.find(r => r.name.includes('Giao Hàng') || r.name.toLowerCase().includes('shipper'));

  const staffRoles = [founderRole, managerRole, techRole, supportRole, shipperRole].filter(Boolean);

  // Xác định vai trò Khách hàng / VIP (Verified)
  const memberRole = roles.find(r => r.name.includes('Explorer') || r.name.includes('Active Customer') || r.name.includes('Khách Mua Hàng') || r.name.includes('Thành Viên Mới'));
  const vipRoles = roles.filter(r => 
    r.name.includes('Ruby') || r.name.includes('Diamond') || 
    r.name.includes('Elite VIP') || r.name.includes('VIP Client') ||
    r.name.includes('Bạch Kim') || r.name.includes('VIP')
  );

  const verifiedRoles = [memberRole, ...vipRoles.values()].filter(Boolean);

  // Tìm danh mục "CỬA HÀNG CENAR"
  const channels = await guild.channels.fetch();
  const parentCat = channels.find(c => 
    c.type === ChannelType.GuildCategory && 
    c.name.toLowerCase().includes('cửa hàng cenar')
  );

  if (!parentCat) {
    console.warn(`⚠️ Không tìm thấy Danh mục "CỬA HÀNG CENAR" trên server: ${guild.name}. Sẽ tạo kênh ở thư mục gốc.`);
  } else {
    console.log(`Tìm thấy danh mục: "${parentCat.name}" (ID: ${parentCat.id})`);
  }

  const overwrites = [
    {
      id: everyoneRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    }
  ];

  // Quyền cho Staff
  for (const r of staffRoles) {
    overwrites.push({
      id: r.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  // Quyền cho Khách hàng đã xác minh (View được nhưng không thể gửi tin nhắn)
  for (const r of verifiedRoles) {
    overwrites.push({
      id: r.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
    });
  }

  const targetChannelName = STORE_ONE_CHANNEL_NAMES.promotion;

  // Tìm kênh khuyến mãi trong danh mục "CỬA HÀNG CENAR"
  let saleChannel = channels.find(c => 
    c.type === ChannelType.GuildText && 
    c.name === targetChannelName && 
    c.parentId === (parentCat?.id || null)
  );

  // Dọn dẹp kênh khuyến mãi cũ ngoài danh mục để tránh trùng lặp
  const duplicates = channels.filter(c => 
    c.type === ChannelType.GuildText && 
    (c.name === 'khuyến-mãi' || c.name === 'khuyen-mai' || c.name === '🔥｜khuyến-mãi' || c.name === '🥒｜khuyến-mãi' || c.name === targetChannelName) &&
    c.id !== (saleChannel?.id || null)
  );

  for (const dup of duplicates.values()) {
    console.log(`[CLEANUP] Xóa kênh khuyến mãi ngoài cấu trúc / trùng lặp: #${dup.name} (${dup.id})`);
    await dup.delete().catch(() => null);
  }

  // Tạo mới hoặc cập nhật kênh trong danh mục
  if (saleChannel) {
    console.log(`Kênh sale đã tồn tại: #${saleChannel.name} (ID: ${saleChannel.id}). Cập nhật danh mục...`);
    await saleChannel.edit({
      parent: parentCat?.id || null
    }).catch(console.error);
  } else {
    console.log(`Tạo kênh text mới "${targetChannelName}" dưới danh mục "${parentCat?.name || 'Gốc'}"...`);
    saleChannel = await guild.channels.create({
      name: targetChannelName,
      type: ChannelType.GuildText,
      parent: parentCat?.id || null
    }).catch(err => {
      console.error('Lỗi khi tạo kênh:', err);
      return null;
    });
  }

  if (saleChannel) {
    // Đồng bộ quyền với danh mục cha (để thừa hưởng phân quyền và ẩn Icon Lock)
    if (parentCat) {
      console.log('Đồng bộ quyền với danh mục cha...');
      await saleChannel.lockPermissions().catch(console.error);
    }

    // Ghi đè quyền của everyone và khách hàng để tắt quyền gửi tin nhắn (Read-only)
    console.log('Thiết lập quyền chỉ đọc (Read-only) cho khách hàng...');
    await saleChannel.permissionOverwrites.edit(everyoneRole.id, {
      SendMessages: false
    }).catch(console.error);

    for (const r of verifiedRoles) {
      await saleChannel.permissionOverwrites.edit(r.id, {
        SendMessages: false,
        AddReactions: false
      }).catch(console.error);
    }

    // Lưu vào database
    upsertGuildConfig({
      guild_id: guildId,
      sale_channel_id: saleChannel.id,
      updated_by: client.user.id
    });

    // Dọn dẹp tin nhắn cũ
    try {
      const messages = await saleChannel.messages.fetch({ limit: 50 });
      const botMessages = messages.filter(m => m.author.id === client.user.id);
      for (const msg of botMessages.values()) {
        await msg.delete().catch(() => null);
      }
      console.log('Đã dọn dẹp tin nhắn cũ của bot trong kênh sale.');
    } catch (e) {
      console.warn('Lỗi dọn dẹp tin nhắn cũ:', e.message);
    }

    // Refresh panel sale để đăng/ghim panel mặc định lên kênh mới tạo
    await refreshSalePanel(client, guildId, saleChannel);
    console.log(`✓ Hoàn tất cấu hình kênh sale ghim đẹp cho server: ${guild.name}`);
  }

  client.destroy();
}

async function main() {
  await setupServer('.env');
  await setupServer('.env.store2');
  console.log('\n=== CÀI ĐẶT THÀNH CÔNG CHO CẢ 2 SERVER ===');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
