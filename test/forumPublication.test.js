import { describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection } from 'discord.js';
import { listForumPosts, upsertForumPost } from '../src/services/forumPublicationService.js';

describe('forum publication', () => {
  it('finds active and older archived posts before publishing', async () => {
    const archived = { id:'old', archiveTimestamp:123 };
    const forum = { type:ChannelType.GuildForum, threads:{
      fetchActive:vi.fn().mockResolvedValue({threads:new Collection([['new',{id:'new'}]])}),
      fetchArchived:vi.fn().mockResolvedValueOnce({threads:new Collection([['old',archived]]),hasMore:true})
        .mockResolvedValueOnce({threads:new Collection(),hasMore:false}),
    } };
    expect([...await listForumPosts(forum)].map(([id])=>id)).toEqual(['new','old']);
    expect(forum.threads.fetchArchived).toHaveBeenLastCalledWith({limit:100,before:123});
  });

  it('updates a stable post on retries, unarchives it and preserves unrelated replies', async () => {
    const starter = {author:{id:'bot'},edit:vi.fn()};
    const human = {id:'101',author:{id:'customer'},toJSON:()=>({content:'Question'}),delete:vi.fn()};
    const page = {id:'102',author:{id:'bot'},toJSON:()=>({custom_id:'product:select'}),edit:vi.fn(),delete:vi.fn()};
    const thread = {id:'100',name:'02 · Discord Server Boost',ownerId:'bot',archived:true,
      setArchived:vi.fn(), messages:{fetch:vi.fn(arg=>Promise.resolve(typeof arg==='string'?starter:new Collection([['101',human],['102',page]])))},send:vi.fn()};
    const forum={client:{user:{id:'bot'}},availableTags:[],threads:{create:vi.fn()}};
    const posts = new Map([[thread.id,thread]]);
    await upsertForumPost(forum,posts,{name:thread.name,payloads:[{components:[]}],tagName:'Discord'});
    expect(forum.threads.create).not.toHaveBeenCalled();
    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(starter.edit).toHaveBeenCalledOnce();
    expect(page.delete).toHaveBeenCalledOnce();
    expect(human.delete).not.toHaveBeenCalled();
  });

  it('creates exactly one native post with its custom-emoji tag', async () => {
    const thread={id:'100',messages:{fetch:vi.fn().mockResolvedValue(new Collection())}};
    const forum={client:{user:{id:'bot'}},availableTags:[{id:'tag',name:'Discord'}],threads:{create:vi.fn().mockResolvedValue(thread)}};
    const payload={components:[],allowedMentions:{parse:[]}};
    const posts=new Map();
    await upsertForumPost(forum,posts,{name:'02 · Discord Server Boost',payloads:[payload],tagName:'Discord'});
    expect(forum.threads.create).toHaveBeenCalledWith(expect.objectContaining({message:payload,appliedTags:['tag']}));
    expect(posts.get('100')).toBe(thread);
  });
});
