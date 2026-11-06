import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
const mocks = vi.hoisted(() => ({ update:vi.fn(), config:vi.fn(()=>({})), price:vi.fn(()=>320000) }));
vi.mock('../src/services/boostPricingService.js', () => ({ getBoostPrice:mocks.price, updateBoostPrice:mocks.update }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig:mocks.config }));
vi.mock('../src/services/blacklistService.js', () => ({ getCustomerFlag:vi.fn(()=>({})) }));
vi.mock('../src/events/shared.js', () => ({ safeReply:(interaction,payload)=>interaction.reply(payload) }));
import { handleBoostPriceEdit, handleBoostPriceModal } from '../src/events/boostHandlers.js';

function interaction(manager = false) {
  return { guildId:'1282637033340403754', user:{id:'1555555555555555555'},
    guild:{ members:{ fetch:vi.fn().mockResolvedValue({permissions:{has:bit=>manager && bit===PermissionFlagsBits.Administrator},roles:{cache:new Map()}}) } },
    reply:vi.fn(), showModal:vi.fn(), deferReply:vi.fn(), editReply:vi.fn(), fields:{getTextInputValue:()=> '350000'} };
}
beforeEach(()=>vi.clearAllMocks());
describe('Boost Admin price controls', () => {
  it('blocks ordinary users on both button and forged modal submission', async () => {
    const user=interaction();
    await handleBoostPriceEdit(user);
    await handleBoostPriceModal(user,320000);
    expect(user.showModal).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(user.editReply).toHaveBeenCalledWith(expect.stringContaining('Chỉ Admin'));
  });
  it('checks fresh permissions again after an Admin opens a modal', async () => {
    const admin=interaction(true);
    await handleBoostPriceEdit(admin);
    expect(admin.showModal.mock.calls[0][0].toJSON().custom_id).toBe('boost:price:modal:320000');
    admin.guild.members.fetch.mockResolvedValue(null);
    await handleBoostPriceModal(admin,320000);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(admin.guild.members.fetch).toHaveBeenCalledTimes(2);
  });
});
