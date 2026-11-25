import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import { MessageFlags } from 'discord.js';
import { storefrontComponentEmoji, storefrontEmoji as icon } from '../src/utils/storefrontEmoji.js';

const flatten = parts => parts.flatMap(part => [part, ...flatten(part.components ?? [])]);

const mocks = vi.hoisted(() => ({ create: vi.fn(), warranty: vi.fn(), order: vi.fn(), list: vi.fn(), flag: vi.fn(), mute: vi.fn() }));
vi.mock('../src/events/ticketHandlers.js', () => ({ handleTicketCreate: mocks.create }));
vi.mock('../src/services/warrantyService.js', () => ({ openWarrantyTicket: mocks.warranty }));
vi.mock('../src/services/orderService.js', () => ({ getOrderByCode: mocks.order, listWarrantyEligibleOrders: mocks.list }));
vi.mock('../src/services/blacklistService.js', () => ({ getCustomerFlag: mocks.flag, getTicketMuteStatus: mocks.mute }));

import { handleTicketIntakeInteraction } from '../src/events/ticketIntakeHandlers.js';

function interaction(customId, values = {}, guildId = STORE_ONE_GUILD_ID, selected = []) {
  return {
    customId, guildId, guild: { id: guildId, roles: { everyone: { id: guildId } } }, user: { id: 'customer' },
    isButton: () => customId.includes(':open:'), isModalSubmit: () => customId.includes(':form:'),
    isStringSelectMenu: () => customId.includes(':pick:'), values: selected,
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
    expect(mocks.create).toHaveBeenCalledWith(order, 'ORDER', null, { intake: { title: 'Mua hàng', text: [
      `### ${icon('created')} Yêu cầu mua hàng của khách`,
      `**${icon('clipboard')} Sản phẩm khách muốn mua**\n> \\*\\*Netflix\\*\\*`,
      `**${icon('expiry')} Thời hạn gói**\n> 1 tháng`,
      `**${icon('receipt')} Phương thức thanh toán mong muốn**\n> MoMo`,
      `-# ${icon('reminder')} Shop sẽ xác nhận gói, giá và cách thanh toán ngay trong ticket này.`,
    ].join('\n\n') } });

    const support = interaction('ticket:intake:form:support', { topic: 'Đăng nhập', issue: 'Cần hướng dẫn' });
    await handleTicketIntakeInteraction(support);
    expect(mocks.create).toHaveBeenCalledWith(support, 'SUPPORT', null, { intake: { title: 'Hỗ trợ',
      text: `### ${icon('mic')} Hỗ trợ\n${icon('location')} **Chủ đề** · Đăng nhập\n${icon('edit')} **Nội dung** · Cần hướng dẫn` } });
  });

  it('lists only the customer eligible orders before asking for the issue', async () => {
    const orders = [
      { order_code: 'CN_123456', product_name: 'Netflix Premium', status: 'COMPLETED',
        completed_at: '2026-11-12T03:00:00Z', expiry_at: '2026-12-12T03:00:00Z' },
      { order_code: 'CN_654321', product_name: 'Spotify', status: 'WARRANTY_OPEN', created_at: '2026-10-01T03:00:00Z' },
    ];
    mocks.list.mockReturnValue(orders);
    const target = interaction('ticket:intake:open:warranty');
    await handleTicketIntakeInteraction(target);
    expect(target.showModal).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledWith(STORE_ONE_GUILD_ID, 'customer');
    const response = target.reply.mock.lastCall[0];
    expect(response.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    const parts = flatten(response.components);
    const select = parts.find(part => part.custom_id === 'ticket:intake:pick:warranty');
    expect(select.options.map(option => [option.value, option.label, option.description])).toEqual([
      ['CN_123456', 'CN_123456 · Netflix Premium', 'Đã hoàn thành · Mua 12/11/2026 · HSD 12/12/2026'],
      ['CN_654321', 'CN_654321 · Spotify', 'Đang có ticket bảo hành · Mua 01/10/2026'],
    ]);
    expect(select.options.map(option => option.emoji.id)).toEqual(['num1', 'num2'].map(key => storefrontComponentEmoji(key).id));
    const content = parts.map(part => part.content ?? '').join('\n');
    for (const line of content.split('\n').filter(Boolean)) expect(line).toMatch(/<a?:cenar_ui27_\w+:\d+>/);

    mocks.list.mockReturnValue([]);
    const empty = interaction('ticket:intake:open:warranty');
    await handleTicketIntakeInteraction(empty);
    expect(flatten(empty.reply.mock.lastCall[0].components).map(part => part.content ?? '').join('\n'))
      .toContain(`${icon('empty')} Bạn chưa có đơn đã hoàn thành`);
  });

  it('opens the issue form only for an owned completed order', async () => {
    mocks.order.mockReturnValue({ order_code: 'CN_123456', guild_id: STORE_ONE_GUILD_ID, customer_id: 'customer', status: 'COMPLETED' });
    const pick = interaction('ticket:intake:pick:warranty', {}, STORE_ONE_GUILD_ID, ['CN_123456']);
    await handleTicketIntakeInteraction(pick);
    const modal = pick.showModal.mock.lastCall[0].toJSON();
    expect(modal.custom_id).toBe('ticket:intake:form:warranty:CN_123456');
    expect(modal.title).toBe('Bảo hành CN_123456');
    expect(modal.components.flatMap(row => row.components.map(field => [field.custom_id, field.required])))
      .toEqual([['issue', true], ['since', false], ['tried', false]]);

    mocks.order.mockReturnValue({ order_code: 'CN_123456', guild_id: STORE_ONE_GUILD_ID, customer_id: 'someone', status: 'COMPLETED' });
    const foreign = interaction('ticket:intake:pick:warranty', {}, STORE_ONE_GUILD_ID, ['CN_123456']);
    await handleTicketIntakeInteraction(foreign);
    expect(foreign.showModal).not.toHaveBeenCalled();
    expect(foreign.reply.mock.lastCall[0].content).toContain(icon('search'));

    mocks.order.mockReturnValue({ order_code: 'CN_123456', guild_id: STORE_ONE_GUILD_ID, customer_id: 'customer', status: 'PROCESSING' });
    const pending = interaction('ticket:intake:pick:warranty', {}, STORE_ONE_GUILD_ID, ['CN_123456']);
    await handleTicketIntakeInteraction(pending);
    expect(pending.showModal).not.toHaveBeenCalled();
  });

  it('opens the warranty ticket with the described issue and decorated confirmation', async () => {
    const target = interaction('ticket:intake:form:warranty:CN_123456', { issue: 'Báo *sai* mật khẩu', since: 'Sáng nay', tried: '' });
    mocks.order.mockReturnValue({ guild_id: STORE_TWO_GUILD_ID, customer_id: 'customer', status: 'COMPLETED' });
    await handleTicketIntakeInteraction(target);
    expect(mocks.warranty).not.toHaveBeenCalled();

    mocks.order.mockReturnValue({ guild_id: STORE_ONE_GUILD_ID, customer_id: 'customer', status: 'COMPLETED' });
    mocks.warranty.mockResolvedValue({ channel: { id: 'private' }, reused: false });
    await handleTicketIntakeInteraction(target);
    expect(mocks.warranty).toHaveBeenCalledWith({ guild: target.guild, customerId: 'customer', actorId: 'customer',
      orderCode: 'CN_123456', formData: { issue: 'Báo \\*sai\\* mật khẩu', issueSince: 'Sáng nay' } });
    expect(target.editReply).toHaveBeenCalledWith({ content: [
      `${icon('check')} **Đã gửi yêu cầu bảo hành** · \`CN_123456\``,
      `${icon('ticket_open')} Ticket riêng của bạn: <#private>`,
      `-# ${icon('pending')} Staff sẽ phản hồi trong ticket, bạn không cần tag.`,
    ].join('\n') });

    const send = vi.fn(async () => {});
    const channel = { id: 'open', isTextBased: () => true, send, permissionsFor: () => ({ has: () => false }) };
    mocks.warranty.mockResolvedValue({ channel, reused: true });
    const again = interaction('ticket:intake:form:warranty:CN_123456', { issue: 'Vẫn lỗi', since: '', tried: 'Đăng nhập lại' });
    await handleTicketIntakeInteraction(again);
    expect(send.mock.lastCall[0].content).toBe([
      `### ${icon('history')} Khách bổ sung mô tả lỗi`,
      `${icon('warn')} **Lỗi đang gặp** · Vẫn lỗi`,
      `${icon('details')} **Đã thử** · Đăng nhập lại`,
    ].join('\n'));
    expect(again.editReply.mock.lastCall[0].content).toContain('Đã cập nhật yêu cầu bảo hành');
  });

  it('still accepts a legacy single-step warranty form and blocks restricted customers', async () => {
    mocks.order.mockReturnValue({ guild_id: STORE_ONE_GUILD_ID, customer_id: 'customer', status: 'COMPLETED' });
    mocks.warranty.mockResolvedValue({ channel: { id: 'private' }, reused: false });
    const legacy = interaction('ticket:intake:form:warranty', { code: 'cn_123456', issue: 'Lỗi đăng nhập' });
    await handleTicketIntakeInteraction(legacy);
    expect(mocks.warranty).toHaveBeenCalledWith(expect.objectContaining({ orderCode: 'CN_123456', formData: { issue: 'Lỗi đăng nhập' } }));

    mocks.flag.mockReturnValue({ is_blacklisted: 1 });
    const blocked = interaction('ticket:intake:open:warranty');
    await handleTicketIntakeInteraction(blocked);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(blocked.reply.mock.lastCall[0].content).toContain('giới hạn mở ticket');

    const forged = interaction('ticket:intake:form:warranty:bad code', { issue: 'x' });
    await handleTicketIntakeInteraction(forged);
    expect(mocks.warranty).toHaveBeenCalledTimes(1);
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
