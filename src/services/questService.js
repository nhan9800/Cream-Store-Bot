import crypto from 'node:crypto';
import { db, nowIso } from '../database/db.js';
import { config } from '../config.js';

export const QUEST_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'APPROVED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
]);

const DEFAULT_PLANS = [
  { code: 'QUEST_VN', name: 'Quest Assist · Việt Nam', description: 'Hỗ trợ kiểm tra và theo dõi 01 yêu cầu Quest trong tối đa 30 ngày.', price: 35000, regions: ['Việt Nam'], estimatedDays: 3 },
  { code: 'QUEST_US', name: 'Quest Assist · US', description: 'Hỗ trợ yêu cầu Quest cần phạm vi US, theo dõi tiến độ minh bạch.', price: 40000, regions: ['US'], estimatedDays: 3 },
  { code: 'QUEST_DUAL', name: 'Quest Assist · Mỹ & Đức', description: 'Hỗ trợ kiểm tra Quest theo hai phạm vi Mỹ và Đức.', price: 45000, regions: ['US', 'Đức'], estimatedDays: 3 },
  { code: 'QUEST_PLUS', name: 'Quest Assist · 3 khu vực', description: 'Hỗ trợ kiểm tra Quest trong phạm vi Mỹ, Nhật và Đức.', price: 50000, regions: ['US', 'Nhật', 'Đức'], estimatedDays: 3 },
  { code: 'QUEST_GLOBAL', name: 'Quest Assist · 4 khu vực', description: 'Hỗ trợ kiểm tra Quest trong phạm vi Mỹ, Nhật, Đức và Singapore.', price: 55000, regions: ['US', 'Nhật', 'Đức', 'Singapore'], estimatedDays: 3 },
  { code: 'QUEST_WORLD', name: 'Quest Assist · Toàn cầu', description: 'Gói hỗ trợ phạm vi rộng gồm Mỹ, Nhật, Đức, Singapore và Úc.', price: 60000, regions: ['US', 'Nhật', 'Đức', 'Singapore', 'Úc'], estimatedDays: 3 },
];

const STATUS_META = Object.freeze({
  PENDING_REVIEW: { title: 'Đã gửi yêu cầu', defaultStep: 'Đang chờ Cenar kiểm tra thông tin', minProgress: 0 },
  APPROVED: { title: 'Yêu cầu đã được duyệt', defaultStep: 'Đã xác nhận phạm vi hỗ trợ', minProgress: 10 },
  IN_PROGRESS: { title: 'Đang tiến hành', defaultStep: 'Đội ngũ đang xử lý yêu cầu', minProgress: 20 },
  WAITING_CUSTOMER: { title: 'Cần khách hàng bổ sung', defaultStep: 'Vui lòng kiểm tra hướng dẫn từ Cenar', minProgress: 20 },
  COMPLETED: { title: 'Đã hoàn tất', defaultStep: 'Yêu cầu đã hoàn tất', minProgress: 100 },
  REJECTED: { title: 'Không thể tiếp nhận', defaultStep: 'Yêu cầu đã bị từ chối', minProgress: 0 },
  CANCELLED: { title: 'Đã hủy', defaultStep: 'Yêu cầu đã được hủy', minProgress: 0 },
});

function text(value, maxLength = 300) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanOptional(value, maxLength) {
  const result = text(value, maxLength);
  return result || null;
}

function assertDiscordId(value) {
  const discordId = text(value, 30);
  if (!/^\d{15,22}$/.test(discordId)) throw new Error('Tài khoản chưa liên kết Discord hợp lệ.');
  return discordId;
}

function parseRegions(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 40)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizePlan(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description || '',
    price: Number(row.price || 0),
    regions: parseRegions(row.regions_json),
    estimatedDays: Number(row.estimated_days || 3),
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active),
  };
}

function normalizeEvent(row) {
  return {
    id: Number(row.id),
    type: row.event_type,
    title: row.title,
    detail: row.detail || '',
    progressPercent: row.progress_percent == null ? null : Number(row.progress_percent),
    actorId: row.actor_id || null,
    customerVisible: Boolean(row.customer_visible),
    createdAt: row.created_at,
  };
}

