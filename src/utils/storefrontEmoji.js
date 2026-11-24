// Store 1 application emoji from the licensed Emoji.gg pack. Source metadata
// and original downloads are tracked in assets/emojis/ui27/manifest.json.
const ids = {
  art: '1569038556872315001',
  book: '1569038359920123985',
  calendar: '1569038428169834548',
  cart: '1569038452622758012',
  chart: '1569038496922992712',
  details: '1569038418095251658',
  document: '1569038493324279918',
  fire: '1569038380531191891',
  lock: '1569038367096578240',
  pause: '1569038400529502280',
  payos: '1569038431361966203',
  price: '1569038469693706383',
  product: '1569038420054122526',
  reference: '1569038368661311569',
  search: '1569038435073921055',
  store: '1569038491650625758',
  support: '1569038356392710354',
  target: '1569038551411195975',
  ticket: '1569038441356857385',
  ticket_open: '1569038443495817226',
  verified: '1569038449095348348',
};

export function storefrontComponentEmoji(key) {
  return { id: ids[key], name: `cenar_ui27_${key}` };
}

export function storefrontEmoji(key) {
  const { id, name } = storefrontComponentEmoji(key);
  return `<:${name}:${id}>`;
}
