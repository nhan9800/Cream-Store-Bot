import { describe, it, expect } from 'vitest';
import { calculateClaudePrice } from '../pricing.js';

describe('calculateClaudePrice', () => {
  it('days = 1 should return 85000', () => {
    expect(calculateClaudePrice(1)).toBe(85000);
  });

  it('days = 2 should return 90000', () => {
    expect(calculateClaudePrice(2)).toBe(90000);
  });

  it('days = 3 should return 95000', () => {
    expect(calculateClaudePrice(3)).toBe(95000);
  });

  it('days = 7 should return 115000', () => {
    expect(calculateClaudePrice(7)).toBe(115000);
  });

  it('days = 30 should return 230000', () => {
    expect(calculateClaudePrice(30)).toBe(230000);
  });

  it('days = 0 should throw error', () => {
    expect(() => calculateClaudePrice(0)).toThrow();
  });

  it('days = số âm (-5) should throw error', () => {
    expect(() => calculateClaudePrice(-5)).toThrow();
  });

  it('days = số thập phân (1.5) should throw error', () => {
    expect(() => calculateClaudePrice(1.5)).toThrow();
  });

  it('days = chuỗi chữ ("5") should throw error', () => {
    expect(() => calculateClaudePrice("5")).toThrow();
  });
});
