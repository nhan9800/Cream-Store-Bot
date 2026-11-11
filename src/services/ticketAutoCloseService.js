import { db, nowIso } from '../database/db.js';
import { cancelOrder } from './orderService.js';
import { closeTicket, closeTicketIfOpen, getTicketById } from './ticketService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { emitStaffLog } from './staffLogService.js';
import { archiveTicketConversation } from './ticketClosureService.js';
import { sendOrderCancelledFlow, updateOrderLogMessage } from './notificationService.js';
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

export function buildPaymentReminderV2({ guildId, customerId, orderCode, stage = 'first', deadlineAt = null }) {
  const E = createEmojiResolver(guildId);
  const isFinal = stage === 'final';
  const deadlineMinutes = deadlineAt === null ? config.unpaidOrderTicketHours * 60
    : Math.max(1, Math.ceil((Number(deadlineAt) - Date.now()) / 60000));
  const deadlineText = deadlineAt === null ? null : `<t:${Math.floor(Number(deadlineAt) / 1000)}:R>`;
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
      `> ${E('icon_clock')} **Ticket closes:** ${deadlineText || `**${config.unpaidOrderTicketHours} hours**`} (${deadlineMinutes} minutes)`,
      `> ${E('payment_money')} **Action required:** ${isFinal ? 'Complete payment or reply in this ticket now.' : 'Pay or send a short reply to keep the ticket open.'}`,
      '',
      isFinal
        ? `${E('order_cancel')} **After this deadline, the order is cancelled and the ticket closes automatically.**`
        : `${E('status_info')} A short message such as \`I am paying now\` confirms that you still need assistance.`,
      `${E('status_info')} An unpaid ticket stays open for at least ${config.unpaidOrderTicketHours} hours after the latest order or ticket activity. QR/payment links may expire earlier; ask for a current invoice if needed.`,
      '',
      `-# ${E('ticket_open')} Automated ticket monitoring · You do not need to mention staff or the Owner`,
    ] : [
      `${E('ticket_user')} Chào <@${customerId}>, hệ thống vẫn chưa ghi nhận thanh toán cho đơn hàng của bạn.`,
      '',
      `> ${E('order_id')} **Mã đơn:** \`${orderCode}\``,
      `> ${E('icon_clock')} **Ticket đóng:** ${deadlineText || `**${config.unpaidOrderTicketHours} giờ**`} (${deadlineMinutes} phút)`,
      `> ${E('payment_money')} **Cần thực hiện:** ${isFinal ? 'Hoàn tất thanh toán hoặc phản hồi ngay trong ticket.' : 'Thanh toán hoặc gửi một phản hồi để giữ ticket mở.'}`,
      '',
      isFinal
        ? `${E('order_cancel')} **Sau thời hạn trên, đơn sẽ tự động hủy và ticket sẽ được đóng.**`
        : `${E('status_info')} Chỉ cần gửi một tin nhắn ngắn như \`mình đang thanh toán\` để hệ thống ghi nhận bạn vẫn cần hỗ trợ.`,
      `${E('status_info')} Ticket chưa thanh toán được giữ ít nhất ${config.unpaidOrderTicketHours} giờ từ đơn mới nhất hoặc hoạt động trong ticket. QR/liên kết thanh toán có thể hết hạn sớm hơn; liên hệ shop để nhận hóa đơn hiện hành khi cần.`,
      '',
      `-# ${E('ticket_open')} Ticket được theo dõi tự động · Không cần ping nhân viên hoặc Owner`,
    ],
  });
}

async function cancelPendingOrderEverywhere({ client, guild = null, order, reason }) {
  const cancelled = cancelOrder(order.order_code, reason);
  if (!cancelled) return null;
  const resolvedGuild = guild
    || client.guilds.cache.get(cancelled.guild_id)
    || await client.guilds.fetch(cancelled.guild_id).catch(() => null);
  if (resolvedGuild) {
    await updateOrderLogMessage(resolvedGuild, cancelled).catch(() => null);
    await sendOrderCancelledFlow({ guild: resolvedGuild, order: cancelled, reason }).catch(() => null);
  }
  return cancelled;
}

