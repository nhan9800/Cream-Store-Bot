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
  pauseMarketing: vi.fn(() => ({ paused: true })),
  supplierStart: vi.fn(),
  supplierPanel: vi.fn(),
  guildId: '1070676180103086132',
  supplierConfigured: vi.fn(),
  supplierOffers: vi.fn(),
  supplierWorker: vi.fn(),
  supplierTicketRepair: vi.fn(),
  supplierTicketMaintenance: vi.fn(),
  discordRateLimitHealth: vi.fn(),
  supplierRuntimes: new Map(),
}));

vi.mock('discord.js', async (importOriginal) => ({
  ...await importOriginal(),
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
  config: { get guildId() { return state.guildId; }, httpPort: 4200 }, assertRuntimeConfig: vi.fn(),
}));
vi.mock('../src/database/db.js', () => ({ initDatabase: vi.fn() }));
vi.mock('../src/services/reminderRoutingService.js', () => ({ adoptStoreOneReminderRouting: vi.fn() }));
vi.mock('../src/services/marketingPauseService.js', () => ({ pauseAutomaticMarketing: state.pauseMarketing }));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({ supplierAutobuyRuntime: {
  start: state.supplierStart, forProvider: provider => state.supplierRuntimes.get(provider),
} }));
vi.mock('../src/services/supplierAutobuyCatalogService.js', () => ({
  supplierSalesConfigured: state.supplierConfigured, getSupplierOffers: state.supplierOffers,
}));
vi.mock('../src/services/supplierAutobuyOrderService.js', () => ({ startSupplierAutobuyWorker: state.supplierWorker }));
vi.mock('../src/services/shopRelaunchReleaseService.js', () => ({ runShopRelaunchRelease: vi.fn() }));
vi.mock('../src/services/compactSaleReleaseService.js', () => ({ runCompactSaleRelease: vi.fn() }));
vi.mock('../src/services/discordRateLimitHealthService.js', () => ({ installDiscordRateLimitHealth: state.discordRateLimitHealth }));
vi.mock('../src/services/dopermindCatalogReview20261114.js', () => ({ runDopermindCatalogReview: vi.fn() }));
vi.mock('../src/services/supplierAutobuyPanelService.js', () => ({ ensureSupplierAutobuyChannel: state.supplierPanel }));
vi.mock('../src/services/supplierAutobuyTicketNoticeService.js', () => ({
  repairSupplierTicketOrderNotices: state.supplierTicketRepair,
  startSupplierTicketNoticeMaintenance: state.supplierTicketMaintenance,
}));
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
  state.guildId = '1070676180103086132';
  state.supplierConfigured.mockReturnValue(false);
  state.supplierOffers.mockResolvedValue({ offers: [{ available: true }] });
  state.supplierWorker.mockResolvedValue({ workerRunning: true });
  state.supplierTicketRepair.mockResolvedValue({ status: 'READY', scanned: 0, sent: 0, failed: 0 });
  state.supplierRuntimes.clear();
  state.webhook.mockResolvedValue(undefined);
  state.cleanup.mockImplementation(() => new Promise(() => {}));
  state.publish.mockImplementation(() => new Promise(() => {}));
  state.icons.mockResolvedValue({ status: 'ready' });
  state.iconStatus.mockReturnValue({ status: 'ready', available: 57, created: 0 });
  state.supplierStart.mockResolvedValue({ status: 'OUT_OF_SCOPE' });
  state.supplierPanel.mockResolvedValue({ status: 'DISABLED_OTHER_STORE' });
  vi.stubEnv('ENV_FILE', '.env.test-startup-not-present');
  vi.stubEnv('SUPPLIER_AUTOBUY_PROVIDER', '');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  global.discordClient = previousClient;
});

