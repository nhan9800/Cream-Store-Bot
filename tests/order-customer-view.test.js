import { beforeAll, describe, expect, it } from 'vitest';

let encrypt;
let buildCustomerOrderView;
let canRequesterAccessOrder;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'order-customer-view-test-key-that-is-long-enough';
  ({ encrypt } = await import('../src/utils/crypto.js'));
  ({ buildCustomerOrderView, canRequesterAccessOrder } = await import('../src/services/orderCustomerView.js'));
});

function order() {
  return {
    order_code: 'CN_123456',
    customer_id: '123456789012345678',
    created_by_id: 'user_123',
    product_name: 'YouTube Premium',
    quantity: 1,
    total_amount: 260000,
    amount_paid: 260000,
    payment_status: 'PAID',
    status: 'COMPLETED',
    credential_email: encrypt('customer@example.com'),
    credential_password: encrypt('secret-password'),
    credential_profile: encrypt('Profile 1'),
    credential_pin: encrypt('1234'),
    delivery_login_url: 'https://example.com/login',
    claim_notes: 'Bảo hành trong thời hạn gói.',
    created_at: '2026-09-27T00:00:00.000Z',
    internal_secret: 'must-never-leak',
  };
}

describe('customer order view', () => {
  it('recognizes the Discord owner, creating web user and staff', () => {
    const value = order();
    expect(canRequesterAccessOrder(value, { discordId: value.customer_id, role: 'member' })).toBe(true);
    expect(canRequesterAccessOrder(value, { userId: value.created_by_id, role: 'member' })).toBe(true);
    expect(canRequesterAccessOrder(value, { userId: 'staff', role: 'staff' })).toBe(true);
    expect(canRequesterAccessOrder(value, { discordId: '999999999999999999', role: 'member' })).toBe(false);
  });

  it('never includes raw database credentials in a public response', () => {
    const view = buildCustomerOrderView(order());
    expect(view).not.toHaveProperty('credential_password');
    expect(view).not.toHaveProperty('internal_secret');
    expect(view).not.toHaveProperty('delivered_account');
    expect(view).not.toHaveProperty('customer_id');
    expect(view).not.toHaveProperty('created_by_id');
  });

  it('decrypts delivery fields only for an authorized caller', () => {
    const view = buildCustomerOrderView(order(), { includeDelivery: true, includeOwnership: true });
    expect(view.delivered_account).toMatchObject({
      email: 'customer@example.com',
      password: 'secret-password',
      profile: 'Profile 1',
      pin: '1234',
      warranty_code: 'BH-CN_123456',
    });
    expect(view.customer_id).toBe('123456789012345678');
    expect(view.created_by_id).toBe('user_123');
    expect(JSON.stringify(view)).not.toContain('enc:v1:');
  });

  it('does not return encrypted ciphertext when a credential cannot be decrypted', () => {
    const value = order();
    value.credential_password = 'enc:v1:invalid-ciphertext';
    const view = buildCustomerOrderView(value, { includeDelivery: true, includeOwnership: true });
    expect(view.delivered_account.password).toBeNull();
    expect(JSON.stringify(view)).not.toContain('enc:v1:');
  });
});
