import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

const publish = vi.hoisted(() => vi.fn());
vi.mock('../src/services/announcementService.js', async original => ({
  ...await original(), publishAnnouncement: publish,
}));
import { buildAnnouncementModal, createAnnouncementDraft, handleAnnouncementDraftInteraction } from '../src/services/announcementDraftService.js';
import { registerInteractionHandler } from '../src/events/interactionCreate.js';

let sequence = 100;
const image = { id: '123456789012345680', name: 'sale.png', contentType: 'image/png',
  url: 'https://cdn.discordapp.com/attachments/1/2/sale.png' };
function interaction(customId, overrides = {}) {
  const value = {
    id: String(123456789012345000n + BigInt(sequence++)), guildId: '1282637033340403754',
    channelId: '1514598369597587546', guild: { id: '1282637033340403754' },
    user: { id: 'owner', tag: 'owner' }, memberPermissions: { has: () => true }, customId,
    values: [], message: { id: 'preview', components: [] },
    isButton: () => true, isModalSubmit: () => false, isRoleSelectMenu: () => false,
    isFromMessage: () => true,
    fields: { getTextInputValue: () => 'Lịch hỗ trợ cuối tuần' },
    reply: vi.fn(async () => {}), followUp: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}), showModal: vi.fn(async () => {}),
    deferUpdate: vi.fn(async () => { value.deferred = true; }),
    deferReply: vi.fn(async () => { value.deferred = true; }),
    ...overrides,
  };
  return value;
}
async function draftWithContent(attachment = null) {
  const draft = createAnnouncementDraft(interaction(), attachment);
  await handleAnnouncementDraftInteraction(interaction(buildAnnouncementModal(draft).data.custom_id,
    { isButton: () => false, isModalSubmit: () => true, isFromMessage: () => false }));
  return draft;
}
function confirm(draft, overrides) { return interaction(`announcement:confirm:${draft.id}`, overrides); }
const published = () => ({ channel: { id: '1514598369597587546' }, message: { id: '123456789012345681' } });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); publish.mockReset(); });

