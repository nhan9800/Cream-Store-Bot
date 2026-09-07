import { describe, expect, it } from 'vitest';
import {
  buildWarrantyLookupPayload,
  claimAiResponseSlot,
  classifyCustomerIntent,
  extractOrderCode,
  hasExplicitPurchaseConfirmation,
  matchWarrantyOrders,
  sanitizeCustomerTextForAi,
  shouldAiReplyInPublic,
  shouldAiReplyInTicket,
} from '../src/services/aiSupportAutomationService.js';
import { canTicketAiRespond } from '../src/services/ticketService.js';
import { getConfiguredAiProviders } from '../src/services/aiService.js';

const GUILD_ID = '1282637033340403754';

describe('AI support automation safety', () => {
  it('classifies warranty, product advice and explicit checkout separately', () => {
    expect(classifyCustomerIntent('Netflix của mình bị lỗi, mất premium rồi')).toBe('WARRANTY');
    expect(classifyCustomerIntent('Shop tư vấn giúp gói YouTube 3 tháng giá bao nhiêu?')).toBe('PRODUCT_ADVICE');
    expect(classifyCustomerIntent('Mình muốn mua Netflix')).toBe('PURCHASE');
    expect(classifyCustomerIntent('Chốt gói Netflix 1 tháng nhé')).toBe('PURCHASE_CONFIRM');
    expect(hasExplicitPurchaseConfirmation('Mình muốn mua Netflix')).toBe(false);
    expect(hasExplicitPurchaseConfirmation('Ok lấy gói này')).toBe(true);
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
});
