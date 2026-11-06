import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, { ENV_FILE:'.env.recovery-health-test-absent', DATABASE_PATH:`./data/test-recovery-health-${process.pid}-${Date.now()}.sqlite` }));
import { db, initDatabase } from '../src/database/db.js';
import { getMemberRecoveryHealth } from '../src/services/memberRecoveryHealthService.js';
beforeAll(()=>initDatabase());
afterAll(()=>{const path=db.name;db.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(path+suffix,{force:true});});
describe('aggregate member recovery health',()=>{
  it('distinguishes stored consent, scopes, encryption and expiry without exposing identities or credentials',()=>{
    const insert=db.prepare(`INSERT INTO oauth_backups(discord_id,guild_id,username,access_token,refresh_token,scopes,recovery_consent_at,token_expires_at) VALUES(?,?,?,?,?,?,?,?)`);
    for(const [index,scopes,consent,access,expiry] of [
      [1,'identify guilds.join','2026-11-06 13:00:00','enc:v1:private-access','2030-01-01T00:00:00Z'],
      [2,'identify guilds.join','2026-11-06 12:00:00','enc:v1:expired-access','2020-01-01T00:00:00Z'],
      [3,'identify','2026-11-06 15:00:00','enc:v1:wrong-scope','2030-01-01T00:00:00Z'],
      [4,'identify guilds.join',null,'enc:v1:no-consent','2030-01-01T00:00:00Z'],
      [5,'identify guilds.join','2026-11-06 12:00:00','legacy-plain-private','2030-01-01T00:00:00Z'],
    ])insert.run(`155555555555555555${index}`,'1282637033340403754','private-name',access,'enc:v1:private-refresh',scopes,consent,expiry);
    const status=getMemberRecoveryHealth('1282637033340403754',Date.parse('2026-11-06T14:00:00Z'));
    expect(status.counts).toEqual({stored:5,consented:4,completeScope:3,encryptedCredentials:2,accessUnexpired:1,refreshNeeded:1});
    expect(status.authorizationValidity).toBe('requires_live_discord_check');
    expect(status.latestConsentAt).toBe('2026-11-06T15:00:00.000Z');
    expect(status.snapshot).toBeNull();
    expect(JSON.stringify(status)).not.toMatch(/private-name|private-access|private-refresh|155555555555555555|legacy-plain/);
    expect(getMemberRecoveryHealth('1999999999999999999').counts.stored).toBe(0);
  });
  it('reads SQLite timestamps as UTC and scopes snapshot metadata to the requested guild',()=>{
    db.prepare(`INSERT INTO oauth_backups(discord_id,guild_id,access_token,refresh_token,scopes,recovery_consent_at,token_expires_at)
      VALUES(?,?,?,?,?,?,?)`).run('1555555555555555560','1999999999999999999','enc:v1:one','enc:v1:two','identify guilds.join','2026-11-06 13:00:00','2026-11-06 14:00:00');
    db.prepare(`INSERT INTO guild_recovery_snapshots(guild_id,captured_at,structure_hash,snapshot_json,member_count,authorized_member_count)
      VALUES(?,?,?,?,?,?)`).run('1999999999999999999','2026-11-06T13:00:00Z','hash','{"private":"do not expose"}',3000,42);
    const status=getMemberRecoveryHealth('1999999999999999999',Date.parse('2026-11-06T13:59:59Z'));
    expect(status.counts.accessUnexpired).toBe(1);
    expect(status.latestConsentAt).toBe('2026-11-06T13:00:00.000Z');
    expect(status.snapshot).toEqual({capturedAt:'2026-11-06T13:00:00Z',members:3000,authorizedMembers:42});
    expect(JSON.stringify(status)).not.toContain('do not expose');
    expect(getMemberRecoveryHealth('1999999999999999999',Date.parse('2026-11-06T14:00:00Z')).counts.refreshNeeded).toBe(1);
  });
});
