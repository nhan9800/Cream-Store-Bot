import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: {}, owner: vi.fn(), submit: vi.fn(), preview: vi.fn(), apply: vi.fn(),
  cases: vi.fn(), offer: vi.fn(), payout: vi.fn(), capability: vi.fn(), getCase: vi.fn(), claim: vi.fn(), finish: vi.fn() }));
vi.mock('../src/database/db.js', () => ({ db: mocks.db }));
vi.mock('../src/services/geminiRefundService.js', async importOriginal => ({ ...(await importOriginal()),
  requireRefundOwner: mocks.owner, submitRefundBank: mocks.submit, previewGeminiRefunds: mocks.preview,
  applyGeminiRefunds: mocks.apply, ensureRefundCases: mocks.cases, getRefundCase: mocks.getCase,
  claimRefundNotice: mocks.claim, finishRefundNotice: mocks.finish }));
vi.mock('../src/services/refundPresentation.js', () => ({ buildRefundOffer: mocks.offer, buildRefundPayout: mocks.payout }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({}) }));
vi.mock('../src/utils/permissions.js', () => ({ assertStaffCapability: mocks.capability }));
vi.mock('../src/services/notificationService.js', () => ({ updateOrderLogMessage: vi.fn() }));
import { GeminiRefundError } from '../src/services/geminiRefundService.js';
import { handleRefundInteraction, resolveRefundBank } from '../src/events/refundHandlers.js';
import { execute as manager } from '../src/commands/gemini-refund.js';
import { execute as customer } from '../src/commands/hoan-tien.js';

const interaction = (extra = {}) => ({ customId: 'refund:bank:test-case', user: { id: 'buyer' }, guildId: 'shop',
  guild: { members: { fetch: vi.fn().mockResolvedValue({}) } },
  reply: vi.fn(), editReply: vi.fn(), showModal: vi.fn(), deferReply: vi.fn(),
  isButton: () => true, isModalSubmit: () => false, options: { getString: key => ({ ma_don: 'CN_123456', hanh_dong: 'PREVIEW' })[key] },
  ...extra });
