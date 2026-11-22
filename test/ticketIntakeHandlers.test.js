import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), warranty: vi.fn(), order: vi.fn(), flag: vi.fn(), mute: vi.fn() }));
vi.mock('../src/events/ticketHandlers.js', () => ({ handleTicketCreate: mocks.create }));
vi.mock('../src/services/warrantyService.js', () => ({ openWarrantyTicket: mocks.warranty }));
vi.mock('../src/services/orderService.js', () => ({ getOrderByCode: mocks.order }));
vi.mock('../src/services/blacklistService.js', () => ({ getCustomerFlag: mocks.flag, getTicketMuteStatus: mocks.mute }));

import { handleTicketIntakeInteraction } from '../src/events/ticketIntakeHandlers.js';

function interaction(customId, values = {}, guildId = STORE_ONE_GUILD_ID) {
  return {
    customId, guildId, guild: { id: guildId, roles: { everyone: { id: guildId } } }, user: { id: 'customer' },
    isButton: () => customId.includes(':open:'), isModalSubmit: () => customId.includes(':form:'),
    fields: { getTextInputValue: id => values[id] ?? '' },
    showModal: vi.fn(async () => {}), deferReply: vi.fn(async () => {}), reply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
  };
}

describe('Store 1 ticket intake', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.flag.mockReturnValue({ is_blacklisted: 0 });
    mocks.mute.mockReturnValue({ is_ticket_muted: false });
  });

  it('opens the right form before creating a ticket', async () => {
    for (const [type, fields] of [
      ['order', ['product', 'duration', 'payment']],
      ['support', ['topic', 'code', 'issue']],
      ['warranty', ['code', 'issue']],
    ]) {
      const target = interaction(`ticket:intake:open:${type}`);
      await handleTicketIntakeInteraction(target);
      const modal = target.showModal.mock.lastCall[0].toJSON();
      expect(modal.custom_id).toBe(`ticket:intake:form:${type}`);
      expect(modal.components.flatMap(row => row.components.map(field => field.custom_id))).toEqual(fields);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.warranty).not.toHaveBeenCalled();
  });

  it('records purchase preferences and support context in their normal private ticket flow', async () => {
    const order = interaction('ticket:intake:form:order', { product: '**Netflix**', duration: '1 tháng', payment: 'MoMo' });
    await handleTicketIntakeInteraction(order);
    expect(order.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(mocks.create).toHaveBeenCalledWith(order, 'ORDER', null, { intake: { title: 'Mua hàng',
      text: '### Mua hàng\n**Sản phẩm** · \\*\\*Netflix\\*\\*\n**Thời hạn** · 1 tháng\n**Thanh toán mong muốn** · MoMo' } });

    const support = interaction('ticket:intake:form:support', { topic: 'Đăng nhập', issue: 'Cần hướng dẫn' });
    await handleTicketIntakeInteraction(support);
    expect(mocks.create).toHaveBeenCalledWith(support, 'SUPPORT', null, { intake: { title: 'Hỗ trợ',
      text: '### Hỗ trợ\n**Chủ đề** · Đăng nhập\n**Nội dung** · Cần hướng dẫn' } });
  });

  it('accepts a warranty request only for the current guild and customer and preserves the issue', async () => {
    const target = interaction('ticket:intake:form:warranty', { code: 'cn_123456', issue: 'Lỗi đăng nhập' });
    mocks.order.mockReturnValue({ guild_id: STORE_TWO_GUILD_ID, customer_id: 'customer', status: 'COMPLETED' });
    await handleTicketIntakeInteraction(target);
    expect(mocks.warranty).not.toHaveBeenCalled();

    mocks.order.mockReturnValue({ guild_id: STORE_ONE_GUILD_ID, customer_id: 'customer', status: 'COMPLETED' });
    mocks.warranty.mockResolvedValue({ channel: { id: 'private' }, reused: false });
    await handleTicketIntakeInteraction(target);
    expect(mocks.warranty).toHaveBeenCalledWith({ guild: target.guild, customerId: 'customer', actorId: 'customer',
      orderCode: 'CN_123456', formData: { issue: 'Lỗi đăng nhập' } });
    expect(target.editReply).toHaveBeenCalledWith({ content: 'Ticket bảo hành của bạn: <#private>.' });
  });

  it('rejects whitespace-only required fields and leaves Store 2 untouched', async () => {
    const missing = interaction('ticket:intake:form:order', { product: '   ', duration: '1 tháng', payment: 'MoMo' });
    const other = interaction('ticket:intake:open:order', {}, STORE_TWO_GUILD_ID);
    await handleTicketIntakeInteraction(missing);
    await handleTicketIntakeInteraction(other);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(other.showModal).not.toHaveBeenCalled();
    expect(missing.reply).toHaveBeenCalled();
  });
});
