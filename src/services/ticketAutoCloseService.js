import { db, nowIso } from '../database/db.js';
import { cancelOrder } from './orderService.js';
import { closeTicket } from './ticketService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { emitStaffLog } from './staffLogService.js';
import { exportTicketTranscript } from './transcriptService.js';
import { deliverTranscript, updateOrderLogMessage } from './notificationService.js';
import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig } from './guildConfigService.js';
import { config } from '../config.js';
import { isInternationalGuild } from '../utils/locale.js';

/**
 * Dựng thông báo Components V2 (Container + TextDisplay) để emoji custom hiển thị
 * được cả ở dòng tiêu đề — điều mà embed .setTitle() không làm được.
 * @param {{ accent: number, headerEmoji: string, headerText: string, bodyLines: string[] }} opts
 * @returns {{ components: any[], flags: number }}
 */
export function buildNoticeV2({ accent, headerEmoji, headerText, bodyLines }) {
  const header = [headerEmoji, headerText].filter(Boolean).join(' ').trim();
  const container = new ContainerBuilder().setAccentColor(accent);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${header}`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(bodyLines.join('\n'))
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildPaymentReminderV2({ guildId, customerId, orderCode, stage = 'first' }) {
  const E = createEmojiResolver(guildId);
  const isFinal = stage === 'final';
  const deadlineMinutes = isFinal ? 10 : 20;
  const international = isInternationalGuild(guildId);

  return buildNoticeV2({
    accent: isFinal ? 0xE67E22 : 0xFEE75C,
    headerEmoji: isFinal ? E('status_warn') : E('icon_clock'),
    headerText: international
      ? (isFinal ? 'PAYMENT REMINDER • FINAL NOTICE' : 'PAYMENT REMINDER • 1/2')
      : (isFinal ? 'NHẮC THANH TOÁN · LẦN CUỐI' : 'NHẮC THANH TOÁN · LẦN 1/2'),
    bodyLines: international ? [
      `${E('ticket_user')} Hi <@${customerId}>, payment has not been confirmed for your order yet.`,
      '',
      `> ${E('order_id')} **Order:** \`${orderCode}\``,
      `> ${E('icon_clock')} **Time remaining:** **${deadlineMinutes} minutes**`,
      `> ${E('payment_money')} **Action required:** ${isFinal ? 'Complete payment or reply in this ticket now.' : 'Pay or send a short reply to keep the ticket open.'}`,
      '',
      isFinal
        ? `${E('order_cancel')} **After this deadline, the order is cancelled and the ticket closes automatically.**`
        : `${E('status_info')} A short message such as \`I am paying now\` confirms that you still need assistance.`,
      '',
      `-# ${E('ticket_open')} Automated ticket monitoring · You do not need to mention staff or the Owner`,
    ] : [
      `${E('ticket_user')} Chào <@${customerId}>, hệ thống vẫn chưa ghi nhận thanh toán cho đơn hàng của bạn.`,
      '',
      `> ${E('order_id')} **Mã đơn:** \`${orderCode}\``,
      `> ${E('icon_clock')} **Thời hạn còn lại:** **${deadlineMinutes} phút**`,
      `> ${E('payment_money')} **Cần thực hiện:** ${isFinal ? 'Hoàn tất thanh toán hoặc phản hồi ngay trong ticket.' : 'Thanh toán hoặc gửi một phản hồi để giữ ticket mở.'}`,
      '',
      isFinal
        ? `${E('order_cancel')} **Sau thời hạn trên, đơn sẽ tự động hủy và ticket sẽ được đóng.**`
        : `${E('status_info')} Chỉ cần gửi một tin nhắn ngắn như \`mình đang thanh toán\` để hệ thống ghi nhận bạn vẫn cần hỗ trợ.`,
      '',
      `-# ${E('ticket_open')} Ticket được theo dõi tự động · Không cần ping nhân viên hoặc Owner`,
    ],
  });
}

