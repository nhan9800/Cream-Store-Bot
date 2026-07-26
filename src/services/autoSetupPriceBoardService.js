import {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { buildStockPanelComponents, stockPanelRegistry } from '../commands/stock.js';
import { getGuildConfig } from './guildConfigService.js';
import { resolveSelectMenuEmoji } from './emojiService.js';

export function buildPricePortalPayload(guildId, guildConfig) {
  const title = guildConfig?.price_list_title || '📺  PREMIUM SERVICES CATALOG — CENAR STORE  📺';
  const description = guildConfig?.price_list_description || [
    '# 🌟 CHÀO MỪNG BẠN ĐẾN VỚI HỆ THỐNG DỊCH VỤ PREMIUM 🌟',
    '',
    'Cửa hàng chuyên cung cấp các tài khoản giải trí, học tập và làm việc Premium chính chủ với giá siêu ưu đãi, bảo hành trọn vẹn thời gian sử dụng.',
    '',
    '---',
    '',
    '### 🛍️ DANH MỤC DỊCH VỤ NỔI BẬT:',
    '📺 **YouTube Premium** — Xem video không quảng cáo, chạy nền tiện lợi.',
    '🎵 **Spotify Premium** — Nghe nhạc chất lượng cao offline không giới hạn.',
    '🍿 **Netflix Premium** — Trải nghiệm phim ảnh chất lượng UltraHD 4K.',
    '💎 **Discord Nitro** — Đầy đủ đặc quyền VIP, nhận 2 Boosts Server.',
    '🚀 **Discord Boost Server** — Tối ưu hóa cộng đồng của bạn nhanh chóng.',
    '🛠️ **Dịch vụ Setup & Custom** — Thiết kế máy chủ, làm bot & website (Giá: **Thương lượng**).',
    '',
    '---',
    '',
    '### 💡 HƯỚNG DẪN MUA HÀNG:',
    '1. Sử dụng **Menu Thả Xuống** bên dưới để chọn dịch vụ bạn muốn xem bảng giá.',
    '2. Bảng giá chi tiết sẽ hiện lên riêng tư kèm nút đặt mua.',
    '3. Chọn gói và điền thông tin để hệ thống tự động mở ticket xử lý nhanh chóng.',
    '',
    '🛡️ *Mọi giao dịch đều được đảm bảo an toàn & bảo hành trọn vẹn thời hạn sử dụng!*'
  ].join('\n');
  const imageUrl = guildConfig?.price_list_image_url || null;

  const portalEmbed = new EmbedBuilder()
    .setColor(0xF3A6D7)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Cenar Store • An toàn - Uy tín - Chất lượng 💙' })
    .setTimestamp();

  if (imageUrl && imageUrl.startsWith('http')) {
    portalEmbed.setImage(imageUrl);
  }

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('price_list:select')
      .setPlaceholder('🛒 Chọn danh mục sản phẩm để xem bảng giá')
      .addOptions([
        {
          label: 'YouTube Premium (Siêu Ổn Định)',
          description: 'Gói ổn định chính chủ 3T - 6T - 12T',
          value: 'youtube',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_youtube', '📺')
        },
        {
          label: 'Spotify Premium (Siêu Ổn Định)',
          description: 'Nghe nhạc chất lượng cao offline',
          value: 'spotify',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_spotify', '🎵')
        },
        {
          label: 'Netflix Extra Premium',
          description: 'Xem cùng lúc 1 thiết bị, UltraHD 4K',
          value: 'netflix',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_netflix', '🍿')
        },
        {
          label: 'Discord Nitro Full Premium',
          description: 'Đầy đủ đặc quyền VIP Discord',
          value: 'nitro',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_discord', '💎')
        },
        {
          label: 'Discord Boost Server',
          description: 'Bơm thẳng Server lên Level 3 nhanh chóng',
          value: 'boost',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_discord', '🚀')
        },
        {
          label: 'Decor Discord (Hiệu ứng hồ sơ)',
          description: 'Hiệu ứng hồ sơ & trang trí ảnh đại diện Discord',
          value: 'decor',
          emoji: resolveSelectMenuEmoji(guildId, 'icon_sparkle', '✨')
        },
        {
          label: 'AI & Phần Mềm Premium',
          description: 'ChatGPT, Gemini Pro, Office 365, Adobe, CapCut...',
          value: 'ai',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_chatgpt', '🤖')
        },
        {
          label: 'GearUP Booster (Giảm Lag Ping)',
          description: 'Tối ưu kết nối, giảm ping game 3T - 6T - 12T',
          value: 'gearup',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_gearup', '🎮')
        },
        {
          label: 'Dịch vụ Setup & Custom',
          description: 'Thiết kế máy chủ, làm bot & website (Giá: Thương lượng)',
          value: 'service',
          emoji: resolveSelectMenuEmoji(guildId, 'brand_discord', '🛠️')
        }
      ])
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('price_list:admin:edit_portal')
      .setLabel('Sửa bảng giá')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✏️')
  );

  return {
    embeds: [portalEmbed],
    components: [selectRow, buttonRow]
  };
}