describe('independent price-board publication at startup', () => {
  it('starts both requested storefronts independently while sharing one durable worker', async () => {
    state.guildId = '1282637033340403754';
    vi.stubEnv('ENV_FILE', '.env');
    vi.stubEnv('SUPPLIER_AUTOBUY_PROVIDER', 'cdkvietnam');
    state.supplierConfigured.mockReturnValue(true);
    for (const provider of ['cdkvietnam', 'dopermind']) {
      const snapshot = { provider, status: 'CONNECTED' };
      state.supplierRuntimes.set(provider, { start: vi.fn(async () => snapshot),
        setSalesEnabled: vi.fn(enabled => ({ ...snapshot, purchasesEnabled: enabled })) });
    }
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.supplierPanel).toHaveBeenCalledTimes(2));
    expect(state.supplierWorker).toHaveBeenCalledTimes(1);
    expect(state.discordRateLimitHealth).toHaveBeenCalledExactlyOnceWith(client, {
      guildId: '1282637033340403754', envFile: '.env',
    });
    expect(state.supplierPanel.mock.calls.map(([, options]) => options.provider).sort()).toEqual(['cdkvietnam', 'dopermind']);
    expect(state.supplierPanel.mock.calls.every(([, options]) => options.snapshot.purchasesEnabled)).toBe(true);
    await vi.waitFor(() => expect(state.supplierTicketRepair).toHaveBeenCalledExactlyOnceWith(client, {
      guildId: '1282637033340403754', envFile: '.env', limit: 25,
    }));
    expect(state.supplierTicketMaintenance).toHaveBeenCalledExactlyOnceWith(client, {
      guildId: '1282637033340403754', envFile: '.env', limit: 25,
    });
    expect(state.scheduler).toHaveBeenCalledWith(client);
  });
  it('keeps the connected source and commerce available when the other provider probe fails', async () => {
    state.guildId = '1282637033340403754';
    vi.stubEnv('ENV_FILE', '.env');
    vi.stubEnv('SUPPLIER_AUTOBUY_PROVIDER', 'cdkvietnam');
    state.supplierConfigured.mockReturnValue(true);
    state.supplierRuntimes.set('cdkvietnam', { start: vi.fn(async () => ({ provider: 'cdkvietnam', status: 'CONNECTED' })),
      setSalesEnabled: vi.fn(enabled => ({ provider: 'cdkvietnam', purchasesEnabled: enabled })) });
    state.supplierRuntimes.set('dopermind', { start: vi.fn(async () => { throw new Error('private provider response'); }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.supplierPanel).toHaveBeenCalledTimes(2));
    expect(state.supplierPanel.mock.calls.find(([, options]) => options.provider === 'cdkvietnam')[1].snapshot.purchasesEnabled).toBe(true);
    expect(state.supplierPanel.mock.calls.find(([, options]) => options.provider === 'dopermind')[1].snapshot).toBeNull();
    expect(state.supplierWorker).toHaveBeenCalledTimes(1);
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private provider response');
  });
  it('starts catalog publication despite a stalled optional cleanup and keeps commerce running while publication waits', async () => {
    const client = await buildClient();
    const ready = state.handlers.get('clientReady')(client);
    let finished = false;
    ready.then(() => { finished = true; });
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    expect(state.webhook).toHaveBeenCalledWith(client);
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(state.otp).toHaveBeenCalledWith(client);
    expect(state.supplierTicketRepair).not.toHaveBeenCalled();
    expect(state.supplierTicketMaintenance).not.toHaveBeenCalled();
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
    expect(state.supplierStart).not.toHaveBeenCalled();
    expect(state.supplierPanel).not.toHaveBeenCalled();
  });

  it('keeps commerce running while the hosting supplier probe is pending', async () => {
    state.supplierStart.mockImplementation(() => new Promise(() => {}));
    vi.stubEnv('DAIPHUC_PARTNER_API_KEY', 'supplier-test-only');
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.supplierStart).toHaveBeenCalledTimes(1));
    expect(state.supplierStart).toHaveBeenCalledWith({
      guildId: '1070676180103086132', envFile: '.env.test-startup-not-present', apiKey: 'supplier-test-only', provider: 'daiphuc',
    });
    expect(state.webhook.mock.invocationCallOrder[0]).toBeLessThan(state.supplierStart.mock.invocationCallOrder[0]);
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(state.otp).toHaveBeenCalledWith(client);
    expect(state.destroy).not.toHaveBeenCalled();
    expect(state.supplierPanel).not.toHaveBeenCalled();
  });

  it('isolates an unexpected supplier startup failure without logging private error data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.supplierStart.mockRejectedValue(new Error('supplier-private-credential-and-payload'));
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[SUPPLIER-AUTOBUY] STARTUP_PROBE_FAILED'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('supplier-private');
    expect(state.scheduler).toHaveBeenCalledTimes(1);
    expect(state.destroy).not.toHaveBeenCalled();
  });

  it('routes only the new secret when Dopermind is selected without blocking commerce', async () => {
    vi.stubEnv('SUPPLIER_AUTOBUY_PROVIDER', 'dopermind');
    vi.stubEnv('DOPERMIND_API_KEY', 'new-provider-test-only');
    vi.stubEnv('DAIPHUC_PARTNER_API_KEY', 'old-provider-test-only');
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.supplierStart).toHaveBeenCalledTimes(1));
    expect(state.supplierStart).toHaveBeenCalledExactlyOnceWith({
      guildId: '1070676180103086132', envFile: '.env.test-startup-not-present',
      provider: 'dopermind', apiKey: 'new-provider-test-only',
    });
    expect(state.scheduler).toHaveBeenCalledWith(client);
  });

  it('sets up the requested supplier panel after the probe and icons finish without waiting for optional cleanup', async () => {
    const snapshot = { status: 'AUTH_REJECTED', purchasesEnabled: false };
    state.supplierStart.mockResolvedValue(snapshot);
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(state.supplierPanel).toHaveBeenCalledExactlyOnceWith(client, {
      guildId: '1070676180103086132', envFile: '.env.test-startup-not-present', snapshot,
    }));
    expect(state.scheduler).toHaveBeenCalledWith(client);
    expect(state.otp).toHaveBeenCalledWith(client);
  });

  it('contains supplier channel setup errors without logging raw Discord payloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.supplierPanel.mockRejectedValue(new Error('private-supplier-channel-payload'));
    const client = await buildClient();
    void state.handlers.get('clientReady')(client);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[SUPPLIER-AUTOBUY] PANEL_SETUP_FAILED'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-supplier-channel');
    expect(state.scheduler).toHaveBeenCalledTimes(1);
  });
});
