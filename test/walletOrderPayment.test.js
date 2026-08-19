import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import {
  createOrder,
  getOrderByCode,
  payOrderWithWallet,
  reconcileWalletPaidOrders,
  WalletPaymentError,
  cancelOrder,
} from '../src/services/orderService.js';
import {
  addWalletBalance,
  getWalletBalance,
  getWalletTransactions,
} from '../src/services/walletService.js';
import { buildWalletView } from '../src/commands/wallet.js';
import { MessageFlags } from 'discord.js';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-wallet-order-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-wallet-order-not-present';
  process.env.DATABASE_PATH = relativePath;
  return relativePath;
});

const suffix = Date.now().toString();
const guildId = `wallet_guild_${suffix}`;
const customerId = `wallet_customer_${suffix}`;
let sequence = 0;

function createPendingOrder(totalAmount) {
  sequence += 1;
  const orderCode = `CN_${String(810000 + sequence)}`;
  const ticket = createTicket({
    guildId,
    channelId: `web-${orderCode.toLowerCase()}`,
    customerId,
    openedById: customerId,
    ticketType: 'ORDER',
    relatedOrderCode: orderCode,
    supportSource: 'WEBSITE_ORDER',
  });
  return createOrder({
    orderCode,
    guildId,
    ticketId: ticket.id,
    ticketChannelId: ticket.channel_id,
    customerId,
    productName: 'Sản phẩm kiểm thử',
    quantity: 1,
    totalAmount,
    durationMonths: 1,
    orderLogChannelId: 'test-order-log',
    createdById: customerId,
  });
}

describe('atomic website wallet payment', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    db.close();
    const absolutePath = path.resolve(process.cwd(), testDatabasePath);
    for (const suffixToRemove of ['', '-shm', '-wal']) {
      fs.rmSync(`${absolutePath}${suffixToRemove}`, { force: true });
    }
  });

  it('commits wallet debit, ledger and paid order together and is idempotent', () => {
    const order = createPendingOrder(140_000);
    addWalletBalance(guildId, customerId, 140_000, 'TOPUP', 'Nạp kiểm thử', 'TOPUP_ATOMIC');

    const first = payOrderWithWallet({
      orderCode: order.order_code,
      guildId,
      customerId,
      amount: 140_000,
    });
    const second = payOrderWithWallet({
      orderCode: order.order_code,
      guildId,
      customerId,
      amount: 140_000,
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(getWalletBalance(guildId, customerId)).toBe(0);
    const updated = getOrderByCode(order.order_code);
    expect(updated).toMatchObject({
      status: 'PROCESSING',
      payment_status: 'PAID',
      payment_provider: 'WALLET',
      amount_paid: 140_000,
    });
    const payments = getWalletTransactions(guildId, customerId, 20)
      .filter((tx) => tx.type === 'PAYMENT' && tx.related_code === order.order_code);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(-140_000);
  });

  it('rolls back without a ledger entry when the balance is insufficient', () => {
    const order = createPendingOrder(200_000);
    addWalletBalance(guildId, customerId, 100_000, 'TOPUP', 'Nạp thiếu', 'TOPUP_SHORT');
    const balanceBefore = getWalletBalance(guildId, customerId);

    expect(() => payOrderWithWallet({
      orderCode: order.order_code,
      guildId,
      customerId,
      amount: 200_000,
    })).toThrowError(WalletPaymentError);

    expect(getWalletBalance(guildId, customerId)).toBe(balanceBefore);
    expect(getOrderByCode(order.order_code)).toMatchObject({
      status: 'PENDING_PAYMENT',
      payment_status: 'UNPAID',
      amount_paid: 0,
    });
    const payments = getWalletTransactions(guildId, customerId, 50)
      .filter((tx) => tx.type === 'PAYMENT' && tx.related_code === order.order_code);
    expect(payments).toHaveLength(0);
  });

  it('repairs a legacy cancelled order only when an exact unmatched debit exists', () => {
    const order = createPendingOrder(115_000);
    addWalletBalance(guildId, customerId, 115_000, 'TOPUP', 'Nạp đối soát', 'TOPUP_RECON');
    addWalletBalance(
      guildId,
      customerId,
      -115_000,
      'PAYMENT',
      `Thanh toán đơn ${order.order_code}`,
      order.order_code,
    );
    cancelOrder(order.order_code, 'Mô phỏng tiến trình cũ bị ngắt');
    const balanceBefore = getWalletBalance(guildId, customerId);

    const result = reconcileWalletPaidOrders();

    expect(result.repaired.some((item) => item.orderCode === order.order_code)).toBe(true);
    expect(getWalletBalance(guildId, customerId)).toBe(balanceBefore);
    expect(getOrderByCode(order.order_code)).toMatchObject({
      status: 'PROCESSING',
      payment_status: 'PAID',
      payment_provider: 'WALLET',
      amount_paid: 115_000,
      payment_cancel_reason: null,
    });
    expect(reconcileWalletPaidOrders().repaired).toHaveLength(0);
  });

  it('renders the wallet view as a private Components V2 card', () => {
    const payload = buildWalletView({
      guildId,
      targetUser: { id: customerId },
      balance: 25_000,
      summary: { totalIn: 140_000, totalOut: 115_000, transactionCount: 2 },
      transactions: [{
        amount: -115_000,
        type: 'PAYMENT',
        description: 'Thanh toán đơn CN_999999',
        related_code: 'CN_999999',
        created_at: new Date().toISOString(),
      }],
    });
    const serialized = JSON.stringify(payload.components[0].toJSON());

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(serialized).toContain('VÍ CENAR');
    expect(serialized).toContain('25.000 VND');
    expect(serialized).toContain('CN_999999');
  });
});