beforeEach(() => { vi.clearAllMocks(); mocks.capability.mockReturnValue(true); mocks.owner.mockReturnValue({ guild_id: 'shop',quote_revision:1,quote:{feeBps:3000,refund:60000} }); mocks.offer.mockReturnValue({ content: 'private offer' }); });
describe('refund UI privacy and authorization', () => {
  it('opens a four-field modal only after checking the actual customer', async () => {
    const i = interaction(); await handleRefundInteraction(i);
    expect(mocks.owner).toHaveBeenCalledWith(mocks.db, 'test-case', 'buyer');
    expect(i.showModal.mock.lastCall[0].toJSON().components).toHaveLength(4);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('rejects a forged button and keeps the reply private', async () => {
    mocks.owner.mockImplementationOnce(() => { throw new GeminiRefundError('Không tìm thấy hồ sơ'); });
    const i = interaction(); await handleRefundInteraction(i);
    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith({ content: 'Không tìm thấy hồ sơ', ephemeral: true });
  });
  it('rejects an old modal before reading bank fields when a newer proposal is pending', async () => {
    mocks.owner.mockReturnValueOnce({quote_revision:1,pending_quote_revision:2,quote:{feeBps:1000,refund:80000},pendingQuote:{feeBps:3000,refund:60000}});
    const getTextInputValue=vi.fn();
    const i=interaction({customId:'refund:submit:test-case:1',isButton:()=>false,isModalSubmit:()=>true,fields:{getTextInputValue}});
    await handleRefundInteraction(i);
    expect(getTextInputValue).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
    expect(i.reply.mock.lastCall[0]).toMatchObject({ephemeral:true,content:expect.stringContaining('Bảng tính đã cập nhật')});
  });
  it('opens only the current proposal with its exact percentage and amount in acceptance', async () => {
    mocks.owner.mockReturnValueOnce({stage:'READY_TO_PAY',quote_revision:1,pending_quote_revision:2,
      quote:{feeBps:1000,refund:80000},pendingQuote:{feeBps:4000,refund:50000}});
    const i=interaction({customId:'refund:bank:test-case:2'}); await handleRefundInteraction(i);
    const modal=i.showModal.mock.lastCall[0].toJSON();
    expect(modal.custom_id).toBe('refund:submit:test-case:2');
    expect(modal.components[3].components[0].label).toBe('Đồng ý 40% & hoàn 50.000đ');
  });
  it('returns the ready accepted card privately without reopening intake', async () => {
    mocks.owner.mockReturnValueOnce({stage:'READY_TO_PAY',quote_revision:1,quote:{feeBps:1000,refund:80000}});
    const i=interaction(); await handleRefundInteraction(i);
    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply.mock.lastCall[0].flags).toBe(32768|64);
  });
  it('acknowledges a modal privately before storing details, with no channel message', async () => {
    const fields = { bank: 'MB', account: '00123456789', name: 'NGUYEN VAN A', accept: 'ĐỒNG Ý' };
    mocks.submit.mockReturnValue({ stage: 'READY_TO_PAY' });
    const i = interaction({ customId: 'refund:submit:test-case', isButton: () => false, isModalSubmit: () => true,
      fields: { getTextInputValue: id => fields[id] } });
    await handleRefundInteraction(i);
    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(mocks.submit.mock.lastCall[1]).toMatchObject({ customerId: 'buyer', bank: { bin: '970422' }, account: '00123456789' });
    expect(i.editReply).toHaveBeenCalledWith({ content: 'private offer' });
  });
  it('does not expose internal errors, even if an exception contains sensitive input', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.owner.mockImplementationOnce(() => { throw new Error('bank secret 00123456789'); });
    const i = interaction(); await handleRefundInteraction(i);
    expect(JSON.stringify(i.reply.mock.calls)).not.toContain('00123456789');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('00123456789'); spy.mockRestore();
  });
  it('requires runtime manager authority before preview or writes', async () => {
    mocks.capability.mockReturnValue(false); const i = interaction(); await manager(i);
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });
  it.each(['FEE_PREVIEW','FEE_APPLY','REFRESH'])('blocks %s before accessing cases for a non-manager', async action => {
    mocks.capability.mockReturnValue(false);
    await manager(interaction({options:{getString:()=>action}}));
    expect(mocks.cases).not.toHaveBeenCalled(); expect(mocks.getCase).not.toHaveBeenCalled();
  });
  it('offers a private same-shop command when DMs are blocked', async () => {
    const i = interaction(); await customer(i);
    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(mocks.owner).toHaveBeenCalledWith(mocks.db, 'CN_123456', 'buyer');
    mocks.owner.mockReturnValueOnce({ guild_id: 'another-shop' });
    await customer(interaction()); expect(mocks.offer).toHaveBeenCalledTimes(1);
  });
  it('uses the known public bank directory without guessing ambiguous bank names', () => {
    expect(resolveRefundBank('VCB').bin).toBe('970436');
    expect(resolveRefundBank('not a bank')).toBeUndefined();
  });
  it('stops the whole DM batch on Discord 20026, without further requests or retries', async () => {
    mocks.db.prepare = () => ({ all: () => [{ id: 'a' }, { id: 'b' }] });
    mocks.getCase.mockImplementation((_db, id) => ({ id, order_code: `CN_${id}`, customer_id: id, active: true, notice_state: 'UNSENT',
      productName: 'Gemini', durationMonths: 18, durationDays: null, refundFromStatus: 'WARRANTY_OPEN' }));
    mocks.claim.mockReturnValue(true);
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error('restricted'), { code: 20026 }));
    const i = interaction({ client: { users: { fetch } }, options: { getString: () => 'NOTIFY' } });
    await manager(i);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith(mocks.db, 'a', null, true);
    await manager(i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
