import { createHash } from 'node:crypto';
import {
  ChannelType, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { withOwnerMessageEdit } from '../utils/manualAnnouncementWrite.js';
import { membershipTierForSpend } from '../config/membershipProgram.js';
import { STORE_SERVICE_FORUM, serviceMessageTarget } from '../config/storeServiceForum202611.js';
import { getLeaderboardPeriodBounds, getLeaderboardRows } from './leaderboardService.js';

const MEDALS = ['icon_gold', 'icon_silver', 'icon_bronze', 'icon_num4', 'icon_num5', 'icon_num6', 'icon_num7', 'icon_num8', 'icon_num9', 'icon_num10'];
const COLORS = { ruby: 0xDB2777, diamond: 0x60A5FA, elite: 0xA78BFA, vip: 0xFBBF24, active: 0x7C3AED };
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const snowflake = value => /^\d{17,20}$/.test(String(value || ''));
const failure = code => Object.assign(new Error('Leaderboard update unavailable'), { code });
const absent = error => error?.status === 404 || error?.code === 10008;
const rejectedSend = error => [400, 401, 403, 404, 413, 429].includes(error?.status)
  || [50001, 50013, 10003].includes(error?.code);
const nonce = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

function textOf(message) {
  const texts = [];
  const visit = value => {
    const node = value?.toJSON?.() || value;
    if (typeof node?.content === 'string') texts.push(node.content);
    for (const child of node?.components || []) visit(child);
  };
  for (const component of message?.components || []) visit(component);
  for (const embed of message?.embeds || []) texts.push(embed.title || '', embed.description || '');
  return texts.filter(Boolean).join('\n');
}
function heading(message) {
  return textOf(message).split('\n')[0].replace(/<a?:\w+:\d+>/g, '').replace(/^##\s*/, '').trim();
}
function owned(message, channel, client) {
  return snowflake(message?.id) && message.author?.id === client.user.id
    && !message.webhookId && message.channelId === channel.id;
}

export function buildLeaderboardV2(title, subtitle, rows, guildId) {
  const E = createEmojiResolver(guildId);
  const tier = membershipTierForSpend(rows[0]?.total_spent || 0);
  const container = new ContainerBuilder().setAccentColor(COLORS[tier.key] || COLORS.active);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E('icon_trophy')} ${title}\n> ${subtitle}`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const lines = rows.map((row, index) => {
    const member = membershipTierForSpend(row.total_spent || 0);
    const total = new Intl.NumberFormat('vi-VN').format(Number(row.total_spent || 0));
    return `${MEDALS[index] ? E(MEDALS[index]) : `${index + 1}.`} <@${row.customer_id}> ${E(member.slot)} **${member.label}**\n`
      + `> ${E('payment_payos')} ${row.orders} đơn | ${E('payment_money')} **${total}đ**`;
  });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n') || '*Chưa có thanh toán hợp lệ trong kỳ này.*'));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${E('icon_heart_purple')} Cenar Store — Cảm ơn quý khách đã ủng hộ`));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
}

export async function findLeaderboardChannel(guild, client) {
  if (guild.id === STORE_SERVICE_FORUM.guildId) {
    const channel = await guild.channels.fetch(STORE_SERVICE_FORUM.posts.honor);
    if (channel?.id !== STORE_SERVICE_FORUM.posts.honor || channel.type !== ChannelType.PublicThread
      || channel.guildId !== guild.id || channel.parentId !== STORE_SERVICE_FORUM.forumId
      || channel.ownerId !== client.user.id) throw failure('LEADERBOARD_TARGET_MISMATCH');
    return channel;
  }
  const channel = guild.channels.cache.find(item => item.type === ChannelType.GuildText
    && item.guildId === guild.id && item.name.includes('vinh-danh'));
  if (!channel) throw failure('LEADERBOARD_TARGET_MISSING');
  return channel;
}

