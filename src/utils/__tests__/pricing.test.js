import { describe, it, expect } from 'vitest';
import { calculateClaudePrice } from '../pricing.js';

describe('calculateClaudePrice', () => {
  it('input = 1 should return 85000', () => {
    expect(calculateClaudePrice(1)).toBe(85000);
  });

  it('input = 2 should return 170000', () => {
    expect(calculateClaudePrice(2)).toBe(170000);
  });

  it('input = 3 should return 255000', () => {
    expect(calculateClaudePrice(3)).toBe(255000);
  });

  it('input = 7 should return 595000', () => {
    expect(calculateClaudePrice(7)).toBe(595000);
  });

  it('input = 100 (auto scale) should return 85000', () => {
    expect(calculateClaudePrice(100)).toBe(85000);
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
