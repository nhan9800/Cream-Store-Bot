import {
  isWordGridLanguage, normalizeWordGridGuess, scoreWordGridGuess, WORD_GRID_ATTEMPTS, wordGridSolution,
} from './bookingWordGrid.js';

export const COMMUNITY_VOICE_INTERVAL_MS = 60_000;
export const MAX_CONNECTIONS = 10;

const DAY_MS = 86_400_000;
const DAILY_GAME_REWARDS = 6;
const VN_TIME_OFFSET_MS = 7 * 3_600_000;
const CHECK_IN_BASE = 10;
const SOCIAL_COOLDOWN_MS = 60_000;
const REQUEST_LIFETIME_MS = DAY_MS;

export const COMMUNITY_SHOP = Object.freeze({
  nhan: { label: 'Nhẫn kỷ niệm', cost: 50 },
  'thuc-an': { label: 'Thức ăn cho thú cưng', cost: 5 },
  'huy-hieu': { label: 'Huy hiệu Cenar', cost: 35 },
});

export function communityDay(now) {
  return new Date(now + VN_TIME_OFFSET_MS).toISOString().slice(0, 10);
}

function dailyProgress(row) {
  return [
    { label: 'Điểm danh', count: Number(row.checked_in === row.day), goal: 1 },
    { label: 'Trò chuyện', count: row.messages, goal: 3 },
    { label: 'Sinh hoạt voice (phút)', count: row.voice_minutes, goal: 5 },
    { label: 'Chơi trò chơi', count: row.games, goal: 1 },
  ];
}

function validUser(id) {
  if (typeof id !== 'string' || !/^\d{17,20}$/u.test(id)) throw new TypeError('Invalid Discord member ID');
  return id;
}

