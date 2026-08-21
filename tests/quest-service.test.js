import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let tempRoot;
let db;
let service;
const previousEnv = {
  ENV_FILE: process.env.ENV_FILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-quest-service-'));
  process.env.ENV_FILE = path.join(tempRoot, '.env.test');
  process.env.DATABASE_PATH = path.join(tempRoot, 'quest-service.sqlite');
  process.env.ENCRYPTION_KEY = 'quest-service-test-key';
  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  service = await import('../src/services/questService.js');
}, 30_000);

afterAll(() => {
  if (db?.open) db.close();
  if (tempRoot && tempRoot.startsWith(os.tmpdir())) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Quest service workflow', () => {
  test('publishes the six approved prices with a 5k increase', () => {
    expect(service.listQuestPlans().map((plan) => plan.price)).toEqual([
      35_000,
      40_000,
      45_000,
      50_000,
      55_000,
      60_000,
    ]);
  });

  test('keeps customer ownership and a visible progress timeline without credentials', () => {
    const created = service.createQuestRequest({
      clientRequestId: 'test-client-request-1',
      discordId: '123456789012345678',
      discordUsername: 'quest_customer',
      planCode: 'QUEST_US',
      questName: 'VALORANT Watch Quest',
      rewardName: 'Profile decoration',
      customerNote: 'Chỉ lưu thông tin nhiệm vụ.',
    });

    expect(created).toMatchObject({
      status: 'PENDING_REVIEW',
      progressPercent: 0,
      quotedPrice: 40_000,
    });
    expect(JSON.stringify(created)).not.toMatch(/token|password/i);
    expect(service.getQuestRequest(created.id, { customerDiscordId: '999999999999999999' })).toBeNull();

    service.updateQuestRequestStatus(created.id, {
      status: 'APPROVED',
      progressPercent: 10,
      currentStep: 'Đã xác nhận phạm vi hỗ trợ',
    }, 'ADMIN');
    const progressed = service.updateQuestProgress(created.id, {
      progressPercent: 55,
      currentStep: 'Đã hoàn tất bước kiểm tra thứ hai',
      detail: 'Khách hàng có thể xem mốc này trên web và bot.',
    }, 'ADMIN');

    expect(progressed).toMatchObject({ status: 'IN_PROGRESS', progressPercent: 55 });
    expect(progressed.events.map((event) => event.progressPercent)).toEqual([0, 10, 55]);

    const queryPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM quest_service_requests
      WHERE discord_id = ?
      ORDER BY created_at DESC
    `).all('123456789012345678').map((row) => row.detail).join(' ');
    expect(queryPlan).toContain('idx_quest_service_requests_customer');
  });
});
