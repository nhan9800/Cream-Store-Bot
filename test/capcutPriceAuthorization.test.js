import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), refresh: vi.fn() }));
vi.mock('../src/services/capcutPricingService.js', () => ({ getEditableCapcutProducts: mocks.list, getCapcutPriceProduct: mocks.get, updateCapcutPrice: mocks.update }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({}) }));
vi.mock('../src/events/shared.js', () => ({ safeReply: (interaction, payload) => interaction.reply(payload) }));
vi.mock('../src/services/autoSetupPriceBoardService.js', () => ({ refreshCapcutPriceForumPost: mocks.refresh }));
import { handleCapcutPriceEdit, handleCapcutPriceSelect, handleCapcutPriceModal } from '../src/events/capcutPricingHandlers.js';

const products = [{ id: 1, name: 'CapCut Pro 1 Tháng', price: 100000 }, { id: 2, name: 'CapCut Pro 7 Ngày', price: 20000 }, { id: 3, name: 'CapCut Pro 12 Tháng', price: 1250000 }];
function interaction(admin = false, guildId = '1282637033340403754') {
  return { guildId, user: { id: '1555555555555555555' }, values: ['1'],
    guild: { id: guildId, members: { fetch: vi.fn().mockResolvedValue({ permissions: { has: bit => admin && bit === PermissionFlagsBits.Administrator }, roles: { cache: new Map() } }) } },
    reply: vi.fn(), showModal: vi.fn(), deferReply: vi.fn(), editReply: vi.fn(), fields: { getTextInputValue: () => '120000' } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue(products);
  mocks.get.mockImplementation(id => { if (String(id) !== '1') throw new Error('Gói này không thuộc danh sách CapCut đang bán.'); return products[0]; });
  mocks.update.mockReturnValue({ ...products[0], price: 120000 });
  mocks.refresh.mockResolvedValue({ id: 'existing-post' });
});

describe('Store1 CapCut Admin price controls', () => {
  it.each([false, true])('blocks ordinary users and foreign-guild Admins at all three entrypoints (%s)', async foreign => {
    const user = interaction(foreign, foreign ? '999999999999999999' : undefined);
    await handleCapcutPriceEdit(user);
    await handleCapcutPriceSelect(user);
    await handleCapcutPriceModal(user, '1', '100000');
    expect(user.showModal).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(user.editReply).toHaveBeenCalledWith(expect.stringContaining('Chỉ Admin'));
  });

  it('opens an ephemeral picker containing all current variants', async () => {
    const admin = interaction(true);
    await handleCapcutPriceEdit(admin);
    expect(admin.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const payload = admin.editReply.mock.calls[0][0];
    expect(payload.components[0].toJSON().components[0].options.map(option => option.value)).toEqual(['1', '2', '3']);
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it('checks fresh authority at selection and submission, including revoked roles and failed fetches', async () => {
    const admin = interaction(true);
    await handleCapcutPriceEdit(admin);
    await handleCapcutPriceSelect(admin);
    expect(admin.showModal.mock.calls[0][0].toJSON().custom_id).toBe('capcut:price:modal:1:100000');
    admin.guild.members.fetch.mockResolvedValue(null);
    await handleCapcutPriceSelect(admin);
    admin.guild.members.fetch.mockRejectedValue(new Error('unavailable'));
    await handleCapcutPriceModal(admin, '1', '100000');
    expect(admin.showModal).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(admin.guild.members.fetch).toHaveBeenCalledTimes(4);
    expect(admin.guild.members.fetch).toHaveBeenLastCalledWith({ user: admin.user.id, force: true });
  });

  it('rejects a forged non-CapCut selector and never opens a modal', async () => {
    const admin = interaction(true);
    admin.values = ['other-product'];
    await handleCapcutPriceSelect(admin);
    expect(admin.showModal).not.toHaveBeenCalled();
    expect(admin.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('CapCut') }));
  });

  it('commits once then refreshes only the CapCut forum post; a failed refresh does not undo the catalog', async () => {
    const admin = interaction(true);
    mocks.refresh.mockRejectedValue(new Error('Discord unavailable'));
    await handleCapcutPriceModal(admin, '1', '100000');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('1', '120000', '100000', admin.user.id);
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(admin.guild);
    expect(admin.editReply).toHaveBeenCalledWith(expect.stringContaining('chưa làm mới'));
  });

  it('does not refresh or report success after a stale-price/forged-ID rejection', async () => {
    const admin = interaction(true);
    mocks.update.mockImplementation(() => { throw new Error('Giá đã được cập nhật bởi Admin khác.'); });
    await handleCapcutPriceModal(admin, '1', '100000');
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(admin.editReply).toHaveBeenCalledWith(expect.stringContaining('Admin khác'));
  });
});
