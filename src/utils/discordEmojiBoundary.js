import { config } from '../config.js';
import { resolveLiveCustomEmoji, sanitizeCustomEmojiText } from '../services/emojiService.js';

const installed = Symbol('cenar.liveEmojiBoundary');
const CUSTOM_TOKEN = /<a?:[A-Za-z0-9_]+:\d+>/g;
function componentEmoji(value,guildId) {
  const live = resolveLiveCustomEmoji(value,guildId);
  const match = live.match(/^<(a?):([A-Za-z0-9_]+):(\d+)>$/);
  return match ? {id:match[3],name:match[2],animated:match[1]==='a'} : null;
}
export function normalizeMessagePresentation(payload,guildId) {
  if (!payload || typeof payload !== 'object') return payload;
  const text = value => typeof value === 'string' ? sanitizeCustomEmojiText(guildId,value) : value;
  const component = value => {
    const item = value?.toJSON?.() || value;
    if (!item || typeof item !== 'object') return item;
    const result = {...item};
    if (typeof result.content === 'string') result.content=text(result.content);
    if (typeof result.description === 'string') result.description=text(result.description);
    // Discord labels cannot render custom emoji markup; emoji is a separate
    // field. Values/custom_ids are protocol data and are never rewritten.
    for (const key of ['label','placeholder']) if (typeof result[key]==='string') result[key]=text(result[key]).replace(CUSTOM_TOKEN,'').trim();
    if (result.emoji) {
      const emoji=componentEmoji(result.emoji,guildId);
      if (emoji) result.emoji=emoji; else delete result.emoji;
    }
    if (result.components) result.components=result.components.map(component);
    if (result.options) result.options=result.options.map(option=>component(option));
    if (result.accessory) result.accessory=component(result.accessory);
    return result;
  };
  const embed = value => {
    const item=value?.toJSON?.() || value;
    const result={...item};
    for (const key of ['title','description']) if (typeof result[key]==='string') result[key]=text(result[key]);
    if (result.fields) result.fields=result.fields.map(field=>({...field,name:text(field.name),value:text(field.value)}));
    if (result.footer) result.footer={...result.footer,text:text(result.footer.text)};
    if (result.author) result.author={...result.author,name:text(result.author.name)};
    return result;
  };
  return {
    ...payload,
    ...(typeof payload.content==='string'?{content:text(payload.content)}:{}),
    ...(payload.embeds?{embeds:payload.embeds.map(embed)}:{}),
    ...(payload.components?{components:payload.components.map(component)}:{}),
  };
}
export function installDiscordEmojiBoundary(client) {
  if (!client?.rest?.request || client.rest[installed]) return false;
  const original=client.rest.request;
  client.rest.request=function(options) {
    const route=String(options?.fullRoute || '');
    const method=String(options?.method || '').toUpperCase();
    const channel=route.match(/^\/channels\/(\d+)\/messages(?:\/\d+)?(?:\?|$)/);
    const callback=/^\/interactions\/\d+\/[^/]+\/callback(?:\?|$)/.test(route);
    const webhook=(method==='POST' && /^\/webhooks\/\d+\/[^/]+(?:\?|$)/.test(route))
      || (method==='PATCH' && /^\/webhooks\/\d+\/[^/]+\/messages\/[^/]+(?:\?|$)/.test(route));
    if (!['POST','PATCH'].includes(method) || (!channel&&!callback&&!webhook) || !options.body) return original.call(this,options);
    if (callback && ![4,7].includes(Number(options.body.type))) return original.call(this,options);
    const guildId=(channel && client.channels?.cache?.get(channel[1])?.guildId) || config.guildId;
    const body=callback ? {...options.body,data:normalizeMessagePresentation(options.body.data,guildId)}
      : normalizeMessagePresentation(options.body,guildId);
    return original.call(this,{...options,body});
  };
  client.rest[installed]=true;
  return true;
}
