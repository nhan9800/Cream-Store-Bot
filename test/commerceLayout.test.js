import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  buildCreditOfferV2,
  buildCustomerProfileV2,
  buildDeliveryNoticeV2,
  buildFeedbackV2,
  buildOrderCancelledCustomerV2,
  buildOrderCompletedV2,
  buildOrderCreatedV2,
  buildOrderLogV2Update,
  buildPaymentMethodSelector,
  buildPaymentQrV2,
  buildPaymentSuccessEmbed,
  buildPublicOrderLogV2,
  buildQueuePositionV2,
  buildQuickFeedbackAckV2,
  buildTicketPanelV2,
  buildTicketWelcomeV2,
  buildTranscriptCustomerV2,
  buildTranscriptSummaryV2,
  buildWarrantySelectV2,
  buildAutomationGuideV2,
  buildBlacklistV2,
  buildDashboardV2,
  buildPayOSSetupV2,
} from '../src/utils/embeds.js';

const order = Object.freeze({
  guild_id: '1282637033340403754', customer_id: '123456789012345678',
  order_code: 'CN_LAYOUT', product_name: 'Nitro Boost Login 2 Tháng', quantity: 1,
  total_amount: 115000, amount_paid: 115000, duration_months: 2,
  status: 'COMPLETED', payment_status: 'PAID', ticket_channel_id: '123456789012345679',
  created_at: '2026-11-08T16:20:00Z', completed_at: '2026-11-08T17:20:00Z',
  expiry_at: '2027-01-08T17:20:00Z',
});
const ticket = { ticket_code: 'TICKET_LAYOUT', customer_id: order.customer_id };
const transcript = {
  ticket, messageCount: 72, compressedBytes: 4096, guildId: order.guild_id,
  closedById: '123456789012345680', transcriptUrl: 'https://example.com/transcript/private-link',
};
const samples = [
  ['ticket panel', () => buildTicketPanelV2({ guild_id: order.guild_id })],
  ...['ORDER', 'SUPPORT', 'COMPLAINT', 'PARTNERSHIP', 'WARRANTY', 'APPEAL'].map(type => [
    `ticket ${type}`, () => buildTicketWelcomeV2('TICKET_LAYOUT', order.customer_id, type, order.order_code, order.product_name, order.guild_id),
  ]),
  ['payment method', () => buildPaymentMethodSelector(order)],
  ['warranty selection', () => buildWarrantySelectV2(order.guild_id)],
  ['order created', () => buildOrderCreatedV2(order, order.ticket_channel_id)],
  ['order log', () => buildOrderLogV2Update(order)],
  ['order cancelled', () => buildOrderCancelledCustomerV2(order, 'Khách yêu cầu hủy')],
  ['queue', () => buildQueuePositionV2(order, 3, 7)],
  ['invoice', () => buildPaymentQrV2({ order, hasImage: true, attachmentName: 'invoice.png' })],
  ['receipt', () => buildPaymentSuccessEmbed(order, '115.000 VND', 'TX_LAYOUT')],
  ['completed', () => buildOrderCompletedV2(order, '123456789012345680')],
  ['completion log', () => buildPublicOrderLogV2(order)],
  ['review confirmation', () => buildQuickFeedbackAckV2(order, 5)],
  ['review', () => buildFeedbackV2({ member: { id: order.customer_id }, order, stars: 5, content: 'Hỗ trợ rõ ràng' })],
  ['delivery notice', () => buildDeliveryNoticeV2(order)],
  ['staff transcript', () => buildTranscriptSummaryV2(transcript)],
  ['customer transcript', () => buildTranscriptCustomerV2(transcript)],
  ['profile', () => buildCustomerProfileV2({ id: order.customer_id }, {}, [order], { points: 50, lifetime_points: 200 }, order.guild_id)],
  ['credit offer', () => buildCreditOfferV2({ limit: 500000, available: 350000 }, order.customer_id, order.guild_id)],
  ['automation guide', () => buildAutomationGuideV2(order.guild_id)],
  ['admin dashboard', () => buildDashboardV2({ revenue_paid: 215000 }, [{ product_name: 'Nitro', total_orders: 2 }], [{ action: 'ORDER_UPDATED', detail: 'CN_LAYOUT' }], order.guild_id)],
  ['blacklist profile', () => buildBlacklistV2({ id: order.customer_id, displayAvatarURL: () => 'https://cdn.example.com/avatar.png' }, { warning_count: 3, is_blacklisted: 1, blacklist_reason: 'Lý do riêng' }, order.guild_id)],
  ['PayOS configuration', () => buildPayOSSetupV2(['Chưa xác nhận webhook'], order.guild_id)],
];