/** Dependencies permit month-boundary tests against an isolated SQLite database. */
export function createVinhDanhService({ database = db, now = () => new Date(), guildId = config.guildId,
  clientId = config.clientId } = {}) {
  const flights = new WeakMap();
  const timers = new WeakMap();
  const health = new WeakMap();
  let initialized = false;
  const get = key => database.prepare('SELECT value FROM system_settings WHERE key = ?').get(key)?.value;
  const set = (key, value) => database.prepare('INSERT OR REPLACE INTO system_settings(key,value) VALUES(?,?)').run(key, value);
  const rows = date => getLeaderboardRows(guildId, 'monthly', date, 10, database).rows;
  function init() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS monthly_leaderboard_archives(
      guild_id TEXT NOT NULL, period TEXT NOT NULL, channel_id TEXT NOT NULL,
      status TEXT NOT NULL, message_id TEXT, attempted_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(guild_id,period))`);
    initialized = true;
  }
  // Incomplete history must never justify repeating an ambiguous send.
  async function history(channel, client, matches) {
    const found = [];
    let before;
    for (let page = 0; page < 10; page++) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      const batch = [...messages.values()];
      for (const message of batch) if (owned(message, channel, client) && matches(message)) found.push(message);
      if (batch.length < 100) return { found, complete: true };
      const next = batch.at(-1)?.id;
      if (!snowflake(next) || next === before) break;
      before = next;
    }
    return { found, complete: false };
  }
  async function archive(channel, client, date, bounds) {
    const previousRows = rows(date);
    if (!previousRows.length) return 'EMPTY';
    const [m, y] = bounds.label.split('/');
    const label = `${Number(m)}/${y}`;
    const oldKey = `final_vinh_danh_posted_${y}_${Number(m)}_${guildId}`;
    const prior = database.prepare('SELECT * FROM monthly_leaderboard_archives WHERE guild_id=? AND period=?').get(guildId, bounds.label);
    if (prior?.channel_id && prior.channel_id !== channel.id) return 'REVIEW';
    if (prior?.status === 'SENT' || prior?.status === 'REVIEW') return prior.status;
    const title = `BẢNG VINH DANH THÁNG CHUNG CUỘC — THÁNG ${label}`;
    const writeState = (status, messageId = null) => database.prepare(`INSERT INTO monthly_leaderboard_archives
      (guild_id,period,channel_id,status,message_id,attempted_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(guild_id,period) DO UPDATE SET status=excluded.status,message_id=excluded.message_id,updated_at=excluded.updated_at`)
      .run(guildId, bounds.label, channel.id, status, messageId, now().toISOString(), now().toISOString());
    const receipt = message => {
      if (!owned(message, channel, client) || heading(message) !== title) throw failure('LEADERBOARD_RECEIPT_INVALID');
      database.transaction(() => { writeState('SENT', message.id); set(oldKey, '1'); })();
      return 'SENT';
    };
    let recovered;
    try { recovered = await history(channel, client, message => heading(message) === title); }
    catch {
      const status = ['UNKNOWN', 'SENDING'].includes(prior?.status) || (!prior && get(oldKey)) ? 'UNKNOWN' : 'RETRY';
      writeState(status);
      return status;
    }
    if (recovered.found.length > 1) { writeState('REVIEW'); return 'REVIEW'; }
    if (recovered.complete && recovered.found.length === 1) return receipt(recovered.found[0]);
    if (!recovered.complete) {
      const status = ['UNKNOWN', 'SENDING'].includes(prior?.status) || (!prior && get(oldKey)) ? 'UNKNOWN' : 'RETRY';
      writeState(status); return status;
    }
    if (['UNKNOWN', 'SENDING'].includes(prior?.status) || (!prior && get(oldKey))) {
      writeState('UNKNOWN'); return 'UNKNOWN';
    }
    // Claim before Discord. Crash/timeouts recover by matching history, never a blind resend.
    database.prepare(`INSERT INTO monthly_leaderboard_archives
      (guild_id,period,channel_id,status,updated_at) VALUES(?,?,?,'PENDING',?)
      ON CONFLICT(guild_id,period) DO NOTHING`).run(guildId, bounds.label, channel.id, now().toISOString());
    const claim = database.prepare("UPDATE monthly_leaderboard_archives SET status='SENDING',attempted_at=?,updated_at=? WHERE guild_id=? AND period=? AND status IN ('PENDING','RETRY')")
      .run(now().toISOString(), now().toISOString(), guildId, bounds.label);
    if (claim.changes !== 1) return 'PENDING';
    try {
      const payload = buildLeaderboardV2(title, `Danh sách vinh danh khách hàng tiêu biểu nhất trong toàn bộ **tháng ${label}**`, previousRows, guildId);
      return receipt(await channel.send({ ...payload, nonce: nonce(`leaderboard-archive:${guildId}:${bounds.label}`), enforceNonce: true }));
    } catch (error) {
      writeState(rejectedSend(error) ? 'RETRY' : 'UNKNOWN');
      return rejectedSend(error) ? 'RETRY' : 'UNKNOWN';
    }
  }
  async function live(channel, client, date, bounds, previousBounds) {
    const [m, y] = bounds.label.split('/');
    const [pm, py] = previousBounds.label.split('/');
    const monthKey = `live_vinh_danh_msg_id_${y}_${Number(m)}_${guildId}`;
    const stableKey = `live_vinh_danh_current_msg_id_${guildId}`;
    const messageId = guildId === STORE_SERVICE_FORUM.guildId ? channel.id
      : serviceMessageTarget(guildId, get(stableKey) || get(monthKey) || get(`live_vinh_danh_msg_id_${py}_${Number(pm)}_${guildId}`));
    const title = `BẢNG XẾP HẠNG TIÊU DÙNG THÁNG ${Number(m)}/${y} (LIVE)`;
    const payload = buildLeaderboardV2(title, `Bảng xếp hạng cập nhật liên tục các khách hàng chi tiêu nhiều nhất trong **tháng ${Number(m)}/${y}**`, rows(date), guildId);
    let message;
    if (messageId) {
      try { message = await channel.messages.fetch({ message: messageId, force: true }); }
      catch (error) { if (!absent(error) || guildId === STORE_SERVICE_FORUM.guildId) throw error; }
    }
    if (!message) {
      const recovered = await history(channel, client, item => /^BẢNG XẾP HẠNG TIÊU DÙNG THÁNG \d{1,2}\/\d{4} \(LIVE\)$/.test(heading(item)));
      if (!recovered.complete) throw failure('LEADERBOARD_HISTORY_INCOMPLETE');
      message = recovered.found[0];
    }
    let status = 'CURRENT';
    if (message) {
      if (!owned(message, channel, client)) throw failure('LEADERBOARD_OWNER_MISMATCH');
      if (textOf(message) !== textOf(payload)) {
        message = await withOwnerMessageEdit({ rest: client.rest, channelId: channel.id, messageId: message.id }, () => message.edit(payload));
        status = 'UPDATED';
      }
    } else {
      const createKey = `live_vinh_danh_create_${guildId}`;
      if (get(createKey)) throw failure('LEADERBOARD_CREATE_UNCERTAIN');
      set(createKey, 'SENDING');
      try { message = await channel.send({ ...payload, nonce: nonce(`leaderboard-live:${guildId}`), enforceNonce: true }); }
      catch (error) { if (rejectedSend(error)) database.prepare('DELETE FROM system_settings WHERE key=?').run(createKey); throw error; }
      status = 'CREATED';
    }
    if (!owned(message, channel, client) || heading(message) !== title) throw failure('LEADERBOARD_RECEIPT_INVALID');
    database.transaction(() => { set(stableKey, message.id); set(monthKey, message.id); })();
    return status;
  }
  async function update(client) {
    const date = now();
    const checkedAt = date.toISOString();
    const bounds = getLeaderboardPeriodBounds('monthly', date);
    const [m, y] = bounds.label.split('/').map(Number);
    const previousDate = new Date(Date.UTC(y, m - 2, 1));
    const previousBounds = getLeaderboardPeriodBounds('monthly', previousDate);
    let current;
    try {
      init();
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
      if (guild?.id !== guildId || guild.client?.user?.id !== client.user.id) throw failure('LEADERBOARD_GUILD_MISMATCH');
      const channel = await findLeaderboardChannel(guild, client);
      if (channel.archived) {
        if (typeof channel.setArchived !== 'function') throw failure('LEADERBOARD_THREAD_ARCHIVED');
        await channel.setArchived(false, 'Cập nhật bảng xếp hạng tháng');
      }
      // Archive outages must not freeze the visible current month.
      const liveStatus = await live(channel, client, date, bounds, previousBounds);
      health.set(client, { status: 'PENDING', checkedAt, period: bounds.label, liveStatus, archiveStatus: 'CHECKING' });
      const archiveStatus = await archive(channel, client, previousDate, previousBounds);
      current = { status: ['SENT', 'EMPTY'].includes(archiveStatus) ? 'READY' : 'PENDING', checkedAt, period: bounds.label, liveStatus, archiveStatus };
    } catch (error) {
      current = { status: 'RETRY_REQUIRED', checkedAt, period: bounds.label,
        error: String(error?.code || '').startsWith('LEADERBOARD_') ? error.code : 'UPDATE_FAILED' };
    }
    health.set(client, current);
    return { ...current };
  }
  const eligible = client => client && typeof client === 'object' && client.isReady?.()
    && snowflake(guildId) && snowflake(client.user?.id) && (!clientId || client.user.id === clientId);
  function run(client) {
    if (!eligible(client)) return Promise.resolve({ status: 'NOT_READY' });
    if (!flights.has(client)) flights.set(client, update(client).finally(() => flights.delete(client)));
    return flights.get(client);
  }
  function stopMaintenance(client) {
    const state = timers.get(client);
    if (state) { state.stopped = true; clearTimeout(state.timer); client.off?.('invalidated', state.stop); timers.delete(client); }
  }
  function startMaintenance(client, { intervalMs = 60_000, isReady = () => true } = {}) {
    if (!client || typeof client !== 'object' || timers.has(client)) return;
    const state = { stopped: false, timer: null, stop: () => stopMaintenance(client) };
    const tick = async () => {
      if (state.stopped) return;
      if (client.token === null) { state.stop(); return; }
      try { if (eligible(client) && isReady()) await run(client); } catch { /* next tick retries */ }
      if (!state.stopped) { state.timer = setTimeout(tick, Math.min(300_000, Math.max(1_000, Number(intervalMs) || 60_000))); state.timer.unref?.(); }
    };
    timers.set(client, state);
    client.once?.('invalidated', state.stop);
    void tick();
  }
  return { run, startMaintenance, stopMaintenance, getHealth: client => ({ ...(health.get(client) || { status: 'NOT_STARTED', checkedAt: null }) }) };
}

const service = createVinhDanhService();
export const runAutoVinhDanh = client => service.run(client);
export const startVinhDanhMaintenance = (client, options) => service.startMaintenance(client, options);
export const stopVinhDanhMaintenance = client => service.stopMaintenance(client);
export const getVinhDanhHealth = client => service.getHealth(client);