function findOrderTicket(order) {
  return getTicketById(Number(order.ticket_id))
    || db.prepare('SELECT * FROM tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1').get(order.ticket_channel_id)
    || null;
}

function paymentTicketState(ticket, now = Date.now()) {
  if (!ticket || ticket.guild_id !== config.guildId || ticket.status !== 'OPEN'
    || ticket.ticket_type !== 'ORDER' || Number(ticket.keep_open_requested) === 1) return null;
  const linked = db.prepare(`SELECT * FROM orders WHERE guild_id=? AND
    (ticket_id=? OR ticket_channel_id=? OR order_code=?)`).all(ticket.guild_id, ticket.id,
    ticket.channel_id, ticket.related_order_code || '');
  if (!linked.length || linked.some(order => ['PAID', 'FREE'].includes(order.payment_status)
    || !['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'].includes(order.status))) return null;
  const pending = linked.filter(order => ['UNPAID', 'CANCELLED'].includes(order.payment_status) && order.status === 'PENDING_PAYMENT'
    || ['UNPAID', 'CANCELLED'].includes(order.payment_status) && order.status === 'CANCELLED'
      && (order.payment_link_id && !order.payment_cancel_reason
        || /^(Thanh toán (?:PayOS )?bị hủy|Thanh toán.*hết hạn|Tự động hủy.*(thanh toán|phản hồi)|Tự động đóng ticket chưa thanh toán)/i.test(order.payment_cancel_reason || '')));
  if (!pending.length) return null;
  const anchors = [ticket.created_at, ticket.last_activity_at, ...pending.map(order => order.created_at)]
    .filter(Boolean).map(value => Date.parse(value));
  if (!anchors.length || anchors.some(value => !Number.isFinite(value))) return null;
  const deadline = Math.max(...anchors) + config.unpaidOrderTicketHours * 3600000;
  return { ticket, pending, deadline, due: now >= deadline };
}

export function getPendingPaymentTicketPolicy() {
  return { idleHours: config.unpaidOrderTicketHours, activityBasis: 'LATEST_ORDER_OR_HUMAN_TICKET_ACTIVITY', invoiceExpirySeparate: true };
}

