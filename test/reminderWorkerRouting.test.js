import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  config: { guildId: '1282637033340403754', ownerRoleIds: [], ownerIds: [], adminDiscordIds: [], subscriptionAdminReminderDays: 7 },
  settings: { reminder_channel_id: 'old-reminders', staff_log_channel_id: 'staff-log' },
  adminCandidates: [], youtubeCandidates: [], spotifyCandidates: [], expiringOrders: [],
  getSub: vi.fn(), reserve: vi.fn(), markAdmin: vi.fn(), resetAdmin: vi.fn(), markYoutube: vi.fn(), markSpotify: vi.fn(), markExpiry: vi.fn(), response: vi.fn(), staffLog: vi.fn(),
}));
vi.mock('../src/config.js', () => ({ config: state.config }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: () => ({ get: () => state.settings }) }, nowIso: () => new Date().toISOString() }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => state.settings }));
vi.mock('../src/services/staffLogService.js', () => ({ recordStaffLog: state.staffLog }));
vi.mock('../src/services/subscriptionService.js', () => ({
  claimAdminRenewal: vi.fn(), getAdminRenewalCandidates: () => state.adminCandidates,
  getSubscriptionById: state.getSub, getSubscriptionProgress: () => ({ totalCycles: 12, totalMonths: 12, fulfilledMonths: 1, nextCycleNumber: 2, nextCycleStartMonth: 2, nextCycleEndMonth: 2, nextAction: 'RENEW' }),
  isSubscriptionRenewalDue: () => true, markAdminReminderSent: state.markAdmin,
  markDisconnected: vi.fn(), markRenewed: vi.fn(), reserveAdminReminderDispatch: state.reserve,
  resetOrphanedAdminReminderDispatch: state.resetAdmin, snoozeAdminRenewal: vi.fn(),
  getAllDueForRenewalGlobal: () => [], getAllExpiringOneTimeGlobal: () => [], markRemindSent: vi.fn(),
  markCustomerResponse: state.response, addSubscription: vi.fn(),
}));
vi.mock('../src/services/youtubeRenewalService.js', () => ({
  getYoutubeMembership: id => ({ id, guildId: state.config.guildId, customerGmailMasked: 'a***@example.test', sourceName: 'Source', nextSourcePaymentAt: '2026-11-08T00:00:00.000Z', totalCycles: 12, paidCycles: 1 }),
  getYoutubeMembershipsDueForReminder: () => state.youtubeCandidates,
  markYoutubeCyclePaid: vi.fn(), markYoutubeReminderSent: state.markYoutube, resolveYoutubeReminderStage: () => 'DUE_3D', snoozeYoutubeReminder: vi.fn(),
}));
vi.mock('../src/services/spotifyFamilyService.js', () => ({
  getSpotifyFamiliesDueForReminder: () => state.spotifyCandidates,
  getSpotifyFamily: id => ({ id, guildId: state.config.guildId, name: 'Family', nextRenewalAt: '2026-11-08T00:00:00.000Z', members: [] }),
  markSpotifyFamilyReminderSent: state.markSpotify, markSpotifyFamilyRenewed: vi.fn(), resolveFamilyReminderStage: () => 'DUE_3D', snoozeSpotifyFamilyReminder: vi.fn(),
}));
vi.mock('../src/services/v11DbHelpers.js', () => ({
  getOrdersExpiringInWindowRaw: low => low === 48 ? state.expiringOrders : [], markExpiryNoticeRaw: state.markExpiry, getExpiredSubscriptionOrdersRaw: () => [],
}));
vi.mock('../src/services/deliverySubscriptionService.js', () => ({ resolveDeliveryServiceStartAt: vi.fn() }));
vi.mock('../src/services/orderService.js', () => ({ getOrderByCode: vi.fn() }));
vi.mock('../src/events/shared.js', () => ({ safeReply: vi.fn(), parseDateInput: vi.fn() }));
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import { STORE_ONE_REMINDER_CHANNEL_ID } from '../src/services/reminderRoutingService.js';
import { cleanupStaleAdminRenewalPanels, runStoreOneAdminRenewalReminders } from '../src/services/adminRenewalReminderService.js';
import { runYoutubeRenewalReminders } from '../src/services/youtubeRenewalReminderService.js';
import { runSpotifyFamilyReminders } from '../src/services/spotifyFamilyReminderService.js';
import { runDeepNotifications } from '../src/services/deepNotificationService.js';
import { handleSubscriptionRenewButton } from '../src/events/subscriptionHandlers.js';
import { emitAutomationLog } from '../src/services/automationLogService.js';

