import { describe, expect, it } from 'vitest';
import { resolveLauncherPorts } from '../ports.js';

describe('launcher ports', () => {
  it('uses non-conflicting defaults', () => {
    expect(resolveLauncherPorts({})).toEqual({
      publicPort: 2753,
      store1Port: 5000,
      store2Port: 8080,
    });
  });

  it('supports a platform-provided public port', () => {
    expect(resolveLauncherPorts({ PORT: '3210' }).publicPort).toBe(3210);
  });

  it('rejects duplicate or invalid ports', () => {
    expect(() => resolveLauncherPorts({ SERVER_PORT: '5000' })).toThrow(/must be different/);
    expect(() => resolveLauncherPorts({ STORE2_HTTP_PORT: '70000' })).toThrow(/STORE2_HTTP_PORT/);
  });
});
