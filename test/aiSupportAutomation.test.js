import { describe, expect, it, vi } from 'vitest';
import {
  buildAiOrderConfirmationPayload,
  buildAiProductSelectionPayload,
  buildWarrantyLookupPayload,
  claimAiResponseSlot,
  classifyCustomerIntent,
  extractOrderCode,
  evaluateCatalogOrderQuote,
  hasExplicitPurchaseConfirmation,
  handleAiSupportInteraction,
  matchWarrantyOrders,
  prepareAiOrderConfirmation,
  sanitizeCustomerTextForAi,
  shouldAiReplyInPublic,
  shouldAiReplyInTicket,
} from '../src/services/aiSupportAutomationService.js';
import { canTicketAiRespond } from '../src/services/ticketService.js';
import { buildAiConversationHistory, buildAiMessageContext, getConfiguredAiProviders } from '../src/services/aiService.js';
import * as orderService from '../src/services/orderService.js';
import * as ticketService from '../src/services/ticketService.js';
import * as productCatalogService from '../src/services/productCatalogService.js';
import * as guildConfigService from '../src/services/guildConfigService.js';
import * as paymentService from '../src/services/paymentService.js';
import * as staffLogService from '../src/services/staffLogService.js';
import * as orderEmbeds from '../src/utils/embeds.js';
import * as orderFormatters from '../src/utils/formatters.js';

const GUILD_ID = '1282637033340403754';