function fixture(guildId = STORE_ONE_GUILD_ID) {
  const make = id => ({ id, guildId, isTextBased: () => true, send: vi.fn().mockResolvedValue({ id: 'sent-message' }), messages: { fetch: vi.fn() } });
  const target = make(STORE_ONE_REMINDER_CHANNEL_ID), old = make('old-reminders'), staff = make('staff-log');
  const available = new Map([[target.id, target], [old.id, old], [staff.id, staff]]);
  const guild = { id: guildId, ownerId: 'owner', roles: { cache: new Collection() }, channels: { cache: new Collection(), fetch: vi.fn(async id => available.get(id) || null) } };
  const user = { id: 'customer', tag: 'Customer', send: vi.fn().mockResolvedValue({ id: 'dm-message' }) };
  const client = { user: { id: 'bot' }, guilds: { cache: new Collection([[guild.id, guild]]), fetch: vi.fn().mockResolvedValue(guild) },
    channels: { cache: new Collection(), fetch: vi.fn(async id => available.get(id) || null) }, users: { fetch: vi.fn().mockResolvedValue(user) } };
  guild.client = client;
  for (const channel of available.values()) channel.guild = guild;
  return { client, guild, target, old, staff, user };
}
const subscription = extra => ({ id: 1, guild_id: STORE_ONE_GUILD_ID, service_type: 'netflix', status: 'ACTIVE', renewal_mode: 'auto_cycle', customer_id: 'customer', gmail_email: 'fixture@example.test',
  next_renewal_at: '2026-11-08T00:00:00.000Z', expiry_at: '2027-10-06T00:00:00.000Z', total_duration_months: 12, times_renewed: 0, ...extra });

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T00:00:00.000Z'));
  state.config.guildId = STORE_ONE_GUILD_ID;
  state.adminCandidates = []; state.youtubeCandidates = []; state.spotifyCandidates = []; state.expiringOrders = [];
  state.markAdmin.mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe('worker consolidation without historical resends', () => {
  it('delivers new admin, YouTube and Spotify reminders to the fixed Store1 destination', async () => {
    const f = fixture(); const sub = subscription();
    state.adminCandidates = [sub]; state.reserve.mockReturnValue({ subscription: sub, sentAt: 'reserved' });
    state.youtubeCandidates = [{ id: 2 }]; state.spotifyCandidates = [{ id: 3 }];
    expect((await runStoreOneAdminRenewalReminders(f.client)).sent).toBe(1);
    expect((await runYoutubeRenewalReminders(f.client)).sent).toBe(1);
    expect((await runSpotifyFamilyReminders(f.client)).sent).toBe(1);
    expect(f.target.send).toHaveBeenCalledTimes(3); expect(f.old.send).not.toHaveBeenCalled(); expect(f.staff.send).not.toHaveBeenCalled();
    expect(state.markAdmin).toHaveBeenCalledWith(1, expect.objectContaining({ channelId: STORE_ONE_REMINDER_CHANNEL_ID }));
    expect(state.markYoutube).toHaveBeenCalledWith(2, expect.objectContaining({ channelId: STORE_ONE_REMINDER_CHANNEL_ID }));
    expect(state.markSpotify).toHaveBeenCalledWith(3, expect.objectContaining({ channelId: STORE_ONE_REMINDER_CHANNEL_ID }));
  });
  it('does not replay an already-sent renewal or reset provenance bound to another channel', async () => {
    const f = fixture(); const sub = subscription({ admin_reminder_stage: 'UPCOMING_3D', admin_reminder_sent_at: '2026-11-05T00:00:00.000Z',
      admin_reminder_for_at: '2026-11-08T00:00:00.000Z', admin_reminder_channel_id: 'old-reminders', admin_reminder_message_id: 'old-card' });
    state.adminCandidates = [sub];
    expect((await runStoreOneAdminRenewalReminders(f.client)).sent).toBe(0);
    expect(state.reserve).not.toHaveBeenCalled(); expect(f.target.send).not.toHaveBeenCalled();
    const stale = { id: 'stale-duplicate', author: { id: 'bot' }, toJSON: () => ({ custom_id: 'sub:admin:renew:1' }), delete: vi.fn().mockResolvedValue(undefined) };
    f.target.messages.fetch.mockResolvedValue(new Collection([[stale.id, stale]])); state.getSub.mockReturnValue(sub);
    await cleanupStaleAdminRenewalPanels(f.client);
    expect(state.resetAdmin).not.toHaveBeenCalled(); expect(f.old.messages.fetch).not.toHaveBeenCalled();
    expect(sub.admin_reminder_channel_id).toBe('old-reminders'); expect(sub.admin_reminder_message_id).toBe('old-card');
  });
  it('preserves the customer DM and expiry marker while its operational log uses the new cold channel', async () => {
    const f = fixture(); state.expiringOrders = [{ guild_id: STORE_ONE_GUILD_ID, customer_id: 'customer', order_code: 'CN_FIXTURE', product_name: 'Product', expiry_at: '2026-11-09T00:00:00.000Z' }];
    expect(await runDeepNotifications(f.client)).toEqual({ sent3d: 1, sent2d: 0, sent1d: 0 });
    expect(f.user.send).toHaveBeenCalledOnce(); expect(f.target.send).toHaveBeenCalledOnce(); expect(f.old.send).not.toHaveBeenCalled();
    expect(state.markExpiry).toHaveBeenCalledExactlyOnceWith('CN_FIXTURE', 'expiry_notice_3d_sent_at');
  });
  it('routes customer renewal responses and only subscription action logs, preserving unrelated staff logs', async () => {
    const f = fixture(); state.getSub.mockReturnValue(subscription());
    await handleSubscriptionRenewButton({ client: f.client, guildId: STORE_ONE_GUILD_ID, customId: 'sub:renew:yes:1', user: f.user, update: vi.fn().mockResolvedValue(undefined) });
    expect(state.response).toHaveBeenCalledWith(1, 'YES'); expect(f.target.send).toHaveBeenCalledOnce();
    await emitAutomationLog(f.client, { guildId: STORE_ONE_GUILD_ID, action: 'SUBSCRIPTION_RENEWED', title: 'Renewed' });
    expect(f.target.send).toHaveBeenCalledTimes(2);
    await emitAutomationLog(f.client, { guildId: STORE_ONE_GUILD_ID, action: 'ORDER_RENEW_CREATED', title: 'Renewal invoice' });
    expect(f.target.send).toHaveBeenCalledTimes(3);
    await emitAutomationLog(f.client, { guildId: STORE_ONE_GUILD_ID, action: 'OTP_ALLOCATED', title: 'OTP' });
    await emitAutomationLog(f.client, { guildId: STORE_ONE_GUILD_ID, action: 'ORDER_CREATED', title: 'Order' });
    expect(f.staff.send).toHaveBeenCalledTimes(2);
  });
  it('keeps Store2 YouTube and Spotify reminders on its configured destination', async () => {
    state.config.guildId = STORE_TWO_GUILD_ID; const f = fixture(STORE_TWO_GUILD_ID);
    state.youtubeCandidates = [{ id: 2 }]; state.spotifyCandidates = [{ id: 3 }];
    await runYoutubeRenewalReminders(f.client); await runSpotifyFamilyReminders(f.client);
    expect(f.old.send).toHaveBeenCalledTimes(2); expect(f.target.send).not.toHaveBeenCalled();
  });
});
