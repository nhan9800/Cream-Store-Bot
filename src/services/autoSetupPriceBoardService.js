import { ChannelType, MessageFlags } from 'discord.js';
import { buildStockPanelComponents, stockPanelRegistry } from '../commands/stock.js';

export async function autoSetupPriceBoard(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      // Tìm kênh bảng giá (bang-gia / bảng-giá)
      let channel = guild.channels.cache.find(c => 
        c.isTextBased() && (c.name.includes('bang-gia') || c.name.includes('bảng-giá') || c.name.includes('price'))
      );

      // Nếu chưa có kênh bảng giá, tự tạo kênh mới
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

      const components = buildStockPanelComponents(guild.id);
      if (!components) {
        console.log(`[AUTO-SETUP-PRICE] Chưa có sản phẩm nào cho guild ${guild.name}, bỏ qua gửi bảng giá.`);
        continue;
      }

      // Kiểm tra tin nhắn gần đây trong kênh xem bot đã gửi panel chưa
      const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
      let botPanelMsg = null;

      if (messages) {
        botPanelMsg = messages.find(m => m.author.id === client.user.id && m.components && m.components.length > 0);
      }

      if (botPanelMsg) {
        // Cập nhật bảng giá hiện có
        await botPanelMsg.edit({
          components,
          flags: MessageFlags.IsComponentsV2,
        }).catch(err => console.error('[AUTO-SETUP-PRICE] Lỗi edit bảng giá:', err.message));
        
        stockPanelRegistry.set(guild.id, {
          channelId: channel.id,
          messageId: botPanelMsg.id,
        });
        console.log(`[AUTO-SETUP-PRICE] Đã làm mới Bảng Giá tại kênh #${channel.name} (${guild.name})`);
      } else {
        // Gửi mới bảng giá nếu kênh chưa có tin nhắn của bot
        const sentMsg = await channel.send({
          components,
          flags: MessageFlags.IsComponentsV2,
        }).catch(err => {
          console.error('[AUTO-SETUP-PRICE] Lỗi gửi bảng giá mới:', err.message);
          return null;
        });

        if (sentMsg) {
          stockPanelRegistry.set(guild.id, {
            channelId: channel.id,
            messageId: sentMsg.id,
          });
          console.log(`[AUTO-SETUP-PRICE] Đã tự động gửi Bảng Giá đầy đủ vào kênh #${channel.name} (${guild.name})`);
        }
      }
    }
  } catch (error) {
    console.error('[AUTO-SETUP-PRICE] Lỗi chung khi tự động thiết lập Bảng Giá:', error);
  }
}
