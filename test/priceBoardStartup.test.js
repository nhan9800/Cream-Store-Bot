import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map(),
  publish: vi.fn(),
  webhook: vi.fn(),
  scheduler: vi.fn(),
  cleanup: vi.fn(),
  otp: vi.fn(),
  destroy: vi.fn(),
  icons: vi.fn(),
  iconStatus: vi.fn(),
  refreshInterfaces: vi.fn(),
}));

vi.mock('discord.js', () => ({
  Events: { ClientReady: 'clientReady' },
  Client: class {
    constructor() { this.user = { tag: 'startup-test-bot' }; this.guilds = { cache: new Map() }; }
    once(name, handler) { state.handlers.set(name, handler); return this; }
    on() { return this; }
    destroy() { state.destroy(); }
  },
  REST: class { setToken() { return this; } async put() {} },
  Routes: { applicationGuildCommands: () => '/test-commands' },
}));
vi.mock('../src/config.js', () => ({
  config: { guildId: '1070676180103086132', httpPort: 4200 }, assertRuntimeConfig: vi.fn(),
}));
vi.mock('../src/database/db.js', () => ({ initDatabase: vi.fn() }));
vi.mock('../src/events/interactionCreate.js', () => ({ getClientOptions: () => ({}), loadCommands: async () => new Map(), registerInteractionHandler: vi.fn() }));
vi.mock('../src/services/schedulerService.js', () => ({ startScheduler: state.scheduler }));
vi.mock('../src/services/webhookServer.js', () => ({ startWebhookServer: state.webhook }));
vi.mock('../src/services/presenceService.js', () => ({ startPresenceRotation: vi.fn() }));
vi.mock('../src/services/otpAutoCheckService.js', () => ({ startOtpAutoCheck: state.otp }));
vi.mock('../src/services/deliverySubscriptionService.js', () => ({ backfillRecentDeliverySubscriptions: () => ({ scanned: 0, created: 0, skipped: 0, failed: [] }) }));
vi.mock('../src/services/subscriptionService.js', () => ({
  applySubscriptionProgressRepairOnce: () => ({ skipped: true, cleanupPending: false }),
  markSubscriptionProgressRepairCleanupComplete: vi.fn(),
  migrateSubscriptionMonthlyCycles: () => ({}), repairNetflixDeliveryStartDates: () => ({ repaired: [] }),
}));
vi.mock('../src/services/adminRenewalReminderService.js', () => ({ cleanupAdminRenewalMessagesForRepair: vi.fn(), cleanupStaleAdminRenewalPanels: state.cleanup }));
vi.mock('../src/services/transcriptService.js', () => ({ cleanupExpiredTranscripts: () => ({}), cleanupTranscriptArchiveStorage: () => ({}), migrateLegacyTranscriptsToGzip: () => ({}) }));
vi.mock('../src/services/orderService.js', () => ({ reconcileWalletPaidOrders: () => ({ repaired: [] }) }));
vi.mock('../src/services/adminOrderCenterService.js', () => ({ resetLegacyWarrantyAgingStateOnce: () => ({}), refreshAdminOrderCenter: vi.fn(), refreshExistingAdminAgingReminderCards: vi.fn() }));
vi.mock('../src/services/errorLogService.js', () => ({ initErrorLogger: vi.fn() }));
vi.mock('../src/services/autoSetupDiscountBoardService.js', () => ({ autoSetupDiscountBoard: async () => undefined }));
vi.mock('../src/utils/internationalCommands.js', () => ({ localizeCommandsForInternationalStore: (commands) => commands }));
vi.mock('../src/services/musicPlayerService.js', () => ({ initializeMusicPlayer: async () => undefined }));
vi.mock('../src/services/autoSetupPriceBoardService.js', () => ({ autoSetupPriceBoard: state.publish }));
vi.mock('../src/services/coreEmojiPackService.js', () => ({
  startCoreEmojiMaintenance: state.icons, getCoreEmojiPackStatus: state.iconStatus,
}));
vi.mock('../src/services/botInterfaceRefreshService.js', () => ({ refreshBotInterfaces: state.refreshInterfaces }));
vi.mock('../src/services/internationalStoreSetupService.js', () => ({ setupInternationalStores: async () => undefined }));
vi.mock('../src/services/roleService.js', () => ({ syncCustomerActivityRoles: async () => ({}) }));
vi.mock('../src/services/emojiService.js', () => ({ autoSyncGuildEmojis: () => ({}) }));
vi.mock('../src/services/autoSetupService.js', () => ({ autoSetupPartnerAndCtv: async () => undefined }));
vi.mock('../src/services/ctvOrderLogService.js', () => ({ reconcileRecentCtvOrderLogs: async () => ({}) }));
vi.mock('../src/services/autoSetupCardService.js', () => ({ autoSetupCardChannel: async () => undefined }));
vi.mock('../src/services/autoSetupOtpService.js', () => ({ autoRefreshOtpPanel: async () => undefined }));
vi.mock('../src/services/premiumProductSetupService.js', () => ({ publishPremiumProductsForGuild: async () => undefined }));
vi.mock('../src/services/warrantyService.js', () => ({ refreshOpenWarrantyActionPanels: async () => ({}) }));
vi.mock('../src/services/youtubeWarrantyClaimService.js', () => ({ syncYoutubeWarrantyClaimsAcrossGuilds: async () => ({}) }));
vi.mock('../src/services/inviteTrackerService.js', () => ({ initInviteCache: async () => undefined, handleInviteCreate: vi.fn(), handleInviteDelete: vi.fn() }));
vi.mock('../src/services/giveawayService.js', () => ({ cancelBotHostedGiveaways: async () => undefined }));
vi.mock('../src/events/messageCreate.js', () => ({ name: 'messageCreate', execute: vi.fn() }));
vi.mock('../src/events/guildMemberAdd.js', () => ({ name: 'guildMemberAdd', execute: vi.fn() }));
vi.mock('../src/events/guildMemberRemove.js', () => ({ name: 'guildMemberRemove', execute: vi.fn() }));