export async function processPendingPaymentTickets(client) {
  try {
    const pendingOrders = db.prepare(`
      SELECT * FROM orders 
      WHERE guild_id = ?
        AND status = 'PENDING_PAYMENT' 
        and payment_status IN ('UNPAID', 'CANCELLED')
    `).all(config.guildId);

    const now = Date.now();

    for (const order of pendingOrders) {
      const createdTime = new Date(order.created_at).getTime();
      const ageMinutes = (now - createdTime) / (60 * 1000);

      // Nếu không có kênh ticket Discord, tự động hủy đơn sau 15 phút
      if (!order.ticket_channel_id) {
        if (ageMinutes >= 15 || order.payment_status === 'CANCELLED') {
          cancelOrder(order.order_code, order.payment_cancel_reason || 'Tự động hủy đơn hàng không có kênh ticket');
        }
        continue;
      }

      // Bỏ qua các đơn WEB - ticket_channel_id không phải Discord snowflake
      // Ví dụ: 'web-cn-854625' là ID đơn web, không thể fetch từ Discord API
      if (
        typeof order.ticket_channel_id === 'string' &&
        (order.ticket_channel_id.startsWith('web-') || !/^\d+$/.test(order.ticket_channel_id))
      ) {
        continue; // Đơn web không có Discord channel, bỏ qua silently
      }

      // Lấy kênh Discord tương ứng
      let channel = null;
      try {
        channel = await client.channels.fetch(order.ticket_channel_id);
      } catch (err) {
        // Chỉ hủy đơn nếu Discord API trả về mã lỗi 10003 (Unknown Channel) - tức là kênh thực sự đã bị xóa!
        if (err.code === 10003) {
          cancelOrder(order.order_code, 'Kênh ticket đã bị xóa bên ngoài');
        } else {
          console.error(`[PENDING-PAYMENT-TICKETS] Lỗi tạm thời khi fetch channel ${order.ticket_channel_id} (Đơn ${order.order_code}):`, err.message);
        }
        continue;
      }

      const E = createEmojiResolver(order.guild_id);

      // Nếu trạng thái thanh toán đã bị hủy hoặc hết hạn, xử lý hủy đơn và đóng ticket ngay lập tức
      if (order.payment_status === 'CANCELLED') {
        const payload = buildNoticeV2({
          accent: 0xED4245, // Đỏ
          headerEmoji: E('order_cancel'),
          headerText: 'ĐƠN HÀNG BỊ HỦY',
          bodyLines: [
            `${E('status_cross')} Đơn hàng **${order.order_code}** đã bị hủy do liên kết thanh toán đã hết hạn hoặc bị hủy.`,
            '',
            `${E('ticket_close')} **Ticket này sẽ tự động đóng và xóa kênh sau 5 giây.**`,
          ],
        });

        await channel.send(payload).catch(() => null);

        const cancelled = cancelOrder(order.order_code, order.payment_cancel_reason || 'Thanh toán bị hủy hoặc hết hạn');
        if (cancelled) {
          await updateOrderLogMessage(channel.guild, cancelled).catch(() => null);
        }

        setTimeout(async () => {
          try {
            const ticket = db.prepare('SELECT * FROM tickets WHERE related_order_code = ?').get(order.order_code);
            if (ticket) {
              const transcriptResult = await exportTicketTranscript(channel).catch(() => null);
              closeTicket(ticket.id, client.user.id);

              await emitStaffLog(client, {
                guildId: order.guild_id,
                actorId: client.user.id,
                targetId: order.customer_id,
                action: 'TICKET_CLOSE',
                detail: `Auto-close ticket do thanh toán bị hủy/hết hạn`,
                relatedTicketCode: ticket.ticket_code,
                relatedOrderCode: order.order_code,
              });

              if (transcriptResult) {
                await deliverTranscript({
                  guild: channel.guild,
                  ticket,
                  transcriptResult,
                  closedById: client.user.id,
                });
              }
            }
            await channel.delete('Auto-close ticket do thanh toán bị hủy/hết hạn').catch(() => null);
          } catch (err) {
            console.error('[AUTO CLOSE TICKET ERR CANCELLED]', err);
          }
        }, 5000);
        continue;
      }

      // CASE 1: Chưa gửi nhắc nhở lần 1
      if (!order.payment_reminder_sent_at) {
        if (ageMinutes >= 15) {
          const payload = buildPaymentReminderV2({
            guildId: order.guild_id,
            customerId: order.customer_id,
            orderCode: order.order_code,
            stage: 'first',
          });

          await channel.send({
            ...payload,
            allowedMentions: { users: [order.customer_id] },
          }).catch(() => null);

          db.prepare(`
            UPDATE orders
            SET payment_reminder_sent_at = ?, updated_at = ?
            WHERE order_code = ?
          `).run(nowIso(), nowIso(), order.order_code);
        }
        continue;
      }

      // CASE 2: Đã gửi nhắc nhở lần 1, đang đợi 20 phút
      if (order.payment_reminder_sent_at && !order.processing_reminder_sent_at) {
        const firstWarnTime = new Date(order.payment_reminder_sent_at).getTime();
        const minsSinceFirstWarn = (now - firstWarnTime) / (60 * 1000);

        if (minsSinceFirstWarn >= 20) {
          // Kiểm tra xem khách hàng có tin nhắn mới nào sau firstWarnTime không
          const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => null);
          let customerReplied = false;
          let latestReplyTimestamp = 0;

          if (msgs) {
            const customerMsgs = msgs.filter(
              m => m.author.id === order.customer_id && m.createdTimestamp > firstWarnTime
            );
            if (customerMsgs.size > 0) {
              customerReplied = true;
              latestReplyTimestamp = Math.max(...customerMsgs.map(m => m.createdTimestamp));
            }
          }

          if (!customerReplied) {
            // Không phản hồi -> Tự động hủy đơn & đóng ticket
            const payload = buildNoticeV2({
              accent: 0xED4245, // Đỏ
              headerEmoji: E('order_cancel'),
              headerText: 'ĐƠN HÀNG BỊ HỦY TỰ ĐỘNG',
              bodyLines: [
                `${E('status_cross')} Đơn hàng **${order.order_code}** đã bị hủy tự động do quá **20 phút** không nhận được phản hồi hoặc thanh toán kể từ lần nhắc thứ 1.`,
                '',
                `${E('ticket_close')} **Ticket này sẽ tự động đóng và xóa kênh sau 5 giây.**`,
              ],
            });

            await channel.send(payload).catch(() => null);

            cancelOrder(order.order_code, 'Tự động hủy do quá 20 phút không phản hồi/thanh toán lần 1');
            
            setTimeout(async () => {
              try {
                const ticket = db.prepare('SELECT * FROM tickets WHERE related_order_code = ?').get(order.order_code);
                if (ticket) {
                  const transcriptResult = await exportTicketTranscript(channel).catch(() => null);
                  closeTicket(ticket.id, client.user.id);

                  await emitStaffLog(client, {
                    guildId: order.guild_id,
                    actorId: client.user.id,
                    targetId: order.customer_id,
                    action: 'TICKET_CLOSE',
                    detail: `Auto-close ticket do không thanh toán/phản hồi`,
                    relatedTicketCode: ticket.ticket_code,
                    relatedOrderCode: order.order_code,
                  });

                  if (transcriptResult) {
                    await deliverTranscript({
                      guild: channel.guild,
                      ticket,
                      transcriptResult,
                      closedById: client.user.id,
                    });
                  }
                }
                await channel.delete('Auto-close ticket do quá thời hạn thanh toán').catch(() => null);
              } catch (err) {
                console.error('[AUTO CLOSE TICKET ERR]', err);
              }
            }, 5000);

          } else {
            // Khách có phản hồi -> Check xem đã quá 5 phút kể từ tin nhắn cuối cùng chưa
            const minsSinceReply = (now - latestReplyTimestamp) / (60 * 1000);
            if (minsSinceReply >= 5) {
              // Nhắc nhở lần 2 (Đợi 10 phút)
              const payload = buildPaymentReminderV2({
                guildId: order.guild_id,
                customerId: order.customer_id,
                orderCode: order.order_code,
                stage: 'final',
              });

              await channel.send({
                ...payload,
                allowedMentions: { users: [order.customer_id] },
              }).catch(() => null);

              db.prepare(`
                UPDATE orders 
                SET processing_reminder_sent_at = ?, updated_at = ? 
                WHERE order_code = ?
              `).run(nowIso(), nowIso(), order.order_code);
            }
          }
        }
        continue;
      }

      // CASE 3: Đã nhắc nhở lần 2, đang đợi 10 phút
      if (order.processing_reminder_sent_at) {
        const secondWarnTime = new Date(order.processing_reminder_sent_at).getTime();
        const minsSinceSecondWarn = (now - secondWarnTime) / (60 * 1000);

        if (minsSinceSecondWarn >= 10) {
          // Kiểm tra xem khách có nhắn gì mới sau secondWarnTime không
          const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => null);
          let customerRepliedAfterSecond = false;

          if (msgs) {
            const customerMsgs = msgs.filter(
              m => m.author.id === order.customer_id && m.createdTimestamp > secondWarnTime
            );
            if (customerMsgs.size > 0) {
              customerRepliedAfterSecond = true;
            }
          }

          if (!customerRepliedAfterSecond) {
            // Không phản hồi lần 2 -> Đóng ticket
            const payload = buildNoticeV2({
              accent: 0xED4245, // Đỏ
              headerEmoji: E('order_cancel'),
              headerText: 'ĐƠN HÀNG BỊ HỦY TỰ ĐỘNG (LẦN CUỐI)',
              bodyLines: [
                `${E('status_cross')} Đơn hàng **${order.order_code}** đã bị hủy tự động do quá **10 phút** không nhận được phản hồi hoặc thanh toán kể từ lần nhắc cuối cùng.`,
                '',
                `${E('ticket_close')} **Ticket này sẽ tự động đóng và xóa kênh sau 5 giây.**`,
              ],
            });

            await channel.send(payload).catch(() => null);

            cancelOrder(order.order_code, 'Tự động hủy do quá 10 phút không phản hồi/thanh toán lần 2');

            setTimeout(async () => {
              try {
                const ticket = db.prepare('SELECT * FROM tickets WHERE related_order_code = ?').get(order.order_code);
                if (ticket) {
                  const transcriptResult = await exportTicketTranscript(channel).catch(() => null);
                  closeTicket(ticket.id, client.user.id);

                  await emitStaffLog(client, {
                    guildId: order.guild_id,
                    actorId: client.user.id,
                    targetId: order.customer_id,
                    action: 'TICKET_CLOSE',
                    detail: `Auto-close ticket lần 2 do không thanh toán/phản hồi`,
                    relatedTicketCode: ticket.ticket_code,
                    relatedOrderCode: order.order_code,
                  });

                  if (transcriptResult) {
                    await deliverTranscript({
                      guild: channel.guild,
                      ticket,
                      transcriptResult,
                      closedById: client.user.id,
                    });
                  }
                }
                await channel.delete('Auto-close ticket lần 2 do quá thời hạn thanh toán').catch(() => null);
              } catch (err) {
                console.error('[AUTO CLOSE TICKET ERR 2]', err);
              }
            }, 5000);
          } else {
            // Khách lại có phản hồi tiếp -> Reset status để cho phép nhắc nhở tiếp sau 5 phút nếu vẫn chưa trả tiền
            db.prepare(`
              UPDATE orders 
              SET processing_reminder_sent_at = NULL, updated_at = ? 
              WHERE order_code = ?
            `).run(nowIso(), order.order_code);
          }
        }
      }
    }
  } catch (error) {
    console.error('[TICKET AUTO CLOSE SERVICE] Lỗi:', error);
  }
}