describe('/thongbao interaction lifecycle', () => {
  it('routes confirm before the general button cooldown and acknowledges before publication', async () => {
    const draft = await draftWithContent();
    const press = confirm(draft);
    publish.mockImplementation(async () => { expect(press.deferred).toBe(true); return published(); });
    const listeners = new Map();
    registerInteractionHandler({ on: (name, fn) => listeners.set(name, fn) }, new Map());
    await listeners.get('interactionCreate')(press);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].nonce).toBe(draft.id);
  });

  it('does not send if acknowledgment fails and releases the lock for the next click', async () => {
    const draft = await draftWithContent();
    publish.mockResolvedValue(published());
    const press = confirm(draft, { deferUpdate: vi.fn(async () => { throw Object.assign(new Error('expired'), { code: 10062 }); }) });
    await handleAnnouncementDraftInteraction(press);
    expect(publish).not.toHaveBeenCalled();
    expect(draft.publishing).toBe(false);
    await handleAnnouncementDraftInteraction(confirm(draft));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('keeps one send while double clicking and after a failed success receipt', async () => {
    const draft = await draftWithContent();
    let complete;
    publish.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const first = confirm(draft, { editReply: vi.fn(async () => { throw new Error('webhook timeout'); }) });
    const running = handleAnnouncementDraftInteraction(first);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    const second = confirm(draft);
    await handleAnnouncementDraftInteraction(second);
    expect(second.reply).toHaveBeenCalled();
    complete(published());
    await running;
    await handleAnnouncementDraftInteraction(confirm(draft));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(draft.result.message.id).toBe('123456789012345681');
  });

  it('preserves image and role choices through edits, using the same preview and draft', async () => {
    const draft = await draftWithContent(image);
    const role = '1282638730812854345';
    await handleAnnouncementDraftInteraction(interaction(`announcement:roleselect:${draft.id}`, {
      isRoleSelectMenu: () => true, isButton: () => false, values: [role],
    }));
    await handleAnnouncementDraftInteraction(interaction(`announcement:toggle_here:${draft.id}`));
    const edit = interaction(`announcement:edit:${draft.id}`);
    await handleAnnouncementDraftInteraction(edit);
    const modalId = edit.showModal.mock.calls[0][0].data.custom_id;
    const submit = interaction(modalId, { isModalSubmit: () => true, isButton: () => false,
      fields: { getTextInputValue: () => 'Nội dung đã sửa' } });
    await handleAnnouncementDraftInteraction(submit);
    expect(submit.deferUpdate).toHaveBeenCalled();
    expect(submit.deferReply).not.toHaveBeenCalled();
    expect(draft.roles).toEqual([role]);
    expect(draft.tagHere).toBe(true);
    expect(draft.image.url).toBe(image.url);
    expect(draft.content).toBe('Nội dung đã sửa');
    const stale = interaction(modalId, { isModalSubmit: () => true, isButton: () => false });
    await handleAnnouncementDraftInteraction(stale);
    expect(stale.reply.mock.calls[0][0].content).toContain('cửa sổ khác');
  });

  it('rebuilds a usable preview after a known rejection; selection no longer needs old embeds', async () => {
    const draft = await draftWithContent(image);
    publish.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403, code: 50013 }));
    const failed = confirm(draft);
    await handleAnnouncementDraftInteraction(failed);
    expect(failed.editReply.mock.calls.at(-1)[0].embeds).toHaveLength(1);
    const select = interaction(`announcement:roleselect:${draft.id}`, {
      message: { embeds: [], components: [] }, isRoleSelectMenu: () => true,
      values: ['1282638730812854345'],
    });
    await handleAnnouncementDraftInteraction(select);
    expect(select.editReply.mock.calls[0][0].embeds[0].data.image.url).toBe(image.url);
    publish.mockResolvedValueOnce(published());
    await handleAnnouncementDraftInteraction(confirm(draft));
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('reuses the nonce for immediate uncertain retries and refuses a late blind resend', async () => {
    vi.useFakeTimers();
    const draft = await draftWithContent();
    publish.mockImplementation(async options => { options.onSend(); throw new Error('socket closed'); });
    await handleAnnouncementDraftInteraction(confirm(draft));
    const edit = interaction(`announcement:edit:${draft.id}`);
    await handleAnnouncementDraftInteraction(edit);
    expect(edit.showModal).not.toHaveBeenCalled();
    await handleAnnouncementDraftInteraction(confirm(draft));
    expect(publish.mock.calls.map(([options]) => options.nonce)).toEqual([draft.id, draft.id]);
    vi.advanceTimersByTime(91_000);
    await handleAnnouncementDraftInteraction(confirm(draft));
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('isolates simultaneous drafts and rejects wrong users, lost permissions and expired controls', async () => {
    const first = await draftWithContent(image);
    const second = await draftWithContent();
    expect(second.image).toBeNull();
    const foreign = confirm(first, { user: { id: 'other' } });
    await handleAnnouncementDraftInteraction(foreign);
    const unprivileged = confirm(first, { memberPermissions: { has: () => false } });
    await handleAnnouncementDraftInteraction(unprivileged);
    expect(publish).not.toHaveBeenCalled();
    vi.useFakeTimers();
    vi.advanceTimersByTime(16 * 60_000);
    const expired = confirm(first);
    await handleAnnouncementDraftInteraction(expired);
    expect(expired.reply.mock.calls[0][0].content).toContain('hết hạn');
    expect(() => createAnnouncementDraft(interaction(undefined, { memberPermissions: { has: () => false } })))
      .toThrow('Quản Lý Tin Nhắn');
  });

  it('never mentions members in previews and requires mention permission for mass tags', async () => {
    const draft = await draftWithContent();
    const press = interaction(`announcement:toggle_everyone:${draft.id}`, {
      memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageMessages },
    });
    await handleAnnouncementDraftInteraction(press);
    expect(draft.tagEveryone).toBe(false);
    expect(press.reply.mock.calls[0][0].allowedMentions.parse).toEqual([]);
  });
});