describe('AI support automation safety', () => {
  it('distinguishes warranty policy questions from faults and refuses negated checkout', () => {
    expect(classifyCustomerIntent('YouTube bảo hành bao lâu?')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('YouTube có bảo hành không?')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('Mình muốn mua ChatGPT Plus UPI Pay 1 tháng bảo hành 12 giờ')).toBe('PURCHASE');
    expect(classifyCustomerIntent('YouTube có quyền lợi gì, có bảo hành không?')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('YouTube bị out fam, có bảo hành không?')).toBe('WARRANTY');
    for (const text of ['Không chốt YouTube nhé', 'Đừng tạo đơn', 'Khoan lên đơn', 'Chưa xác nhận mua']) {
      expect(hasExplicitPurchaseConfirmation(text)).toBe(false);
    }
  });

  it('responds to short ticket follow-ups and scopes history to the triggering customer and time', () => {
    const current = { id: '100', author: { id: 'customer' }, content: '3 tháng nhé',
      client: { user: { id: 'bot' } }, mentions: { has: () => false } };
    expect(shouldAiReplyInTicket(current, { status: 'OPEN', customer_id: 'customer' })).toBe(true);
    const prior = { id: '90', author: { id: 'customer' }, content: 'YouTube giá sao?' };
    const other = { id: '91', author: { id: 'someone-else' }, content: 'Netflix' };
    const future = { id: '110', author: { id: 'customer' }, content: '1 tháng' };
    const context = buildAiMessageContext(current, new Map([prior, other, future].map(m => [m.id, m])), 'customer');
    expect(context.map(m => m.id)).toEqual(['90', '100']);
    const history = buildAiConversationHistory([other, ...context], 'bot', { customerId: 'customer' });
    expect(history).toHaveLength(2);
    expect(history.at(-1).content).toContain('3 tháng');
  });
  it('classifies warranty, product advice and explicit checkout separately', () => {
    expect(classifyCustomerIntent('Netflix của mình bị lỗi, mất premium rồi')).toBe('WARRANTY');
    expect(classifyCustomerIntent('Shop tư vấn giúp gói YouTube 3 tháng giá bao nhiêu?')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('Mình muốn mua Netflix')).toBe('PURCHASE');
    expect(classifyCustomerIntent('Chốt gói Netflix 1 tháng nhé')).toBe('PURCHASE_CONFIRM');
    expect(hasExplicitPurchaseConfirmation('Mình muốn mua Netflix')).toBe(false);
    expect(hasExplicitPurchaseConfirmation('Ok lấy gói này')).toBe(true);
    expect(classifyCustomerIntent('Lên đơn YouTube 3 tháng cho mình nhé')).toBe('PURCHASE_CONFIRM');
    expect(classifyCustomerIntent('Cho mình Netflix 1 tháng')).toBe('PURCHASE');
  });

  it('understands natural Vietnamese shorthand and keeps ambiguous requests in advice mode', () => {
    expect(classifyCustomerIntent('Shop ơi, mình đang phân vân YouTube 1 hay 3 tháng, tư vấn giúp mình với')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('ytb 3 tháng giá sao shop?')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('Mình muốn mua gói này, nhưng chưa chốt thời hạn')).toBe('PURCHASE');
    expect(classifyCustomerIntent('Mình đã chuyển khoản rồi, kiểm tra giúp mình với')).toBe('PAYMENT');
  });

  it.each([
    ['Mình đã chốt Nitro hôm qua, hoàn tiền giúp mình', 'REFUND'],
    ['Xin refund đơn CN_123456, không lấy gói nữa', 'REFUND'],
    ['Bao giờ shop hoàn tiền cho đơn đã mua?', 'REFUND'],
    ['Shop chưa hoàn tiền cho mình', 'REFUND'],
    ['Tôi đã chuyển khoản mua Nitro, kiểm tra giao dịch giúp', 'PAYMENT'],
    ['em ck roi, len don luc nay sao chua nhan?', 'PAYMENT'],
    ['Thanh toán lỗi nhưng đã trừ tiền', 'PAYMENT'],
    ['QR hết hạn, lấy gói Canva thế nào?', 'PAYMENT'],
    ['Đơn CN_123456 xử lý tới đâu rồi?', 'ORDER_LOOKUP'],
    ['Tôi đã chốt Locket 1 năm rồi', 'ORDER_LOOKUP'],
    ['Check đơn Nitro, bao giờ giao hàng?', 'ORDER_LOOKUP'],
    ['Cho mình gặp nhân viên, mình muốn mua Nitro', 'HUMAN_SUPPORT'],
    ['Chuyển sang staff giúp mình với', 'HUMAN_SUPPORT'],
    ['Mình cần nói chuyện với người thật', 'HUMAN_SUPPORT'],
  ])('routes an existing request instead of preparing another order: %s', (content, intent) => {
    expect(classifyCustomerIntent(content)).toBe(intent);
    expect(hasExplicitPurchaseConfirmation(content)).toBe(false);
    expect(shouldAiReplyInTicket({
      author: { id: 'customer' }, content, client: { user: { id: 'bot' } },
    }, { status: 'OPEN', customer_id: 'customer' })).toBe(true);
  });

  it.each([
    ['Locket có bảo hành không?', 'PRODUCT_ADVICE'],
    ['Nếu Gemini bị quét thì có được bảo hành không?', 'PRODUCT_ADVICE'],
    ['Nếu tài khoản bị khóa có được hoàn tiền không?', 'PRODUCT_ADVICE'],
    ['Chính sách refund thế nào?', 'PRODUCT_ADVICE'],
    ['Locket của mình bị mất gói rồi', 'WARRANTY'],
    ['win 11 loi khong dung duoc', 'WARRANTY'],
    ['Gemini đang bị quét, có được bảo hành không?', 'WARRANTY'],
    ['spoti acc die roi shop', 'WARRANTY'],
    ['Mình đã thanh toán YouTube tuần trước, hôm nay bị out fam', 'WARRANTY'],
    ['Đơn CN_123456 bảo hành YouTube bị out fam xử lý tới đâu?', 'WARRANTY'],
    ['Cho mình Locket Gold 12 tháng', 'PURCHASE'],
    ['Chốt Windows 11 Pro cho mình', 'PURCHASE_CONFIRM'],
    ['Mình muốn mua thêm Canva', 'PURCHASE'],
    ['Locket giá sao?', 'PRODUCT_ADVICE'],
    ['win 11 bao nhiêu tiền?', 'PRODUCT_ADVICE'],
    ['Nitro tối đa 100k', 'PRODUCT_ADVICE'],
    ['Locket dưới 90k', 'PRODUCT_ADVICE'],
    ['Canva không quá 200k', 'PRODUCT_ADVICE'],
    ['Giá sao?', 'PRODUCT_ADVICE'],
    ['gia sao shop', 'PRODUCT_ADVICE'],
    ['Mình có cần gọi admin để thanh toán không?', 'SUPPORT'],
    ['Không cần gặp staff, cho mình hỏi Locket giá sao?', 'PRODUCT_ADVICE'],
    ['Không muốn refund, cho mình hỏi Locket giá sao?', 'PRODUCT_ADVICE'],
    ['Chưa muốn hoàn tiền, cho mình hỏi Locket giá sao?', 'PRODUCT_ADVICE'],
    ['internet hôm nay chậm ghê', 'GENERAL'],
  ])('distinguishes a policy or new purchase from an actual fault: %s', (content, intent) => {
    expect(classifyCustomerIntent(content)).toBe(intent);
  });

  it('redacts labelled credentials and common API key formats while retaining the order reference', () => {
    const credentialText = [
      'CN_123456 mình bị lỗi đăng nhập',
      'Authorization: Bearer syntheticBearerCredential',
      'access_token: syntheticAccessCredential',
      'refresh-token="syntheticRefreshCredential"',
      'api_key=syntheticApiCredential',
      'client_secret: syntheticClientSecret',
      'Cookie: session=syntheticSession; other=syntheticCookie',
      'sk-proj-syntheticKeyValue1234567890',
      'gsk_syntheticKeyValue1234567890',
      'AIzaSyntheticKeyValue1234567890',
    ].join('\n');
    const sanitized = sanitizeCustomerTextForAi(credentialText);
    expect(sanitized).toContain('CN_123456');
    expect(sanitized).toContain('mình bị lỗi đăng nhập');
    expect(sanitized).not.toMatch(/synthetic/i);
    expect(sanitized).toContain('[COOKIE ĐÃ ẨN]');
  });

  it('extracts only supported Cenar order codes', () => {
    expect(extractOrderCode('bảo hành giúp đơn cn_123456')).toBe('CN_123456');
    expect(extractOrderCode('Mã cũ CR_654321 bị lỗi')).toBe('CR_654321');
    expect(extractOrderCode('đơn 123456')).toBeNull();
  });

  it('redacts secrets before any customer history is sent to the model', () => {
    const sanitized = sanitizeCustomerTextForAi(
      'email test@gmail.com password: abc123 OTP 123456 sđt 0912345678 https://example.com/x',
    );
    expect(sanitized).not.toContain('test@gmail.com');
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('123456');
    expect(sanitized).not.toContain('https://');
    expect(sanitized).not.toContain('0912345678');
    expect(sanitized).toContain('[EMAIL ĐÃ ẨN]');
  });

  it('ranks completed orders by the product mentioned without losing fallback results', () => {
    const orders = [
      { order_code: 'CN_111111', product_name: 'Netflix Slot 1 Tháng' },
      { order_code: 'CN_222222', product_name: 'YouTube Premium 3 Tháng' },
    ];
    expect(matchWarrantyOrders(orders, 'YouTube bị out family')).toEqual([orders[1]]);
    expect(matchWarrantyOrders(orders, 'sản phẩm bị lỗi')).toEqual(orders);
  });

  it('renders a selector for real orders and an escalation path when no order exists', () => {
    const ticket = { id: 99 };
    const orderPayload = buildWarrantyLookupPayload({
      ticket,
      guildId: GUILD_ID,
      orders: [{
        order_code: 'CN_123456',
        product_name: 'Netflix Slot 1 Tháng',
        completed_at: '2026-09-01T00:00:00.000Z',
        status: 'COMPLETED',
      }],
    });
    const orderJson = JSON.stringify(orderPayload);
    expect(orderJson).toContain('ai:support:warranty_select:99');
    expect(orderJson).toContain('CN_123456');

    const emptyJson = JSON.stringify(buildWarrantyLookupPayload({ ticket, guildId: GUILD_ID, orders: [] }));
    expect(emptyJson).toContain('ai:support:escalate:99');
    expect(emptyJson).toContain('không tạo đơn 0đ hay lịch sử giả');
  });

  it('locks confirmation to the quoted catalog revision and renders clear product choices', () => {
    const ticket = { id: 88 };
    const product = {
      id: 7,
      name: 'YouTube Premium 3 Tháng',
      price: 150_000,
      duration_months: 3,
      duration_days: null,
      warranty_policy: 'Full 3 tháng',
      is_active: 1,
      updated_at: '2026-09-28T08:00:00.000Z',
    };
    const confirmation = JSON.stringify(buildAiOrderConfirmationPayload({
      guildId: GUILD_ID,
      ticket,
      product,
      quantity: 2,
    }));
    const revision = Math.trunc(new Date(product.updated_at).getTime()).toString(36);
    expect(confirmation).toContain(`ai:support:order_confirm:88:7:2:300000:${revision}`);
    expect(confirmation).toContain('300.000đ');
    expect(confirmation).toContain('Full 3 tháng');

    expect(evaluateCatalogOrderQuote(product, 2, 300_000, revision).isCurrent).toBe(true);
    expect(evaluateCatalogOrderQuote({ ...product, price: 160_000 }, 2, 300_000, revision).isCurrent).toBe(false);
    expect(evaluateCatalogOrderQuote(product, 2, undefined, undefined).isCurrent).toBe(false);

    const selection = JSON.stringify(buildAiProductSelectionPayload({
      guildId: GUILD_ID,
      ticket,
      products: [product, { ...product, id: 8, name: 'YouTube Premium 6 Tháng' }],
      quantity: 2,
    }));
    expect(selection).toContain('ai:support:order_select:88:2');
    expect(selection).toContain('YouTube Premium 3 Tháng');
    expect(selection).toContain('YouTube Premium 6 Tháng');
  });

  it.each([
    [{ name: 'Windows 11 Pro Vĩnh Viễn', service_type: 'windows', duration_months: null }, 'Vĩnh viễn'],
    [{ name: 'Bot Custom + Hosting 3 tháng', service_type: 'service', duration_months: null }, 'Theo phạm vi dự án'],
    [{ name: 'CapCut Pro 7 ngày', service_type: 'capcut', duration_days: 7 }, '7 ngày'],
  ])('shows the product duration without inventing a monthly subscription: %o', (facts, duration) => {
    const product = { id: 7, price: 120_000, is_active: 1, ...facts };
    const confirmation = JSON.stringify(buildAiOrderConfirmationPayload({
      guildId: GUILD_ID, ticket: { id: 88 }, product,
    }));
    expect(confirmation).toContain(duration);
    expect(confirmation).not.toContain('1 tháng');
  });

  it.each([
    [154, 'CapCut Pro 7 Ngày (2 Thiết Bị - Cấp Acc)', 'AI', 1, null, 0, 7],
    [153, 'CapCut Pro 1 Tháng (2 Thiết Bị - Cấp Acc)', 'AI', 1, null, 1, null],
    [184, 'Setup Discord + Hosting 3 Tháng', 'SERVICE', 3, null, 3, null],
    [119, 'Decor Discord Gói 25k', 'decor', 1, null, 1, null],
  ])('creates the confirmed SKU %i with its effective day plan and unchanged commercial values', async (
    id, name, serviceType, rawMonths, rawDays, orderMonths, orderDays,
  ) => {
    const ticket = { id: 800 + id, guild_id: GUILD_ID, channel_id: `synthetic-ticket-${id}`,
      customer_id: `synthetic-customer-${id}`, ticket_type: 'ORDER', status: 'OPEN' };
    const product = { id, name, service_type: serviceType, guild_id: 'WEB', is_active: 1,
      price: 15000, duration_months: rawMonths, duration_days: rawDays };
    const create = vi.spyOn(orderService, 'createOrder').mockReturnValue({
      order_code: 'CN_123456', product_name: name, total_amount: 30000,
    });
    const qr = vi.spyOn(paymentService, 'sendOrRefreshPaymentQr').mockResolvedValue({});
    vi.spyOn(orderService, 'getLatestOrderByTicketChannel').mockReturnValue(null);
    vi.spyOn(orderService, 'saveOrderLogMessage').mockReturnValue(true);
    vi.spyOn(orderService, 'getQueuePosition').mockReturnValue({ position: 1, total: 1 });
    vi.spyOn(ticketService, 'getTicketById').mockReturnValue(ticket);
    vi.spyOn(ticketService, 'getTicketByChannelId').mockReturnValue(ticket);
    vi.spyOn(productCatalogService, 'getProductById').mockReturnValue(product);
    vi.spyOn(guildConfigService, 'getGuildConfig').mockReturnValue({ order_log_channel_id: 'synthetic-log' });
    vi.spyOn(staffLogService, 'emitStaffLog').mockResolvedValue({});
    vi.spyOn(orderEmbeds, 'buildOrderCreatedV2').mockReturnValue({ container: {}, actionRow: {}, flags: 32768 });
    vi.spyOn(orderEmbeds, 'buildQueuePositionV2').mockReturnValue({ container: {}, actionRow: {} });
    vi.spyOn(orderFormatters, 'buildOrderLogContent').mockReturnValue('Synthetic order log');
    const channel = { id: ticket.channel_id, send: vi.fn().mockResolvedValue({ id: 'synthetic-message' }) };
    const interaction = {
      guildId: GUILD_ID, inGuild: () => true, user: { id: ticket.customer_id },
      client: { user: { id: 'synthetic-bot' } },
      customId: `ai:support:order_confirm:${ticket.id}:${product.id}:2:30000:catalog`,
      guild: { channels: { fetch: vi.fn().mockResolvedValue({ send: vi.fn().mockResolvedValue({ id: 'synthetic-log-message' }) }) } },
      channel, deferReply: vi.fn().mockResolvedValue(), editReply: vi.fn().mockResolvedValue(),
      message: { edit: vi.fn().mockResolvedValue() }, reply: vi.fn().mockResolvedValue(),
    };
    try {
      await prepareAiOrderConfirmation({ guildId: GUILD_ID, channel, author: { id: ticket.customer_id } }, { productId: id, quantity: 2 });
      expect(create).not.toHaveBeenCalled();
      expect(qr).not.toHaveBeenCalled();
      if (orderDays) expect(JSON.stringify(channel.send.mock.calls[0][0])).toContain('7 ngày');
      expect(await handleAiSupportInteraction(interaction)).toBe(true);
      expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        guildId: GUILD_ID, ticketId: ticket.id, customerId: ticket.customer_id,
        productId: id, productName: name, quantity: 2, totalAmount: 30000,
        durationMonths: orderMonths, durationDays: orderDays,
      }));
      expect(qr).toHaveBeenCalledOnce();
      expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('CN_123456'));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('limits proactive public replies to configured channels and meaningful intent', () => {
    const base = {
      content: 'Shop tư vấn YouTube giúp mình?',
      channel: { id: '1519182567151239188' },
    };
    expect(shouldAiReplyInPublic(base)).toBe(true);
    expect(shouldAiReplyInPublic({ ...base, channel: { id: 'other' } })).toBe(false);
    expect(shouldAiReplyInPublic({ ...base, content: 'xin chào mọi người' })).toBe(false);
    expect(shouldAiReplyInPublic({ ...base, channel: { id: 'other' } }, { mentioned: true })).toBe(true);
  });

  it('respects response cooldowns and only answers the ticket customer', () => {
    expect(claimAiResponseSlot('test-slot', 10, 1_000)).toBe(true);
    expect(claimAiResponseSlot('test-slot', 10, 2_000)).toBe(false);
    expect(claimAiResponseSlot('test-slot', 10, 12_000)).toBe(true);

    const message = {
      author: { id: 'customer' },
      content: 'giá YouTube bao nhiêu?',
      client: { user: { id: 'bot' } },
      mentions: { has: () => false },
    };
    expect(shouldAiReplyInTicket(message, { status: 'OPEN', customer_id: 'customer' })).toBe(true);
    expect(shouldAiReplyInTicket(message, { status: 'OPEN', customer_id: 'other' })).toBe(false);
  });

  it('automatically resumes only timed staff pauses', () => {
    const now = new Date('2026-09-07T10:00:00.000Z');
    expect(canTicketAiRespond({ status: 'OPEN', ai_status: 'ACTIVE' }, now)).toBe(true);
    expect(canTicketAiRespond({ status: 'OPEN', ai_status: 'PAUSED', ai_paused_until: null }, now)).toBe(false);
    expect(canTicketAiRespond({ status: 'OPEN', ai_status: 'PAUSED', ai_paused_until: '2026-09-07T09:59:00.000Z' }, now)).toBe(true);
    expect(canTicketAiRespond({ status: 'OPEN', ai_status: 'PAUSED', ai_paused_until: '2026-09-07T10:30:00.000Z' }, now)).toBe(false);
  });

  it('selects an available AI provider and keeps a configured fallback', () => {
    expect(getConfiguredAiProviders({
      aiProvider: 'auto',
      groqApiKey: '',
      geminiApiKeys: ['key-a'],
    })).toEqual(['gemini']);
    expect(getConfiguredAiProviders({
      aiProvider: 'gemini',
      groqApiKey: 'groq-key',
      geminiApiKeys: ['key-a'],
    })).toEqual(['gemini', 'groq']);
    expect(getConfiguredAiProviders({
      aiProvider: 'groq',
      groqApiKey: 'groq-key',
      geminiApiKeys: ['key-a'],
    })).toEqual(['groq', 'gemini']);
  });

  it('keeps the first context and latest messages while bounding model history', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      author: { id: index % 2 ? 'bot' : `customer-${index}`, bot: index % 2 === 1 },
      content: `message-${index} ${'x'.repeat(1_100)}`,
    }));
    const history = buildAiConversationHistory(messages, 'bot', { limit: 6, maxChars: 240 });
    expect(history).toHaveLength(6);
    expect(history[0].content).toContain('message-0');
    expect(history.at(-1).content).toContain('message-19');
    expect(history.every((item) => item.content.length <= 260)).toBe(true);
  });
});
