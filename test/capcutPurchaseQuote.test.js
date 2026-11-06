import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ livePrice: 100000, product: {}, quote: vi.fn(), wallet: vi.fn(), createOrder: vi.fn(), pay: vi.fn(), ticket: vi.fn(), close: vi.fn(), locks: new Set() }));
vi.mock('../src/config.js', () => ({ config: { ticketOpenCooldownSeconds: 1 } }));
vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/utils/emojiHelper.js', () => ({ createEmojiResolver: () => slot => slot }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({ ticket_category_id: 'category' }) }));
vi.mock('../src/services/blacklistService.js', () => ({ getCustomerFlag: () => ({}), getTicketMuteStatus: () => ({ is_ticket_muted: false }) }));
vi.mock('../src/services/productCatalogService.js', () => ({ getProductById: () => ({ ...mocks.product }), updateProduct: vi.fn(), addProduct: vi.fn(), getProductByName: vi.fn() }));
vi.mock('../src/services/shopPanelService.js', () => ({ refreshAllShopPanels: vi.fn() }));
vi.mock('../src/services/cenarHub.js', () => ({ getCenarHub: () => null }));
vi.mock('../src/services/ticketService.js', () => ({ createTicket: mocks.ticket, getOpenTicketByCustomer: () => null, closeTicket: mocks.close }));
vi.mock('../src/services/orderService.js', () => ({ createOrder: mocks.createOrder, payOrderWithWallet: mocks.pay, saveOrderLogMessage: vi.fn() }));
vi.mock('../src/utils/embeds.js', () => ({ buildTicketWelcomeV2: vi.fn(), buildTicketControlComponents: vi.fn() }));
vi.mock('../src/utils/formatters.js', () => ({ buildTicketChannelName: () => 'new-ticket', parseMoneyInput: vi.fn(), buildOrderLogContent: vi.fn() }));
vi.mock('../src/services/abuseService.js', () => ({ ensureRateLimit: vi.fn() }));
vi.mock('../src/services/ctvService.js', () => ({ isCustomerCtv: () => false }));
vi.mock('../src/services/ctvOrderLogService.js', () => ({ buildCtvPriorityNotice: vi.fn() }));
vi.mock('../src/services/walletService.js', () => ({ getWalletBalance: mocks.wallet }));
vi.mock('../src/services/paymentService.js', () => ({ sendOrRefreshPaymentQr: vi.fn() }));
vi.mock('../src/services/capcutPricingService.js', () => ({ assertCapcutPurchaseQuote: mocks.quote }));
vi.mock('../src/events/shared.js', () => ({ safeReply: (interaction, payload) => interaction.reply(payload), getTicketCategoryId: () => 'category', activeTicketCreations: mocks.locks }));
import { handleProductPurchaseFlow, handleProductSelect } from '../src/events/productHandlers.js';

function interaction() {
  const member = { permissions: { has: () => false }, roles: { cache: new Map() } };
  const channel = { id: 'created-channel', setName: vi.fn().mockResolvedValue(null), send: vi.fn().mockResolvedValue({}), delete: vi.fn() };
  return { guildId: '1282637033340403754', user: { id: '1555555555555555555', username: 'fixture' }, member,
    client: { user: { id: 'bot' } }, values: ['1'], fields: { getTextInputValue: () => '1' },
    guild: { roles: { everyone: { id: 'everyone' } }, members: { fetch: vi.fn().mockResolvedValue(member) },
      channels: { create: vi.fn().mockResolvedValue(channel) } },
    reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn(), showModal: vi.fn().mockResolvedValue(null), channelFixture: channel };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.locks.clear(); mocks.livePrice = 100000;
  mocks.product = { id: 1, product_key: 'capcut-pro-1-thang-2-thiet-bi-cap-acc', name: 'CapCut Pro 1 Tháng',
    price: 100000, ctv_price: null, is_active: 1, service_type: 'AI', duration_months: 1 };
  mocks.wallet.mockReturnValue(1000000);
  mocks.ticket.mockReturnValue({ id: 99, ticket_code: 'FIXTURE', channel_id: 'created-channel' });
  mocks.quote.mockImplementation((id, expected) => {
    if (Number(expected) !== mocks.livePrice) throw new Error(`Giá CapCut hiện tại là ${mocks.livePrice}đ; chưa tạo đơn hoặc trừ ví.`);
    return mocks.livePrice;
  });
});

describe('CapCut purchase quoted-price guard', () => {
  it('shows the current unit price in the modal and carries it into the purchase quote', async () => {
    const user = interaction();
    await handleProductSelect(user);
    const modal = user.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe('product:purchase:modal:1:100000');
    expect(modal.components[0].components[0].label).toContain('100.000đ');
  });
  it.each([undefined, '100000'])('rejects an old/missing quote before ticket creation or any wallet charge (%s)', async quote => {
    const user = interaction();
    mocks.product.price = mocks.livePrice = 120000;
    await handleProductPurchaseFlow(user, '1', quote);
    expect(mocks.ticket).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(user.guild.channels.create).not.toHaveBeenCalled();
    expect(user.editReply).toHaveBeenCalledWith(expect.stringContaining('chưa tạo đơn hoặc trừ ví'));
  });
  it('rechecks after Discord I/O, closes only its empty ticket record and preserves channel history', async () => {
    const user = interaction();
    user.guild.channels.create.mockImplementation(async () => { mocks.livePrice = 120000; return user.channelFixture; });
    await handleProductPurchaseFlow(user, '1', '100000');
    expect(mocks.quote).toHaveBeenCalledTimes(2);
    expect(mocks.ticket).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(99, 'bot');
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(user.channelFixture.delete).not.toHaveBeenCalled();
    expect(user.channelFixture.send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));
    expect(mocks.locks.size).toBe(0);
  });
});
