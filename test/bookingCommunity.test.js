import Database from 'better-sqlite3';
import { Events, MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { communityWordPuzzle, playCommunityGame } from '../src/services/bookingCommunityGames.js';
import { communityDay, createBookingCommunityService, MAX_CONNECTIONS } from '../src/services/bookingCommunityService.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

vi.mock('../src/database/db.js', async () => {
  const { default: Sqlite } = await import('better-sqlite3');
  return { db: new Sqlite(':memory:') };
});
vi.mock('../src/services/bookingStoreSetupService.js', () => ({
  BOOKING_APP_ID: '1139187282075721768',
  bookingPortal: () => ({ chat: 'room', voiceChannels: ['voice'], emoji: { reviews: { id: '1234567890123456789', name: 'cenar_book' } } }),
}));
import { data, execute, bookingOnly, handleBookingCommunityInteraction } from '../src/commands/cenar-cong-dong.js';
import { bookingCommunity, eligibleVoiceMembers, registerBookingCommunity } from '../src/events/bookingCommunityEvents.js';
import { communityCheckInCard, communityMissionCard } from '../src/utils/bookingCommunityViews.js';

const memberId = suffix => `11391872820757${String(suffix).padStart(5, '0')}`;
const first = memberId(1);
const second = memberId(2);
const appId = '1139187282075721768';
const baseTime = Date.parse('2026-11-22T16:59:00Z');
const dayMs = 86_400_000;

describe('Cenar Booking community persistence', () => {
  let database;
  let time;
  let service;
  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    time = baseTime;
    service = createBookingCommunityService(database, { clock: () => time });
  });
  afterEach(() => database.close());

  it('limits text and voice XP to one per minute per account and preserves it on reload', () => {
    expect(service.message(first)).toBe(true);
    expect(service.message(first)).toBe(false);
    expect(service.voiceMinute(first)).toBe(true);
    expect(service.voiceMinute(first)).toBe(false);
    time += 60_000;
    expect(service.voiceMinute(first)).toBe(true);
    expect(service.message(second)).toBe(true);
    service = createBookingCommunityService(database, { clock: () => time });
    expect(service.profile(first)).toMatchObject({ xp: 25, points: 0 });
    expect(service.rank()).toEqual([{ user_id: first, xp: 25 }, { user_id: second, xp: 15 }]);
  });

  it('resets the challenge at Vietnam midnight, pays streaks once, and breaks a skipped streak', () => {
    expect(communityDay(time)).toBe('2026-11-22');
    expect(service.checkIn(first)).toMatchObject({ points: 10, streak: 1 });
    expect(service.checkIn(first)).toMatchObject({ status: 'claimed', streak: 1 });
    time += 60_000;
    expect(communityDay(time)).toBe('2026-11-23');
    expect(service.checkIn(first)).toMatchObject({ points: 11, streak: 2 });
    time += dayMs * 2;
    expect(service.checkIn(first)).toMatchObject({ points: 10, streak: 1 });
    expect(service.profile(first).points).toBe(31);
  });

  it('awards a full daily mission exactly once and caps positive game rewards', () => {
    time += 60_000;
    service.checkIn(first);
    expect(service.claimDaily(first).status).toBe('incomplete');
    for (let i = 0; i < 5; i += 1) {
      time += 60_000;
      service.voiceMinute(first);
      service.message(first);
    }
    const win = () => ({ won: true });
    expect(service.play(first, win).points).toBe(4);
    expect(service.play(first, win).status).toBe('cooldown');
    expect(service.claimDaily(first)).toEqual({ status: 'awarded', points: 25 });
    expect(service.claimDaily(first).status).toBe('claimed');
    for (let i = 0; i < 5; i += 1) {
      time += 10_000;
      expect(service.play(first, win).points).toBe(4);
    }
    time += 10_000;
    expect(service.play(first, win).points).toBe(0);
    expect(service.profile(first).points).toBe(59);
  });

  it('keeps word-game attempts independent and refreshes both the next day', () => {
    const moon = () => ({ won: false });
    expect(service.play(first, moon, 'noi-tu').status).toBe('played');
    time += 15_000;
    expect(service.play(first, moon, 'noi-tu').status).toBe('already-played');
    expect(service.play(first, moon, 'doan-tu').status).toBe('played');
    time += 60_000;
    expect(service.play(first, moon, 'noi-tu').status).toBe('played');
  });

  it('keeps purchases and giveaways virtual, durable and bounded by the balance', () => {
    expect(service.buy(first, 'nhan')).toEqual({ status: 'insufficient', points: 0 });
    expect(service.buy(first, 'toString')).toEqual({ status: 'invalid-item' });
    service.checkIn(first);
    expect(service.buy(first, 'thuc-an').points).toBe(5);
    expect(service.openBox(first).status).toBe('opened');
    expect(service.openBox(first).status).toBe('claimed');
    expect(service.profile(first).inventory).toEqual({ 'thuc-an': 2 });
  });

  it('requires consent from both participants, binds acceptance to the recipient and supports revocation', () => {
    service.setConnections(first, true);
    expect(service.request(first, second).status).toBe('opt-in');
    service.setConnections(second, true);
    expect(service.request(first, second).status).toBe('requested');
    expect(service.accept(first, second).status).toBe('no-request');
    expect(service.connections(second)).toMatchObject([{ state: 'pending', incoming: true }]);
    expect(service.accept(second, first).status).toBe('linked');
    expect(service.interact(first, second).status).toBe('cooldown');
    time += 60_000;
    expect(service.interact(first, second)).toEqual({ status: 'interacted', affinity: 1 });
    service.setConnections(second, false);
    expect(service.connections(first)).toEqual([]);
    expect(service.interact(first, second).status).toBe('opt-in');
  });

  it('caps outbox and inbox, and frees capacity when consent expires', () => {
    service.setConnections(first, true);
    for (let i = 0; i < MAX_CONNECTIONS; i += 1) {
      const guest = memberId(i + 10);
      service.setConnections(guest, true);
      expect(service.request(guest, first).status).toBe('requested');
    }
    service.setConnections(second, true);
    expect(service.connections(first)).toHaveLength(MAX_CONNECTIONS);
    expect(service.request(second, first).status).toBe('capacity');
    time += dayMs;
    expect(service.request(second, first).status).toBe('requested');
    expect(service.connections(first)).toHaveLength(1);
    expect(service.accept(first, memberId(10)).status).toBe('no-request');
  });

  it('consumes one virtual ring only after consent and permits feeding only the shared pet', () => {
    service.setConnections(first, true);
    service.setConnections(second, true);
    service.request(first, second);
    service.accept(second, first);
    expect(service.propose(first, second).status).toBe('missing-ring');
    for (let i = 0; i < 5; i += 1) {
      service.checkIn(first);
      time += dayMs;
    }
    expect(service.feedPet(first, second).status).toBe('requires-marriage');
    expect(service.buy(first, 'nhan').status).toBe('bought');
    expect(service.propose(first, second).status).toBe('proposed');
    expect(service.profile(first).inventory.nhan).toBe(1);
    expect(service.accept(second, first).status).toBe('married');
    expect(service.accept(second, first).status).toBe('no-request');
    expect(service.profile(first).inventory.nhan).toBe(0);
    expect(service.feedPet(second, first).status).toBe('missing-food');
    service.openBox(second);
    expect(service.feedPet(second, first)).toEqual({ status: 'fed', pet: 1 });
    expect(service.connections(first)[0]).toMatchObject({ state: 'married', pet: 1 });
  });
});

