export const BOOST_PRODUCT_KEY = 'discord-server-boost-14-3-months';
export const BOOST_PRICE_SETTING = 'boost:3m:price';
export const BOOST_DEFAULT_PRICE = 320000;

export function parseBoostPrice(value) {
  // Require an explicit VND amount; shorthand such as 320k is ambiguous.
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d{3,7}$/.test(text)) throw new Error('Nhập số tiền VND từ 1.000 đến 99.999.999, không dùng dấu chấm hoặc chữ k.');
  return Number(text);
}