function normalizeRequest(row, { includeEvents = false, customerOnly = false } = {}) {
  if (!row) return null;
  const result = {
    id: Number(row.id),
    requestCode: row.request_code,
    guildId: row.guild_id,
    discordId: row.discord_id,
    discordUsername: row.discord_username || null,
    planCode: row.plan_code,
    planName: row.plan_name || null,
    planRegions: parseRegions(row.plan_regions_json),
    quotedPrice: Number(row.quoted_price || 0),
    questName: row.quest_name,
    gameName: row.game_name || null,
    rewardName: row.reward_name || null,
    region: row.region || null,
    questDeadlineAt: row.quest_deadline_at || null,
    customerNote: row.customer_note || null,
    relatedOrderCode: row.related_order_code || null,
    status: row.status,
    progressPercent: Math.max(0, Math.min(100, Number(row.progress_percent || 0))),
    currentStep: row.current_step,
    rejectionReason: row.rejection_reason || null,
    reviewedAt: row.reviewed_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!customerOnly) result.reviewedBy = row.reviewed_by || null;
  if (includeEvents) {
    const visibility = customerOnly ? 'AND customer_visible = 1' : '';
    result.events = db.prepare(`
      SELECT * FROM quest_service_events
      WHERE request_id = ? ${visibility}
      ORDER BY created_at ASC, id ASC
    `).all(row.id).map(normalizeEvent);
  }
  return result;
}

function ensureDefaultPlans() {
  const statement = db.prepare(`
    INSERT INTO quest_service_plans (
      code, name, description, price, regions_json, estimated_days, sort_order, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      price = excluded.price,
      regions_json = excluded.regions_json,
      estimated_days = excluded.estimated_days,
      sort_order = excluded.sort_order,
      is_active = 1,
      updated_at = excluded.updated_at
  `);
  const timestamp = nowIso();
  db.transaction(() => DEFAULT_PLANS.forEach((plan, index) => statement.run(
    plan.code,
    plan.name,
    plan.description,
    plan.price,
    JSON.stringify(plan.regions),
    plan.estimatedDays,
    index + 1,
    timestamp,
  )))();
}

function requestQuery(whereSql = '') {
  return `
    SELECT r.*, p.name AS plan_name, p.regions_json AS plan_regions_json
    FROM quest_service_requests r
    JOIN quest_service_plans p ON p.code = r.plan_code
    ${whereSql}
  `;
}

function createRequestCode() {
  for (let index = 0; index < 12; index += 1) {
    const code = `QS_${crypto.randomInt(100000, 1000000)}`;
    if (!db.prepare('SELECT 1 FROM quest_service_requests WHERE request_code = ?').get(code)) return code;
  }
  return `QS_${Date.now().toString().slice(-9)}`;
}

function addEvent({ requestId, type, title, detail = null, progressPercent = null, actorId = null, customerVisible = true }) {
  db.prepare(`
    INSERT INTO quest_service_events (
      request_id, event_type, title, detail, progress_percent, actor_id, customer_visible, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, type, title, detail, progressPercent, actorId, customerVisible ? 1 : 0, nowIso());
}

export function listQuestPlans({ includeInactive = false } = {}) {
  ensureDefaultPlans();
  return db.prepare(`
    SELECT * FROM quest_service_plans
    ${includeInactive ? '' : 'WHERE is_active = 1'}
    ORDER BY sort_order ASC, price ASC
  `).all().map(normalizePlan);
}

export function createQuestRequest(input = {}) {
  ensureDefaultPlans();
  const discordId = assertDiscordId(input.discordId);
  const planCode = text(input.planCode, 40).toUpperCase();
  const plan = db.prepare('SELECT * FROM quest_service_plans WHERE code = ? AND is_active = 1').get(planCode);
  if (!plan) throw new Error('Gói hỗ trợ Quest không tồn tại hoặc đã ngừng nhận.');

  const questName = text(input.questName, 160);
  if (questName.length < 3) throw new Error('Vui lòng nhập tên Quest cần hỗ trợ.');
  const clientRequestId = cleanOptional(input.clientRequestId, 100);
  if (clientRequestId) {
    const duplicate = db.prepare(requestQuery('WHERE r.client_request_id = ?')).get(clientRequestId);
    if (duplicate) {
      if (duplicate.discord_id !== discordId) throw new Error('Mã gửi yêu cầu không hợp lệ.');
      return normalizeRequest(duplicate, { includeEvents: true, customerOnly: true });
    }
  }

  const deadline = cleanOptional(input.questDeadlineAt, 40);
  if (deadline && Number.isNaN(Date.parse(deadline))) throw new Error('Thời hạn Quest không hợp lệ.');
  const timestamp = nowIso();
  const requestCode = createRequestCode();

  const createdId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO quest_service_requests (
        request_code, client_request_id, guild_id, web_user_id, discord_id, discord_username,
        plan_code, quoted_price, quest_name, game_name, reward_name, region,
        quest_deadline_at, customer_note, related_order_code, status, progress_percent,
        current_step, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', 0, ?, ?, ?)
    `).run(
      requestCode,
      clientRequestId,
      String(config.guildId || 'WEB'),
      cleanOptional(input.webUserId, 128),
      discordId,
      cleanOptional(input.discordUsername, 100),
      planCode,
      Number(plan.price),
      questName,
      cleanOptional(input.gameName, 120),
      cleanOptional(input.rewardName, 160),
      cleanOptional(input.region, 80),
      deadline ? new Date(deadline).toISOString() : null,
      cleanOptional(input.customerNote, 800),
      cleanOptional(input.relatedOrderCode, 40)?.toUpperCase() || null,
      STATUS_META.PENDING_REVIEW.defaultStep,
      timestamp,
      timestamp,
    );
    addEvent({
      requestId: result.lastInsertRowid,
      type: 'CREATED',
      title: STATUS_META.PENDING_REVIEW.title,
      detail: 'Cenar đã ghi nhận yêu cầu. Admin sẽ kiểm tra phạm vi và phản hồi trên tiến trình này.',
      progressPercent: 0,
      actorId: discordId,
    });
    return Number(result.lastInsertRowid);
  })();

  return getQuestRequest(createdId, { customerDiscordId: discordId });
}

