import express from 'express';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.supplier-health-test-absent',
  DATABASE_PATH: `./data/test-supplier-health-${process.pid}-${Date.now()}.sqlite`,
  GUILD_ID: '1282637033340403754',
}));

import { db, initDatabase } from '../src/database/db.js';
import { registerBotApiRoutes } from '../src/services/botApiRoutes.js';
import { supplierAutobuyRuntime } from '../src/services/supplierAutobuyRuntime.js';
import { getSupplierAutobuyPanelHealth } from '../src/services/supplierAutobuyPanelService.js';

let server, base, providerCalls = 0, ready = true;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  initDatabase();
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
    if (String(url).startsWith('https://docs-tele.ryan-zola.dev/')) {
      providerCalls += 1;
      expect(options.method).toBe('GET');
      const health = String(url).endsWith('/health');
      return Promise.resolve(new Response(JSON.stringify(health
        ? { ok: true, private: 'supplier-private-payload' }
        : { detail: 'supplier-private-payload' }), {
        status: health ? 200 : 401, headers: { 'content-type': 'application/json' },
      }));
    }
    return originalFetch(url, options);
  });
  await supplierAutobuyRuntime.start({
    guildId: '1282637033340403754', envFile: '.env', apiKey: 'supplier-private-key',
  });
  const app = express();
  app.locals.discordClient = { isReady: () => ready };
  registerBotApiRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks();
  if (db.open) db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});

describe('supplier startup evidence in public bot health', () => {
  it('reports cached sanitized failure without changing ready health or repeating provider calls', async () => {
    const responses = await Promise.all(['/api/health', '/api/bot/health'].map(path => fetch(base + path)));
    const payloads = await Promise.all(responses.map(response => response.json()));
    for (let index = 0; index < responses.length; index += 1) {
      expect(responses[index].status).toBe(200);
      expect(responses[index].headers.get('cache-control')).toBe('no-store');
      expect(payloads[index]).toMatchObject({
        ok: true, discordReady: true,
        supplierAutobuy: { readOnly: true, purchasesEnabled: false, schemaMapped: false },
      });
      expect(payloads[index].supplierAutobuy).toEqual(supplierAutobuyRuntime.getHealth());
      expect(payloads[index].supplierAutobuyPanel).toEqual(getSupplierAutobuyPanelHealth());
      expect(payloads[index].supplierAutobuyDelivery).toMatchObject({ status: 'UNINITIALIZED', journalAttempts: 0 });
      expect(JSON.stringify(payloads[index])).not.toContain('supplier-private');
    }
    expect(payloads[0].supplierAutobuy).toEqual(payloads[1].supplierAutobuy);
    expect(providerCalls).toBe(3);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_autobuy_delivery_attempts'").get()).toBeUndefined();
  });

  it('keeps Discord-unavailable health at503 regardless of cached supplier status', async () => {
    ready = false;
    const response = await fetch(base + '/api/health');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, discordReady: false });
    expect(providerCalls).toBe(3);
  });
});
