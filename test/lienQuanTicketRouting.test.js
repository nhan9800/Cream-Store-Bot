import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-lien-quan-routing-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.lien-quan-routing-not-present';
  process.env.DATABASE_PATH = value;
  process.env.GUILD_ID = '987654321098765432';
  process.env.BOT_API_KEY = 'test-lien-quan-routing-api-key';
  process.env.ENCRYPTION_KEY = 'test-lien-quan-routing-encryption';
  return value;
});

import { db, initDatabase } from '../src/database/db.js';
import { upsertGuildConfig } from '../src/services/guildConfigService.js';
import { createTicket, getOpenTicketBySubject } from '../src/services/ticketService.js';
import { handleTicketCreate } from '../src/events/ticketHandlers.js';
import { LIEN_QUAN_TICKET_PREFIX } from '../src/utils/lienQuanCatalog.js';

const guildId = '987654321098765432';
let sequence = 0;

function privateChannel(id) {
  return { id, isTextBased: () => true, permissionsFor: () => ({ has: () => false }), send: vi.fn(async () => ({})),
    toString: () => `<#${id}>` };
}

function quote(code, channels) {
  sequence += 1;
  const create = vi.fn(async () => { throw new Error('stop before creating a channel'); });
  return {
    id: `interaction-${sequence}`, createdTimestamp: Date.now(), guildId, inGuild: () => true,
    user: { id: `customer-${sequence}` }, member: null, client: { user: { id: 'bot' } },
    guild: { roles: { everyone: { id: guildId } }, members: { fetch: vi.fn(async () => { throw new Error('none'); }) },
      channels: { fetch: vi.fn(async id => channels[id] ?? null), create } },
    reply: vi.fn(async () => {}), followUp: vi.fn(async () => {}),
    intake: { title: LIEN_QUAN_TICKET_PREFIX + code, subjectPrefix: LIEN_QUAN_TICKET_PREFIX, text: `Báo giá ${code}` },
  };
}

function openTicket(interaction, channelId, subject) {
  return createTicket({ guildId, channelId, customerId: interaction.user.id, openedById: interaction.user.id,
    ticketType: 'ORDER', ticketSubject: subject });
}

const send = target => handleTicketCreate(target, 'ORDER', null, { intake: target.intake });

describe('Liên Quân quote ticket routing', () => {
  beforeAll(() => {
    initDatabase();
    upsertGuildConfig({ guild_id: guildId, ticket_category_id: '444444444444444444',
      order_log_channel_id: '555555555555555555', feedback_channel_id: '666666666666666666' });
  });
  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  it('never posts a quote into an unrelated open order ticket', async () => {
    const nitro = privateChannel('nitro-ticket');
    const target = quote('LQ-02', { 'nitro-ticket': nitro });
    openTicket(target, 'nitro-ticket', null);

    await send(target);
    expect(nitro.send).not.toHaveBeenCalled();
    expect(target.guild.channels.create).toHaveBeenCalledOnce();
  });

  it('points a repeated press of the same account to its ticket without posting again', async () => {
    const lq = privateChannel('lq-ticket');
    const target = quote('LQ-03', { 'lq-ticket': lq });
    openTicket(target, 'lq-ticket', LIEN_QUAN_TICKET_PREFIX + 'LQ-03');

    await send(target);
    expect(lq.send).not.toHaveBeenCalled();
    expect(target.guild.channels.create).not.toHaveBeenCalled();
    expect(target.reply.mock.lastCall[0].content).toContain('Bạn đã có ticket cho **Acc Liên Quân · LQ-03**');
  });

  it('adds another account to the customer\'s open Liên Quân ticket', async () => {
    const nitro = privateChannel('nitro-2');
    const lq = privateChannel('lq-2');
    const target = quote('LQ-05', { 'nitro-2': nitro, 'lq-2': lq });
    openTicket(target, 'lq-2', LIEN_QUAN_TICKET_PREFIX + 'LQ-01');
    openTicket(target, 'nitro-2', null);

    await send(target);
    expect(nitro.send).not.toHaveBeenCalled();
    expect(lq.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Báo giá LQ-05', enforceNonce: true }));
    expect(target.guild.channels.create).not.toHaveBeenCalled();
  });

  it('matches the subject prefix literally', () => {
    const target = quote('LQ-01', {});
    openTicket(target, 'wildcard', 'Acc Liên Quân %');
    expect(getOpenTicketBySubject(guildId, target.user.id, 'ORDER', 'Acc Liên Quân %_')).toBeNull();
    expect(getOpenTicketBySubject(guildId, target.user.id, 'ORDER', LIEN_QUAN_TICKET_PREFIX)).toBeNull();
  });
});
