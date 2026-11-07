import { describe, expect, it, vi } from 'vitest';
import { Collection } from 'discord.js';
const mocks=vi.hoisted(()=>({prepare:vi.fn(()=>({all:()=>[{guild_id:'1282637033340403754'}],get:()=>({guild_id:'1282637033340403754'})}))}));
vi.mock('../src/database/db.js',()=>({db:{prepare:mocks.prepare}}));
vi.mock('../src/commands/setup-otp.js',()=>({buildOtpPanel:()=>({components:[]})}));
import { autoSetupCardChannel } from '../src/services/autoSetupCardService.js';
import { autoRefreshOtpPanel } from '../src/services/autoSetupOtpService.js';
import { STORE_SERVICE_FORUM,serviceChannelTarget,serviceMessageTarget } from '../src/config/storeServiceForum202611.js';
describe('store forum maintenance',()=>{
  it('routes new settings to posts without rewriting another store',()=>{
    expect(serviceChannelTarget(STORE_SERVICE_FORUM.guildId,'1530821462590492672')).toBe(STORE_SERVICE_FORUM.posts.cards);
    expect(serviceMessageTarget(STORE_SERVICE_FORUM.guildId,'1530830079788060763')).toMatch(/^\d+$/);
    expect(serviceChannelTarget('1070676180103086132','1530821462590492672')).toBe('1530821462590492672');
    expect(serviceChannelTarget(STORE_SERVICE_FORUM.guildId,'1568256315669618708')).toBe('1515008584549797979');
    expect(serviceChannelTarget(STORE_SERVICE_FORUM.guildId,'1515008584549797979')).toBe('1515008584549797979');
    expect(serviceChannelTarget(STORE_SERVICE_FORUM.guildId,'1514607026247045121')).toBe('1514607026247045121');
    expect(serviceMessageTarget(STORE_SERVICE_FORUM.guildId,'1568256315669618708')).toBe('1568092041366216796');
    expect(STORE_SERVICE_FORUM.posts).not.toHaveProperty('promotion');
  });
  it('edits the shared card starter while preserving the discount board and other replies',async()=>{
    const card={id:'card',author:{id:'bot'},toJSON:()=>({content:'CENAR CARD CENTER'}),edit:vi.fn().mockResolvedValue({}),delete:vi.fn()};
    const discount={id:'discount',author:{id:'bot'},toJSON:()=>({content:'BẢNG CHIẾT KHẤU'}),edit:vi.fn(),delete:vi.fn()};
    const post={id:STORE_SERVICE_FORUM.posts.cards,name:'08 · Nạp thẻ & chiết khấu',messages:{fetch:vi.fn().mockResolvedValue(new Collection([['card',card],['discount',discount]]))},send:vi.fn()};
    const guild={id:STORE_SERVICE_FORUM.guildId,channels:{fetch:vi.fn().mockResolvedValue(post),create:vi.fn(),cache:new Collection()}};
    const client={user:{id:'bot'},guilds:{fetch:vi.fn().mockResolvedValue(guild)}};
    await autoSetupCardChannel(client);
    expect(guild.channels.fetch).toHaveBeenCalledWith(STORE_SERVICE_FORUM.posts.cards);
    expect(card.edit).toHaveBeenCalledOnce();expect(post.send).not.toHaveBeenCalled();
    expect(discount.edit).not.toHaveBeenCalled();expect(discount.delete).not.toHaveBeenCalled();expect(card.delete).not.toHaveBeenCalled();
  });
  it('refreshes OTP in the forum instead of the archived text channel',async()=>{
    const panel={author:{id:'bot'},components:[{toJSON:()=>({custom_id:'otp:open_menu'})}],flags:new Set([32768]),edit:vi.fn().mockResolvedValue({})};
    const post={id:STORE_SERVICE_FORUM.posts.sim,messages:{fetch:vi.fn().mockResolvedValue(new Collection([['panel',panel]]))}};
    const guild={id:STORE_SERVICE_FORUM.guildId,channels:{fetch:vi.fn().mockResolvedValue(post),cache:new Collection([['old',{name:'thuê-sim-online',isTextBased:()=>true}]])}};
    const client={user:{id:'bot'},guilds:{cache:new Collection([[guild.id,guild]])}};
    await autoRefreshOtpPanel(client);
    expect(guild.channels.fetch).toHaveBeenCalledWith(STORE_SERVICE_FORUM.posts.sim);
    expect(panel.edit).toHaveBeenCalledOnce();
  });
});