export async function processCompletedFeedbackTickets(client) {
  try {
    const orders = db.prepare(`
      SELECT * FROM orders 
      WHERE guild_id = ?
        AND status = 'COMPLETED' 
        AND feedback_due_at IS NOT NULL 
        AND feedback_submitted_at IS NULL 
        AND non_legit_assigned_at IS NULL
    `).all(config.guildId);

    const now = Date.now();

    for (const order of orders) {
      const completedTime = new Date(order.completed_at).getTime();
      const dueTime = new Date(order.feedback_due_at).getTime();
      
      const elapsedHours = (now - completedTime) / (1000 * 60 * 60);

      // Lấy kênh Discord tương ứng
      const channel = await client.channels.fetch(order.ticket_channel_id).catch(() => null);

      // CASE 1: Quá hạn feedback (quá 48 tiếng hoặc qua dueTime) -> Tước bảo hành + Gắn role + Đóng ticket
      if (now >= dueTime || elapsedHours >= 48) {
        // Gắn role "Quên feedback"
        try {
          const guild = client.guilds.cache.get(order.guild_id) || await client.guilds.fetch(order.guild_id).catch(() => null);
          if (guild) {
            const guildConfig = getGuildConfig(order.guild_id);
            if (guildConfig && guildConfig.non_legit_role_id) {
              const member = await guild.members.fetch(order.customer_id).catch(() => null);
              if (member) {
                await member.roles.add(guildConfig.non_legit_role_id, 'Quá 48h không gửi feedback đơn hàng').catch((e) => {
                  console.error(`[ROLES] Lỗi gán role non-legit cho ${order.customer_id}:`, e.message);
                });
              }
            }
          }
        } catch (roleErr) {
          console.error('[AUTO_CLOSE_FEEDBACK] Lỗi xử lý gán role:', roleErr.message);
        }

        // Cập nhật database để đánh dấu đã xử lý tước bảo hành
        db.prepare(`
          UPDATE orders 
          SET non_legit_assigned_at = ?, updated_at = ? 
          WHERE order_code = ?
        `).run(nowIso(), nowIso(), order.order_code);

        if (channel) {
          const E = createEmojiResolver(order.guild_id);
          const payload = buildNoticeV2({
            accent: 0xED4245, // Đỏ
            headerEmoji: E('ticket_close'),
            headerText: 'TỰ ĐỘNG ĐÓNG TICKET & HỦY BẢO HÀNH',
            bodyLines: [
              `${E('status_cross')} Đơn hàng **${order.order_code}** đã quá **48 giờ** hoàn thành nhưng bạn vẫn chưa gửi đánh giá (feedback).`,
              '',
              `${E('status_warn')} **Hậu quả:**`,
              `${E('order_product')} Tài khoản của bạn đã bị gắn role **Quên Feedback**.`,
              `${E('order_product')} Bạn **bị tước bỏ hoàn toàn quyền lợi bảo hành** cho đơn hàng này.`,
              `${E('order_product')} Kênh ticket này sẽ **tự động đóng và xóa sau 5 giây.**`,
            ],
          });

          await channel.send(payload).catch(() => null);

          setTimeout(async () => {
            try {
              const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(order.ticket_channel_id);
              if (ticket) {
                const transcriptResult = await exportTicketTranscript(channel).catch(() => null);
                closeTicket(ticket.id, client.user.id);

                await emitStaffLog(client, {
                  guildId: order.guild_id,
                  actorId: client.user.id,
                  targetId: order.customer_id,
                  action: 'TICKET_CLOSE',
                  detail: `Auto-close do quá 48h không feedback (tước bảo hành)`,
                  relatedTicketCode: ticket.ticket_code,
                  relatedOrderCode: order.order_code,
                });

                if (transcriptResult) {
                  await deliverTranscript({
                    guild: channel.guild,
                    ticket,
                    transcriptResult,
                    closedById: client.user.id,
                  });
                }
              }
              await channel.delete('Quá 48h không feedback').catch(() => null);
            } catch (err) {
              console.error('[AUTO_CLOSE_FEEDBACK_ERR]', err);
            }
          }, 5000);
        }
        continue;
      }

      // CASE 2: Chưa gửi nhắc nhở và đã quá 24 tiếng kể từ khi hoàn thành -> Gửi nhắc nhở
      if (!order.feedback_reminder_sent_at && elapsedHours >= 24) {
        if (channel) {
          const E = createEmojiResolver(order.guild_id);
          const payload = buildNoticeV2({
            accent: 0xFEE75C, // Vàng/Cam
            headerEmoji: E('icon_clock'),
            headerText: 'NHẮC NHỞ HOÀN TẤT ĐÁNH GIÁ (FEEDBACK)',
            bodyLines: [
              `${E('icon_fire')} Chào <@${order.customer_id}>, đơn hàng **${order.order_code}** của bạn đã hoàn thành được **24 giờ**. Tuy nhiên, hệ thống nhận thấy bạn chưa gửi đánh giá (feedback) về cho shop.`,
              '',
              `${E('order_product')} **Yêu cầu:** Vui lòng hoàn tất đánh giá trong vòng **24 giờ tới** để **kích hoạt & bảo vệ quyền lợi bảo hành** trọn đời của đơn hàng.`,
              '',
              `${E('status_warn')} **Lưu ý:** Nếu quá **48 giờ** kể từ lúc giao hàng mà bạn vẫn chưa feedback, hệ thống sẽ **tự động đóng ticket, gắn role Quên Feedback và hủy quyền lợi bảo hành** của đơn hàng này.`,
              '',
              `${E('icon_star')} **Cách gửi:** Gõ lệnh **/feedback** và điền số sao cùng ý kiến của bạn.`,
            ],
          });

          await channel.send({
            ...payload,
            allowedMentions: { users: [order.customer_id] },
          }).catch(() => null);
        }

        db.prepare(`
          UPDATE orders 
          SET feedback_reminder_sent_at = ?, updated_at = ? 
          WHERE order_code = ?
        `).run(nowIso(), nowIso(), order.order_code);
      }
    }
  } catch (error) {
    console.error('[TICKET AUTO CLOSE SERVICE - FEEDBACK] Lỗi:', error);
  }
}