describe('Cenar Booking community Discord surface', () => {
  const makeSlash = (userId, interactionId, subcommand, strings = {}) => ({
    client: { user: { id: appId } }, guildId: STORE_TWO_GUILD_ID, user: { id: userId }, id: interactionId,
    options: { getSubcommand: () => subcommand, getString: name => strings[name] ?? null }, reply: vi.fn(),
  });
  const makeButton = (userId, interactionId, customId) => ({
    client: { user: { id: appId } }, guildId: STORE_TWO_GUILD_ID, user: { id: userId }, id: interactionId, customId,
    message: { author: { id: appId } }, isButton: () => true, isModalSubmit: () => false,
    reply: vi.fn(), update: vi.fn(), showModal: vi.fn(),
  });
  const tree = payload => payload.components[0].toJSON().components;

  it('runs six standalone games and both Vietnamese word prompts', () => {
    const low = () => 0;
    const high = max => max - 1;
    expect(playCommunityGame('xuc-xac', 'cao', high).won).toBe(true);
    expect(playCommunityGame('hai-cua', 'cat', low).won).toBe(false);
    expect(playCommunityGame('tung-xu', 'sap', low).won).toBe(true);
    expect(playCommunityGame('bai-21', 'dung', high).won).toBe(false);
    expect(playCommunityGame('cau-ca', '', low).won).toBe(true);
    expect(playCommunityGame('ba-o', '', low).won).toBe(true);
    expect(communityWordPuzzle('noi-tu', '', baseTime).prompt).toContain('Cụm hôm nay');
    expect(communityWordPuzzle('doan-tu', '', baseTime).prompt).toContain('chữ cái');
  });

  it('credits only eligible humans with a human peer within configured community voice', () => {
    const make = (id, channelId, { bot = false, deaf = false } = {}) => ({ id, channelId, deaf, member: { user: { id, bot } } });
    const states = [make('a', 'voice'), make('b', 'voice'), make('c', 'voice', { deaf: true }),
      make('d', 'afk'), make('e', 'afk'), make('f', 'shop'), make('g', 'shop'), make('h', 'voice2'), make('bot', 'voice2', { bot: true })];
    const guild = { afkChannelId: 'afk', voiceStates: { cache: new Map(states.map(state => [state.id, state])) } };
    expect([...eligibleVoiceMembers(guild, ['voice', 'voice2', 'afk'])]).toEqual([['a', 'voice'], ['b', 'voice']]);
  });

  it('renders private Components V2 cards only in Booking and validates declared options', async () => {
    expect(bookingOnly).toBe(true);
    expect(data.toJSON().options).toHaveLength(12);
    const make = (guildId, clientId = appId) => ({ client: { user: { id: clientId } }, guildId, user: { id: first },
      options: { getSubcommand: () => 'bat-dau' }, reply: vi.fn() });
    const otherGuild = make(STORE_ONE_GUILD_ID);
    await execute(otherGuild);
    expect(otherGuild.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    const correct = make(STORE_TWO_GUILD_ID);
    await execute(correct);
    const [payload] = correct.reply.mock.lastCall;
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.components[0].toJSON().components[0].content).toContain('<:cenar_book:1234567890123456789>');
  });

  it('displays shop inventory and prices and spends once per private card', async () => {
    const shopper = memberId(91);
    bookingCommunity().checkIn(shopper);
    const slash = makeSlash(shopper, memberId(900), 'cua-hang');
    await execute(slash);
    const sections = tree(slash.reply.mock.lastCall[0]).filter(component => component.type === 9);
    expect(sections).toHaveLength(3);
    expect(sections[0].accessory.disabled).toBe(true);
    const food = sections[1];
    expect(food.components[0].content).toContain('**5 điểm**');
    expect(food.accessory).toMatchObject({ label: 'Mua', disabled: false });
    const unrelated = makeButton(memberId(92), memberId(901), food.accessory.custom_id);
    await handleBookingCommunityInteraction(unrelated);
    expect(unrelated.update).not.toHaveBeenCalled();
    expect(bookingCommunity().profile(shopper).points).toBe(10);

    const confirm = makeButton(shopper, memberId(902), food.accessory.custom_id);
    const duplicate = makeButton(shopper, memberId(903), food.accessory.custom_id);
    await Promise.all([handleBookingCommunityInteraction(confirm), handleBookingCommunityInteraction(duplicate)]);
    expect(bookingCommunity().profile(shopper)).toMatchObject({ points: 5, inventory: { 'thuc-an': 1 } });
    expect(confirm.update.mock.lastCall[0].flags).toBe(MessageFlags.IsComponentsV2);
    expect(tree(confirm.update.mock.lastCall[0])[0].content).toContain('Đã thêm');
    expect(duplicate.reply.mock.lastCall[0].content).toContain('đã xử lý lần bấm trước');
  });

  it('renders mission and streak bars with text counts and a Vietnam-midnight reset', () => {
    const context = { owner: first };
    const reset = Date.parse('2026-11-22T17:00:00Z') / 1000;
    const checkIn = tree(communityCheckInCard(context, { status: 'checked-in', points: 14, streak: 5 }, baseTime));
    expect(checkIn[0].content).toContain('+14 điểm');
    expect(checkIn.some(component => component.content?.includes('5/7'))).toBe(true);
    const missions = tree(communityMissionCard(context, [{ label: 'Nhắn tin', count: 2, goal: 3 }], { status: 'incomplete' }, baseTime));
    expect(missions[0].content).toContain('0/1 nhiệm vụ');
    expect(missions.some(component => component.content?.includes('**2/3**'))).toBe(true);
    expect(missions.some(component => component.content?.includes(`<t:${reset}:R>`))).toBe(true);
  });

  it('renders a playable game board and a private modal for word puzzle answers', async () => {
    const player = memberId(93);
    const game = makeSlash(player, memberId(910), 'choi', { tro: 'xuc-xac' });
    await execute(game);
    const diceActions = tree(game.reply.mock.lastCall[0]).at(-1).components;
    expect(diceActions.map(action => action.label)).toEqual(['Cao', 'Thấp']);
    const play = makeButton(player, memberId(911), diceActions[0].custom_id);
    await handleBookingCommunityInteraction(play);
    expect(tree(play.update.mock.lastCall[0]).some(component => component.content?.includes('Ba viên xúc xắc'))).toBe(true);

    const word = makeSlash(player, memberId(912), 'tro-tu', { tro: 'noi-tu' });
    await execute(word);
    const answerAction = tree(word.reply.mock.lastCall[0]).at(-1).components[0];
    expect(answerAction.label).toBe('Nhập đáp án');
    const answer = makeButton(player, memberId(913), answerAction.custom_id);
    await handleBookingCommunityInteraction(answer);
    expect(answer.showModal.mock.lastCall[0].toJSON()).toMatchObject({ custom_id: answerAction.custom_id, title: 'Nối từ' });
    expect(answer.update).not.toHaveBeenCalled();
  });

  it('registers once and awards text XP only in the intended guild, bot and channel', () => {
    const handlers = new Map();
    const client = { user: { id: appId }, isReady: () => false, on: vi.fn((event, handler) => handlers.set(event, handler)), once: vi.fn() };
    registerBookingCommunity(client);
    registerBookingCommunity(client);
    expect(client.once).toHaveBeenCalledTimes(1);
    const text = handlers.get(Events.MessageCreate);
    const sample = { guildId: STORE_TWO_GUILD_ID, channelId: 'room', author: { id: second }, content: 'Chào Cenar' };
    text({ ...sample, guildId: STORE_ONE_GUILD_ID });
    text({ ...sample, channelId: 'ticket' });
    text({ ...sample, webhookId: 'webhook' });
    text({ ...sample, author: { id: second, bot: true } });
    expect(bookingCommunity().profile(second).xp).toBe(0);
    text(sample);
    expect(bookingCommunity().profile(second).xp).toBe(15);
  });
});
