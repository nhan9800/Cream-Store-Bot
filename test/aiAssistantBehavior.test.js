import fs from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const databasePath = `./data/test-ai-behavior-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-ai-behavior-not-present';
  process.env.DATABASE_PATH = databasePath;
  return { databasePath, ticket: null, products: [], prepare: vi.fn(), select: vi.fn(), log: vi.fn(), generate: vi.fn() };
});
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: state.generate }; } }));
vi.mock('../src/services/aiKnowledgeService.js', () => ({ getAiKnowledge: () => '' }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({ ticket_panel_channel_id: 'ticket-panel' }) }));
vi.mock('../src/services/productCatalogService.js', () => ({
  getActiveProducts: () => state.products, generateProductKnowledgeText: () => 'Catalog hiện hành',
}));
vi.mock('../src/services/ticketService.js', () => ({ getTicketByChannelId: () => state.ticket }));
vi.mock('../src/services/automationLogService.js', () => ({ emitAutomationLog: state.log }));
vi.mock('../src/services/aiSupportAutomationService.js', async (original) => ({
  ...await original(), prepareAiOrderConfirmation: state.prepare, sendAiProductSelection: state.select,
}));

import { config } from '../src/config.js';
import { db } from '../src/database/db.js';
import { aiProductDuration } from '../src/utils/aiProductFacts.js';
import { buildCurrentAiHint, buildDeterministicFallback, generateSystemPrompt, processAiMessage } from '../src/services/aiService.js';

const original = { aiProvider: config.aiProvider, groqApiKey: config.groqApiKey, geminiApiKeys: config.geminiApiKeys };
const youtube = { id: 1, name: 'YouTube Premium 6 Tháng', duration_months: 6, price: 250000, warranty_policy: 'Theo thời hạn gói', is_active: 1 };
function message(content) {
  const item = {
    id: '100', guildId: 'guild', content, author: { id: 'customer', bot: false },
    client: { user: { id: 'bot' } }, reply: vi.fn().mockResolvedValue({ id: 'reply' }),
    guild: { id: 'guild', channels: { cache: new Map() } },
    channel: { id: 'ticket', name: 'ticket-test', sendTyping: vi.fn().mockResolvedValue(), messages: { fetch: vi.fn().mockResolvedValue(new Map()) } },
  };
  return item;
}
beforeEach(() => {
  state.ticket = { id: 9, guild_id: 'guild', customer_id: 'customer', ticket_type: 'ORDER', status: 'OPEN' };
  state.products = [youtube];
  state.prepare.mockReset().mockResolvedValue(true);
  state.select.mockReset().mockResolvedValue(true);
  state.log.mockReset().mockResolvedValue();
  state.generate.mockReset().mockResolvedValue({ text: 'Câu trả lời mẫu.', functionCalls: [] });
  Object.assign(config, { aiProvider: 'gemini', geminiApiKeys: ['synthetic-test-key'], groqApiKey: '' });
});
afterEach(() => { Object.assign(config, original); vi.restoreAllMocks(); });
afterAll(() => {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${state.databasePath}${suffix}`, { force: true });
});

