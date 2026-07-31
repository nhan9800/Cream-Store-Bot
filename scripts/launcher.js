import http from 'node:http';

const STORE1_PORT = process.env.STORE1_PORT || 2753;
const STORE2_PORT = process.env.STORE2_PORT || 8080;
const LAUNCHER_PORT = process.env.LAUNCHER_PORT || 20022;

const server = http.createServer((req, res) => {
  let targetPort = STORE1_PORT;

  // Ví dụ rule phân giải đơn giản qua path
  if (req.url.startsWith('/store2/')) {
    targetPort = STORE2_PORT;
    req.url = req.url.replace('/store2', ''); // Rewrite URL
  } else if (req.url.startsWith('/store1/')) {
    targetPort = STORE1_PORT;
    req.url = req.url.replace('/store1', ''); // Rewrite URL
  } else if (req.headers['x-store-id'] === 'store2') {
    targetPort = STORE2_PORT;
  }

  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: req.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`[LAUNCHER] Proxy error to port ${targetPort}:`, err.message);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(LAUNCHER_PORT, () => {
  console.log(`[LAUNCHER] Reverse Proxy started on port ${LAUNCHER_PORT}`);
  console.log(`[LAUNCHER] Routing rules:`);
  console.log(`   /store2/* -> 127.0.0.1:${STORE2_PORT}`);
  console.log(`   /store1/* -> 127.0.0.1:${STORE1_PORT}`);
  console.log(`   Default   -> 127.0.0.1:${STORE1_PORT}`);
});
