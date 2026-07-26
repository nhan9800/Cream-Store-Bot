import { Client, Events, REST, Routes } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { initDatabase } from './database/db.js';
import { getClientOptions, loadCommands, registerInteractionHandler } from './events/interactionCreate.js';
import { startScheduler } from './services/schedulerService.js';
import { startWebhookServer } from './services/webhookServer.js';
import { startPresenceRotation } from './services/presenceService.js';
import { startOtpAutoCheck } from './services/otpAutoCheckService.js';

import { initErrorLogger } from './services/errorLogService.js';
import { autoSetupDiscountBoard } from './services/autoSetupDiscountBoardService.js';
import { runTempKeySetup } from './services/tempKeySetup.js';

export async function buildClient() {
  initDatabase();

  const commands = await loadCommands();
  const client = new Client(getClientOptions());
  global.discordClient = client;

  initErrorLogger(client);
  registerInteractionHandler(client, commands);

  client.once(Events.ClientReady, async (readyClient) => {
    runTempKeySetup(readyClient);
    console.log(`[READY] Logged in as ${readyClient.user.tag}`);
    console.log(`[READY] Loaded ${commands.size} slash commands`);

    startPresenceRotation(readyClient);
    startScheduler(readyClient);
    startWebhookServer(readyClient);
    startOtpAutoCheck(readyClient);
    autoSetupDiscountBoard(readyClient);

    // Tự động đồng bộ emoji cho tất cả các guild bot đang tham gia
    import('./services/emojiService.js').then(({ autoSyncGuildEmojis }) => {
      for (const guild of readyClient.guilds.cache.values()) {
        try {
          const result = autoSyncGuildEmojis(guild);
          console.log(`[EMOJI-SYNC] Synced ${result.syncedCount} emojis for guild: ${guild.name}`);
        } catch (e) {
          console.error(`[EMOJI-SYNC] Failed to auto-sync for guild ${guild.name}:`, e);
        }
      }
    }).catch(err => console.error('Failed to import emojiService for ready event', err));

    // Tự động chạy setup Partner & CTV cho các guild mà bot tham gia
    import('./services/autoSetupService.js').then(({ autoSetupPartnerAndCtv }) => {
      autoSetupPartnerAndCtv(readyClient).catch(err => {
        console.log(`[AUTO-SETUP] Lỗi chạy setup: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupService', err));

    // Tự động setup kênh Nạp Thẻ
    import('./services/autoSetupCardService.js').then(({ autoSetupCardChannel }) => {
      autoSetupCardChannel(readyClient).catch(err => {
        console.log(`[AUTO-SETUP-CARD] Lỗi chạy setup: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupCardService', err));

    // Tự động gửi / làm mới Bảng Giá đầy đủ (Components V2) vào kênh Bảng Giá
    import('./services/autoSetupPriceBoardService.js').then(({ autoSetupPriceBoard }) => {
      autoSetupPriceBoard(readyClient).catch(err => {
        console.log(`[AUTO-SETUP-PRICE] Lỗi chạy setup bảng giá: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupPriceBoardService', err));

        // Gửi thông báo ra mắt Boost Server - Đã bị tắt theo yêu cầu để tránh spam tag @everyone khi restart
    const SERVER1_GUILD_ID = '1282637033340403754';
    const isStore1 = readyClient.guilds.cache.has(SERVER1_GUILD_ID);
    if (isStore1) {
      console.log('[BOOST-ANNOUNCE] Tính năng tự động thông báo Boost Server khi khởi động đã bị tắt để tránh phiền khách hàng.');
    }
  });

  import('./events/messageCreate.js').then((module) => {
    client.on(module.name, (...args) => module.execute(...args));
  }).catch(err => console.error('Failed to load messageCreate event', err));

  import('./events/guildMemberAdd.js').then((module) => {
    client.on(module.name, (...args) => module.execute(...args));
  }).catch(err => console.error('Failed to load guildMemberAdd event', err));

  import('./events/guildMemberRemove.js').then((module) => {
    client.on(module.name, (...args) => module.execute(...args));
  }).catch(err => console.error('Failed to load guildMemberRemove event', err));

  client.salesCommands = commands;
  return client;
}

export async function startBot() {
  assertRuntimeConfig();
  const client = await buildClient();
  await client.login(config.botToken);
  return client;
}

export async function deployCommands() {
  if (!config.botToken || !config.clientId || !config.guildId) {
    throw new Error('Thiếu BOT_TOKEN, CLIENT_ID hoặc GUILD_ID để deploy slash command.');
  }

  initDatabase();

  const commands = await loadCommands();
  const commandData = [...commands.values()].map((command) => command.data.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.botToken);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: commandData,
  });

  return commandData.length;
}
