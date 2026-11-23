export const WORD_GRID_SIZE = 5;
export const WORD_GRID_ATTEMPTS = 6;

const words = {
  vi: ['áo dài', 'cá ngừ', 'mưa đá', 'mặt hồ', 'gió lạ', 'hoa lá', 'bồ câu', 'bàn cờ', 'bản đồ', 'đồi cỏ',
    'hồ sen', 'đèn đá', 'đất đá', 'đỏ son', 'hạt dẻ', 'quả bơ', 'gà tre', 'vỉa hè', 'mồ hôi', 'bút bi', 'máy in',
    'sọt đồ', 'đá quý', 'hoa đỏ', 'đậu đỏ', 'gà đen', 'sữa bò', 'lá nâu', 'tờ báo', 'cỏ lau'],
  en: ['ocean', 'tiger', 'cloud', 'peach', 'olive', 'river', 'grape', 'bloom', 'flame', 'stone', 'light',
    'lemon', 'crown', 'plant', 'music', 'bread', 'amber', 'pearl', 'sheep', 'apple', 'dance', 'dream', 'train',
    'house', 'piano', 'horse', 'trail', 'bunny', 'plane', 'beach', 'quilt'],
};

export function isWordGridLanguage(language) {
  return Object.hasOwn(words, language);
}

export function wordGridSolution(language, day) {
  const pool = words[language];
  const dayNumber = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
  return pool[dayNumber % pool.length];
}

export function normalizeWordGridGuess(value, language) {
  if (typeof value !== 'string') return null;
  const input = value.trim().toLowerCase();
  if (language === 'en') return /^[a-z]{5}$/u.test(input) ? input : null;
  if (!/^[\p{Script=Latin}\p{M}\s]+$/u.test(input)) return null;
  const letters = input.normalize('NFD').replace(/[\p{M}\s]/gu, '').replace(/đ/gu, 'd');
  return /^[a-z]{5}$/u.test(letters) ? letters : null;
}

export function scoreWordGridGuess(solution, guess) {
  const remaining = new Map();
  const marks = [...solution].map((letter, index) => {
    if (letter === guess[index]) return 'exact';
    remaining.set(letter, (remaining.get(letter) ?? 0) + 1);
    return 'absent';
  });
  for (const [index, letter] of [...guess].entries()) {
    const count = remaining.get(letter) ?? 0;
    if (marks[index] === 'exact' || count === 0) continue;
    marks[index] = 'present';
    remaining.set(letter, count - 1);
  }
  return marks;
}
