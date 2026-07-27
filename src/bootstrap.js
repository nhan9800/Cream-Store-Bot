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

    // Tự động setup kênh Nạp Thẻ (Đã tắt theo yêu cầu)
    /*
    import('./services/autoSetupCardService.js').then(({ autoSetupCardChannel }) => {
      autoSetupCardChannel(readyClient).catch(err => {
        console.log(`[AUTO-SETUP-CARD] Lỗi chạy setup: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupCardService', err));
    */

    // Tự động setup kênh Bảng Giá
    import('./services/autoSetupPriceBoardService.js').then(({ autoSetupPriceBoard }) => {
      autoSetupPriceBoard(readyClient).catch(err => {
        console.log(`[AUTO-SETUP-PRICE] Lỗi chạy setup bảng giá: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupPriceBoardService', err));

    // Khởi tạo Invite Tracker (Cache link mời)
    import('./services/inviteTrackerService.js').then(({ initInviteCache, handleInviteCreate, handleInviteDelete }) => {
      initInviteCache(readyClient).catch(err => console.error('[INVITE-TRACKER] Init error:', err));
      readyClient.on('inviteCreate', invite => handleInviteCreate(invite));
      readyClient.on('inviteDelete', invite => handleInviteDelete(invite));
    }).catch(err => console.error('Failed to import inviteTrackerService', err));

    // Tự động setup kênh Giveaway (chỉ chạy 1 lần nếu chưa có)
    import('./services/autoSetupGiveawayService.js').then(({ autoSetupGiveawayChannel }) => {
      autoSetupGiveawayChannel(readyClient).catch(err => {
        console.log(`[AUTO-SETUP-GIVEAWAY] Lỗi chạy setup giveaway: ${err.message}`);
      });
    }).catch(err => console.error('Failed to import autoSetupGiveawayService', err));

    // Tự động setup kênh Premium Products (Claude, Locket)
    import('./services/premiumProductSetupService.js').then(({ autoSetupAndPublishPremiumProducts }) => {
      for (const guild of readyClient.guilds.cache.values()) {
        autoSetupAndPublishPremiumProducts(guild).catch(err => {
          console.log(`[AUTO-SETUP-PREMIUM] Lỗi chạy setup cho guild ${guild.name}: ${err.message}`);
        });
      }
    }).catch(err => console.error('Failed to import premiumProductSetupService', err));

    // Gửi thông báo bảng giá mới vào kênh thông báo (1 lần duy nhất per session)
    const ANNOUNCE_CHANNEL_ID = '1514598369597587546';
    const ANNOUNCE_SENT_KEY = `announce_priceboard_v2_${Date.now().toString().slice(0,-5)}`; // reset mỗi 100s
    setTimeout(async () => {
      console.log(`[ANNOUNCE] 🔔 Đang cố gắng gửi thông báo bảng giá vào kênh ${ANNOUNCE_CHANNEL_ID}...`);
      try {
        const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
        const { createEmojiResolver } = await import('./utils/emojiHelper.js');

        for (const guild of readyClient.guilds.cache.values()) {
          let ch;
          try {
            ch = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID)
              || await guild.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
          } catch { ch = null; }
          if (!ch?.isTextBased()) continue;

          const E = createEmojiResolver(guild.id);

          const container = new ContainerBuilder().setAccentColor(0xFFA500);

          // Header
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `## ${E('icon_sparkle', '✨')} BẢNG GIÁ CẬP NHẬT — CENAR STORE\n` +
              `> ${E('icon_fire', '🔥')} *Sản phẩm mới · Giá tốt nhất · Bảo hành toàn diện*`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

          // Nhóm 1: Discord
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${E('brand_nitro', '💎')} DISCORD NITRO & BOOST\n` +
              `${E('status_check', '✅')} Nitro Basic · Nitro Full · Server Boost\n` +
              `${E('icon_price', '💰')} Giá từ **\`9,000đ\`** — Rẻ nhất thị trường`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

          // Nhóm 2: AI
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${E('brand_claude', '🤖')} AI & PHẦN MỀM BẢN QUYỀN\n` +
              `${E('status_check', '✅')} Claude API 100M · Claude Pro · ChatGPT Plus\n` +
              `${E('status_check', '✅')} Canva Pro · Capcut Pro · Adobe CC\n` +
              `${E('icon_crown', '👑')} Premium mới nhất: **Claude 5 Opus** đã có mặt!`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

          // Nhóm 3: Giải trí
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${E('brand_youtube', '🎬')} GIẢI TRÍ — STREAMING\n` +
              `${E('status_check', '✅')} YouTube Premium · Spotify · Netflix\n` +
              `${E('icon_price', '💰')} Giá từ **\`19,000đ\` / tháng**`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

          // Nhóm 4: Premium đặc biệt
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${E('icon_heart_purple', '💛')} SẢN PHẨM PREMIUM MỚI\n` +
              `${E('brand_claude', '🤖')} **Claude API 100M** — Truy cập toàn bộ Claude 5\n` +
              `${E('icon_heart_purple', '💛')} **Locket Gold 1 Năm** — Đặc quyền VIP không quảng cáo\n` +
              `${E('icon_sparkle', '✨')} Xem chi tiết trong kênh **SẢN PHẨM PREMIUM** bên trên!`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

          // CTA
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `### ${E('icon_gem', '💎')} TẠI SAO CHỌN CENAR STORE?\n` +
              `${E('icon_gem', '💎')} **Bảo hành trọn gói** — Đổi trả nếu lỗi không giải thích.\n` +
              `${E('icon_key', '🔒')} **Bảo mật tuyệt đối** — Không thu thập thông tin cá nhân.\n` +
              `${E('status_check', '✅')} **Hỗ trợ 24/7** — Team luôn online sẵn sàng.\n` +
              `${E('icon_fire', '🚀')} **Giao hàng tức thì** — Nhận trong vài phút sau khi thanh toán.`
            )
          );
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

          // Footer
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `-# ${E('icon_heart_purple', '💜')} Cenar Store — Uy Tín · Chất Lượng · Bảo Hành Trọn Gói · Hỗ Trợ 24/7`
            )
          );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Xem Bảng Giá').setStyle(ButtonStyle.Primary).setEmoji(E.component('icon_price') || '💰').setCustomId('announce:view_price'),
            new ButtonBuilder().setLabel('Mua Claude API').setStyle(ButtonStyle.Success).setEmoji(E.component('brand_claude') || '🤖').setCustomId('product:claude:buy'),
            new ButtonBuilder().setLabel('Mua Locket Gold').setStyle(ButtonStyle.Secondary).setEmoji(E.component('icon_heart_purple') || '💛').setCustomId('product:locket:buy'),
          );

          await ch.send({
            content: `@everyone`,
            components: [container, row],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: ['everyone'] },
          });
          console.log(`[ANNOUNCE] ✅ Đã gửi thông báo bảng giá mới vào kênh ${ch.name} (${guild.name})`);
        }
      } catch (err) {
        console.error('[ANNOUNCE] Lỗi gửi thông báo:', err.message);
      }
    }, 8000); // Chờ 8s sau khi bot ready để đảm bảo cache đã load

  }); // end client.once ClientReady

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