let pendingPaymentRun = null;
export function processPendingPaymentTickets(client) {
  if (pendingPaymentRun) return pendingPaymentRun;
  pendingPaymentRun = (async () => {
    const orders = db.prepare(`SELECT * FROM orders WHERE guild_id=?
      AND payment_status IN ('UNPAID','CANCELLED') AND status IN ('PENDING_PAYMENT','CANCELLED')`).all(config.guildId);
    const seen = new Set();
    for (const order of orders) {
      try {
        // Preserve the separate legacy no-ticket cleanup; a web pseudo-channel
        // is never a Discord channel and is not part of this policy.
        if (!order.ticket_channel_id) {
          if (order.status === 'PENDING_PAYMENT' && (Date.now() - Date.parse(order.created_at) >= 15 * 60000
            || order.payment_status === 'CANCELLED')) await cancelPendingOrderEverywhere({ client, order,
              reason: order.payment_cancel_reason || 'Tự động hủy đơn hàng không có kênh ticket' });
          continue;
        }
        if (!/^\d{17,20}$/.test(String(order.ticket_channel_id))) continue;
        const ticket = findOrderTicket(order);
        if (!ticket || seen.has(ticket.id)) continue;
        seen.add(ticket.id);
        let state = paymentTicketState(ticket);
        if (!state) continue;
        // Missing access/Unknown Channel alone is not proof a transcript exists.
        const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
        if (!channel || channel.guild?.id !== ticket.guild_id) continue;
        state = paymentTicketState(getTicketById(ticket.id));
        if (!state) continue;
        if (!state.due) {
          const remaining = state.deadline - Date.now();
          const reminder = state.pending.find(item => item.status === 'PENDING_PAYMENT'
            && (!item.payment_reminder_sent_at && Date.now() - Date.parse(item.created_at) >= 15 * 60000
              || remaining <= 10 * 60000 && (!item.processing_reminder_sent_at
                || Date.parse(item.processing_reminder_sent_at) < state.deadline - 10 * 60000)));
          if (!reminder) continue;
          const stage = remaining <= 10 * 60000 ? 'final' : 'first';
          const sent = await channel.send({ ...buildPaymentReminderV2({ guildId: order.guild_id,
            customerId: reminder.customer_id, orderCode: reminder.order_code, stage, deadlineAt: state.deadline }),
            allowedMentions: { parse: [], users: [reminder.customer_id] } }).catch(() => null);
          if (sent) db.prepare(`UPDATE orders SET ${stage === 'final' ? 'processing_reminder_sent_at' : 'payment_reminder_sent_at'}=?,updated_at=?
            WHERE order_code=? AND status='PENDING_PAYMENT' AND payment_status='UNPAID'`).run(nowIso(), nowIso(), reminder.order_code);
          continue;
        }
        const deadline = state.deadline;
        const archive = await archiveTicketConversation({ guild: channel.guild, ticket: state.ticket, channel,
          closedById: client.user.id, minimumCreatedAt: new Date().toISOString() });
        if (!archive?.archived) continue;
        state = paymentTicketState(getTicketById(ticket.id));
        if (!state?.due || state.deadline !== deadline) continue;
        const reason = `Tự động đóng ticket chưa thanh toán sau ${config.unpaidOrderTicketHours} giờ không hoạt động`;
        // Recheck all linked orders synchronously after transcript I/O. Payment,
        // Keep Open, warranty work or a new order must cancel this closure.
        const claim = db.transaction(() => {
          const fresh = paymentTicketState(getTicketById(ticket.id));
          if (!fresh?.due || fresh.deadline !== deadline) return null;
          const cancelled = fresh.pending.filter(item => item.status === 'PENDING_PAYMENT').map(item => cancelOrder(item.order_code, reason));
          // A new purchase must see a closed ticket while Discord DELETE is in
          // flight, rather than bind to a channel already being removed.
          const closure = closeTicketIfOpen(ticket.id, client.user.id);
          return closure.closed ? { cancelled, ticket: closure.ticket } : null;
        }).immediate();
        if (!claim) continue;
        try { await channel.delete(reason); }
        catch (error) {
          if (Number(error?.code) !== 10003) {
            // Undo only our exact closure claim; never overwrite a later admin
            // transition or clear a Keep Open request recorded during DELETE.
            db.prepare(`UPDATE tickets SET status='OPEN',closed_at=NULL,closed_by_id=NULL WHERE id=? AND status='CLOSED'
              AND closed_at=? AND closed_by_id=? AND channel_id=?`).run(ticket.id, claim.ticket.closed_at, client.user.id, ticket.channel_id);
            continue;
          }
          // Unknown Channel confirms the already-archived channel is gone.
        }
        for (const cancelledOrder of claim.cancelled) {
          if (!cancelledOrder) continue;
          await updateOrderLogMessage(channel.guild, cancelledOrder).catch(() => null);
          await sendOrderCancelledFlow({ guild: channel.guild, order: cancelledOrder, reason }).catch(() => null);
        }
        await emitStaffLog(client, { guildId: ticket.guild_id, actorId: client.user.id, targetId: ticket.customer_id,
          action: 'TICKET_CLOSE', detail: reason, relatedTicketCode: ticket.ticket_code,
          relatedOrderCode: order.order_code }).catch(() => null);
      } catch (error) {
        console.error('[PENDING-PAYMENT-TICKETS] Giữ ticket để thử lại:', error?.code || error?.name || 'CLOSE_FAILED');
      }
    }
  })().finally(() => { pendingPaymentRun = null; });
  return pendingPaymentRun;
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
                const archiveResult = await archiveTicketConversation({
                  guild: channel.guild,
                  ticket,
                  channel,
                  closedById: client.user.id,
                });
                if (!archiveResult.archived) {
                  console.error(`[AUTO CLOSE] Giữ kênh ${ticket.ticket_code} vì transcript chưa lưu được.`);
                  return;
                }
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

              } else return;
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
