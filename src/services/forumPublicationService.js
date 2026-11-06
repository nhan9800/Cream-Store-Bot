import { ChannelType } from 'discord.js';

export async function listForumPosts(forum) {
  if (forum.type !== ChannelType.GuildForum) throw new Error('Expected a forum channel.');
  const active = await forum.threads.fetchActive();
  const posts = new Map(active.threads);
  let before;
  for (;;) {
    const page = await forum.threads.fetchArchived({ limit: 100, ...(before ? { before } : {}) });
    for (const [id, thread] of page.threads) posts.set(id, thread);
    if (!page.hasMore) break;
    if (posts.size >= 1000 || !page.threads.size) throw new Error('Forum history scan incomplete.');
    before = [...page.threads.values()].at(-1).archiveTimestamp;
  }
  return posts;
}

export async function upsertForumPost(forum, posts, { name, payloads, tagName }) {
  let thread = [...posts.values()].find(post => post.name === name && post.ownerId === forum.client.user.id);
  let startIndex = 0;
  if (!thread) {
    const tag = forum.availableTags.find(item => item.name === tagName);
    thread = await forum.threads.create({
      name, autoArchiveDuration: 10080, ...(tag ? { appliedTags: [tag.id] } : {}),
      message: payloads[0], reason: 'Owner-requested product forum publication',
    });
    posts.set(thread.id, thread);
    startIndex = 1;
  } else {
    if (thread.archived) await thread.setArchived(false);
    const starter = await thread.messages.fetch(thread.id);
    if (starter.author.id !== forum.client.user.id) throw new Error('Forum starter is not owned by this bot.');
    await starter.edit(payloads[0]);
    startIndex = 1;
  }
  // Additional pages are only bot-owned price payloads; never remove customer
  // replies or a guide/history message. Stable titles avoid duplicate posts.
  const messages = await thread.messages.fetch({ limit: 100 });
  const pages = [...messages.values()].filter(message => message.id !== thread.id
    && message.author.id === forum.client.user.id
    && JSON.stringify(message.toJSON()).includes('product:select'))
    .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  for (let index = startIndex; index < payloads.length; index++) {
    if (pages[index - 1]) await pages[index - 1].edit(payloads[index]);
    else await thread.send(payloads[index]);
  }
  for (const page of pages.slice(payloads.length - 1)) await page.delete();
  return thread;
}
