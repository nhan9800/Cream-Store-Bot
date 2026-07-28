import { db } from '../database/db.js';
import { checkSession } from './viotpService.js';
import { addWalletBalance } from './walletService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';

let intervalHandle = null;

export function startOtpAutoCheck(client) {
  if (intervalHandle) return;

  async function checkLoop() {
    if (!intervalHandle) return;
    try {
      // Lấy danh sách các đơn OTP đang PENDING
      const pendingOrders = db.prepare("SELECT * FROM viotp_orders WHERE status = 'PENDING'").all();
      
      for (const order of pendingOrders) {
        try {
          const sessionData = await checkSession(order.request_id);
          
          // Status: 0 = Đang đợi, 1 = Hoàn thành, 2 = Hết hạn
          if (sessionData.Status === 1) {
            // Có mã OTP
            db.prepare('UPDATE viotp_orders SET status = ?, otp_code = ? WHERE request_id = ?').run('COMPLETED', sessionData.Code, order.request_id);
            
            // Cố gắng gửi tin nhắn cho khách
            try {
              const E = createEmojiResolver(order.guild_id);
              const user = await client.users.fetch(order.customer_id);
              if (user) {
                const container = new ContainerBuilder().setAccentColor(0x2ECC71);
                container.addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(`## ${E('starxoay')} ĐÃ NHẬN ĐƯỢC MÃ OTP!\n\n**Dịch vụ:** ${order.service_name}\n**Số điện thoại:** \`${order.phone_number}\`\n**Mã OTP:** \`${sessionData.Code}\`\n\n> ${E('status_info')} **Nội dung tin nhắn:**\n> *${sessionData.SmsContent}*`)
                );
                await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
              }
            } catch (dmErr) {
              console.error(`[OTP Auto] Không thể gửi DM cho khách ${order.customer_id}:`, dmErr.message);
            }

          } else if (sessionData.Status === 2) {
            // Hết hạn
            db.prepare('UPDATE viotp_orders SET status = ? WHERE request_id = ?').run('EXPIRED', order.request_id);
            addWalletBalance(order.guild_id, order.customer_id, order.price, 'REFUND', `Hoàn tiền OTP tự động hết hạn (${order.service_name})`);
            
            try {
              const E = createEmojiResolver(order.guild_id);
              const user = await client.users.fetch(order.customer_id);
              if (user) {
                await user.send(`${E('tick_red51') || '❌'} **THÔNG BÁO HOÀN TIỀN**\nPhiên chờ mã OTP của dịch vụ **${order.service_name}** (\`${order.phone_number}\`) đã quá 5 phút và bị tự động hủy.\nHệ thống đã hoàn lại **${order.price.toLocaleString('vi-VN')}đ** vào ví của bạn.`);
              }
            } catch (dmErr) {
              console.error(`[OTP Auto] Không thể gửi DM hết hạn cho khách ${order.customer_id}:`, dmErr.message);
            }
          } else if (sessionData.Status === 0) {
            const createdTime = new Date(order.created_at + 'Z').getTime();
            if (Date.now() - createdTime > 10 * 60 * 1000) { // 10 minutes
              db.prepare('UPDATE viotp_orders SET status = ? WHERE request_id = ?').run('EXPIRED', order.request_id);
              addWalletBalance(order.guild_id, order.customer_id, order.price, 'REFUND', `Hoàn tiền OTP tự động hết hạn quá 10p (${order.service_name})`);
              
              try {
                const E = createEmojiResolver(order.guild_id);
                const user = await client.users.fetch(order.customer_id);
                if (user) {
                  await user.send(`${E('tick_red51') || '❌'} **THÔNG BÁO HOÀN TIỀN**\nPhiên chờ mã OTP của dịch vụ **${order.service_name}** (\`${order.phone_number}\`) đã quá 10 phút chưa nhận được mã.\nHệ thống đã chủ động hoàn lại **${order.price.toLocaleString('vi-VN')}đ** vào ví của bạn.`);
                }
              } catch (dmErr) {}
            }
          }

        } catch (apiErr) {
          if (apiErr.message.includes('Mã phiên không đúng') || apiErr.message.includes('-2')) {
            db.prepare('UPDATE viotp_orders SET status = ? WHERE request_id = ?').run('FAILED', order.request_id);
            addWalletBalance(order.guild_id, order.customer_id, order.price, 'REFUND', `Hoàn tiền OTP lỗi phiên (${order.service_name})`);
            
            try {
              const E = createEmojiResolver(order.guild_id);
              const user = await client.users.fetch(order.customer_id);
              if (user) {
                await user.send(`${E('tick_red51')} **THÔNG BÁO LỖI PHIÊN**\nPhiên thuê OTP **${order.service_name}** (\`${order.phone_number}\`) bị lỗi từ nhà mạng.\nHệ thống đã tự động hoàn lại **${order.price.toLocaleString('vi-VN')}đ** vào ví của bạn.`);
              }
            } catch (dmErr) {
              console.error(`[OTP Auto] Không thể gửi DM lỗi cho khách ${order.customer_id}:`, dmErr.message);
            }
          } else {
            console.error(`[OTP Auto] Lỗi khi check request_id ${order.request_id}:`, apiErr.message);
          }
        }
      }
    } catch (globalErr) {
      console.error('[OTP Auto] Lỗi vòng lặp quét OTP:', globalErr.message);
    }
    
    if (intervalHandle) {
      intervalHandle = setTimeout(checkLoop, 15 * 1000);
    }
  }
  
  // Khởi động loop
  intervalHandle = setTimeout(checkLoop, 0);

  console.log('[OTP Auto Check] Service started (15s recursive interval).');
}

export function stopOtpAutoCheck() {
  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
    console.log('[OTP Auto Check] Service stopped.');
  }
}
