import fs from 'node:fs';
import path from 'node:path';
import { runDeepNotifications, runSubscriptionNotifications } from './deepNotificationService.js';
import { backupDatabase } from './backupService.js';
import {
  getDueAutoCloseTickets,
  closeTicket,
  scheduleMissingFeedbackTicketAutoCloses,
  scheduleTicketAutoClose,
} from './ticketService.js';
import { config } from '../config.js';
import { exportTicketTranscript } from './transcriptService.js';
import { deliverTranscript, updateOrderLogMessage } from './notificationService.js';
import { emitStaffLog } from './staffLogService.js';
import { setOrderStatus } from './orderService.js';
import { runAutoVinhDanh } from './vinhDanhService.js';
import { processPendingPaymentTickets, processCompletedFeedbackTickets } from './ticketAutoCloseService.js';
import { autoUpdateDiscountBoard } from './cardSwapService.js';
import { checkExpiredGiveaways } from './giveawayService.js';
import { processPendingInviteRewards } from './inviteTrackerService.js';
import { processAdminOrderAgingReminders } from './adminOrderCenterService.js';
import { runSpotifyFamilyReminders } from './spotifyFamilyReminderService.js';
import { runYoutubeRenewalReminders } from './youtubeRenewalReminderService.js';
import { syncYoutubeWarrantyClaims } from './youtubeWarrantyClaimService.js';

let schedulerHandle = null;
let backupHandle = null;
let bootstrapped = false;
let lastVinhDanhRun = 0;
let lastDiscountBoardRun = 0;
let lastYoutubeWarrantySync = 0;

function autoBackupDatabase() {
  backupDatabase().catch(e => console.error('[BACKUP] Lỗi hệ thống sao lưu tự động:', e));
}

export function startScheduler(client) {
  if (schedulerHandle) return;

  const intervalMinutes = Number(process.env.DEEP_NOTIFICATION_INTERVAL_MINUTES ?? 5);

  const tick = async () => {
    try {
      await processPendingPaymentTickets(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi tự động đóng ticket chưa thanh toán:', error);
    }

    try {
      await processCompletedFeedbackTickets(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi tự động xử lý ticket chưa feedback:', error);
    }

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
      const { checkExpiredSubscriptionOrders } = await import('./deepNotificationService.js');
      await checkExpiredSubscriptionOrders(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi checkExpiredSubscriptionOrders:', error);
    }

    try {
      await checkExpiredGiveaways(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi checkExpiredGiveaways:', error);
    }

    try {
      await processPendingInviteRewards(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi processPendingInviteRewards:', error);
    }

    try {
      await processAdminOrderAgingReminders(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi nhắc đơn tồn 7/14 ngày cho admin:', error);
    }

    try {
      await runSpotifyFamilyReminders(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi nhắc hạn Spotify Family:', error);
    }

    try {
      await runYoutubeRenewalReminders(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi nhắc thanh toán nguồn YouTube:', error);
    }

    // Reconcile open YouTube warranty tickets periodically so existing tickets
    // receive their Gmail form even when they were opened after bot startup.
    const warrantySyncNow = Date.now();
    if (warrantySyncNow - lastYoutubeWarrantySync >= 5 * 60 * 1000) {
      try {
        const result = await syncYoutubeWarrantyClaims(client, { guildId: config.guildId });
        console.log(`[SCHEDULER-YOUTUBE-WARRANTY] scanned=${result.scanned} created=${result.created} published=${result.published} current=${result.current} missing=${result.missingChannels} failed=${result.failed}`);
        lastYoutubeWarrantySync = warrantySyncNow;
      } catch (error) {
        console.error('[SCHEDULER] Lỗi đồng bộ form bảo hành YouTube:', error);
      }
    }

    // Tự động cập nhật vinh danh định kỳ mỗi 1 tiếng
    const nowMs = Date.now();
    if (nowMs - lastVinhDanhRun >= 60 * 60 * 1000) {
      try {
        await runAutoVinhDanh(client);
        lastVinhDanhRun = nowMs;
      } catch (error) {
        console.error('[SCHEDULER] Lỗi tự động vinh danh:', error);
      }
    }

    // Tự động cập nhật bảng chiết khấu mỗi 1 tiếng
    if (nowMs - lastDiscountBoardRun >= 60 * 60 * 1000) {
      try {
        await autoUpdateDiscountBoard(client);
        lastDiscountBoardRun = nowMs;
      } catch (error) {
        console.error('[SCHEDULER] Lỗi tự động cập nhật bảng chiết khấu:', error);
      }
    }

    try {
      const repairedTickets = scheduleMissingFeedbackTicketAutoCloses(config.guildId);
      if (repairedTickets.length > 0) {
        console.warn(`[SCHEDULER] Đã khôi phục lịch tự đóng cho ${repairedTickets.length} ticket đã feedback.`);
      }

      const dueTickets = getDueAutoCloseTickets(config.guildId, 20);
      for (const ticket of dueTickets) {
        try {
          const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
          if (!channel) {
            closeTicket(ticket.id, client.user.id);
            continue;
          }
          
          const guild = channel.guild;
          const transcriptResult = await exportTicketTranscript(channel).catch(() => null);

          let channelClosed = false;
          try {
            await channel.delete(`Tự động đóng Ticket ${ticket.ticket_code} sau khi feedback`);
            channelClosed = true;
          } catch (deleteError) {
            if (channel.isThread?.()) {
              channelClosed = await channel
                .setArchived(true, `Tự động đóng Ticket ${ticket.ticket_code} sau khi feedback`)
                .then(() => true)
                .catch(() => false);
            }
            if (!channelClosed) {
              scheduleTicketAutoClose(ticket.id, 1);
              console.error(`[SCHEDULER] Discord chưa đóng được ticket ${ticket.ticket_code}; sẽ thử lại sau 1 phút:`, deleteError);
              continue;
            }
          }

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
      runSchedulerLoop();
      autoBackupDatabase();
    }, 5000);
  }

  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  
  async function runSchedulerLoop() {
    if (!schedulerHandle) return; // Stopped
    
    try {
      await tick();
    } catch (e) {
      console.error('[SCHEDULER] Lỗi ngoài ý muốn trong tick():', e);
    }
    
    if (schedulerHandle) {
      schedulerHandle = setTimeout(runSchedulerLoop, intervalMs);
    }
  }

  // Khởi tạo handle để cờ chạy
  schedulerHandle = setTimeout(() => {}, 0); 
  clearTimeout(schedulerHandle);
  schedulerHandle = true; // Use boolean flag or actual handle to track status

  // Chạy file backup mỗi 12 tiếng một lần
  backupHandle = setInterval(() => {
    autoBackupDatabase();
  }, 12 * 60 * 60 * 1000);

  console.log(`[V11.5] Scheduler chạy mỗi ${Math.max(1, intervalMinutes)} phút. Auto-backup giữ tối thiểu 3 điểm phục hồi và chụp recovery snapshot trước khi sao lưu.`);
  console.log(`[V11.5] Cenar Store Bot — Scheduler & Backup Service started.`);
}

export function stopScheduler() {
  if (schedulerHandle && typeof schedulerHandle !== 'boolean') {
    clearTimeout(schedulerHandle);
  }
  schedulerHandle = null;
  
  if (backupHandle) {
    clearInterval(backupHandle);
    backupHandle = null;
  }
}
