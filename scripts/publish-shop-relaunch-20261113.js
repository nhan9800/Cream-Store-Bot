import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { SHOP_RELAUNCH, readShopRelaunchProducts, shopRelaunchHash } from '../src/campaigns/shopRelaunch20261113.js';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const catalogPath = option('--catalog-db');
if (!catalogPath) throw new Error('Use --catalog-db <existing production SQLite path>; preview is the default.');
const publish = args.includes('--publish');
const expectedPriceHash = option('--expected-price-hash');
const envFile = option('--env-file');
if (publish && (!envFile || !/^[a-f0-9]{64}$/.test(expectedPriceHash || ''))) {
  throw new Error('Publication requires --publish --env-file <protected env path> --expected-price-hash <reviewed preview hash>.');
}

// A preview neither logs in nor creates/modifies any database table.
const database = new Database(path.resolve(catalogPath), { readonly: !publish, fileMustExist: true });
let client;
try {
  const priceManifest = readShopRelaunchProducts(database);
  const preview = { revision: SHOP_RELAUNCH.revision, status: 'preview', priceHash: shopRelaunchHash(priceManifest),
    guildId: SHOP_RELAUNCH.guildId, promotionChannelId: SHOP_RELAUNCH.channelId,
    announcementChannelId: SHOP_RELAUNCH.announcementChannelId, memberRoleId: SHOP_RELAUNCH.memberRoleId,
    priceManifest, emojiReadiness: 'Verified against live application/guild inventory during publication.' };
  if (!publish) {
    console.log(JSON.stringify(preview, null, 2));
  } else {
    if (preview.priceHash !== expectedPriceHash) throw new Error('RELAUNCH_CATALOG_CHANGED');
    const protectedEnv = path.resolve(envFile);
    if (!fs.existsSync(protectedEnv)) throw new Error('Protected env file does not exist.');
    dotenv.config({ path: protectedEnv, override: true, quiet: true });
    process.env.ENV_FILE = protectedEnv;
    if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');
    const { createEmojiResolver } = await import('../src/utils/emojiHelper.js');
    const { installDiscordEmojiBoundary } = await import('../src/utils/discordEmojiBoundary.js');
    const { withManualAnnouncementWrite } = await import('../src/utils/manualAnnouncementWrite.js');
    const { publishShopRelaunch } = await import('../src/services/shopRelaunchPublicationService.js');
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    global.discordClient = client;
    const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
    await client.login(process.env.BOT_TOKEN); await ready;
    const guild = await client.guilds.fetch(SHOP_RELAUNCH.guildId);
    await guild.emojis.fetch(); await client.application.emojis.fetch();
    installDiscordEmojiBoundary(client);
    const result = await publishShopRelaunch(client, { dbInstance: database, E: createEmojiResolver(guild.id), expectedPriceHash,
      sendMessage: (channel, payload) => withManualAnnouncementWrite({ rest: client.rest, channelId: channel.id, nonce: payload.nonce },
        () => channel.send(payload)) });
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  client?.destroy(); database.close(); delete global.discordClient;
}