function components(payload) {
  return [
    ...(payload.components || (payload.container ? [payload.container] : [])),
    ...(payload.rows || []), ...(payload.actionRow ? [payload.actionRow] : []),
    ...(payload.row ? [payload.row] : []),
  ].map(item => typeof item.toJSON === 'function' ? item.toJSON() : item);
}
function flatten(nodes) {
  return nodes.flatMap(node => [node, ...flatten(node.components || []), ...(node.accessory ? [node.accessory] : [])]);
}

describe('commerce feature layout contracts', () => {
  it.each(samples)('%s has readable native sections and stays within Discord message limits', (_label, render) => {
    const view = render();
    const roots = components(view);
    const all = flatten(roots);
    const text = all.filter(c => c.type === 10).map(c => c.content);
    expect(view.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(all.length).toBeLessThanOrEqual(40);
    expect(text.join('').length).toBeLessThanOrEqual(4000);
    expect(text[0]).toMatch(/^## /);
    expect(all.some(c => c.type === 14 && c.divider && c.spacing === 2)).toBe(true);
    for (const container of all.filter(c => c.type === 17)) {
      expect(container.components[0].type).not.toBe(14);
      expect(container.components.at(-1).type).not.toBe(14);
      for (let index = 1; index < container.components.length; index += 1) {
        expect(container.components[index - 1].type === 14 && container.components[index].type === 14).toBe(false);
      }
    }
    for (const row of all.filter(c => c.type === 1)) expect(row.components.length).toBeLessThanOrEqual(5);
  });

  it('keeps rating and literal review prose separate from shop-authored labels', () => {
    const opinion = 'Cảm ơn 😊\n\n### Ý kiến của tôi\n---\n`mã: giữ nguyên`\n> nội dung riêng';
    const view = buildFeedbackV2({ member: { id: order.customer_id }, order, stars: 2, content: opinion });
    const text = flatten(components(view)).filter(c => c.type === 10).map(c => c.content);
    expect(text).toContain(`> ${opinion}`);
    expect(text[0]).toContain('2/5 sao');
    expect(text.find(c => c.includes('Khách hàng chia sẻ'))).not.toContain(opinion);
  });

  it('keeps transcript link and counts intact in both customer and staff views', () => {
    for (const render of [buildTranscriptCustomerV2, buildTranscriptSummaryV2]) {
      const all = flatten(components(render(transcript)));
      expect(all.find(c => c.type === 2).url).toBe(transcript.transcriptUrl);
      expect(all.filter(c => c.type === 10).map(c => c.content).join('\n')).toContain('`72`');
    }
  });

  it('keeps admin metrics, authoritative log detail and source limits intact', () => {
    const view = buildDashboardV2({
      total_orders: 91, pending_payment: 7, processing: 12, completed: 65,
      warranty_open: 7, customers: 41, blacklisted: 3, revenue_paid: 215000,
    }, Array.from({ length: 6 }, (_, i) => ({ product_name: `PRODUCT_${i}`, total_orders: i + 1 })),
    [{ action: 'ORDER_UPDATED', detail: 'Dòng đầu\n\n### Dòng giữ nguyên' }], order.guild_id);
    const text = flatten(components(view)).filter(c => c.type === 10).map(c => c.content).join('\n');
    for (const expected of ['`91`', '`7`', '`12`', '`65`', '`41`', '`3`', '215.000 VND', 'Dòng đầu\n\n### Dòng giữ nguyên']) expect(text).toContain(expected);
    expect(text).toContain('PRODUCT_4');
    expect(text).not.toContain('PRODUCT_5');
  });

  it('keeps blacklist reason literal and retains the requested avatar', () => {
    const reason = 'Nội dung 😊\n\n---\n### Không sửa lý do';
    const view = buildBlacklistV2({ id: order.customer_id, displayAvatarURL: () => 'https://cdn.example.com/avatar.png' }, {
      warning_count: 3, is_blacklisted: 1, is_ticket_muted: 1,
      blacklist_reason: reason, ticket_mute_reason: 'Lý do mute riêng',
    }, order.guild_id);
    const all = flatten(components(view));
    expect(all.find(c => c.type === 11).media.url).toBe('https://cdn.example.com/avatar.png');
    expect(all.filter(c => c.type === 10).some(c => c.content.endsWith(reason))).toBe(true);
    expect(all.filter(c => c.type === 10).map(c => c.content).join('\n')).toContain('Lý do mute riêng');
  });

  it('retains generation time in the guide, blacklist and PayOS command footers', () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-09T01:40:00Z');
    vi.setSystemTime(now);
    try {
      const views = [
        buildAutomationGuideV2(order.guild_id),
        buildBlacklistV2({ id: order.customer_id, displayAvatarURL: () => 'https://cdn.example.com/avatar.png' }, {}, order.guild_id),
        buildPayOSSetupV2([], order.guild_id),
      ];
      for (const view of views) {
        const footer = flatten(components(view)).filter(c => c.type === 10).at(-1).content;
        expect(footer).toContain(`-# <t:${now.getTime() / 1000}:f>`);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
