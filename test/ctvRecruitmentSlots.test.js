import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ButtonStyle, MessageFlags } from 'discord.js';
import { db, initDatabase } from '../src/database/db.js';
import {
  addCtvApplication,
  approveCtvApplication,
  getCtvRecruitmentSnapshot,
  rejectCtvApplication,
  startCtvRecruitmentCampaign,
} from '../src/services/ctvService.js';
import { buildCtvRecruitmentPayload } from '../src/services/ctvRecruitmentPanelService.js';

const GUILD_ID = `test_ctv_campaign_${Date.now()}`;
const DEFAULT_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function allDisplayText(payload) {
  return payload.components
    .flatMap((component) => component.toJSON().components || [])
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

describe('CTV recruitment slots', () => {
  beforeAll(() => {
    initDatabase();
    startCtvRecruitmentCampaign(GUILD_ID, 3);
  });

  afterAll(() => {
    db.prepare('DELETE FROM ctv_applications WHERE guild_id = ?').run(GUILD_ID);
    db.prepare('DELETE FROM customer_profiles WHERE guild_id = ?').run(GUILD_ID);
    db.prepare('DELETE FROM ctv_settings WHERE guild_id = ?').run(GUILD_ID);
  });

  it('starts with three openings and does not reserve a slot on submission', () => {
    const application = addCtvApplication(GUILD_ID, 'candidate_1', 'Discord community', 'Sell carefully and support customers.');
    expect(application.created).toBe(true);
    expect(application.snapshot.remaining).toBe(3);
    expect(getCtvRecruitmentSnapshot(GUILD_ID).remaining).toBe(3);
  });

  it('consumes exactly one slot per approval and ignores a repeated approval', () => {
    const application = db.prepare(`
      SELECT * FROM ctv_applications WHERE guild_id = ? AND applicant_id = ?
    `).get(GUILD_ID, 'candidate_1');
    const approved = approveCtvApplication(GUILD_ID, application.id, 'admin_1');
    expect(approved.approved).toBe(true);
    expect(approved.snapshot.remaining).toBe(2);

    const repeated = approveCtvApplication(GUILD_ID, application.id, 'admin_1');
    expect(repeated.approved).toBe(false);
    expect(repeated.reason).toBe('PROCESSED');
    expect(repeated.snapshot.remaining).toBe(2);
  });

  it('does not consume a slot when an application is rejected', () => {
    const submission = addCtvApplication(GUILD_ID, 'candidate_2', 'TikTok', 'Create product content and take care of buyers.');
    const rejected = rejectCtvApplication(GUILD_ID, submission.application.id, 'admin_1');
    expect(rejected.rejected).toBe(true);
    expect(getCtvRecruitmentSnapshot(GUILD_ID).remaining).toBe(2);
  });

  it('locks at zero slots and refuses later submissions', () => {
    for (const userId of ['candidate_3', 'candidate_4']) {
      const submission = addCtvApplication(GUILD_ID, userId, 'Facebook', 'Build a customer page and provide after-sales support.');
      const approved = approveCtvApplication(GUILD_ID, submission.application.id, 'admin_1');
      expect(approved.approved).toBe(true);
    }
    const snapshot = getCtvRecruitmentSnapshot(GUILD_ID);
    expect(snapshot.remaining).toBe(0);
    expect(snapshot.isFull).toBe(true);
    expect(addCtvApplication(GUILD_ID, 'candidate_5', 'Discord', 'A complete and serious sales plan.').reason).toBe('FULL');
  });

  it('renders both available and full Components V2 states with custom emojis', () => {
    const openPayload = buildCtvRecruitmentPayload(GUILD_ID, {}, {
      active: true,
      capacity: 3,
      filled: 1,
      remaining: 2,
      isFull: false,
    });
    const fullPayload = buildCtvRecruitmentPayload(GUILD_ID, {}, {
      active: true,
      capacity: 3,
      filled: 3,
      remaining: 0,
      isFull: true,
    });
    const openText = allDisplayText(openPayload);
    const fullText = allDisplayText(fullPayload);
    const fullButton = fullPayload.components[2].toJSON().components[0];

    expect(openPayload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(openPayload.components).toHaveLength(3);
    expect(openText).toContain('CÒN 02/03 VỊ TRÍ');
    expect(openText).toContain('QUYỀN LỢI CTV');
    expect(openText).toContain('mở nhiều ticket');
    expect(fullText).toContain('ĐÃ TUYỂN ĐỦ');
    expect(fullButton.disabled).toBe(true);
    expect(fullButton.style).toBe(ButtonStyle.Secondary);
    expect(openText).not.toMatch(DEFAULT_EMOJI);
    expect(openText).toMatch(/<a?:cenar_[a-zA-Z0-9_]+:\d+>/);
  });
});
