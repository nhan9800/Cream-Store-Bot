import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { bookingPhotoBytes } from './bookingProfilePhoto.js';

export class BookingProfileError extends Error {}

export const bookingProfileTemplate = Object.freeze({ title: 'Cenar Booking', accent: '#8176e9' });
const publishedProfiles = 'FROM booking_host_profiles WHERE approved IS NOT NULL AND forum_thread_id IS NOT NULL';
const publishedFields = 'host_id, profile_number, approved, forum_thread_id';
const photoVaultLimit = 16 * 1024 * 1024;

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
    CREATE TABLE IF NOT EXISTS booking_host_profile_photos (
      host_id TEXT PRIMARY KEY REFERENCES booking_host_profiles(host_id) ON DELETE CASCADE,
      draft_photo BLOB CHECK(draft_photo IS NULL OR (typeof(draft_photo)='blob' AND length(draft_photo) BETWEEN 1 AND ${bookingPhotoBytes})),
      approved_photo BLOB CHECK(approved_photo IS NULL OR (typeof(approved_photo)='blob' AND length(approved_photo) BETWEEN 1 AND ${bookingPhotoBytes})),
      sync_removal INTEGER NOT NULL DEFAULT 0 CHECK(sync_removal IN (0,1))
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

  const stagePhoto = db.transaction((hostId, photo) => {
    if (!get(hostId)) throw new BookingProfileError('Dùng /cenar-ho-so gui-ban-nhap để tạo hồ sơ trước.');
    if (!Buffer.isBuffer(photo) || !photo.length || photo.length > bookingPhotoBytes) {
      throw new BookingProfileError('Ảnh không vừa giới hạn lưu trữ của thẻ.');
    }
    const { bytes } = db.prepare(`SELECT COALESCE(SUM(COALESCE(length(approved_photo),0)
      + CASE WHEN host_id=? THEN 0 ELSE COALESCE(length(draft_photo),0) END),0) AS bytes
      FROM booking_host_profile_photos`).get(hostId);
    if (bytes + photo.length > photoVaultLimit) throw new BookingProfileError('Kho ảnh hồ sơ đã đầy. Thử lại sau.');
    db.prepare(`INSERT INTO booking_host_profile_photos(host_id,draft_photo) VALUES (?,?)
      ON CONFLICT(host_id) DO UPDATE SET draft_photo=excluded.draft_photo`).run(hostId, photo);
    db.prepare('UPDATE booking_host_profiles SET draft_revision=draft_revision+1 WHERE host_id=?').run(hostId);
    return get(hostId);
  });

  function getDraftPhoto(hostId) {
    return db.prepare(`SELECT COALESCE(draft_photo,approved_photo) AS photo FROM booking_host_profile_photos WHERE host_id=?`)
      .get(hostId)?.photo ?? null;
  }

  function hasPendingPhoto(hostId) {
    return Boolean(db.prepare('SELECT 1 FROM booking_host_profile_photos WHERE host_id=? AND draft_photo IS NOT NULL').get(hostId));
  }

  function withApprovedPhoto(profile) {
    if (!profile?.approved?.consent) return profile;
    const photo = db.prepare('SELECT approved_photo AS photo FROM booking_host_profile_photos WHERE host_id=?').get(profile.host_id)?.photo;
    return photo ? { ...profile, approvedPhoto: photo } : profile;
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
    db.prepare(`UPDATE booking_host_profile_photos SET approved_photo=COALESCE(draft_photo,approved_photo), draft_photo=NULL
      WHERE host_id=?`).run(hostId);
    return get(hostId);
  });

  const removePhoto = db.transaction(hostId => {
    const profile = get(hostId);
    if (!profile) return null;
    const removal = db.prepare(`UPDATE booking_host_profile_photos SET draft_photo=NULL, approved_photo=NULL,
      sync_removal=CASE WHEN approved_photo IS NOT NULL AND ? THEN 1 ELSE sync_removal END
      WHERE host_id=? AND (draft_photo IS NOT NULL OR approved_photo IS NOT NULL)`).run(Number(Boolean(profile.approved && profile.profile_number)), hostId);
    if (removal.changes) db.prepare('UPDATE booking_host_profiles SET draft_revision=draft_revision+1 WHERE host_id=?').run(hostId);
    clearUnusedPhotoRow(hostId);
    return {
      removed: removal.changes > 0,
      sync: Boolean(db.prepare('SELECT sync_removal FROM booking_host_profile_photos WHERE host_id=?').get(hostId)?.sync_removal),
    };
  });

  function clearUnusedPhotoRow(hostId) {
    db.prepare(`DELETE FROM booking_host_profile_photos WHERE host_id=?
      AND draft_photo IS NULL AND approved_photo IS NULL AND sync_removal=0`).run(hostId);
  }

  const markPhotoSynced = db.transaction(hostId => {
    db.prepare('UPDATE booking_host_profile_photos SET sync_removal=0 WHERE host_id=? AND sync_removal=1').run(hostId);
    clearUnusedPhotoRow(hostId);
  });

  const hide = db.transaction(hostId => {
    const profile = get(hostId);
    if (!profile) return false;
    const draft = { ...profile.draft, consent: false };
    db.prepare(`UPDATE booking_host_profiles SET approved=NULL, approved_revision=NULL, draft=?, draft_revision=draft_revision+1
      WHERE host_id=?`).run(JSON.stringify(draft), hostId);
    db.prepare('DELETE FROM booking_host_profile_photos WHERE host_id=?').run(hostId);
    return true;
  });

  function ratingFor(hostId) {
    return db.prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating),1) AS average
      FROM booking_host_reviews WHERE host_id=?`).get(hostId);
  }

  const publishedPage = db.transaction(requestedPage => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total ${publishedProfiles}`).get();
    const page = Math.max(1, Math.min(requestedPage, total));
    const row = db.prepare(`SELECT ${publishedFields} ${publishedProfiles} ORDER BY profile_number LIMIT 1 OFFSET ?`).get(page - 1);
    return { profile: withApprovedPhoto(readPublished(row)), page, total };
  });

  const getPublished = db.transaction(profileNumber => {
    return withApprovedPhoto(readPublished(db.prepare(`SELECT ${publishedFields} ${publishedProfiles} AND profile_number = ?`).get(profileNumber)));
  });

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
    get, saveDraft, approve: approve.immediate, hide: hide.immediate, ratingFor, publishedPage, getPublished,
    stagePhoto: stagePhoto.immediate, getDraftPhoto, hasPendingPhoto, withApprovedPhoto,
    removePhoto: removePhoto.immediate, markPhotoSynced: markPhotoSynced.immediate,
    getReview, createReview, getTemplate, setTemplate,
    setHostThread: (hostId, threadId) => db.prepare('UPDATE booking_host_profiles SET forum_thread_id=? WHERE host_id=?').run(threadId, hostId),
    setReviewThread: (ticketId, threadId) => db.prepare('UPDATE booking_host_reviews SET forum_thread_id=? WHERE ticket_id=?').run(threadId, ticketId),
  };
}
