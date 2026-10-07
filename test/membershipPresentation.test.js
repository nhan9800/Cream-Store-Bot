import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, MessageFlags } from 'discord.js';
vi.hoisted(()=>{process.env.ENV_FILE='.env.membership-test-absent';process.env.DATABASE_PATH=`./data/test-membership-${process.pid}.sqlite`;});
import { db, initDatabase } from '../src/database/db.js';
import { MEMBER_ROLES, BUYER_TIERS, membershipPriorityForSpend } from '../src/config/membershipProgram.js';
import { roleColorsFor } from '../src/config/roleColors.js';
import { buildMembershipBenefitsPayload, refreshMembershipPresentation, rolePresentationPatch } from '../src/services/membershipPresentationService.js';
import { getCustomerMembershipProgress } from '../src/services/roleService.js';

function setup() {
  const cache=new Collection();
  const live=new Collection();
  let sequence=100;
  const emojis={cache,fetch:vi.fn(async()=>new Collection(live)),create:vi.fn(async({name})=>{
    const emoji={id:`${sequence++}`,name};live.set(emoji.id,emoji);cache.set(emoji.id,emoji);return emoji;
  })};
  const roleCache=new Collection(MEMBER_ROLES.map(tier=>{
    const role={id:tier.id,name:'Previous name',editable:true,managed:false,position:10,permissions:'0',color:0,icon:'old'};
    role.edit=vi.fn(async patch=>{
      Object.assign(role,patch,{icon:patch.icon ? `new-${tier.key}` : role.icon});
      if(patch.colors) role.colors=Object.fromEntries(Object.entries(patch.colors).map(([key,value])=>[key,value ? parseInt(value.slice(1),16) : null]));
      return role;
    });
    return [role.id,role];
  }));
  const message={id:'board',url:'https://discord.com/channels/1282637033340403754/channel/board',author:{id:'bot'},flags:new Set([MessageFlags.IsComponentsV2]),edit:vi.fn(async()=>message)};
  const channel={id:'channel',type:0,name:'đặc-quyền-thành-viên',messages:{fetch:vi.fn(async input=>typeof input==='string' ? message : new Collection())},send:vi.fn(async()=>message)};
  const guild={id:'1282637033340403754',features:['ROLE_ICONS','ENHANCED_ROLE_COLORS'],roles:{cache:roleCache,fetch:vi.fn()},members:{fetchMe:vi.fn(async()=>({permissions:{has:()=>true}}))},channels:{fetch:vi.fn(async()=>new Collection([[channel.id,channel]])),create:vi.fn(async()=>channel)}};
  const client={user:{id:'bot'},application:{emojis},guilds:{fetch:vi.fn(async()=>guild)}};
  return {client,guild,roleCache,channel,message,emojis,live};
}
beforeAll(()=>initDatabase());
beforeEach(()=>db.prepare("DELETE FROM system_settings WHERE key LIKE 'membership_presentation:%'").run());
afterAll(()=>{const file=db.name;db.close();for(const suffix of ['', '-wal','-shm']) fs.rmSync(file+suffix,{force:true});});

describe('Cenar Circle preserves paid customer roles',()=>{
  it('keeps the historical keys, IDs and spending boundaries in role, web and order priority',()=>{
    expect(BUYER_TIERS.map(t=>[t.key,t.id,t.minSpent])).toEqual([
      ['ruby','1282637775291551776',8000000],['diamond','1282637814571466808',5000000],
      ['elite','1282637470139420694',3000000],['vip','1282637168149532724',1000000],['active','1282637103045279820',0],
    ]);
    for(const [spent,key,rank] of [[999999,'active',0],[1000000,'vip',100],[2999999,'vip',100],[3000000,'elite',200],[5000000,'diamond',300],[8000000,'ruby',400]]){
      expect(getCustomerMembershipProgress({total_spent:spent}).current.key).toBe(key);
      expect(membershipPriorityForSpend(spent)).toBe(rank);
    }
  });
  it('fits Discord component/text limits, gives every tier one matching threshold, and never pings roles',()=>{
    const payload=buildMembershipBenefitsPayload(null,'1282637033340403754');
    const json=payload.components.map(c=>c.toJSON());
    const text=json.flatMap(c=>c.components.filter(item=>item.content).map(item=>item.content)).join('\n');
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(json.reduce((sum,c)=>sum+1+c.components.length,0)).toBeLessThanOrEqual(40);
    expect(payload.allowedMentions).toEqual({parse:[]});
    expect(text).not.toMatch(/15%|24\/7|x3|< 5 phút/);
    for(const tier of MEMBER_ROLES) expect(text.split(`<@&${tier.id}>`)).toHaveLength(2);
  });
  it('only changes appearance and clears enhanced colors when the perk is absent',()=>{
    const patch=rolePresentationPatch({name:'Previous',colors:{primaryColor:1,secondaryColor:2,tertiaryColor:3}},MEMBER_ROLES[0],{enhanced:false,roleIcons:false});
    expect(Object.keys(patch).sort()).toEqual(['colors','name']);
    expect(patch.colors).toEqual({primaryColor:roleColorsFor(MEMBER_ROLES[0].id).primaryColor,secondaryColor:null,tertiaryColor:null});
  });
  it('refreshes all six icons and colors once, preserves hierarchy/access, and reuses one guide',async()=>{
    const s=setup();
    const results=await Promise.all([refreshMembershipPresentation(s.client,{guildId:s.guild.id}),refreshMembershipPresentation(s.client,{guildId:s.guild.id})]);
    expect(results[0]).toMatchObject({status:'ready',verified:6,updated:6,enhanced:true});
    expect(s.emojis.create).toHaveBeenCalledTimes(6);
    expect(s.channel.send).toHaveBeenCalledOnce();
    for(const role of s.roleCache.values()){
      expect(Object.keys(role.edit.mock.calls[0][0]).sort()).toEqual(['colors','icon','name','reason']);
      expect(role.permissions).toBe('0');expect(role.position).toBe(10);
    }
    expect(await refreshMembershipPresentation(s.client,{guildId:s.guild.id})).toMatchObject({updated:0,verified:6});
    expect(s.emojis.create).toHaveBeenCalledTimes(6);expect(s.channel.send).toHaveBeenCalledOnce();
    expect(s.message.edit).toHaveBeenCalledOnce();
  });
  it('replaces a deleted application badge instead of keeping a stale cached emoji',async()=>{
    const s=setup();await refreshMembershipPresentation(s.client,{guildId:s.guild.id});
    const removed=[...s.live.values()][0];s.live.delete(removed.id);
    await refreshMembershipPresentation(s.client,{guildId:s.guild.id});
    expect(s.emojis.cache.has(removed.id)).toBe(false);
    expect(s.emojis.create).toHaveBeenCalledTimes(7);
  });
  it('leaves uneditable roles intact and never edits an unrelated guild',async()=>{
    const s=setup();const role=s.roleCache.values().next().value;role.editable=false;
    await expect(refreshMembershipPresentation(s.client,{guildId:s.guild.id})).rejects.toThrow('MEMBERSHIP_ROLE_NOT_EDITABLE');
    expect(role.edit).not.toHaveBeenCalled();expect(s.channel.send).not.toHaveBeenCalled();
    expect(await refreshMembershipPresentation(s.client,{guildId:'987654321098765432'})).toMatchObject({status:'not_configured'});
  });
});
