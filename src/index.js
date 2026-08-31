import { fork } from 'child_process';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import { resolveLauncherPorts } from './utils/ports.js';
import { acquireProcessLock } from './utils/processLock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// So sánh key an toàn theo thời gian (chống timing attack), fail-closed nếu thiếu key.
function safeKeyMatch(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

if (process.env.IS_CHILD_BOT === 'true') {
  // --- CHILD PROCESS MODE ---
  // Import and run the actual bot bootstrap
  const { startBot } = await import('./bootstrap.js');
  const { startWebhookServer, stopWebhookServer } = await import('./services/webhookServer.js');
  const { initDatabase } = await import('./database/db.js');
  let activeClient = null;
  let childStopping = false;

  async function stopChild(signal) {
    if (childStopping) return;
    childStopping = true;
    console.log(`[BOOT] [${process.env.ENV_FILE}] ${signal} received; closing Discord and HTTP server...`);

    // Do not let an open WebSocket/HTTP keepalive block a deploy forever.
    const forceExit = setTimeout(() => {
      console.error(`[BOOT] [${process.env.ENV_FILE}] Graceful shutdown timed out; forcing exit.`);
      process.exit(0);
    }, 4_000);
    forceExit.unref();

    try {
      activeClient?.destroy();
      await stopWebhookServer();
    } catch (error) {
      console.error(`[BOOT] [${process.env.ENV_FILE}] Shutdown warning:`, error?.message || error);
    }
    clearTimeout(forceExit);
    process.exit(0);
  }

  process.once('SIGTERM', () => void stopChild('SIGTERM'));
  process.once('SIGINT', () => void stopChild('SIGINT'));

  async function main() {
    try {
      activeClient = await startBot();
    } catch (error) {
      // Log lỗi thật để debug
      console.error(`[BOOT] [${process.env.ENV_FILE}] Lỗi khởi động:`, error.code, error.message);
      if (error.code === 'TokenInvalid' || error.message === 'An invalid token was provided.') {
        console.warn(`[BOOT] [${process.env.ENV_FILE}] Discord Token không hợp lệ. Khởi động Web Server ở chế độ độc lập...`);
        initDatabase();
        await startWebhookServer(null);
      } else {
        console.error(`[BOOT] [${process.env.ENV_FILE}] Bot khởi động thất bại (không phải lỗi token):`, error);
        process.exit(1);
      }
    }
  }
  main();
} else {
  // --- PARENT LAUNCHER / PROXY MODE ---
  // Load environment variables from .env file for the parent launcher process
  try {
    const fs = await import('fs');
    const dotenvPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(dotenvPath)) {
      const envContent = fs.readFileSync(dotenvPath, 'utf8');
      envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const index = trimmed.indexOf('=');
        if (index > 0) {
          const key = trimmed.substring(0, index).trim();
          let value = trimmed.substring(index + 1).trim();
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          process.env[key] = value;
        }
      });
    }
  } catch (e) {
    console.error('[LAUNCHER] Error loading .env:', e.message);
  }

  const launcherLockPath = process.env.CENAR_LAUNCHER_LOCK_FILE
    || path.join(process.cwd(), '.vibehost', 'launcher.lock');
  let releaseLauncherLock;
  try {
    releaseLauncherLock = acquireProcessLock(launcherLockPath);
  } catch (error) {
    if (error?.code === 'EALREADY') {
      console.error(`[LAUNCHER] ${error.message}. Duplicate startup aborted before forking stores.`);
      // EX_TEMPFAIL lets the VibeHost supervisor distinguish a duplicate
      // launcher from a normal bot crash and stop the redundant supervisor.
      process.exit(75);
    }
    throw error;
  }

  const {
    publicPort: PORT,
    store1Port: STORE1_PORT,
    store2Port: STORE2_PORT,
  } = resolveLauncherPorts(process.env);

  let launcherStopping = false;
  let childExitHandled = false;

  console.log(`[LAUNCHER] Starting Store 1 (ENV_FILE=.env) on local port ${STORE1_PORT}...`);
  const child1 = fork(__filename, [], {
    env: {
      ...process.env,
      IS_CHILD_BOT: 'true',
      ENV_FILE: '.env',
      INTERNAL_HTTP_PORT: String(STORE1_PORT),
    }
  });
  child1.on('error', (err) => {
    console.error('[LAUNCHER] Store 1 fork error:', err);
  });
  child1.on('exit', (code, signal) => handleChildExit('Store 1', code, signal));

  console.log(`[LAUNCHER] Starting Store 2 (ENV_FILE=.env.store2) on local port ${STORE2_PORT}...`);
  const child2 = fork(__filename, [], {
    env: {
      ...process.env,
      IS_CHILD_BOT: 'true',
      ENV_FILE: '.env.store2',
      INTERNAL_HTTP_PORT: String(STORE2_PORT),
    }
  });
  child2.on('error', (err) => {
    console.error('[LAUNCHER] Store 2 fork error:', err);
  });
  child2.on('exit', (code, signal) => handleChildExit('Store 2', code, signal));

  function handleChildExit(label, code, signal) {
    console.log(`[LAUNCHER] ${label} exited with code ${code} and signal ${signal}`);
    if (launcherStopping || childExitHandled) return;
    childExitHandled = true;
    console.error(`[LAUNCHER] ${label} stopped unexpectedly; exiting so the supervisor can restart both stores.`);
    void shutdownLauncher('CHILD_EXIT', 1);
  }


  function waitForChildExit(child, timeoutMs) {
    if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve(true);
    return Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }

  async function terminateChild(child, label) {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    child.kill('SIGTERM');
    if (await waitForChildExit(child, 5_000)) return;
    console.warn(`[LAUNCHER] ${label} ignored SIGTERM; sending SIGKILL to PID ${child.pid}`);
    child.kill('SIGKILL');
    await waitForChildExit(child, 2_000);
  }

  async function shutdownLauncher(signal, exitCode = 0) {
    if (launcherStopping) return;
    launcherStopping = true;
    console.log(`[LAUNCHER] ${signal} received. Stopping child processes...`);
    await Promise.allSettled([
      terminateChild(child1, 'Store 1'),
      terminateChild(child2, 'Store 2'),
    ]);
    releaseLauncherLock();
    process.exit(exitCode);
  }

  // Handle process shutdown and wait until both internal HTTP ports are free
  // before the supervisor installs/starts the next revision.
  process.once('SIGTERM', () => void shutdownLauncher('SIGTERM'));
  process.once('SIGINT', () => void shutdownLauncher('SIGINT'));
  process.on('exit', releaseLauncherLock);

  // Create reverse proxy server for webhooks and dashboard
  const server = http.createServer(async (req, res) => {
    // Expose deploy/diagnostics logs with authorization
    if (req.url.startsWith('/api/public/logs/')) {
      try {
        const providedKey = req.headers['x-bot-api-key'];
        const expectedKey = process.env.BOT_API_KEY;
        if (!safeKeyMatch(providedKey, expectedKey)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
          return;
        }

        const fs = await import('fs');
        const path = await import('path');
        const isDebug = req.url.includes('/logs/debug');
        const filename = isDebug ? 'debug_log.json' : 'send_price_log.txt';
        const filePath = path.join(process.cwd(), filename);
        
        if (fs.existsSync(filePath)) {
          const contentType = isDebug ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(fs.readFileSync(filePath));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`File ${filename} not found`);
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(e.message);
      }
      return;
    }

    // 1. Redirect /store2/dashboard to /store2/dashboard/ (to load relative assets correctly)
    if (req.url === '/store2/dashboard') {
      res.writeHead(301, { 'Location': '/store2/dashboard/' });
      res.end();
      return;
    }

    let targetPort = STORE1_PORT; // Default to Store 1
    let targetUrl = req.url;

    // 2. Strip /store2 prefix for Store 2 routing
    if (req.url.startsWith('/store2/')) {
      targetPort = STORE2_PORT;
      targetUrl = req.url.slice(7); // Remove '/store2'
    } else if (req.url.startsWith('/webhooks/payos-store2')) {
      targetPort = STORE2_PORT;
    } else if (
      req.url.startsWith('/webhooks/binance-pay-store2')
      || req.url.startsWith('/payments/binance-pay-store2/')
    ) {
      targetPort = STORE2_PORT;
    }

    if (targetUrl.startsWith('/webhooks/payos')) {
      // PayOS Webhook: Buffer body to inspect payosOrderCode
      // Giới hạn 2MB để tránh payload khổng lồ gây tràn RAM tiến trình launcher.
      const MAX_WEBHOOK_BODY = 2 * 1024 * 1024;
      let bodyData = '';
      let bodyTooLarge = false;
      req.on('data', chunk => {
        if (bodyTooLarge) return;
        bodyData += chunk;
        if (bodyData.length > MAX_WEBHOOK_BODY) {
          bodyTooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          req.destroy();
        }
      });

      await new Promise(resolve => {
        req.on('end', resolve);
        req.on('close', resolve);
        req.on('error', resolve);
      });
      if (bodyTooLarge) return;

      // Chỉ dò định tuyến khi URL chưa xác định rõ store (URL /webhooks/payos-store2
      // đã được ép targetPort=8080 ở trên — không cần tra DB nữa).
      if (targetPort !== STORE2_PORT) {
        try {
          const payload = JSON.parse(bodyData);
          const payosOrderCode = payload?.data?.orderCode;
          if (payosOrderCode) {
            const Database = (await import('better-sqlite3')).default;
            const code = Number(payosOrderCode);

            // Tra CẢ HAI database: order nằm ở DB nào thì route về đúng store đó.
            // (Trước đây chỉ tra DB Store 1 nên order Store 2 dùng chung URL bị route nhầm.)
            const dbFiles = [
              { path: path.join(process.cwd(), 'data', 'shopbot.sqlite'), port: STORE1_PORT },
              { path: path.join(process.cwd(), 'data', 'shopbot-store2.sqlite'), port: STORE2_PORT },
            ];

            for (const { path: dbPath, port } of dbFiles) {
              try {
                const db = new Database(dbPath, { readonly: true });
                const order = db.prepare("SELECT guild_id FROM orders WHERE payos_order_code = ?").get(code);
                db.close();
                if (order) {
                  targetPort = port;
                  break;
                }
              } catch (dbErr) {
                // DB store 2 có thể chưa tồn tại nếu chưa dùng — bỏ qua, thử DB kế
                console.error(`[LAUNCHER] Không đọc được ${dbPath}:`, dbErr.message);
              }
            }
          }
        } catch (err) {
          console.error('[LAUNCHER] Error parsing/routing PayOS webhook:', err.message);
        }
      }

      const connector = http.request({
        hostname: '127.0.0.1',
        port: targetPort,
        path: targetUrl,
        method: req.method,
        headers: req.headers
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      connector.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Proxy Error: ${err.message}`);
      });

      connector.write(bodyData);
      connector.end();
      return;
    }

    // Card2K chỉ cho cấu hình một callback cho mỗi kết nối API. Khi hai bot dùng
    // chung kết nối, tìm request_id trong cả hai SQLite để callback luôn tới đúng
    // tiến trình. Việc này cũng giữ nguyên một URL callback duy nhất cho đối tác.
    if (
      targetPort === STORE1_PORT
      && targetUrl.startsWith('/api/public/cardswap/callback')
    ) {
      try {
        const requestId = new URL(targetUrl, 'http://localhost').searchParams.get('request_id');
        if (requestId && /^[A-Za-z0-9_-]{6,80}$/.test(requestId)) {
          const Database = (await import('better-sqlite3')).default;
          const dbFiles = [
            { path: path.join(process.cwd(), 'data', 'shopbot.sqlite'), port: STORE1_PORT },
            { path: path.join(process.cwd(), 'data', 'shopbot-store2.sqlite'), port: STORE2_PORT },
          ];
          for (const { path: dbPath, port } of dbFiles) {
            try {
              const lookupDb = new Database(dbPath, { readonly: true, fileMustExist: true });
              const order = lookupDb.prepare('SELECT 1 FROM card_charging_orders WHERE request_id = ? LIMIT 1').get(requestId);
              lookupDb.close();
              if (order) {
                targetPort = port;
                break;
              }
            } catch (lookupError) {
              if (lookupError.code !== 'SQLITE_CANTOPEN') {
                console.error('[LAUNCHER] Không thể định tuyến callback Card2K:', lookupError.message);
              }
            }
          }
        }
      } catch (error) {
        console.error('[LAUNCHER] Callback Card2K không hợp lệ:', error.message);
      }
    }

    // Standard routing for other URLs
    const connector = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      path: targetUrl,
      method: req.method,
      headers: req.headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(connector);

    connector.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Proxy Error: ${err.message}`);
    });
  });

  // WebSocket upgrade forwarding for dashboard
  server.on('upgrade', (req, socket, head) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    
    // Check path or Referer header to identify Store 2 dashboard WebSockets
    const referer = req.headers.referer || '';
    const isStore2 = pathname.startsWith('/ws/dashboard-store2') || 
                      pathname.startsWith('/store2/ws/dashboard') || 
                      pathname.includes('store2') || 
                      referer.includes('/store2/');

    const targetPort = isStore2 ? STORE2_PORT : STORE1_PORT;
    const targetUrl = req.url.replace('/ws/dashboard-store2', '/ws/dashboard')
                             .replace('/store2/ws/dashboard', '/ws/dashboard');

    const connector = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      path: targetUrl,
      method: 'GET',
      headers: {
        ...req.headers,
        'Connection': 'Upgrade',
        'Upgrade': 'websocket'
      }
    });

    connector.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      let responseString = `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        responseString += `${key}: ${value}\r\n`;
      }
      responseString += '\r\n';
      socket.write(responseString);

      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    connector.on('error', () => {
      socket.destroy();
    });

    connector.end();
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[LAUNCHER] Proxy server listening on port ${PORT}`);
  });
}
