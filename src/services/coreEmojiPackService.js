import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORE_UI_EMOJI_ASSETS, CORE_UI_EMOJI_REVISION } from '../config/coreEmojiPack2026.js';
import { applyVerifiedEmojiMappings, autoSyncGuildEmojis, EMOJI_SLOTS } from './emojiService.js';
import { config } from '../config.js';

const assetRoot = fileURLToPath(new URL('../../assets/emojis/ui26/', import.meta.url));
const states = new WeakMap();
let latestClient = null;
const errorCode = (error) => /^\d{3,6}$/.test(String(error?.code || '')) ? String(error.code) : 'CORE_EMOJI_SYNC_FAILED';

function stateFor(client) {
  if (!states.has(client)) states.set(client,{status:'not_started',revision:CORE_UI_EMOJI_REVISION,expected:CORE_UI_EMOJI_ASSETS.length,available:0,created:0,failures:0,lastError:null,readyAt:null,refreshPending:true,promise:null,maintenancePromise:null,timer:null});
  latestClient = client;
  return states.get(client);
}
export function getCoreEmojiPackStatus(client = latestClient) {
  if (!client) return {status:'not_started',revision:CORE_UI_EMOJI_REVISION,expected:CORE_UI_EMOJI_ASSETS.length,available:0};
  const {promise,timer,maintenancePromise,...summary} = stateFor(client);
  return summary;
}
export function syncCoreEmojiPack(client,{guildId=config.guildId}={}) {
  const state = stateFor(client);
  if (state.promise) return state.promise;
  state.promise = (async () => {
    state.status='syncing';
    try {
      for (const asset of CORE_UI_EMOJI_ASSETS) {
        const path = `${assetRoot}${asset.fileName}`;
        const size = fs.statSync(path).size;
        if (!size || size > 256*1024) throw new Error('INVALID_CORE_EMOJI_ASSET');
      }
      if (!client.isReady?.() || !client.application?.emojis) throw new Error('APPLICATION_EMOJIS_UNAVAILABLE');
      const appInventory = await client.application.emojis.fetch();
      // ApplicationEmojiManager.fetch() adds live records but does not evict
      // records removed through the Developer Portal. Reconcile that cache.
      for (const id of client.application.emojis.cache.keys()) {
        if (!appInventory.has(id)) client.application.emojis.cache.delete(id);
      }
      const created = new Map();
      for (const asset of CORE_UI_EMOJI_ASSETS) {
        let emoji = client.application.emojis.cache.find(item => item.name === asset.name);
        if (!emoji) {
          emoji = await client.application.emojis.create({name:asset.name,attachment:`${assetRoot}${asset.fileName}`});
          state.created++;
        }
        created.set(asset.name,emoji);
      }
      const guild=client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
      if (!guild || String(guild.id)!==String(guildId)) throw new Error('CORE_GUILD_UNAVAILABLE');
      {
        const guildInventory = await guild.emojis.fetch();
        for (const id of guild.emojis.cache.keys()) {
          if (!guildInventory.has(id)) guild.emojis.cache.delete(id);
        }
        const mappings = Object.fromEntries(CORE_UI_EMOJI_ASSETS.flatMap(asset => asset.slots
          .filter(slot=>EMOJI_SLOTS[slot]).map(slot => [slot,created.get(asset.name)])));
        applyVerifiedEmojiMappings(guild,mappings);
        autoSyncGuildEmojis(guild,{pruneStale:true});
      }
      state.available=created.size;
      state.status='ready';
      state.lastError=null;
      state.readyAt=new Date().toISOString();
      return getCoreEmojiPackStatus(client);
    } catch (error) {
      state.status='retry_required';
      state.failures++;
      state.lastError=errorCode(error);
      throw error;
    }
  })().finally(()=>{state.promise=null;});
  return state.promise;
}
export function startCoreEmojiMaintenance(client,{afterSync = async () => {},guildId=config.guildId} = {}) {
  const state = stateFor(client);
  if (state.timer) return state.maintenancePromise || state.promise || Promise.resolve(getCoreEmojiPackStatus(client));
  const tick = async () => {
    try {
      const priorCreated = state.created;
      const wasReady = state.readyAt;
      await syncCoreEmojiPack(client,{guildId});
      if (!wasReady || state.created !== priorCreated) state.refreshPending=true;
      if (state.refreshPending) {
        await afterSync(client);
        state.refreshPending=false;
      }
    } catch {
      if (state.status==='ready' && state.refreshPending) state.lastError='CORE_UI_REFRESH_FAILED';
      console.warn(`[CORE-EMOJI] retry_required code=${state.lastError}`);
    } finally {
      state.maintenancePromise=null;
      state.timer=setTimeout(()=>{state.maintenancePromise=tick();},60_000);
      state.timer.unref?.();
    }
  };
  // Mark active before starting an async pass so repeated setup is idempotent.
  state.timer={};
  state.maintenancePromise=tick();
  return state.maintenancePromise;
}
