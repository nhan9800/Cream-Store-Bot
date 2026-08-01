const NITRO_SHOP_PRICES = new Map([
  [66_000, 25_000],
  [79_000, 35_000],
  [92_000, 50_000],
  [105_000, 60_000],
  [111_000, 65_000],
  [118_000, 75_000],
  [131_000, 85_000],
  [141_000, 95_000],
  [146_000, 105_000],
  [189_000, 125_000],
]);

const STANDARD_SHOP_PRICES = new Map([
  [79_000, 35_000],
  [105_000, 65_000],
  [131_000, 85_000],
  [141_000, 95_000],
  [146_000, 115_000],
  [189_000, 135_000],
]);

export function getDiscordCollectibleShopPrice(originalPrice, nitroEligible) {
  const price = Number(originalPrice);
  if (!Number.isSafeInteger(price)) return null;
  return (nitroEligible ? NITRO_SHOP_PRICES : STANDARD_SHOP_PRICES).get(price) ?? null;
}

export function discordCollectibleUrl(skuId) {
  return `https://discord.com/shop#itemSkuId=${encodeURIComponent(String(skuId))}`;
}
