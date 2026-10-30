import { runDeepNotifications, runSubscriptionNotifications } from './deepNotificationService.js';
import { backupDatabase } from './backupService.js';
import { config } from '../config.js';
import { startFeedbackTicketAutoClose, stopFeedbackTicketAutoClose } from './feedbackTicketAutoCloseService.js';
import { runAutoVinhDanh } from './vinhDanhService.js';
import { processPendingPaymentTickets, processCompletedFeedbackTickets } from './ticketAutoCloseService.js';
import { autoUpdateDiscountBoard } from './cardSwapService.js';
import { checkExpiredGiveaways } from './giveawayService.js';
import { processPendingInviteRewards } from './inviteTrackerService.js';
import { processAdminOrderAgingReminders } from './adminOrderCenterService.js';
import { runSpotifyFamilyReminders } from './spotifyFamilyReminderService.js';
import { runYoutubeRenewalReminders } from './youtubeRenewalReminderService.js';
import { syncYoutubeWarrantyClaimsAcrossGuilds } from './youtubeWarrantyClaimService.js';
import { processPendingDeliveries } from './autoDeliveryService.js';
import { reconcileRecentPayOSPayments } from './paymentService.js';
import { processPendingCustomerRoles } from './customerRoleSyncService.js';
import { dailySaleDateKey, publishDailyFlashSale } from '../campaigns/dailyColorSale2026.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { AUTOMATIC_MARKETING_PAUSED } from '../config/marketingAutomationPolicy.js';

let schedulerHandle = null;
let backupHandle = null;
let dailyPromotionHandle = null;
let customerRoleHandle = null;
let bootstrapped = false;
let lastVinhDanhRun = 0;
let lastDiscountBoardRun = 0;
let lastYoutubeWarrantySync = 0;
let lastDailyFlashSaleDate = null;

async function autoBackupDatabase() {
  try {
    const report = await backupDatabase();
    console.log(`[BACKUP] Hoàn tất với trạng thái ${report.overallStatus}; Telegram=${report.telegram.status}, GoogleDrive=${report.googleDrive.status}.`);
  } catch (error) {
    console.error('[BACKUP] Lỗi hệ thống sao lưu tự động:', error);
  }
}

export function startScheduler(client) {
  if (schedulerHandle) return;

  // A two-minute feedback deadline cannot wait for the five-minute maintenance
  // cycle or its payment/reminder network calls.
  startFeedbackTicketAutoClose(client);

  const intervalMinutes = Number(process.env.DEEP_NOTIFICATION_INTERVAL_MINUTES ?? 5);

  const tick = async () => {
    try {
      const reconciliation = await reconcileRecentPayOSPayments(client);
      if (reconciliation.synced || reconciliation.failed.length) {
        console.log(`[PAYOS-RECONCILIATION] scanned=${reconciliation.scanned} synced=${reconciliation.synced} repairedNotifications=${reconciliation.repairedNotifications} failed=${reconciliation.failed.length}`);
      }
      for (const failure of reconciliation.failed) {
        console.error(`[PAYOS-RECONCILIATION] ${failure.orderCode}: ${failure.error}`);
      }
    } catch (error) {
      console.error('[SCHEDULER] Lỗi đối soát thanh toán PayOS:', error);
    }

    try {
      await processPendingDeliveries(client);
    } catch (error) {
      console.error('[SCHEDULER] Lỗi thử lại giao hàng tự động:', error);
    }

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
        const result = await syncYoutubeWarrantyClaimsAcrossGuilds(client, { guildIds: [config.guildId] });
        console.log(`[SCHEDULER-YOUTUBE-WARRANTY] scanned=${result.scanned} created=${result.created} published=${result.published} current=${result.current} missing=${result.missingChannels} skipped=${result.skipped} failed=${result.failed}`);
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

  };

  if (!bootstrapped) {
    bootstrapped = true;
    setTimeout(() => {
      runSchedulerLoop();
      autoBackupDatabase();
    }, 5000);
  }

  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  async function runDailyPromotionLoop() {
    if (!dailyPromotionHandle) return;
    try {
      const promotionDate = dailySaleDateKey(new Date());
      if (promotionDate !== lastDailyFlashSaleDate) {
        const result = await publishDailyFlashSale(client, { tagEveryone: true, tagMember: false });
        if (result.status === 'posted' || result.status === 'already_posted') {
          lastDailyFlashSaleDate = promotionDate;
          console.log(`[DAILY-FLASH-SALE] status=${result.status} date=${result.dateKey} message=${result.messageId}`);
        }
      }
    } catch (error) {
      console.error('[DAILY-FLASH-SALE] Lỗi đăng bài hằng ngày; sẽ thử lại sau 1 phút:', error);
    } finally {
      if (dailyPromotionHandle) {
        dailyPromotionHandle = setTimeout(runDailyPromotionLoop, 60 * 1000);
      }
    }
  }
  
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

  async function runCustomerRoleLoop() {
    if (!customerRoleHandle) return;
    try {
      const result = await processPendingCustomerRoles(client);
      if (result.scanned) console.log(`[CUSTOMER-ROLE-SYNC] scanned=${result.scanned} synced=${result.synced} pending=${result.pending}`);
    } catch (error) {
      console.error('[CUSTOMER-ROLE-SYNC] Retry deferred:', error.code || error.name);
    } finally {
      if (customerRoleHandle) customerRoleHandle = setTimeout(runCustomerRoleLoop, 60_000);
    }
  }
  customerRoleHandle = setTimeout(runCustomerRoleLoop, 10_000);

  // Chạy file backup mỗi 12 tiếng một lần
  backupHandle = setInterval(() => {
    autoBackupDatabase();
  }, 12 * 60 * 60 * 1000);

  // Chạy độc lập với vòng bảo trì chính để một tác vụ mạng chậm không làm lỡ
  // bài Flash Sale 09:00. Khóa ngày và marker Discord vẫn ngăn đăng trùng.
  if (!AUTOMATIC_MARKETING_PAUSED && String(config.guildId) === STORE_ONE_GUILD_ID && !dailyPromotionHandle) {
    dailyPromotionHandle = setTimeout(runDailyPromotionLoop, 8000);
  }

  console.log(`[V11.5] Scheduler chạy mỗi ${Math.max(1, intervalMinutes)} phút. Auto-backup giữ tối thiểu 3 điểm phục hồi và chụp recovery snapshot trước khi sao lưu.`);
  console.log(`[V11.5] Cenar Store Bot — Scheduler & Backup Service started.`);
}

export function stopScheduler() {
  stopFeedbackTicketAutoClose();
  if (customerRoleHandle) clearTimeout(customerRoleHandle);
  customerRoleHandle = null;
  if (schedulerHandle && typeof schedulerHandle !== 'boolean') {
    clearTimeout(schedulerHandle);
  }
  schedulerHandle = null;
  
  if (backupHandle) {
    clearInterval(backupHandle);
    backupHandle = null;
  }

  if (dailyPromotionHandle) {
    clearTimeout(dailyPromotionHandle);
    dailyPromotionHandle = null;
  }
}
