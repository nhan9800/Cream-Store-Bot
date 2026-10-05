import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

function portIsOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}
describe('forked store parent lifecycle', () => {
  it('releases the internal HTTP port after a launcher is killed without graceful shutdown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-launcher-disconnect-'));
    const watcher = new URL('../src/utils/launcherConnection.js', import.meta.url).href;
    let parent, storePid;
    try {
      fs.writeFileSync(path.join(root, 'store.mjs'), `
        import net from 'node:net';
        import { watchLauncherConnection } from ${JSON.stringify(watcher)};
        const server = net.createServer(socket => socket.end());
        watchLauncherConnection(() => server.close(() => process.exit(0)));
        server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port, pid: process.pid }));
      `);
      fs.writeFileSync(path.join(root, 'parent.mjs'), `
        import { fork } from 'node:child_process';
        const store = fork(new URL('./store.mjs', import.meta.url));
        store.on('message', value => console.log(JSON.stringify(value)));
      `);
      parent = spawn(process.execPath, [path.join(root, 'parent.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
      const ready = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Fixture did not start')), 5000);
        parent.stdout.on('data', chunk => {
          output += chunk;
          if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
        });
        parent.once('error', error => { clearTimeout(timer); reject(error); });
      });
      storePid = ready.pid;
      expect(await portIsOpen(ready.port)).toBe(true);
      const exited = once(parent, 'exit');
      parent.kill('SIGKILL'); await exited;
      const deadline = Date.now() + 5000;
      while (await portIsOpen(ready.port)) {
        if (Date.now() >= deadline) throw new Error('Orphaned store kept its internal port open');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Another listener can claim this same port; no surviving orphan owns it.
      const replacement = net.createServer();
      replacement.listen(ready.port, '127.0.0.1');
      await once(replacement, 'listening');
      await new Promise(resolve => replacement.close(resolve));
    } finally {
      if (parent && parent.exitCode == null && parent.signalCode == null) parent.kill('SIGKILL');
      if (storePid) { try { process.kill(storePid, 'SIGTERM'); } catch { /* already exited */ } }
      if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15000);
});