export function createBookingCommunityService(database, { clock = Date.now } = {}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS booking_community_profiles (
      user_id TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      day TEXT NOT NULL,
      messages INTEGER NOT NULL DEFAULT 0,
      voice_minutes INTEGER NOT NULL DEFAULT 0,
      games INTEGER NOT NULL DEFAULT 0,
      daily_claimed INTEGER NOT NULL DEFAULT 0,
      last_game_at INTEGER NOT NULL DEFAULT 0,
      last_word_chain_day TEXT,
      last_word_guess_day TEXT,
      last_message_at INTEGER NOT NULL DEFAULT 0,
      last_voice_at INTEGER NOT NULL DEFAULT 0,
      last_social_at INTEGER NOT NULL DEFAULT 0,
      checked_in TEXT,
      opened_box TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      connections_enabled INTEGER NOT NULL DEFAULT 0,
      inventory TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS booking_community_rank ON booking_community_profiles(xp DESC, user_id);
    CREATE TABLE IF NOT EXISTS booking_community_word_grids (
      user_id TEXT NOT NULL REFERENCES booking_community_profiles(user_id),
      language TEXT NOT NULL CHECK (language IN ('vi', 'en')),
      day TEXT NOT NULL,
      solution TEXT NOT NULL,
      guesses TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, language)
    );
    CREATE TABLE IF NOT EXISTS booking_community_pairs (
      first_user_id TEXT NOT NULL REFERENCES booking_community_profiles(user_id),
      second_user_id TEXT NOT NULL REFERENCES booking_community_profiles(user_id),
      requested_by TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'linked', 'proposal', 'married')),
      expires_at INTEGER NOT NULL DEFAULT 0,
      affinity INTEGER NOT NULL DEFAULT 0,
      pet INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (first_user_id, second_user_id),
      CHECK (first_user_id < second_user_id)
    );
    CREATE INDEX IF NOT EXISTS booking_community_pair_peer ON booking_community_pairs(second_user_id);
  `);

  const statements = {
    user: database.prepare('SELECT * FROM booking_community_profiles WHERE user_id = ?'),
    create: database.prepare('INSERT OR IGNORE INTO booking_community_profiles (user_id, day) VALUES (?, ?)'),
    newDay: database.prepare(`UPDATE booking_community_profiles
      SET day = ?, messages = 0, voice_minutes = 0, games = 0, daily_claimed = 0 WHERE user_id = ?`),
    message: database.prepare(`UPDATE booking_community_profiles
      SET xp = xp + ?, messages = messages + 1, last_message_at = ? WHERE user_id = ?`),
    voice: database.prepare(`UPDATE booking_community_profiles
      SET xp = xp + 5, voice_minutes = voice_minutes + 1, last_voice_at = ? WHERE user_id = ?`),
    play: database.prepare(`UPDATE booking_community_profiles
      SET points = points + ?, games = min(games + 1, ?), last_game_at = ? WHERE user_id = ?`),
    'noi-tu': database.prepare('UPDATE booking_community_profiles SET last_word_chain_day = ? WHERE user_id = ?'),
    'doan-tu': database.prepare('UPDATE booking_community_profiles SET last_word_guess_day = ? WHERE user_id = ?'),
    wordGrid: database.prepare(`SELECT * FROM booking_community_word_grids
      WHERE user_id = ? AND language = ? AND day = ?`),
    saveWordGrid: database.prepare(`INSERT INTO booking_community_word_grids
      (user_id, language, day, solution, guesses, points) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, language) DO UPDATE
      SET day = excluded.day, solution = excluded.solution, guesses = excluded.guesses, points = excluded.points`),
    checkIn: database.prepare(`UPDATE booking_community_profiles
      SET points = points + ?, checked_in = ?, streak = ? WHERE user_id = ?`),
    claim: database.prepare(`UPDATE booking_community_profiles SET points = points + 25, daily_claimed = 1 WHERE user_id = ?`),
    rank: database.prepare(`SELECT user_id, xp FROM booking_community_profiles WHERE xp > 0 ORDER BY xp DESC, user_id LIMIT 10`),
    buy: database.prepare('UPDATE booking_community_profiles SET points = points - ?, inventory = ? WHERE user_id = ?'),
    inventory: database.prepare('UPDATE booking_community_profiles SET inventory = ? WHERE user_id = ?'),
    box: database.prepare('UPDATE booking_community_profiles SET opened_box = ?, inventory = ? WHERE user_id = ?'),
    enabled: database.prepare('UPDATE booking_community_profiles SET connections_enabled = ? WHERE user_id = ?'),
    social: database.prepare('UPDATE booking_community_profiles SET last_social_at = ? WHERE user_id = ?'),
    pair: database.prepare('SELECT * FROM booking_community_pairs WHERE first_user_id = ? AND second_user_id = ?'),
    pairs: database.prepare('SELECT * FROM booking_community_pairs WHERE first_user_id = ? OR second_user_id = ?'),
    expired: database.prepare(`DELETE FROM booking_community_pairs
      WHERE state = 'pending' AND expires_at <= ? AND (first_user_id = ? OR second_user_id = ?)`),
    request: database.prepare(`INSERT INTO booking_community_pairs
      (first_user_id, second_user_id, requested_by, state, expires_at) VALUES (?, ?, ?, 'pending', ?)`),
    pairState: database.prepare(`UPDATE booking_community_pairs
      SET state = ?, requested_by = ?, expires_at = ? WHERE first_user_id = ? AND second_user_id = ?`),
    deletePair: database.prepare('DELETE FROM booking_community_pairs WHERE first_user_id = ? AND second_user_id = ?'),
    deleteAllPairs: database.prepare('DELETE FROM booking_community_pairs WHERE first_user_id = ? OR second_user_id = ?'),
    affinity: database.prepare('UPDATE booking_community_pairs SET affinity = affinity + 1 WHERE first_user_id = ? AND second_user_id = ?'),
    feed: database.prepare('UPDATE booking_community_pairs SET pet = pet + 1 WHERE first_user_id = ? AND second_user_id = ?'),
  };

  function getDailyUser(id, now) {
    validUser(id);
    const day = communityDay(now);
    statements.create.run(id, day);
    let user = statements.user.get(id);
    if (user.day < day) {
      statements.newDay.run(day, id);
      user = statements.user.get(id);
    }
    return user;
  }

  function forUser(change) {
    const transaction = database.transaction((id, ...args) => {
      const now = clock();
      return change(getDailyUser(id, now), now, ...args);
    });
    return (...args) => transaction.immediate(...args);
  }

  function recordGame(user, now, won) {
    const points = user.games < DAILY_GAME_REWARDS ? (won ? 4 : 1) : 0;
    statements.play.run(points, DAILY_GAME_REWARDS, now, user.user_id);
    return points;
  }

  function getPairs(id) {
    return statements.pairs.all(id, id);
  }

  function isCurrent(pair, now) {
    return pair.state !== 'pending' || pair.expires_at > now;
  }

  function hasConnectionSpace(id, now) {
    statements.expired.run(now, id, id);
    return getPairs(id).length < MAX_CONNECTIONS;
  }

  function isMarried(id) {
    return getPairs(id).some(pair => pair.state === 'married');
  }

  function forPair(change) {
    return forUser((user, now, otherId) => {
      if (user.user_id === otherId) return { status: 'self' };
      const other = statements.user.get(validUser(otherId));
      if (!user.connections_enabled || !other?.connections_enabled) return { status: 'opt-in' };
      const ids = [user.user_id, otherId].sort();
      let pair = statements.pair.get(...ids);
      if (pair?.state === 'pending' && pair.expires_at <= now) {
        statements.deletePair.run(...ids);
        pair = null;
      } else if (pair?.state === 'proposal' && pair.expires_at <= now) {
        statements.pairState.run('linked', pair.requested_by, 0, ...ids);
        pair = statements.pair.get(...ids);
      }
      return change({ user, other, now, ids, pair });
    });
  }

  return {
    profile: forUser(user => ({
      xp: user.xp,
      level: Math.floor(Math.sqrt(user.xp / 100)) + 1,
      points: user.points,
      streak: user.streak,
      connected: Boolean(user.connections_enabled),
      inventory: JSON.parse(user.inventory),
      dailyClaimed: Boolean(user.daily_claimed),
      daily: dailyProgress(user),
    })),
    message: forUser((user, now) => {
      if (now - user.last_message_at < 60_000) return false;
      statements.message.run(15, now, user.user_id);
      return true;
    }),
    voiceMinute: forUser((user, now) => {
      if (now - user.last_voice_at < COMMUNITY_VOICE_INTERVAL_MS) return false;
      statements.voice.run(now, user.user_id);
      return true;
    }),
    play: forUser((user, now, resultFactory, word = null) => {
      if (now - user.last_game_at < 10_000) return { status: 'cooldown' };
      if ((word === 'noi-tu' && user.last_word_chain_day === user.day)
        || (word === 'doan-tu' && user.last_word_guess_day === user.day)) return { status: 'already-played' };
      const result = resultFactory(now);
      const points = recordGame(user, now, result.won);
      if (word === 'noi-tu' || word === 'doan-tu') statements[word].run(user.day, user.user_id);
      return { ...result, points, status: 'played' };
    }),
    wordGrid: forUser((user, now, language, { answer, day: submittedDay, turn } = {}) => {
      if (!isWordGridLanguage(language)) throw new RangeError('Unknown word grid language');
      const day = communityDay(now);
      const stored = statements.wordGrid.get(user.user_id, language, day);
      const solution = stored?.solution ?? wordGridSolution(language, day);
      const secret = normalizeWordGridGuess(solution, language);
      const guesses = stored ? JSON.parse(stored.guesses) : [];
      const respond = (notice, points = stored?.points ?? 0) => {
        const won = guesses.at(-1) === secret;
        const done = won || guesses.length >= WORD_GRID_ATTEMPTS;
        return {
          language, day, now, notice, won, done,
          rows: guesses.map(guess => ({ guess, marks: scoreWordGridGuess(secret, guess) })),
          ...(done ? { answer: solution, points } : {}),
        };
      };
      if (submittedDay !== undefined && (submittedDay !== day || turn !== guesses.length)) return respond('stale');
      if (answer === undefined || guesses.length >= WORD_GRID_ATTEMPTS || guesses.at(-1) === secret) return respond();
      const guess = normalizeWordGridGuess(answer, language);
      if (!guess) return respond('invalid');
      if (guesses.includes(guess)) return respond('duplicate');
      guesses.push(guess);
      const won = guess === secret;
      const done = won || guesses.length === WORD_GRID_ATTEMPTS;
      const points = done ? recordGame(user, now, won) : 0;
      statements.saveWordGrid.run(user.user_id, language, day, solution, JSON.stringify(guesses), points);
      return respond(undefined, points);
    }),
    rank: () => statements.rank.all(),
    checkIn: forUser((user, now) => {
      if (user.checked_in === user.day) return { status: 'claimed', streak: user.streak };
      const streak = user.checked_in === communityDay(now - DAY_MS) ? user.streak + 1 : 1;
      const points = CHECK_IN_BASE + Math.min(streak - 1, 7);
      statements.checkIn.run(points, user.day, streak, user.user_id);
      return { status: 'checked-in', streak, points };
    }),
    claimDaily: forUser(user => {
      if (user.daily_claimed) return { status: 'claimed' };
      if (!dailyProgress(user).every(task => task.count >= task.goal)) return { status: 'incomplete' };
      statements.claim.run(user.user_id);
      return { status: 'awarded', points: 25 };
    }),
    buy: forUser((user, now, item) => {
      if (!Object.hasOwn(COMMUNITY_SHOP, item)) return { status: 'invalid-item' };
      const product = COMMUNITY_SHOP[item];
      if (user.points < product.cost) return { status: 'insufficient', points: user.points };
      const stock = JSON.parse(user.inventory);
      if (item === 'huy-hieu' && stock[item]) return { status: 'already-owned' };
      stock[item] = (stock[item] ?? 0) + 1;
      statements.buy.run(product.cost, JSON.stringify(stock), user.user_id);
      return { status: 'bought', points: user.points - product.cost, label: product.label };
    }),
    openBox: forUser(user => {
      if (user.opened_box === user.day) return { status: 'claimed' };
      const stock = JSON.parse(user.inventory);
      stock['thuc-an'] = (stock['thuc-an'] ?? 0) + 1;
      statements.box.run(user.day, JSON.stringify(stock), user.user_id);
      return { status: 'opened' };
    }),
    setConnections: forUser((user, now, enabled) => {
      statements.enabled.run(Number(Boolean(enabled)), user.user_id);
      if (!enabled) statements.deleteAllPairs.run(user.user_id, user.user_id);
      return { status: enabled ? 'enabled' : 'disabled' };
    }),
    connections: forUser((user, now) => getPairs(user.user_id).filter(pair => isCurrent(pair, now)).map(pair => ({
      peer: pair.first_user_id === user.user_id ? pair.second_user_id : pair.first_user_id,
      state: pair.state === 'proposal' && pair.expires_at <= now ? 'linked' : pair.state,
      incoming: pair.requested_by !== user.user_id,
      affinity: pair.affinity,
      pet: pair.pet,
    }))),
    request: forPair(({ user, other, now, ids, pair }) => {
      if (pair) return { status: 'already-exists' };
      if (!hasConnectionSpace(user.user_id, now) || !hasConnectionSpace(other.user_id, now)) return { status: 'capacity' };
      if (now - user.last_social_at < SOCIAL_COOLDOWN_MS) return { status: 'cooldown' };
      statements.request.run(...ids, user.user_id, now + REQUEST_LIFETIME_MS);
      statements.social.run(now, user.user_id);
      return { status: 'requested' };
    }),
    propose: forPair(({ user, other, now, ids, pair }) => {
      if (pair?.state !== 'linked') return { status: 'missing-link' };
      if (isMarried(user.user_id) || isMarried(other.user_id)) return { status: 'already-married' };
      if (!JSON.parse(user.inventory).nhan) return { status: 'missing-ring' };
      statements.pairState.run('proposal', user.user_id, now + REQUEST_LIFETIME_MS, ...ids);
      return { status: 'proposed' };
    }),
    accept: forPair(({ user, now, ids, pair }) => {
      if (!['pending', 'proposal'].includes(pair?.state) || pair.requested_by === user.user_id) return { status: 'no-request' };
      if (pair.state === 'pending') {
        statements.pairState.run('linked', pair.requested_by, 0, ...ids);
        return { status: 'linked' };
      }
      if (isMarried(user.user_id) || isMarried(pair.requested_by)) return { status: 'already-married' };
      const proposer = statements.user.get(pair.requested_by);
      const inventory = JSON.parse(proposer.inventory);
      if (!inventory.nhan) return { status: 'missing-ring' };
      inventory.nhan -= 1;
      statements.inventory.run(JSON.stringify(inventory), proposer.user_id);
      statements.pairState.run('married', pair.requested_by, 0, ...ids);
      return { status: 'married' };
    }),
    remove: forPair(({ ids, pair }) => {
      if (!pair) return { status: 'missing-link' };
      statements.deletePair.run(...ids);
      return { status: 'removed' };
    }),
    interact: forPair(({ user, now, ids, pair }) => {
      if (!pair || pair.state === 'pending') return { status: 'missing-link' };
      if (now - user.last_social_at < SOCIAL_COOLDOWN_MS) return { status: 'cooldown' };
      statements.affinity.run(...ids);
      statements.social.run(now, user.user_id);
      return { status: 'interacted', affinity: pair.affinity + 1 };
    }),
    feedPet: forPair(({ user, ids, pair }) => {
      if (pair?.state !== 'married') return { status: 'requires-marriage' };
      const stock = JSON.parse(user.inventory);
      if (!stock['thuc-an']) return { status: 'missing-food' };
      stock['thuc-an'] -= 1;
      statements.inventory.run(JSON.stringify(stock), user.user_id);
      statements.feed.run(...ids);
      return { status: 'fed', pet: pair.pet + 1 };
    }),
  };
}
