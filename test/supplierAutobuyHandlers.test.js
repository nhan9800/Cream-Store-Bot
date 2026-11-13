import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';

const state = vi.hoisted(() => ({ panel: vi.fn(), snapshot: vi.fn(), builder: vi.fn(), start: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({
  supplierAutobuyRuntime: { getHealth: state.snapshot, start: state.start },
}));
vi.mock('../src/services/supplierAutobuyPanelService.js', () => ({
  buildSupplierAutobuyReply: state.builder, getSupplierAutobuyPanelHealth: state.panel,
}));

import { config } from '../src/config.js';
import { handleSupplierAutobuyInteraction } from '../src/events/supplierAutobuyHandlers.js';

const guildId = '1282637033340403754';
const channelId = '1514606994256957600';
const messageId = '1514606994256957601';
const botId = '1382729296724099132';
const snapshot = Object.freeze({ status: 'AUTH_REJECTED', purchasesEnabled: false,
  checkedAt: '2026-11-10T14:44:08.385Z', checks: {} });
const components = [{ type: 17, components: [{ type: 10, content: 'Danh mục đang chuẩn bị.' }] }];
function interaction(overrides = {}) {
  return {
    customId: 'supplier-autobuy:catalog', guildId, channelId,
    client: { user: { id: botId } }, message: { id: messageId, author: { id: botId } },
    isButton: () => true, deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(), followUp: vi.fn(), ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  config.guildId = guildId;
  vi.stubEnv('ENV_FILE', '.env');
  state.panel.mockReturnValue({ status: 'READY', channelId, messageId });
  state.snapshot.mockReturnValue(snapshot);
  state.builder.mockReturnValue({ components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('supplier autobuy cached-card interactions', () => {
  it.each([undefined, null, '', 'other:catalog', 'supplier-autobuy-other:catalog'])('ignores unrelated IDs %s', async customId => {
    const click = interaction({ customId });
    expect(await handleSupplierAutobuyInteraction(click)).toBe(false);
    expect(click.reply).not.toHaveBeenCalled();
    expect(state.panel).not.toHaveBeenCalled();
    expect(state.builder).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'status'])('defers privately before rendering the cached %s reply', async action => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected-network-call'));
    const click = interaction({ customId: `supplier-autobuy:${action}` });
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(click.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(click.deferReply.mock.invocationCallOrder[0]).toBeLessThan(state.builder.mock.invocationCallOrder[0]);
    expect(state.builder).toHaveBeenCalledExactlyOnceWith({ client: click.client, snapshot, action, provider: 'cdkvietnam' });
    expect(click.editReply).toHaveBeenCalledExactlyOnceWith({
      components, flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
    expect(click.reply).not.toHaveBeenCalled();
    expect(click.update).not.toHaveBeenCalled();
    expect(click.followUp).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { guildId: null }, { guildId: '1070676180103086132' }, { channelId: 'different-channel' },
    { message: { id: 'stale-card', author: { id: botId } } },
    { message: { id: messageId, author: { id: 'different-bot' } } },
    { message: null }, { client: { user: null } }, { isButton: () => false },
    { customId: 'supplier-autobuy:purchase' }, { customId: 'supplier-autobuy:' },
    { customId: 'supplier-autobuy:status:refresh' },
  ])('acknowledges invalid, forged or stale cards privately %j', async overrides => {
    const click = interaction(overrides);
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(click.reply).toHaveBeenCalledExactlyOnceWith({
      content: expect.stringContaining('bảng mới nhất'), flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
    expect(click.deferReply).not.toHaveBeenCalled();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.builder).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it.each(['.env.store2', undefined, '/home/container/.env'])('rejects wrong runtime environment %s', async envFile => {
    vi.stubEnv('ENV_FILE', envFile);
    const click = interaction();
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(click.reply).toHaveBeenCalledOnce();
    expect(state.panel).not.toHaveBeenCalled();
    expect(state.snapshot).not.toHaveBeenCalled();
  });

  it('rejects a Store1-looking interaction handled by another configured store', async () => {
    config.guildId = '1070676180103086132';
    const click = interaction();
    await handleSupplierAutobuyInteraction(click);
    expect(click.reply).toHaveBeenCalledOnce();
    expect(state.snapshot).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'NOT_STARTED', channelId, messageId }, { status: 'DEGRADED_CARD', channelId, messageId },
    { status: 'READY', channelId: '', messageId }, { status: 'READY', channelId, messageId: '' }, null,
  ])('requires a validated persisted panel %j', async panel => {
    state.panel.mockReturnValue(panel);
    const click = interaction();
    await handleSupplierAutobuyInteraction(click);
    expect(click.reply).toHaveBeenCalledOnce();
    expect(state.snapshot).not.toHaveBeenCalled();
  });

  it('does not build or expose status when private deferral fails', async () => {
    const click = interaction({ deferReply: vi.fn().mockRejectedValue(new Error('private-token')) });
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(state.builder).not.toHaveBeenCalled();
    expect(click.editReply).not.toHaveBeenCalled();
    expect(click.reply).not.toHaveBeenCalled();
  });

  it('contains a failed private edit without retry, raw logging or a public fallback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const click = interaction({ editReply: vi.fn().mockRejectedValue(new Error('private-token')) });
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(click.editReply).toHaveBeenCalledOnce();
    expect(click.reply).not.toHaveBeenCalled();
    expect(click.followUp).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('contains invalid-card reply failure', async () => {
    const click = interaction({ customId: 'supplier-autobuy:unknown', reply: vi.fn().mockRejectedValue(new Error('private-token')) });
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(state.builder).not.toHaveBeenCalled();
    expect(click.followUp).not.toHaveBeenCalled();
  });

  it.each(['deferred', 'replied'])('does not edit an already %s response whose privacy is unknown', async property => {
    const click = interaction({ [property]: true });
    await handleSupplierAutobuyInteraction(click);
    expect(click.deferReply).not.toHaveBeenCalled();
    expect(click.editReply).not.toHaveBeenCalled();
    expect(click.reply).not.toHaveBeenCalled();
    expect(state.builder).not.toHaveBeenCalled();
  });

  it('returns a fixed private notice on presentation failure without exposing raw metadata', async () => {
    state.builder.mockImplementation(() => { throw new Error('private-key-and-account'); });
    const click = interaction();
    expect(await handleSupplierAutobuyInteraction(click)).toBe(true);
    expect(click.editReply).toHaveBeenCalledOnce();
    expect(click.editReply.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('chưa có đơn hàng') });
    expect(JSON.stringify(click.editReply.mock.calls)).not.toContain('private-key');
    expect(state.start).not.toHaveBeenCalled();
  });
});
