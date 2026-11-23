import { randomInt } from 'node:crypto';
import { communityDay } from './bookingCommunityService.js';

export const COMMUNITY_GAMES = Object.freeze({
  'xuc-xac': { label: 'Đoán xúc xắc', choices: ['cao', 'thap'] },
  'hai-cua': { label: 'Hai cửa', choices: ['cat', 'bien'] },
  'tung-xu': { label: 'Tung xu', choices: ['sap', 'ngua'] },
  'bai-21': { label: 'Bài 21', choices: ['rut', 'dung'] },
  'cau-ca': { label: 'Câu cá', choices: [] },
  'ba-o': { label: 'Ba ô', choices: [] },
});

function handTotal(cards) {
  let total = cards.reduce((sum, rank) => sum + (rank === 1 ? 11 : Math.min(rank, 10)), 0);
  for (const rank of cards) if (rank === 1 && total > 21) total -= 10;
  return total;
}

export function playCommunityGame(id, choice, draw = randomInt) {
  if (!Object.hasOwn(COMMUNITY_GAMES, id)) throw new RangeError('Unknown community mini-game');
  const game = COMMUNITY_GAMES[id];
  if (game.choices.length && !game.choices.includes(choice)) return { choices: game.choices };

  if (id === 'xuc-xac') {
    const dice = Array.from({ length: 3 }, () => draw(6) + 1);
    const total = dice.reduce((a, b) => a + b, 0);
    const side = total >= 11 ? 'cao' : 'thap';
    return { description: `Xúc xắc **${dice.join(' + ')} = ${total}** · ${side === 'cao' ? 'Cao' : 'Thấp'}`, won: choice === side,
      display: [{ label: 'Ba viên xúc xắc', body: `${dice.map(value => `\` ${value} \``).join('  ')}\nTổng **${total}** · ${side === 'cao' ? 'Cao' : 'Thấp'}` }] };
  }
  if (id === 'hai-cua') {
    const sand = draw(10) + 1;
    const sea = draw(10) + 1;
    return { description: `Cát **${sand}** · Biển **${sea}**${sand === sea ? ' · Hòa' : ''}`, won: choice === (sand > sea ? 'cat' : sea > sand ? 'bien' : null),
      display: [{ label: 'Điểm hai cửa', body: `**Cát** \` ${sand} \`   **Biển** \` ${sea} \`${sand === sea ? '\nHai cửa hòa.' : ''}` }], tied: sand === sea };
  }
  if (id === 'tung-xu') {
    const side = draw(2) ? 'ngua' : 'sap';
    return { description: `Đồng xu rơi **${side === 'ngua' ? 'mặt ngửa' : 'mặt sấp'}**.`, won: choice === side,
      display: [{ label: 'Đồng xu', body: side === 'ngua' ? '**Mặt ngửa**' : '**Mặt sấp**' }] };
  }
  if (id === 'bai-21') {
    const card = () => draw(13) + 1;
    const mine = [card(), card()];
    if (choice === 'rut') mine.push(card());
    const dealer = [card(), card()];
    while (handTotal(dealer) < 17) dealer.push(card());
    const playerTotal = handTotal(mine);
    const dealerTotal = handTotal(dealer);
    const won = playerTotal <= 21 && (dealerTotal > 21 || playerTotal > dealerTotal);
    const ranks = hand => hand.map(rank => `\` ${['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][rank - 1]} \``).join(' ');
    return { description: `Bạn **${playerTotal}** điểm · Bot **${dealerTotal}** điểm${playerTotal === dealerTotal ? ' · Hòa' : ''}`, won,
      display: [{ label: `Bài của bạn · ${playerTotal} điểm`, body: ranks(mine) },
        { label: `Bài của bot · ${dealerTotal} điểm`, body: ranks(dealer) }], tied: playerTotal === dealerTotal && playerTotal <= 21 };
  }
  if (id === 'cau-ca') {
    const catches = ['Cá bống', 'Cá rô', 'Cá chép', 'Rong biển', 'Móc câu trống'];
    const it = draw(catches.length);
    return { description: `Bạn kéo lên **${catches[it]}**.`, won: it < 3,
      display: [{ label: 'Mẻ câu', body: `**${catches[it]}**` }] };
  }
  const symbols = ['Sao', 'Trăng', 'Mây'];
  const stop = Array.from({ length: 3 }, () => draw(symbols.length));
  return { description: `**${stop.map(symbol => symbols[symbol]).join(' · ')}**`, won: stop.every(symbol => symbol === stop[0]),
    display: [{ label: 'Ba ô kết quả', body: stop.map(symbol => `\` ${symbols[symbol]} \``).join('  ') }] };
}

const wordChains = [
  ['bầu trời', ['trời xanh', 'trời cao', 'trời mưa', 'trời nắng', 'trời đất']],
  ['dòng sông', ['sông nước', 'sông dài', 'sông lớn', 'sông sâu', 'sông ngòi']],
  ['bông hoa', ['hoa cúc', 'hoa đào', 'hoa mai', 'hoa sen', 'hoa hồng', 'hoa lan']],
  ['con đường', ['đường phố', 'đường làng', 'đường mòn', 'đường đua', 'đường sắt']],
  ['mặt biển', ['biển xanh', 'biển lớn', 'biển cả', 'biển đông', 'biển khơi']],
];

const wordGuesses = [
  ['cá voi', 'Động vật biển lớn, thở bằng phổi'],
  ['thỏ con', 'Con vật nhỏ có đôi tai dài, thường nhảy bằng hai chân sau'],
  ['hạt mưa', 'Giọt nước nhỏ rơi từ mây xuống'],
  ['ánh sao', 'Ánh sáng lấp lánh của các ngôi sao'],
  ['bút chì', 'Dụng cụ viết có ruột than, có thể dùng tẩy'],
];

function normalizeWords(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function communityWordPuzzle(id, answer, now = Date.now()) {
  const day = Date.parse(communityDay(now)) / 86_400_000;
  if (id === 'noi-tu') {
    const [seed, matches] = wordChains[day % wordChains.length];
    if (!answer) return { prompt: `Cụm hôm nay **${seed}**. Nhập một cụm hai tiếng bắt đầu bằng **${seed.split(' ').at(-1)}**.` };
    const won = matches.map(normalizeWords).includes(normalizeWords(answer));
    return { description: won ? 'Cụm từ hợp lệ.' : `Cụm đó chưa có trong bộ từ hôm nay. Một đáp án hợp lệ là **${matches[0]}**.`, won };
  }
  if (id !== 'doan-tu') throw new RangeError('Unknown community word puzzle');
  const [word, clue] = wordGuesses[day % wordGuesses.length];
  if (!answer) return { prompt: `${clue}. Cụm từ gồm **${normalizeWords(word).length - 1} chữ cái** và hai tiếng.` };
  const won = normalizeWords(word) === normalizeWords(answer);
  return { description: won ? `Chính xác, **${word}**.` : `Đáp án hôm nay là **${word}**.`, won };
}
