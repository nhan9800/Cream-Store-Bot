/**
 * Calculates the price for Claude API packages.
 * 1 gói Claude API 100M (30 ngày) = 85,000 VND.
 * Nếu người dùng nhập "100", "200"... do nghĩ là 100M, 200M -> tự động quy đổi về 1 gói, 2 gói.
 *
 * @param {number} input - Số lượng gói hoặc số "M" nhập vào.
 * @returns {number} The calculated price in VND.
 */
export function calculateClaudePrice(input) {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) {
    throw new Error('Số lượng phải là số nguyên lớn hơn hoặc bằng 1.');
  }

  const basePrice = 85000;

  // Nếu nhập 100, 200, 300, 500 do nghĩ là số M -> quy về gói
  if (input === 100) return basePrice;
  if (input === 200) return basePrice * 2;
  if (input === 300) return basePrice * 3;
  if (input === 500) return basePrice * 5;

  return basePrice * input;
}

