import { Client, Events, REST, Routes } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { initDatabase } from './database/db.js';
import { getClientOptions, loadCommands, registerInteractionHandler } from './events/interactionCreate.js';
import { startScheduler } from './services/schedulerService.js';
import { startWebhookServer } from './services/webhookServer.js';
import { startPresenceRotation } from './services/presenceService.js';
import { startOtpAutoCheck } from './services/otpAutoCheckService.js';
import { backfillRecentDeliverySubscriptions } from './services/deliverySubscriptionService.js';
import { migrateSubscriptionMonthlyCycles } from './services/subscriptionService.js';
import { cleanupExpiredTranscripts } from './services/transcriptService.js';

import { initErrorLogger } from './services/errorLogService.js';
import { autoSetupDiscountBoard } from './services/autoSetupDiscountBoardService.js';
import { isInternationalGuild } from './utils/locale.js';
import { localizeCommandsForInternationalStore } from './utils/internationalCommands.js';

export async function buildClient() {
  initDatabase();
  const transcriptCleanup = cleanupExpiredTranscripts();
  console.log(`[TRANSCRIPT-CLEANUP] scanned=${transcriptCleanup.scanned} removed=${transcriptCleanup.removed}`);
  const subscriptionMigration = migrateSubscriptionMonthlyCycles();
  console.log(`[SUBSCRIPTION-MIGRATION] scanned=${subscriptionMigration.scanned} normalized=${subscriptionMigration.normalized} needsReview=${subscriptionMigration.needsReview} history=${subscriptionMigration.historyCreated}`);
  const subscriptionBackfill = backfillRecentDeliverySubscriptions({ lookbackDays: 3650 });
  console.log(`[SUBSCRIPTION-SYNC] scanned=${subscriptionBackfill.scanned} created=${subscriptionBackfill.created} skipped=${subscriptionBackfill.skipped} failed=${subscriptionBackfill.failed.length}`);
  for (const failure of subscriptionBackfill.failed) {
    console.error(`[SUBSCRIPTION-SYNC] ${failure.orderCode}: ${failure.error}`);
  }

  const commands = await loadCommands();
  const client = new Client(getClientOptions());
  global.discordClient = client;

  initErrorLogger(client);
  registerInteractionHandler(client, commands);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[READY] Logged in as ${readyClient.user.tag}`);
    console.log(`[READY] Loaded ${commands.size} slash commands`);

    startPresenceRotation(readyClient);
    startScheduler(readyClient);
    startWebhookServer(readyClient);
    startOtpAutoCheck(readyClient);

    // Store 2 is the international storefront. The migration is idempotent,
    // preserves Discord IDs/permission overwrites and creates a recovery
    // snapshot before the first structural rename.
    try {
      const { setupInternationalStores } = await import('./services/internationalStoreSetupService.js');
      await setupInternationalStores(readyClient);
    } catch (error) {
      console.error('[GLOBAL-SETUP] International storefront migration failed:', error);
    }

    // Slash-command definitions live in Discord, not in the running process.
    // Republish them on every production restart so newly added options (for
    // example so_ngay on /order and /oder) always match the deployed source.
    try {
      const baseCommandData = [...commands.values()].map((command) => command.data.toJSON());
      const commandData = isInternationalGuild(config.guildId)
        ? localizeCommandsForInternationalStore(baseCommandData)
        : baseCommandData;
      const rest = new REST({ version: '10' }).setToken(config.botToken);
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commandData });
      console.log(`[COMMANDS] Published ${commandData.length} guild commands from the active source revision.`);
    } catch (error) {
      console.error('[COMMANDS] Failed to publish guild commands:', error);
    }

    await autoSetupDiscountBoard(readyClient);

    import('./services/roleService.js').then(({ syncCustomerActivityRoles }) => {
      syncCustomerActivityRoles(readyClient)
        .then((result) => console.log(`[PATRON-SYNC] scanned=${result.scanned} synced=${result.synced} skipped=${result.skipped}`))
        .catch((error) => console.error('[PATRON-SYNC] Failed:', error));
    }).catch((error) => console.error('[PATRON-SYNC] Failed to load role service:', error));

    // Đồng bộ mapping emoji trước khi dựng lại panel để Components V2 luôn dùng
    // đúng tên cenar_<ten> và không render literal :emoji_name:.
    try {
      const { autoSyncGuildEmojis } = await import('./services/emojiService.js');
      for (const guild of readyClient.guilds.cache.values()) {
        await guild.emojis.fetch().catch(() => null);
        const result = autoSyncGuildEmojis(guild);
        console.log(`[EMOJI-SYNC] Synced ${result.syncedCount} emojis for guild: ${guild.name}`);
      }

      const { autoSetupPartnerAndCtv } = await import('./services/autoSetupService.js');
      await autoSetupPartnerAndCtv(readyClient);

      const { autoSetupCardChannel } = await import('./services/autoSetupCardService.js');
      await autoSetupCardChannel(readyClient);

      const { autoRefreshOtpPanel } = await import('./services/autoSetupOtpService.js');
      await autoRefreshOtpPanel(readyClient);

      const { publishPremiumProductsForGuild } = await import('./services/premiumProductSetupService.js');
      for (const guild of readyClient.guilds.cache.values()) {
        await publishPremiumProductsForGuild(guild);
      }

      const { refreshOpenWarrantyActionPanels } = await import('./services/warrantyService.js');
      const warrantyActions = await refreshOpenWarrantyActionPanels(readyClient);
      console.log(`[WARRANTY-ACTIONS] scanned=${warrantyActions.scanned} published=${warrantyActions.published} current=${warrantyActions.current} missing=${warrantyActions.missingChannels}`);

      const { refreshAdminOrderCenter, refreshExistingAdminAgingReminderCards } = await import('./services/adminOrderCenterService.js');
      const storeOneGuild = readyClient.guilds.cache.get(config.storeOneGuildId);
      if (storeOneGuild) {
        const adminCenter = await refreshAdminOrderCenter(storeOneGuild, { force: true });
        if (adminCenter) console.log(`[ADMIN-ORDER-CENTER] Ready in #${adminCenter.channel.name}`);
        const compactCards = await refreshExistingAdminAgingReminderCards(storeOneGuild);
        console.log(`[ADMIN-ORDER-CENTER] Compact cards scanned=${compactCards.scanned} updated=${compactCards.updated} failed=${compactCards.failed} skipped=${compactCards.skipped}`);
      }
    } catch (error) {
      console.error('[AUTO-SETUP] Không thể đồng bộ emoji/panel:', error);
    }

    // Tự động setup kênh Bảng Giá
    import('./services/autoSetupPriceBoardService.js').then(({ autoSetupPriceBoard }) => {
      autoSetupPriceBoard(readyClient).catch(err => {
        console.log(`[AUTO-SETUP-PRICE] Lỗi chạy setup bảng giá: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupPriceBoardService', err));

    // Khởi tạo Invite Tracker (Cache link mời)
    import('./services/inviteTrackerService.js').then(({ initInviteCache, handleInviteCreate, handleInviteDelete }) => {
      initInviteCache(readyClient).catch(err => console.error('[INVITE-TRACKER] Init error:', err));
      readyClient.on('inviteCreate', invite => handleInviteCreate(invite));
      readyClient.on('inviteDelete', invite => handleInviteDelete(invite));
    }).catch(err => console.error('Failed to import inviteTrackerService', err));

    // Remove legacy auto-created giveaways. Manual /giveaway events are preserved.
    import('./services/giveawayService.js').then(({ cancelBotHostedGiveaways }) => {
      cancelBotHostedGiveaways(readyClient).catch(err => {
        console.log(`[GIVEAWAY] Failed to cancel legacy automatic giveaway: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import giveawayService', err));

    // Gửi thông báo bảng giá (Đã gửi xong, tắt auto-run mỗi lần restart để tránh gửi lặp lại thông báo)
    /*
    const ANNOUNCE_CHANNEL_ID = '1514598369597587546';
    setTimeout(async () => { ... }, 8000);
    */

  }); // end client.once ClientReady

  import('./events/messageCreate.js').then((module) => {
    client.on(module.name, (...args) => module.execute(...args));
  }).catch(err => console.error('Failed to load messageCreate event', err));


  import('./events/guildMemberAdd.js').then((module) => {
    client.on(module.name, (...args) => module.execute(...args));
  }).catch(err => console.error('Failed to load guildMemberAdd event', err));

  import('./events/guildMemberRemove.js').then((module) => {
    client.on(module.name, (...args) => module.execute(...args));
  }).catch(err => console.error('Failed to load guildMemberRemove event', err));

  client.salesCommands = commands;
  return client;
}

export async function startBot() {
  assertRuntimeConfig();
  const client = await buildClient();
  await client.login(config.botToken);
  return client;
}

export async function deployCommands() {
  if (!config.botToken || !config.clientId || !config.guildId) {
    throw new Error('Thiếu BOT_TOKEN, CLIENT_ID hoặc GUILD_ID để deploy slash command.');
  }

  initDatabase();

  const commands = await loadCommands();
  const baseCommandData = [...commands.values()].map((command) => command.data.toJSON());
  const commandData = isInternationalGuild(config.guildId)
    ? localizeCommandsForInternationalStore(baseCommandData)
    : baseCommandData;

  const rest = new REST({ version: '10' }).setToken(config.botToken);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: commandData,
  });

  return commandData.length;
}
