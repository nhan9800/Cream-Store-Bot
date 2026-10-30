import { afterEach, describe, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate }; } }));
import { config } from '../src/config.js';
import { generateSystemPrompt, requestAiCompletion } from '../src/services/aiService.js';

const original = { aiProvider: config.aiProvider, groqApiKey: config.groqApiKey, geminiApiKeys: config.geminiApiKeys };
const input = { systemPrompt: 'Test', history: [{ role: 'user', content: 'Test question' }], tools: [] };
afterEach(() => { Object.assign(config, original); vi.unstubAllGlobals(); vi.restoreAllMocks(); generate.mockReset(); });

describe('AI provider lifecycle', () => {
  it('falls back from empty provider content and sends an abort signal to Gemini', async () => {
    Object.assign(config, { aiProvider: 'groq', groqApiKey: 'test-groq', geminiApiKeys: ['test-gemini'] });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) })));
    generate.mockResolvedValue({ text: 'Mình có thể tư vấn gói phù hợp.', functionCalls: [] });
    expect((await requestAiCompletion(input)).content).toContain('gói phù hợp');
    expect(generate.mock.calls[0][0].config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('bounds incomplete provider bodies and does not multiply the total timeout across fallback providers', async () => {
    Object.assign(config, { aiProvider: 'groq', groqApiKey: 'test-groq', geminiApiKeys: ['test-gemini'] });
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({ ok: true,
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))),
    })));
    await expect(requestAiCompletion(input, { timeoutMs: 30 })).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not log or forward rejected provider response bodies', async () => {
    Object.assign(config, { aiProvider: 'groq', groqApiKey: 'test', geminiApiKeys: [] });
    const text = vi.fn(async () => 'private request contents');
    const cancel = vi.fn(async () => {});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text, body: { cancel } })));
    await expect(requestAiCompletion(input)).rejects.toThrow('AI_PROVIDER_REJECTED');
    expect(text).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('private request contents');
  });

  it('uses gateway channel cache instead of fetching all channels per answer', async () => {
    const fetch = vi.fn(async () => { throw new Error('should not fetch'); });
    const prompt = await generateSystemPrompt({ id: 'test-ai-lifecycle', channels: { cache: new Map(), fetch } }, false);
    expect(fetch).not.toHaveBeenCalled();
    expect(prompt).toContain('QUY TẮC BẮT BUỘC');
  });
});