export function listCustomerQuestRequests(discordId) {
  const safeDiscordId = assertDiscordId(discordId);
  return db.prepare(`${requestQuery('WHERE r.discord_id = ?')} ORDER BY r.created_at DESC`).all(safeDiscordId)
    .map((row) => normalizeRequest(row, { customerOnly: true }));
}

export function listQuestRequests({ status, query, limit = 100 } = {}) {
  const clauses = [];
  const params = [];
  const normalizedStatus = text(status, 30).toUpperCase();
  if (normalizedStatus && normalizedStatus !== 'ALL') {
    if (!QUEST_STATUSES.includes(normalizedStatus)) throw new Error('Trạng thái lọc không hợp lệ.');
    clauses.push('r.status = ?');
    params.push(normalizedStatus);
  }
  const search = text(query, 100);
  if (search) {
    clauses.push('(r.request_code LIKE ? OR r.quest_name LIKE ? OR r.game_name LIKE ? OR r.discord_username LIKE ? OR r.discord_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  return db.prepare(`${requestQuery(where)} ORDER BY CASE r.status WHEN 'PENDING_REVIEW' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'WAITING_CUSTOMER' THEN 3 ELSE 4 END, r.updated_at DESC LIMIT ?`)
    .all(...params, safeLimit).map((row) => normalizeRequest(row));
}

export function getQuestRequest(idOrCode, { customerDiscordId = null } = {}) {
  const isId = /^\d+$/.test(String(idOrCode));
  const row = db.prepare(requestQuery(`WHERE ${isId ? 'r.id' : 'r.request_code'} = ?`)).get(isId ? Number(idOrCode) : text(idOrCode, 30).toUpperCase());
  if (!row) return null;
  if (customerDiscordId && row.discord_id !== assertDiscordId(customerDiscordId)) return null;
  return normalizeRequest(row, { includeEvents: true, customerOnly: Boolean(customerDiscordId) });
}

export function getQuestStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS total FROM quest_service_requests GROUP BY status').all();
  const byStatus = Object.fromEntries(QUEST_STATUSES.map((status) => [status, 0]));
  rows.forEach((row) => { byStatus[row.status] = Number(row.total || 0); });
  return {
    total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    active: byStatus.PENDING_REVIEW + byStatus.APPROVED + byStatus.IN_PROGRESS + byStatus.WAITING_CUSTOMER,
    completed: byStatus.COMPLETED,
    rejected: byStatus.REJECTED,
    byStatus,
  };
}

export function updateQuestRequestStatus(id, input = {}, actorId = 'SYSTEM') {
  const existing = getQuestRequest(id);
  if (!existing) throw new Error('Không tìm thấy yêu cầu Quest.');
  if (['COMPLETED', 'REJECTED', 'CANCELLED'].includes(existing.status)) {
    throw new Error('Yêu cầu này đã kết thúc và không thể thay đổi thêm.');
  }

  const status = text(input.status, 30).toUpperCase();
  if (!QUEST_STATUSES.includes(status) || status === 'PENDING_REVIEW' || status === 'CANCELLED') {
    throw new Error('Trạng thái cập nhật không hợp lệ.');
  }
  const reason = cleanOptional(input.rejectionReason ?? input.reason, 600);
  if (status === 'REJECTED' && (!reason || reason.length < 5)) throw new Error('Vui lòng nhập lý do từ chối rõ ràng.');

  const meta = STATUS_META[status];
  let progress = Number(input.progressPercent);
  if (!Number.isFinite(progress)) progress = existing.progressPercent;
  progress = Math.max(meta.minProgress, Math.min(100, Math.round(progress)));
  if (status === 'REJECTED') progress = existing.progressPercent;
  const step = cleanOptional(input.currentStep, 180) || meta.defaultStep;
  const detail = cleanOptional(input.detail, 800) || (status === 'REJECTED' ? reason : null);
  const timestamp = nowIso();

  db.transaction(() => {
    db.prepare(`
      UPDATE quest_service_requests SET
        status = ?, progress_percent = ?, current_step = ?, rejection_reason = ?,
        reviewed_by = COALESCE(reviewed_by, ?),
        reviewed_at = CASE WHEN reviewed_at IS NULL AND ? IN ('APPROVED','IN_PROGRESS','WAITING_CUSTOMER','COMPLETED','REJECTED') THEN ? ELSE reviewed_at END,
        started_at = CASE WHEN started_at IS NULL AND ? = 'IN_PROGRESS' THEN ? ELSE started_at END,
        completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END,
        updated_at = ?
      WHERE id = ?
    `).run(
      status,
      progress,
      step,
      status === 'REJECTED' ? reason : null,
      text(actorId, 128),
      status,
      timestamp,
      status,
      timestamp,
      status,
      timestamp,
      timestamp,
      existing.id,
    );
    addEvent({
      requestId: existing.id,
      type: status,
      title: meta.title,
      detail,
      progressPercent: progress,
      actorId: text(actorId, 128),
      customerVisible: input.customerVisible !== false,
    });
  })();

  return getQuestRequest(existing.id);
}

export function updateQuestProgress(id, input = {}, actorId = 'SYSTEM') {
  const existing = getQuestRequest(id);
  if (!existing) throw new Error('Không tìm thấy yêu cầu Quest.');
  if (!['APPROVED', 'IN_PROGRESS', 'WAITING_CUSTOMER'].includes(existing.status)) {
    throw new Error('Chỉ yêu cầu đã duyệt hoặc đang xử lý mới cập nhật được tiến độ.');
  }
  const progress = Math.max(existing.progressPercent, Math.min(99, Math.round(Number(input.progressPercent))));
  if (!Number.isFinite(progress)) throw new Error('Phần trăm tiến độ không hợp lệ.');
  const step = text(input.currentStep, 180);
  if (step.length < 3) throw new Error('Vui lòng nhập nội dung bước đang xử lý.');
  const detail = cleanOptional(input.detail, 800);
  const timestamp = nowIso();

  db.transaction(() => {
    db.prepare(`
      UPDATE quest_service_requests
      SET status = 'IN_PROGRESS', progress_percent = ?, current_step = ?,
          started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE id = ?
    `).run(progress, step, timestamp, timestamp, existing.id);
    addEvent({
      requestId: existing.id,
      type: 'PROGRESS',
      title: `Tiến độ ${progress}%`,
      detail: detail || step,
      progressPercent: progress,
      actorId: text(actorId, 128),
    });
  })();
  return getQuestRequest(existing.id);
}

export function updateQuestPlan(code, input = {}) {
  ensureDefaultPlans();
  const normalizedCode = text(code, 40).toUpperCase();
  const existing = db.prepare('SELECT * FROM quest_service_plans WHERE code = ?').get(normalizedCode);
  if (!existing) throw new Error('Không tìm thấy gói Quest.');
  const price = input.price == null ? Number(existing.price) : Number(input.price);
  if (!Number.isSafeInteger(price) || price < 1000 || price > 10000000) throw new Error('Giá gói không hợp lệ.');
  const active = input.isActive == null ? Number(existing.is_active) : (input.isActive ? 1 : 0);
  db.prepare('UPDATE quest_service_plans SET price = ?, is_active = ?, updated_at = ? WHERE code = ?')
    .run(price, active, nowIso(), normalizedCode);
  return normalizePlan(db.prepare('SELECT * FROM quest_service_plans WHERE code = ?').get(normalizedCode));
}