export async function autoSetupPriceBoard(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      let channel = guild.channels.cache.find(c => 
        c.isTextBased() && (c.name.includes('bang-gia') || c.name.includes('bảng-giá') || c.name.includes('price'))
      );

      if (!channel) {
        channel = await guild.channels.create({
          name: '💰・bảng-giá',
          type: ChannelType.GuildText,
          reason: 'Tự động tạo kênh Bảng giá sản phẩm tự động',
        }).catch(err => {
          console.error('[AUTO-SETUP-PRICE] Lỗi tạo kênh bảng-giá:', err.message);
          return null;
        });
      }

      if (!channel) continue;

      const guildConfig = getGuildConfig(guild.id);
      const portalPayload = buildPricePortalPayload(guild.id, guildConfig);
      const stockComponents = buildStockPanelComponents(guild.id);

      const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      let portalMsg = null;
      let stockMsg = null;

      if (messages) {
        portalMsg = messages.find(m => m.author.id === client.user.id && m.embeds && m.embeds.length > 0 && m.components && m.components.some(r => r.components.some(c => c.customId === 'price_list:select')));
        stockMsg = messages.find(m => m.author.id === client.user.id && m.components && m.components.some(r => r.components.some(c => c.customId === 'product:select')));
      }

      // 1. Gửi hoặc Cập nhật Portal Catalog Embed (có Dịch vụ Setup & Custom - Thương lượng)
      if (portalMsg) {
        await portalMsg.edit(portalPayload).catch(err => console.error('[AUTO-SETUP-PRICE] Lỗi edit Portal:', err.message));
      } else {
        await channel.send(portalPayload).catch(err => console.error('[AUTO-SETUP-PRICE] Lỗi send Portal:', err.message));
      }

      // 2. Gửi hoặc Cập nhật Stock Panel V2
      if (stockComponents) {
        if (stockMsg) {
          await stockMsg.edit({ components: stockComponents, flags: MessageFlags.IsComponentsV2 }).catch(err => console.error('[AUTO-SETUP-PRICE] Lỗi edit Stock Panel:', err.message));
          stockPanelRegistry.set(guild.id, { channelId: channel.id, messageId: stockMsg.id });
        } else {
          const sentMsg = await channel.send({ components: stockComponents, flags: MessageFlags.IsComponentsV2 }).catch(err => console.error('[AUTO-SETUP-PRICE] Lỗi send Stock Panel:', err.message));
          if (sentMsg) {
            stockPanelRegistry.set(guild.id, { channelId: channel.id, messageId: sentMsg.id });
          }
        }
      }

      console.log(`[AUTO-SETUP-PRICE] Đã tự động thả/cập nhật Bảng Giá Catalog (Thương lượng) & Bảng Sản Phẩm vào #${channel.name} (${guild.name})`);
    }
  } catch (error) {
    console.error('[AUTO-SETUP-PRICE] Lỗi khi setup bảng giá:', error);
  }
}
