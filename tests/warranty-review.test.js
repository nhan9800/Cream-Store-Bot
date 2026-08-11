import { describe, expect, test } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  buildWarrantyApprovedCustomerV2,
  buildWarrantyReviewedStateV2,
  buildWarrantyTicketOpenedV2,
} from '../src/services/warrantyService.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
const order = {
  order_code: 'CN_266378',
  customer_id: '123456789012345678',
  product_name: 'Spotify Premium 12 Tháng',
};
const ticket = {
  id: 42,
  ticket_code: 'TKT_266378',
  customer_id: order.customer_id,
  related_order_code: order.order_code,
};

describe('Warranty review controls', () => {
  test('places approve and reject controls directly under a new warranty case', () => {
    const payload = buildWarrantyTicketOpenedV2({
      order,
      ticket,
      channel: '<#999999999999999999>',
      formData: null,
      guildId: STORE_ONE_GUILD_ID,
    });
    const json = payload.components.map((component) => component.toJSON());
    const buttons = json[1].components;

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(buttons.map((button) => button.custom_id)).toEqual(['ytb:approve:42', 'ytb:reject:42']);
    expect(buttons.every((button) => button.emoji?.id)).toBe(true);
  });

  test('builds a custom-emoji-only customer success notification with generic next steps', () => {
    const payload = buildWarrantyApprovedCustomerV2({
      order,
      ticket,
      reviewerId: '222222222222222222',
      guildId: STORE_ONE_GUILD_ID,
    });
    const json = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(json).toContain('BẢO HÀNH THÀNH CÔNG');
    expect(json).toContain('CN_266378');
    expect(json).toContain('Hộp thư đến, Spam và Quảng cáo');
    expect(json).not.toMatch(NATIVE_EMOJI);
  });

  test('replaces the clicked panel with one disabled approved state', () => {
    const payload = buildWarrantyReviewedStateV2({
      order,
      ticket,
      reviewerId: '222222222222222222',
      guildId: STORE_ONE_GUILD_ID,
      state: 'approved',
    });
    const button = payload.components[1].toJSON().components[0];

    expect(button.disabled).toBe(true);
    expect(button.label).toBe('Đã Duyệt Bảo Hành');
  });
});
