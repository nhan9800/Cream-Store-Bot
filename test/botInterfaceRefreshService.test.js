import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ price: vi.fn(), panel: vi.fn(), history: vi.fn(), core: vi.fn(), membership: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: { guildId: 'interface-refresh-target' } }));
vi.mock('../src/services/autoSetupPriceBoardService.js', () => ({ autoSetupPriceBoard: mocks.price }));
vi.mock('../src/services/boostServerService.js', () => ({ refreshBoostPanel: mocks.panel }));
vi.mock('../src/services/historicalBoostPresentationRepairService.js', () => ({ startHistoricalBoostPresentationRepair: mocks.history }));
vi.mock('../src/services/coreEmojiPackService.js', () => ({ getCoreEmojiPackStatus: mocks.core }));
vi.mock('../src/services/membershipPresentationService.js', () => ({ refreshMembershipPresentation: mocks.membership }));

import { getBotInterfaceRefreshStatus, refreshBotInterfaces } from '../src/services/botInterfaceRefreshService.js';

const guildId = 'interface-refresh-target';
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.price.mockResolvedValue([{ guildId, status: 'published' }]);
  mocks.panel.mockResolvedValue({ status: 'updated', channelId: '1550000000000000811' });
  mocks.history.mockReturnValue({ status: 'in_progress' });
  mocks.core.mockReturnValue({ status: 'ready', available: 57, created: 0 });
  mocks.membership.mockResolvedValue({ status: 'ready' });
});

describe('bot interface refresh orchestration', () => {
  it('repairs catalog and Boost before retrying a failed membership update', async () => {
    const client = {};
    mocks.membership.mockRejectedValueOnce(new Error('MANAGE_ROLES_REQUIRED'));
    await expect(refreshBotInterfaces(client)).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    expect(mocks.price).toHaveBeenCalledOnce();
    expect(mocks.panel).toHaveBeenCalledOnce();
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'retry_required' });
    await refreshBotInterfaces(client);
    expect(mocks.price.mock.calls[1][1].force).toBe(false);
    expect(getBotInterfaceRefreshStatus(client).status).toBe('ready');
  });
  it('forces the first refresh when all icons were reused instead of created and records only actual UI results', async () => {
    const client = {};
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'not_started' });
    const result = await refreshBotInterfaces(client);
    expect(mocks.price).toHaveBeenCalledWith(client, { targetGuildId: guildId, force: true });
    expect(mocks.panel).toHaveBeenCalledWith(client, guildId);
    expect(mocks.history).toHaveBeenCalledWith(client, { guildId });
    expect(result).toMatchObject({ status: 'ready', priceBoard: 'published', boostPanel: 'updated' });
    expect(Number.isNaN(Date.parse(result.updatedAt))).toBe(false);
    expect(getBotInterfaceRefreshStatus(client)).toEqual(result);
  });

  it('starts the independent historical worker before awaiting a blocked or failing price board', async () => {
    const client = {};
    let rejectPrice;
    mocks.price.mockImplementation(() => new Promise((resolve, reject) => { rejectPrice = reject; }));
    const refresh = refreshBotInterfaces(client);
    const rejected = expect(refresh).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.history.mock.invocationCallOrder[0]).toBeLessThan(mocks.price.mock.invocationCallOrder[0]);
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'in_progress' });
    rejectPrice(new Error('private-discord-request-details'));
    await rejected;
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'retry_required' });
  });

  it.each([
    ['empty', []],
    ['undefined', undefined],
    ['missing channel', [{ status: 'channel_not_found' }]],
    ['partial success', [{ status: 'published' }, { status: 'error' }]],
    ['unfinished', [{ status: 'in_progress' }]],
    ['missing status', [{}]],
  ])('rejects %s price-board results without reporting ready and leaves history running', async (label, products) => {
    const client = {};
    mocks.price.mockResolvedValue(products);
    await expect(refreshBotInterfaces(client)).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'retry_required' });
    expect(mocks.history).toHaveBeenCalledWith(client, { guildId });
    expect(mocks.history.mock.invocationCallOrder[0]).toBeLessThan(mocks.price.mock.invocationCallOrder[0]);
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['empty', {}],
    ['missing channel', { status: 'channel_not_found' }],
    ['Discord failure', { status: 'error' }],
  ])('requires an actual Boost-panel result before ready: %s', async (label, panel) => {
    const client = {};
    mocks.panel.mockResolvedValue(panel);
    await expect(refreshBotInterfaces(client)).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'retry_required' });
    expect(mocks.history).toHaveBeenCalledWith(client, { guildId });
    expect(mocks.history.mock.invocationCallOrder[0]).toBeLessThan(mocks.panel.mock.invocationCallOrder[0]);
  });

  it('keeps the historical worker independent when the Boost panel request rejects', async () => {
    const client = {};
    mocks.panel.mockRejectedValue(new Error('private-webhook-token'));
    await expect(refreshBotInterfaces(client)).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    expect(mocks.history).toHaveBeenCalledWith(client, { guildId });
    expect(getBotInterfaceRefreshStatus(client)).toEqual({ status: 'retry_required' });
    expect(JSON.stringify(getBotInterfaceRefreshStatus(client))).not.toContain('private-webhook-token');
  });

  it('retries a failed panel without republishing an already confirmed catalog and requires both outputs before ready', async () => {
    const client = {};
    mocks.panel.mockResolvedValueOnce({ status: 'error' });
    await expect(refreshBotInterfaces(client)).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    mocks.price.mockResolvedValueOnce([{ status: 'current' }]);
    const result = await refreshBotInterfaces(client);
    expect(mocks.price).toHaveBeenCalledTimes(2);
    expect(mocks.price.mock.calls[0][1]).toEqual({ targetGuildId: guildId, force: true });
    expect(mocks.price.mock.calls[1][1]).toEqual({ targetGuildId: guildId, force: false });
    expect(result).toMatchObject({ status: 'ready', priceBoard: 'current', boostPanel: 'updated' });
    expect(getBotInterfaceRefreshStatus(client)).toEqual(result);
  });

  it('forces a new catalog generation when a deleted icon is recreated after a successful refresh', async () => {
    const client = {};
    await refreshBotInterfaces(client);
    mocks.core.mockReturnValue({ status: 'ready', available: 57, created: 1 });
    await refreshBotInterfaces(client);
    mocks.price.mockResolvedValueOnce([{ status: 'current' }]);
    await refreshBotInterfaces(client);
    expect(mocks.price.mock.calls.map((call) => call[1])).toEqual([
      { targetGuildId: guildId, force: true },
      { targetGuildId: guildId, force: true },
      { targetGuildId: guildId, force: false },
    ]);
  });

  it('continues forcing the catalog until its publication succeeds', async () => {
    const client = {};
    mocks.price.mockResolvedValueOnce([{ status: 'channel_not_found' }]);
    await expect(refreshBotInterfaces(client)).rejects.toThrow('BOT_UI_REFRESH_FAILED');
    await refreshBotInterfaces(client);
    expect(mocks.price.mock.calls.map((call) => call[1].force)).toEqual([true, true]);
    expect(getBotInterfaceRefreshStatus(client)).toMatchObject({ status: 'ready', priceBoard: 'published', boostPanel: 'updated' });
  });
});
