import { describe, it, expect } from 'vitest';
import {
  ORDER_STATUSES,
  VALID_TRANSITIONS,
  normalizeStatus,
  canTransition,
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
