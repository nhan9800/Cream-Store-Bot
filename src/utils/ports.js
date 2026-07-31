function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export function resolveLauncherPorts(env = process.env) {
  const publicPort = parsePort(env.SERVER_PORT || env.PORT || 2753, 'SERVER_PORT/PORT');
  const store1Port = parsePort(env.STORE1_HTTP_PORT || 5000, 'STORE1_HTTP_PORT');
  const store2Port = parsePort(env.STORE2_HTTP_PORT || 8080, 'STORE2_HTTP_PORT');

  if (new Set([publicPort, store1Port, store2Port]).size !== 3) {
    throw new Error('SERVER_PORT/PORT, STORE1_HTTP_PORT and STORE2_HTTP_PORT must be different');
  }

  return { publicPort, store1Port, store2Port };
}
