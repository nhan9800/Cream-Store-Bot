/**
 * Calculates the price for Claude API based on the number of days.
 * 
 * Formula: 85,000 VND for the first day + 5,000 VND for each additional day.
 * 
 * @param {number} days - The number of days requested.
 * @returns {number} The calculated price in VND.
 * @throws {Error} If days is less than 1 or not an integer.
 */
export function calculateClaudePrice(days) {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
    throw new Error('Số ngày phải là số nguyên lớn hơn hoặc bằng 1.');
  }
  
  const basePrice = 85000;
  const additionalDayPrice = 5000;
  
  if (days === 1) {
    return basePrice;
  }
  
  return basePrice + ((days - 1) * additionalDayPrice);
}