describe('shop assistant customer journeys', () => {
  it('prepares only the exact requested SKU and quantity before customer confirmation', async () => {
    const item = message('Mình muốn mua 2 gói YouTube 6 tháng');
    await processAiMessage(item, true);
    expect(state.prepare).toHaveBeenCalledWith(item, { productId: 1, quantity: 2 });
    expect(state.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['Mình đã chuyển khoản mua YouTube rồi', 'PAYMENT'],
    ['Hoàn tiền đơn đã mua giúp mình', 'REFUND'],
    ['Kiểm tra đơn CN_123456 giúp mình', 'ORDER_LOOKUP'],
    ['Cho mình gặp admin', 'OTHER'],
  ])('handles %s even when the model is unavailable', async (content, category) => {
    config.geminiApiKeys = [];
    const item = message(content);
    await processAiMessage(item, true);
    expect(state.log).toHaveBeenCalledWith(item.client, expect.objectContaining({ action: `AI_ESCALATE_${category}` }));
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
    expect(item.reply.mock.calls[0][0].content).toContain('cần staff kiểm tra');
  });

  it.each(['public', 'other-customer', 'other-guild', 'closed', 'staff'])('never executes unsolicited model actions in %s context', async (context) => {
    const item = message('YouTube 6 tháng giá bao nhiêu?');
    if (context === 'other-customer') state.ticket.customer_id = 'someone-else';
    if (context === 'other-guild') state.ticket.guild_id = 'other-guild';
    if (context === 'closed') state.ticket.status = 'CLOSED';
    state.generate.mockResolvedValue({ functionCalls: [{ name: 'prepare_order', args: { productId: 1, quantity: 9 } }] });
    await processAiMessage(item, context !== 'public', context === 'staff');
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.log).not.toHaveBeenCalled();
    expect(item.reply).toHaveBeenCalled();
  });

  it('rejects model checkout for an advice-only or explicitly undecided customer', async () => {
    state.generate.mockResolvedValue({ functionCalls: [{ name: 'prepare_order', args: { productId: 1, quantity: 1 } }] });
    for (const content of ['YouTube 6 tháng giá bao nhiêu?', 'Chưa mua YouTube 6 tháng nhé']) {
      await processAiMessage(message(content), true);
    }
    expect(state.prepare).not.toHaveBeenCalled();
  });

  it.each(['other-guild', 'closed', 'other-customer'])('rejects deterministic checkout in %s ticket', async (context) => {
    if (context === 'other-guild') state.ticket.guild_id = 'other';
    if (context === 'closed') state.ticket.status = 'CLOSED';
    if (context === 'other-customer') state.ticket.customer_id = 'other';
    await processAiMessage(message('Chốt YouTube 6 tháng nhé'), true);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
  });

  it('explains incompatible purchase constraints before showing any checkout selector', async () => {
    const item = message('Chốt YouTube 1 tháng');
    await processAiMessage(item, true);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
    expect(item.reply.mock.calls[0][0].content).toContain('chưa có đúng thời hạn');
  });

  it('does not exceed a brand-free budget in provider fallback', () => {
    state.products = [{ ...youtube, is_featured: 1 },
      { id: 2, name: 'CapCut 7 Ngày', duration_days: 7, price: 15000, is_active: 1, is_featured: 1 },
      { id: 3, name: 'Thiết kế cần báo giá', price: 0, is_active: 1, is_featured: 1 }];
    const text = buildDeterministicFallback(message('Ngân sách tối đa 50k'), true);
    expect(text).toContain('15.000đ');
    expect(text).not.toContain('250.000đ');
    expect(text).not.toContain('Thiết kế');
  });

  it('does not claim a staff alert was delivered when logging fails', async () => {
    state.log.mockRejectedValue(new Error('synthetic unavailable'));
    const item = message('Cho mình gặp admin');
    await processAiMessage(item, true);
    expect(item.reply.mock.calls[0][0].content).toContain('cần staff kiểm tra');
    expect(item.reply.mock.calls[0][0].content).not.toContain('đã chuyển');
  });

  it('validates model escalation categories and masks secrets in staff summaries', async () => {
    const item = message('Mình cần hỗ trợ');
    state.generate.mockResolvedValue({ functionCalls: [{ name: 'escalate_support', args: { category: 'INVENTED', summary: 'test' } }] });
    await processAiMessage(item, true);
    expect(state.log).not.toHaveBeenCalled();
    state.generate.mockResolvedValue({ functionCalls: [{ name: 'escalate_support', args: { category: 'ACCOUNT', summary: 'pass: secret123 otp:123456' } }] });
    await processAiMessage(item, true);
    expect(state.log).toHaveBeenCalledTimes(1);
    const summary = state.log.mock.calls[0][1].summary;
    expect(summary).not.toContain('secret123');
    expect(summary).not.toContain('123456');
  });

  it('explains unavailable duration instead of presenting an alternative as a match', () => {
    const text = buildDeterministicFallback(message('Tư vấn YouTube 1 tháng'), true);
    expect(text).toContain('chưa có đúng thời hạn');
    expect(text).toContain('6 Tháng');
    expect(text).toContain('250.000đ');
  });

  it('asks for the product when warranty policy is ambiguous rather than listing featured products', () => {
    state.products = [{ ...youtube, is_featured: 1 }];
    const text = buildDeterministicFallback(message('Chính sách bảo hành thế nào?'), true);
    expect(text).toContain('sản phẩm nào');
    expect(text).not.toContain('YouTube');
  });

  it('keeps a price-only followup on the customer’s latest product', () => {
    const text = buildDeterministicFallback(message('Giá sao?'), true, ['YouTube 6 tháng']);
    expect(text).toContain('250.000đ');
    expect(text).not.toContain('mô tả lỗi');
  });

  it('supplies accurate warranty and total-budget context without overriding catalog', async () => {
    const hint = buildCurrentAiHint({ intent: 'PRODUCT_ADVICE', isTicket: true, resolution: {
      products: [{ ...youtube, warranty_policy: 'Chỉ bảo hành kích hoạt' }], quantity: 2,
      requestedBudget: { amount: 100000, inclusive: true, scope: 'TOTAL' },
      requestedDurationAvailable: false, unmetConstraints: ['BUDGET'],
    } });
    expect(hint).toContain('100.000đ tổng đơn');
    expect(hint).toContain('Chỉ bảo hành kích hoạt');
    expect(hint).toContain('KHÔNG có đúng thời hạn');
    expect(hint).not.toContain('NaN');
    const prompt = await generateSystemPrompt(message('').guild, false, hint);
    expect(prompt).toContain('Bảo hành khác thời hạn sử dụng');
    expect(prompt).toContain('không tự áp dụng vào checkout');
  });

  it('keeps day, perpetual and project facts distinct', () => {
    expect(aiProductDuration({ name: 'CapCut', duration_days: 7, duration_months: 1 })).toBe('7 ngày');
    expect(aiProductDuration({ name: 'Windows 11 Pro Vĩnh Viễn', duration_months: 0 })).toBe('Vĩnh viễn');
    expect(aiProductDuration({ name: 'Setup Bot + Hosting 3 Tháng', duration_months: 3, service_type: 'SERVICE' })).toBe('Theo phạm vi dự án');
    expect(aiProductDuration({ name: 'Gói chưa rõ', duration_months: null })).toContain('Cần xác nhận');
  });
});
