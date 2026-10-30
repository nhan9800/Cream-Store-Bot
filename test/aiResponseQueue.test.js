import { describe, expect, it, vi } from 'vitest';
import { isAiResponseRunning, runAiResponseTask } from '../src/services/aiResponseQueue.js';

describe('AI ticket response queue', () => {
  it('keeps the newest follow-up without overlapping or queueing every partial message', async () => {
    let finish;
    const calls = [];
    const first = runAiResponseTask('ticket', async () => {
      calls.push('first'); await new Promise(resolve => { finish = resolve; });
    });
    expect(isAiResponseRunning('ticket')).toBe(true);
    await runAiResponseTask('ticket', async () => calls.push('partial'), { coalesce: true });
    await runAiResponseTask('ticket', async () => calls.push('latest'), { coalesce: true });
    expect(calls).toEqual(['first']);
    finish(); await first;
    expect(calls).toEqual(['first', 'latest']);
    expect(isAiResponseRunning('ticket')).toBe(false);
  });

  it('keeps public reply suppression and releases locks on errors', async () => {
    let finish;
    const first = runAiResponseTask('public', () => new Promise(resolve => { finish = resolve; }));
    const suppressed = vi.fn();
    await runAiResponseTask('public', suppressed);
    finish(); await first;
    expect(suppressed).not.toHaveBeenCalled();
    await expect(runAiResponseTask('failed', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(isAiResponseRunning('failed')).toBe(false);
    const retry = vi.fn(); await runAiResponseTask('failed', retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});
