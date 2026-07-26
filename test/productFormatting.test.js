import { describe, it, expect } from 'vitest';
import {
  getDurText,
  formatPriceVND,
  generateProductSlug,
} from '../src/utils/productFormatting.js';

describe('Product Formatting Utilities', () => {
  describe('getDurText', () => {
    it('returns "Thương lượng" when price is 0', () => {
      expect(getDurText({ price: 0, duration_months: 1 })).toBe('Thương lượng');
      expect(getDurText({ price: 0, duration_months: 12 })).toBe('Thương lượng');
    });

    it('returns "Vĩnh viễn" when duration_months is null, undefined, or 0 (and price != 0)', () => {
      expect(getDurText({ price: 100000, duration_months: null })).toBe('Vĩnh viễn');
      expect(getDurText({ price: 100000, duration_months: undefined })).toBe('Vĩnh viễn');
      expect(getDurText({ price: 100000, duration_months: 0 })).toBe('Vĩnh viễn');
    });

    it('returns formatted label from options match or default `${n} tháng`', () => {
      const options = [
        { duration: 1, label: '1 Tháng' },
        { duration: 12, label: '1 Năm' },
      ];
      expect(getDurText({ price: 50000, duration_months: 1 }, options)).toBe('1 Tháng');
      expect(getDurText({ price: 50000, duration_months: 12 }, options)).toBe('1 Năm');
      expect(getDurText({ price: 50000, duration_months: 6 }, options)).toBe('6 tháng');
    });
  });

  describe('formatPriceVND', () => {
    it('returns "Thương lượng" for 0, null, undefined, or NaN', () => {
      expect(formatPriceVND(0)).toBe('Thương lượng');
      expect(formatPriceVND(null)).toBe('Thương lượng');
      expect(formatPriceVND(undefined)).toBe('Thương lượng');
      expect(formatPriceVND('abc')).toBe('Thương lượng');
    });

    it('formats positive numbers in VND format', () => {
      // vi-VN toLocaleString uses dots or spaces depending on runtime, check ends with " đ" and contains digits
      const formatted = formatPriceVND(150000);
      expect(formatted).toContain('150');
      expect(formatted).toMatch(/150.*000\s*đ/);
    });
  });

  describe('generateProductSlug', () => {
    it('generates clean URL-friendly slugs from Vietnamese text', () => {
      expect(generateProductSlug('Tài khoản Netflix 1 Tháng - Màn Riêng'))
        .toBe('tai-khoan-netflix-1-thang-man-rieng');
      expect(generateProductSlug('Bot Custom Discord [Gói VIP]'))
        .toBe('bot-custom-discord-goi-vip');
    });

    it('falls back to sku or default string if name is empty', () => {
      expect(generateProductSlug('', 'SKU-001')).toBe('sku-001');
      expect(generateProductSlug('')).toBe('unnamed-product');
    });
  });
});
