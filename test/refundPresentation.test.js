import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/utils/emojiHelper.js',()=>({
  createEmojiResolver:()=>{ const slots=new Map(); return slot=>{ if(!slots.has(slot))slots.set(slot,String(100000000000000000n+BigInt(slots.size))); return `<:test_${slot}:${slots.get(slot)}>`; }; },
  withButtonEmoji:(button,value)=>{ const id=value?.match(/:(\d+)>$/)?.[1]; return id?button.setEmoji({id,name:'test'}):button; },
}));
import { buildRefundOffer, buildRefundPayout } from '../src/services/refundPresentation.js';
import { encrypt } from '../src/utils/crypto.js';
const q={paid:100000,usageDeduction:10000,feeBps:1000,fee:10000,refund:80000,
  start:'2026-01-01T00:00:00Z',end:'2026-04-11T00:00:00Z',cutoff:'2026-01-11T00:00:00Z',usedMs:864000000,totalMs:8640000000,downtimeMs:0};
const base={id:'test-case',guild_id:'123456789012345678',customer_id:'223456789012345678',order_code:'CN_123456',durationMonths:18,
  quote:q,quote_revision:1,active:true,stage:'AWAITING_DETAILS',ticket_notice_channel_id:'323456789012345678'};
const nodes=node=>[node,...(node.components||[]).flatMap(nodes)];
const serialize=payload=>payload.components.map(c=>c.toJSON());
beforeEach(()=>{process.env.ENCRYPTION_KEY='test-refund-presentation-key';});
describe('refund transactional cards',()=>{
  it('serializes native sections with labelled controls, distinct custom artwork and no bank leak',()=>{
    const p=buildRefundOffer({...base,bank_encrypted:'PRIVATE_BANK_PAYLOAD'}),tree=serialize(p),raw=JSON.stringify(tree);
    expect(p.flags).toBe(32768); expect(p).not.toHaveProperty('embeds'); expect(p).not.toHaveProperty('content');
    expect(raw).not.toContain('PRIVATE_BANK_PAYLOAD'); expect(tree).toHaveLength(3);
    const text=tree.flatMap(nodes).filter(n=>n.type===10).map(n=>n.content).join('\n');
    expect(text).toContain('10% giá mua gốc'); expect(text).toContain('80.000');
    const ids=[...text.matchAll(/<a?:\w+:(\d+)>/g)].map(m=>m[1]);
    const buttons=tree.flatMap(nodes).filter(n=>n.type===2);
    ids.push(...buttons.flatMap(n=>n.emoji?.id?[n.emoji.id]:[]));
    expect(ids.length).toBeGreaterThan(9); expect(new Set(ids).size).toBe(ids.length);
    expect(buttons.find(n=>n.custom_id)?.custom_id).toBe('refund:bank:test-case:1');
    expect(buttons.every(n=>n.label.length>0)).toBe(true);
    expect(p.allowedMentions).toEqual({parse:[]});
  });
  it('shows old and proposed amounts without claiming the higher fee has been accepted',()=>{
    const p=buildRefundOffer({...base,accepted_at:'2026-01-12',stage:'READY_TO_PAY',pending_quote_revision:2,
      pendingQuote:{...q,feeBps:3000,fee:30000,refund:60000}});
    const raw=JSON.stringify(serialize(p));
    expect(raw).toContain('80.000'); expect(raw).toContain('60.000'); expect(raw).toContain('30%');
    expect(raw).toContain('vẫn được giữ'); expect(raw).toContain('refund:bank:test-case:2');
  });
  it('keeps exact-owner intake private and only allows an explicit ticket mention when publishing',()=>{
    const p=buildRefundOffer(base,{mentionCustomer:true});
    expect(JSON.stringify(serialize(p))).toContain(`<@${base.customer_id}>`);
    expect(p.allowedMentions).toEqual({users:[base.customer_id],parse:[]});
    expect(JSON.stringify(serialize(buildRefundOffer({...base,stage:'READY_TO_PAY'})))).not.toContain('refund:bank:');
  });
  it('renders QR locally for the accepted amount while identifying a pending higher proposal',async()=>{
    const fetch=vi.fn(()=>{throw new Error('No external bank requests allowed');}); vi.stubGlobal('fetch',fetch);
    const p=await buildRefundPayout({...base,stage:'READY_TO_PAY',accepted_quote_revision:1,
      bank_encrypted:encrypt(JSON.stringify({bankBin:'970422',bankName:'MB',account:'00123456789',name:'NGUYEN VAN A'})),
      pendingQuote:{...q,feeBps:4000,fee:40000,refund:50000}});
    const raw=JSON.stringify(serialize(p));
    expect(raw).toContain('80.000'); expect(raw).toContain('chưa được khách đồng ý');
    expect(raw).toContain('attachment://refund.png'); expect(p.files[0].attachment.subarray(1,4).toString()).toBe('PNG');
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});
