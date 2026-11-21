import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  ORDER_STATUSES,
  VALID_TRANSITIONS,
  normalizeStatus,
  canTransition,
  getOrderTimeline,
  transitionOrderStatus,
} from '../src/services/orderStateMachine.js';

describe('Order State Machine', () => {
  describe('normalizeStatus', () => {
    it('normalizes legacy lowercase status names to official enum strings', () => {
      expect(normalizeStatus('pending')).toBe(ORDER_STATUSES.PENDING_PAYMENT);
      expect(normalizeStatus('paid')).toBe(ORDER_STATUSES.PAID);
      expect(normalizeStatus('completed')).toBe(ORDER_STATUSES.COMPLETED);
      expect(normalizeStatus('cancelled')).toBe(ORDER_STATUSES.CANCELLED);
    });

    it('returns PENDING_PAYMENT if undefined or null', () => {
      expect(normalizeStatus(null)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
      expect(normalizeStatus(undefined)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
    });
  });

  describe('canTransition', () => {
    it('allows valid transition from PENDING_PAYMENT to PAID, CANCELLED, or FAILED', () => {
      expect(canTransition(ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID)).toBe(true);
      expect(canTransition(ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.CANCELLED)).toBe(true);
      expect(canTransition(ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.FAILED)).toBe(true);
    });

    it('allows valid lifecycle from PAID -> PROCESSING -> DELIVERING -> COMPLETED', () => {
      expect(canTransition(ORDER_STATUSES.PAID, ORDER_STATUSES.PROCESSING)).toBe(true);
      expect(canTransition(ORDER_STATUSES.PROCESSING, ORDER_STATUSES.DELIVERING)).toBe(true);
      expect(canTransition(ORDER_STATUSES.DELIVERING, ORDER_STATUSES.COMPLETED)).toBe(true);
    });

    it('prevents illegal backward transitions like COMPLETED -> PENDING_PAYMENT', () => {
      expect(canTransition(ORDER_STATUSES.COMPLETED, ORDER_STATUSES.PENDING_PAYMENT)).toBe(false);
      expect(canTransition(ORDER_STATUSES.COMPLETED, ORDER_STATUSES.PROCESSING)).toBe(false);
    });

    it('prevents transition from CANCELLED to PAID or PROCESSING', () => {
      expect(canTransition(ORDER_STATUSES.CANCELLED, ORDER_STATUSES.PAID)).toBe(false);
      expect(canTransition(ORDER_STATUSES.CANCELLED, ORDER_STATUSES.PROCESSING)).toBe(false);
    });

    it('allows idempotent same-status transitions (e.g. PAID -> PAID)', () => {
      expect(canTransition(ORDER_STATUSES.PAID, ORDER_STATUSES.PAID)).toBe(true);
      expect(canTransition(ORDER_STATUSES.COMPLETED, ORDER_STATUSES.COMPLETED)).toBe(true);
    });
  });
});

describe('admin completion metadata on actual status transitions', () => {
  let database;
  const stamp = '2026-11-15T08:30:00.000Z';
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(stamp));
    database = new Database(':memory:');
    database.exec(`CREATE TABLE orders (
      order_code TEXT PRIMARY KEY,status TEXT,payment_status TEXT,total_amount INTEGER,amount_paid INTEGER,
      completed_at TEXT,completed_by_id TEXT,status_changed_at TEXT,updated_at TEXT,
      delivered_at TEXT,expiry_at TEXT,feedback_requested_at TEXT,feedback_due_at TEXT
    );
    INSERT INTO orders(order_code,status,payment_status,total_amount,amount_paid,updated_at)
      VALUES('CN_123456','PROCESSING','PAID',88000,88000,'2026-11-01T00:00:00.000Z')`);
  });
  afterEach(() => { database.close(); vi.useRealTimers(); });
  const complete = () => transitionOrderStatus('CN_123456', 'COMPLETED', {
    dbInstance: database, changedBy: 'synthetic-admin', reason: 'Admin dashboard manual update',
  });
  it('stamps canonical completion metadata without changing payment, delivery, feedback or expiry', () => {
    const result = complete();
    expect(result).toMatchObject({ success: true, changed: true, order: {
      status: 'COMPLETED', completed_at: stamp, completed_by_id: 'synthetic-admin',
      status_changed_at: stamp, updated_at: stamp, payment_status: 'PAID', total_amount: 88000, amount_paid: 88000,
      delivered_at: null, expiry_at: null, feedback_requested_at: null, feedback_due_at: null,
    } });
    expect(getOrderTimeline(database, 'CN_123456')).toMatchObject([{
      old_status: 'PROCESSING', new_status: 'COMPLETED', actor: 'synthetic-admin', reason: 'Admin dashboard manual update',
    }]);
  });
  it('preserves first completion evidence when completing warranty work', () => {
    database.prepare("UPDATE orders SET status='WARRANTY_OPEN',completed_at=?,completed_by_id=?").run('2026-10-01T08:00:00.000Z', 'original-staff');
    expect(complete()).toMatchObject({ success: true, changed: true, order: {
      completed_at: '2026-10-01T08:00:00.000Z', completed_by_id: 'original-staff', status_changed_at: stamp,
    } });
  });
  it('does not reconstruct missing historical completion evidence on a same-status replay', () => {
    database.prepare("UPDATE orders SET status='COMPLETED'").run();
    expect(complete()).toMatchObject({ success: true, changed: false, order: { completed_at: null, completed_by_id: null } });
    expect(getOrderTimeline(database, 'CN_123456')).toHaveLength(0);
  });
  it('does not reset timestamps or add duplicate history on repeated completion', () => {
    complete();
    vi.setSystemTime(new Date('2026-11-15T09:30:00.000Z'));
    expect(complete()).toMatchObject({ success: true, changed: false, order: { completed_at: stamp, status_changed_at: stamp } });
    expect(getOrderTimeline(database, 'CN_123456')).toHaveLength(1);
  });
  it('does not stamp completion fields for other state transitions or rejected terminal transitions', () => {
    expect(transitionOrderStatus('CN_123456', 'WAITING_STAFF', { dbInstance: database })).toMatchObject({
      success: true, order: { completed_at: null, completed_by_id: null },
    });
    database.prepare("UPDATE orders SET status='CANCELLED'").run();
    expect(complete().success).toBe(false);
    expect(database.prepare('SELECT completed_at,completed_by_id FROM orders').get()).toEqual({ completed_at: null, completed_by_id: null });
  });
  it('rejects an admin cancellation on any otherwise cancellable state with recorded payment', () => {
    database.prepare("UPDATE orders SET status='WAITING_STAFF'").run();
    const result = transitionOrderStatus('CN_123456', 'CANCELLED', { dbInstance: database });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('đã nhận tiền') });
    expect(database.prepare('SELECT status,payment_status FROM orders').get())
      .toEqual({ status: 'WAITING_STAFF', payment_status: 'PAID' });
    expect(getOrderTimeline(database, 'CN_123456')).toHaveLength(0);
  });
});
