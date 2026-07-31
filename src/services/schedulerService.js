import fs from 'node:fs';
import path from 'node:path';
import { runDeepNotifications, runSubscriptionNotifications } from './deepNotificationService.js';
import { backupDatabase } from './backupService.js';
import { getDueAutoCloseTickets, closeTicket } from './ticketService.js';
import { exportTicketTranscript } from './transcriptService.js';
import { deliverTranscript, updateOrderLogMessage } from './notificationService.js';
import { emitStaffLog } from './staffLogService.js';
import { setOrderStatus } from './orderService.js';

let schedulerHandle = null;
let backupHandle = null;
let bootstrapped = false;

function autoBackupDatabase() {
  backupDatabase().catch(e => console.error('[BACKUP] Lỗi hệ thống sao lưu tự động:', e));
}

export function startScheduler(client) {
  if (schedulerHandle) return;

  const intervalMinutes = Number(process.env.DEEP_NOTIFICATION_INTERVAL_MINUTES ?? 5);

  const tick = async () => {
    try {
      await runDeepNotifications(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi deep notifications:', error);
    }

    try {
      await runSubscriptionNotifications(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi subscription notifications:', error);
    }

    try {
      const dueTickets = getDueAutoCloseTickets(20);
      for (const ticket of dueTickets) {
        try {
          const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
          if (!channel) {
            closeTicket(ticket.id, client.user.id);
            continue;
          }
          
          const guild = channel.guild;
          const transcriptResult = await exportTicketTranscript(channel).catch(() => null);
          closeTicket(ticket.id, client.user.id);

          await emitStaffLog(client, {
            guildId: ticket.guild_id,
            actorId: client.user.id,
            targetId: ticket.customer_id,
            action: 'TICKET_CLOSE',
            detail: `Auto-close ticket sau thời gian feedback`,
            relatedTicketCode: ticket.ticket_code,
            relatedOrderCode: ticket.related_order_code ?? null,
          });

          if (ticket.ticket_type === 'WARRANTY' && ticket.related_order_code) {
            const order = setOrderStatus(ticket.related_order_code, 'COMPLETED');
            if (order) await updateOrderLogMessage(guild, order);
          }

          if (transcriptResult) {
            await deliverTranscript({
              guild,
              ticket,
              transcriptResult,
              closedById: client.user.id,
            });
          }

          await channel.delete(`Tự động đóng Ticket ${ticket.ticket_code} sau khi feedback`).catch(() => null);
        } catch (e) {
          console.error(`[SCHEDULER] Lỗi auto close ticket ${ticket.id}:`, e);
        }
      }
    } catch (error) {
      console.error('[SCHEDULER] Lỗi auto-close tickets:', error);
    }
  };

  if (!bootstrapped) {
    bootstrapped = true;
    setTimeout(() => {
      tick().catch(() => null);
      autoBackupDatabase();
    }, 5000);
  }

  schedulerHandle = setInterval(() => {
    tick().catch(() => null);
  }, Math.max(1, intervalMinutes) * 60 * 1000);

  console.log(`[V11.5] Scheduler đang chạy mỗi ${Math.max(1, intervalMinutes)} phút. Chế độ Auto-backup sẽ được xử lý qua PM2 cron.`);

  console.log(`[V11.5] Scheduler đang chạy mỗi ${Math.max(1, intervalMinutes)} phút. Chế độ Auto-backup Bật (lưu 7 ngày).`);
  console.log(`[V11.5] Cenar Store Bot — Scheduler & Backup Service started.`);
}
export function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
