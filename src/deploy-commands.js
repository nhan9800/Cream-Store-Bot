import { assertDeployConfig, config, environmentInfo } from './config.js';
import { deployCommands } from './bootstrap.js';

try {
  console.log('[DEPLOY] cwd:', environmentInfo.cwd);
  console.log('[DEPLOY] env file:', environmentInfo.envPath);
  console.log('[DEPLOY] client id:', config.clientId ?? '(missing)');
  console.log('[DEPLOY] guild id:', config.guildId ?? '(missing)');
  console.log('[DEPLOY] bot token:', config.botToken ? '(configured)' : '(missing)');

  assertDeployConfig();
  const total = await deployCommands();
  console.log(`[DEPLOY] Đã đăng ký ${total} slash commands vào guild test.`);
  process.exit(0);
} catch (error) {
  console.error('[DEPLOY] Lỗi deploy slash commands:', error);
  process.exit(1);
}
