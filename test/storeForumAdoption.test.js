import {Collection} from 'discord.js';
import{beforeEach,describe,expect,it,vi}from'vitest';
const state=vi.hoisted(()=>({row:{guild_id:'1282637033340403754'},publish:vi.fn(),refresh:vi.fn(),upsert:vi.fn()}));
vi.mock('../src/database/db.js',()=>({db:{prepare:()=>({get:()=>state.row,run:vi.fn()}),transaction:fn=>fn}}));
vi.mock('../src/services/guildConfigService.js',()=>({getGuildConfig:()=>({}),upsertGuildConfig:(...x)=>state.upsert(...x)}));
vi.mock('../src/services/boostServerService.js',()=>({refreshBoostPanel:(...x)=>state.refresh(...x)}));
vi.mock('../src/services/premiumProductSetupService.js',()=>({publishPremiumProductsForGuild:(...x)=>state.publish(...x)}));
import{adoptStoreForums}from'../src/services/storeForumAdoptionService.js';
import{STORE_FORUMS}from'../src/config/storeForums202611.js';
import{STORE_SERVICE_FORUM}from'../src/config/storeServiceForum202611.js';
function fixture(){const guild={id:STORE_FORUMS.guildId,channels:{fetch:vi.fn(async id=>{
 if(id===STORE_SERVICE_FORUM.forumId||id===STORE_FORUMS.priceForumId)return{id,type:15};
 if(id===STORE_FORUMS.guidePosts.boost)return{id,parentId:STORE_FORUMS.guideForumId};
 if([STORE_SERVICE_FORUM.feedbackChannelId,STORE_SERVICE_FORUM.completedOrderLogChannelId,STORE_SERVICE_FORUM.orderLogChannelId].includes(id))return{id,type:0,guildId:STORE_FORUMS.guildId};
 const key=Object.keys(STORE_SERVICE_FORUM.posts).find(key=>STORE_SERVICE_FORUM.posts[key]===id);
 return{id,parentId:STORE_SERVICE_FORUM.forumId,name:STORE_SERVICE_FORUM.postNames[key],setName:vi.fn()};
})}};return{guild,client:{guilds:{cache:new Collection([[guild.id,guild]])}}};}
beforeEach(()=>{vi.clearAllMocks();state.refresh.mockResolvedValue({status:'updated'});state.publish.mockResolvedValue({status:'published'});});
describe('required Store1 forum adoption',()=>{
 it('reconciles Locket during the independent verified forum adoption',async()=>{const{client,guild}=fixture();await adoptStoreForums(client);expect(state.publish).toHaveBeenCalledExactlyOnceWith(guild);expect(state.refresh).toHaveBeenCalledExactlyOnceWith(client,guild.id);});
 it('does not publish Locket into an unverified forum layout',async()=>{const{client,guild}=fixture();guild.channels.fetch.mockResolvedValue({type:0});await expect(adoptStoreForums(client)).rejects.toThrow('Store service forum');expect(state.publish).not.toHaveBeenCalled();});
 it('leaves Store2 setup untouched',async()=>{await adoptStoreForums({guilds:{cache:new Collection()}});expect(state.publish).not.toHaveBeenCalled();});
 it('rejects a foreign standalone review channel before adopting settings',async()=>{const{client,guild}=fixture();const fetch=guild.channels.fetch.getMockImplementation();guild.channels.fetch.mockImplementation(async id=>id===STORE_SERVICE_FORUM.feedbackChannelId?{id,type:0,guildId:'foreign'}:fetch(id));await expect(adoptStoreForums(client)).rejects.toThrow('Standalone review/order log');expect(state.publish).not.toHaveBeenCalled();expect(state.upsert).not.toHaveBeenCalled();});
 it('renumbers only the verified retained forum posts',async()=>{const{client,guild}=fixture();const fetch=guild.channels.fetch.getMockImplementation();const retained={id:STORE_SERVICE_FORUM.posts.cards,parentId:STORE_SERVICE_FORUM.forumId,name:'08 · Nạp thẻ & chiết khấu',setName:vi.fn()};guild.channels.fetch.mockImplementation(async id=>id===retained.id?retained:fetch(id));await adoptStoreForums(client);expect(retained.setName).toHaveBeenCalledExactlyOnceWith('06 · Nạp thẻ & chiết khấu');});
});