import { buildClient } from '../src/bootstrap.js';
const previousClient = global.discordClient;

beforeEach(() => {
  vi.clearAllMocks();
  state.handlers.clear();
  state.webhook.mockResolvedValue(undefined);
  state.cleanup.mockImplementation(() => new Promise(() => {}));
  state.publish.mockImplementation(() => new Promise(() => {}));
  state.icons.mockResolvedValue({ status: 'ready' });
  state.iconStatus.mockReturnValue({ status: 'ready', available: 57, created: 0 });
  vi.stubEnv('ENV_FILE', '.env.test-startup-not-present');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  global.discordClient = previousClient;
});

describe('independent price-board publication at startup', () => {
  it('starts catalog publication despite a stalled optional cleanup and keeps commerce running while publication waits', async () => {
    const client = await buildClient();
    const ready = state.handlers.get('clientReady')(client);
    let finished = false;
    ready.then(() => { finished = true; });
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    expect(state.webhook).toHaveBeenCalledWith(client);
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(state.otp).toHaveBeenCalledWith(client);
    expect(state.cleanup).toHaveBeenCalledTimes(1);
    expect(state.icons).toHaveBeenCalledWith(client, {
      guildId: '1070676180103086132', afterSync: state.refreshInterfaces,
    });
    expect(finished).toBe(false);
  });

  it('captures a rejected background publication without exposing its raw error or stopping startup', async () => {
    const error = Object.assign(new Error('private Discord payload must not be logged'), { code: 50013 });
    state.publish.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[AUTO-SETUP-PRICE] Không thể khởi động đồng bộ bảng giá: 50013'));
    expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
    expect(state.scheduler).toHaveBeenCalledTimes(1);
    expect(state.otp).toHaveBeenCalledTimes(1);
  });

  it('runs just one publication job after the remaining ready handler completes', async () => {
    state.cleanup.mockResolvedValue({});
    state.publish.mockResolvedValue([]);
    const client = await buildClient();
    await state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    expect(state.iconStatus).toHaveBeenCalledWith(client);
  });

  it.each(['retry_required', 'in_progress'])('does not run the extra publication when the completed core pass reports %s', async (status) => {
    state.cleanup.mockResolvedValue({});
    state.iconStatus.mockReturnValue({ status, available: 0, created: 0 });
    const client = await buildClient();
    await state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.iconStatus).toHaveBeenCalledWith(client));
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(state.otp).toHaveBeenCalledWith(client);
  });

  it('keeps commerce and the ready handler running while icons are pending, then publishes only after verified readiness', async () => {
    let resolveIcons;
    state.icons.mockImplementation(() => new Promise((resolve) => { resolveIcons = resolve; }));
    state.iconStatus.mockReturnValue({ status: 'in_progress', available: 0, created: 0 });
    state.cleanup.mockResolvedValue({});
    state.publish.mockResolvedValue([]);
    const client = await buildClient();
    await state.handlers.get('clientReady')(client);
    expect(state.icons).toHaveBeenCalledTimes(1);
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(state.otp).toHaveBeenCalledWith(client);
    expect(state.webhook).toHaveBeenCalledWith(client);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.iconStatus).not.toHaveBeenCalled();
    state.iconStatus.mockReturnValue({ status: 'ready', available: 57, created: 0 });
    resolveIcons({ status: 'ready' });
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    expect(state.iconStatus).toHaveBeenCalledWith(client);
  });

  it('does not publish from a duplicate process that fails to acquire the HTTP port', async () => {
    vi.useFakeTimers();
    state.webhook.mockRejectedValue(Object.assign(new Error('port collision'), { code: 'EADDRINUSE' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = await buildClient();
    await state.handlers.get('clientReady')(client);
    expect(state.destroy).toHaveBeenCalledTimes(1);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.scheduler).not.toHaveBeenCalled();
    expect(state.icons).not.toHaveBeenCalled();
  });
});
