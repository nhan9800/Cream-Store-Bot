import { STORE_TWO_GUILD_ID } from '../utils/locale.js';

export class BookingProfileError extends Error {}

export const bookingProfileTemplate = Object.freeze({ title: 'Cenar Booking', accent: '#8176e9' });
const publishedProfiles = 'FROM booking_host_profiles WHERE approved IS NOT NULL AND forum_thread_id IS NOT NULL';
const publishedFields = 'host_id, profile_number, approved, forum_thread_id';

function readPublished(row) {
  return row ? { ...row, approved: JSON.parse(row.approved) } : null;
}

export function canRequestHostService(profile, service) {
  return (service === 'game' || service === 'voice') && (profile.approved.service === service || profile.approved.service === 'both');
}

function boundedText(value, max, required = true) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').replace(/\p{Cc}/gu, '').trim();
  if ((!text && required) || text.length > max) throw new BookingProfileError('Một mục hồ sơ còn trống hoặc quá dài.');
  return text;
}

export function createBookingProfileService(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_host_profiles (
      host_id TEXT PRIMARY KEY,
      profile_number INTEGER UNIQUE CHECK(profile_number > 0),
      draft TEXT NOT NULL,
      draft_revision INTEGER NOT NULL DEFAULT 1,
      approved TEXT,
      approved_revision INTEGER,
      forum_thread_id TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS booking_host_reviews (
      ticket_id INTEGER PRIMARY KEY,
      host_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      feedback TEXT NOT NULL,
      consent INTEGER NOT NULL CHECK(consent IN (0,1)),
      forum_thread_id TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS booking_reviews_by_host ON booking_host_reviews(host_id);
    CREATE TABLE IF NOT EXISTS booking_profile_template (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1), title TEXT NOT NULL, accent TEXT NOT NULL
    );
  `);

  function get(hostId) {
    const row = db.prepare('SELECT * FROM booking_host_profiles WHERE host_id = ?').get(hostId);
    if (!row) return null;
    return { ...row, draft: JSON.parse(row.draft), approved: row.approved ? JSON.parse(row.approved) : null };
  }

  function saveDraft(hostId, input) {
    const draft = {
      name: boundedText(input.name, 40),
      tagline: boundedText(input.tagline, 120),
      games: boundedText(input.games, 150),
      availability: boundedText(input.availability, 120),
      service: input.service,
      consent: input.consent === true,
    };
    if (!['game', 'voice', 'both'].includes(draft.service)) throw new BookingProfileError('Chọn một loại dịch vụ hợp lệ.');
    const previous = get(hostId);
    if (previous?.approved && !draft.consent) {
      throw new BookingProfileError('Hồ sơ đang công khai. Dùng lệnh ẩn hồ sơ nếu muốn rút đồng ý.');
    }
    db.prepare(`INSERT INTO booking_host_profiles(host_id,draft) VALUES (?,?)
      ON CONFLICT(host_id) DO UPDATE SET draft=excluded.draft,draft_revision=draft_revision+1`).run(hostId, JSON.stringify(draft));
    return get(hostId);
  }

  const approve = db.transaction((hostId, draftRevision) => {
    const profile = get(hostId);
    if (!profile || profile.draft_revision !== draftRevision || !profile.draft.consent) {
      throw new BookingProfileError('Bản nháp đã đổi hoặc host chưa đồng ý công khai. Xem lại bản nháp trước khi duyệt.');
    }
    // Keep an existing host's number. New hosts use the smallest unoccupied number.
    const number = profile.profile_number ?? db.prepare(`SELECT MIN(candidate) AS number
      FROM (SELECT 1 AS candidate UNION SELECT profile_number + 1 FROM booking_host_profiles WHERE profile_number IS NOT NULL)
      WHERE NOT EXISTS (SELECT 1 FROM booking_host_profiles WHERE profile_number = candidate)`).get().number;
    db.prepare(`UPDATE booking_host_profiles SET profile_number=?,approved=draft,approved_revision=draft_revision WHERE host_id=?`)
      .run(number, hostId);
    return get(hostId);
  });

  function hide(hostId) {
    const profile = get(hostId);
    if (!profile) return false;
    const draft = { ...profile.draft, consent: false };
    db.prepare(`UPDATE booking_host_profiles SET approved=NULL, approved_revision=NULL, draft=?, draft_revision=draft_revision+1
      WHERE host_id=?`).run(JSON.stringify(draft), hostId);
    return true;
  }

  function ratingFor(hostId) {
    return db.prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating),1) AS average
      FROM booking_host_reviews WHERE host_id=?`).get(hostId);
  }

  const publishedPage = db.transaction(requestedPage => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total ${publishedProfiles}`).get();
    const page = Math.max(1, Math.min(requestedPage, total));
    const row = db.prepare(`SELECT ${publishedFields} ${publishedProfiles} ORDER BY profile_number LIMIT 1 OFFSET ?`).get(page - 1);
    return { profile: readPublished(row), page, total };
  });

  function getPublished(profileNumber) {
    return readPublished(db.prepare(`SELECT ${publishedFields} ${publishedProfiles} AND profile_number = ?`).get(profileNumber));
  }

  function getReview(ticketId) {
    return db.prepare('SELECT * FROM booking_host_reviews WHERE ticket_id = ?').get(ticketId) ?? null;
  }

  function createReview(session, userId, { rating, feedback, consent }) {
    if (!session || session.guild_id !== STORE_TWO_GUILD_ID || session.status !== 'COMPLETED'
        || session.customer_id !== userId || !session.host_id) {
      throw new BookingProfileError('Chỉ khách của phiên booking đã hoàn thành mới được đánh giá phiên đó.');
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BookingProfileError('Chọn điểm từ 1 đến 5.');
    const cleaned = boundedText(feedback, 400, false);
    if (consent && !cleaned) throw new BookingProfileError('Hãy viết nhận xét nếu muốn staff đăng công khai.');
    const inserted = db.prepare(`INSERT OR IGNORE INTO booking_host_reviews(ticket_id,host_id,customer_id,rating,feedback,consent)
      VALUES (?,?,?,?,?,?)`).run(session.ticket_id, session.host_id, userId, rating, cleaned, Number(consent === true));
    if (!inserted.changes) throw new BookingProfileError('Bạn đã đánh giá phiên này rồi.');
    return getReview(session.ticket_id);
  }

  function getTemplate() {
    return db.prepare('SELECT title,accent FROM booking_profile_template WHERE singleton=1').get() ?? bookingProfileTemplate;
  }

  function setTemplate(title, accent) {
    if (!/^#[a-f\d]{6}$/i.test(accent)) throw new BookingProfileError('Màu nhấn cần có dạng #8176e9.');
    db.prepare(`INSERT INTO booking_profile_template(singleton,title,accent) VALUES (1,?,?)
      ON CONFLICT(singleton) DO UPDATE SET title=excluded.title,accent=excluded.accent`).run(boundedText(title, 40), accent);
  }

  return {
    get, saveDraft, approve: approve.immediate, hide, ratingFor, publishedPage, getPublished,
    getReview, createReview, getTemplate, setTemplate,
    setHostThread: (hostId, threadId) => db.prepare('UPDATE booking_host_profiles SET forum_thread_id=? WHERE host_id=?').run(threadId, hostId),
    setReviewThread: (ticketId, threadId) => db.prepare('UPDATE booking_host_reviews SET forum_thread_id=? WHERE ticket_id=?').run(threadId, ticketId),
  };
}
