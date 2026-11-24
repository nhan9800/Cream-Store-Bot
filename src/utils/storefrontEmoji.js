// Store 1 application emoji from the licensed Emoji.gg pack. Source metadata
// and original downloads are tracked in assets/emojis/ui27/manifest.json.
const ids = {
  add: '1569038398671556700',
  approve: '1569038370209013961',
  bank: '1569038458322944065',
  cancel: '1569038402169606235',
  celebrate: '1569038354635296818',
  checkout: '1569038429948350778',
  claim: '1569038471438405743',
  clipboard: '1569038466086477956',
  created: '1569038379071307816',
  crown: '1569038479742996702',
  diamond: '1569038503029772338',
  disconnect: '1569038485854359620',
  edit: '1569038545438638172',
  expiry: '1569038445475795046',
  feedback: '1569038363216847069',
  folder: '1569038537175867403',
  gift: '1569038358049587243',
  gold: '1569038527226843167',
  group: '1569038474412036137',
  heart: '1569038504833449986',
  home: '1569038549196480542',
  link: '1569038495438340328',
  location: '1569038414114988041',
  mic: '1569038365184233704',
  money: '1569038433320444136',
  music: '1569038518242508930',
  next: '1569038403909976184',
  number: '1569038558440853725',
  play: '1569038508700467301',
  position: '1569038484725960754',
  queue: '1569038439972605962',
  receipt: '1569038423283605724',
  received: '1569038483010486302',
  reminder: '1569038387795468328',
  scan: '1569038489952059534',
  sparkles: '1569038541969686722',
  tip: '1569038543635095613',
  tracking: '1569038375556481034',
  transaction: '1569038555345588254',
  trophy: '1569038523489591557',
  up: '1569038410675396779',
  wallet: '1569038454325514370',
};

export function storefrontComponentEmoji(key) {
  return { id: ids[key], name: `cenar_ui27_${key}`, animated: key === 'gold' || key === 'sparkles' };
}

export function storefrontEmoji(key) {
  const { id, name, animated } = storefrontComponentEmoji(key);
  return `<${animated ? 'a' : ''}:${name}:${id}>`;
}
