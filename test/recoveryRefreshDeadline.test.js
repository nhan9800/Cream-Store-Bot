import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshAccessToken } from '../src/commands/chuyen-server.js';
const original=process.env.CLIENT_SECRET;
const requestGuard={retryAfter:()=>0,setCooldown:vi.fn(),finalizeCooldown:vi.fn()};
const refresh=(token,options={})=>refreshAccessToken(token,{requestGuard,...options});
afterEach(()=>{
  vi.useRealTimers();
  vi.restoreAllMocks();
  if(original==null)delete process.env.CLIENT_SECRET;else process.env.CLIENT_SECRET=original;
});
describe('recovery credential refresh',()=>{
  it('bounds the token request and retains rotation and expiry',async()=>{
    process.env.CLIENT_SECRET='test-only-secret';
    const fetchImpl=vi.fn().mockResolvedValue(Response.json({access_token:'new-access',refresh_token:'rotated-refresh',expires_in:3600,scope:'identify guilds.join'}));
    const result=await refresh('old-refresh',{fetchImpl});
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({access_token:'new-access',refresh_token:'rotated-refresh'});
    expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now());
  });
  it('never reads or reflects an OAuth failure body and refuses malformed or downgraded grants',async()=>{
    process.env.CLIENT_SECRET='test-only-secret';
    const cancel=vi.fn().mockRejectedValue(new Error('secret-from-provider'));const text=vi.fn().mockResolvedValue('secret-from-provider');
    await expect(refresh('old',{fetchImpl:vi.fn().mockResolvedValue({ok:false,status:401,body:{cancel},text})})).rejects.toThrow('Discord HTTP 401');
    expect(cancel).toHaveBeenCalledOnce();expect(text).not.toHaveBeenCalled();
    for(const data of [null, {access_token:' ',expires_in:3600}, {access_token:'x',refresh_token:' ',expires_in:3600},
      {access_token:'x',expires_in:0},{access_token:'x',expires_in:3600,scope:'identify'},
      {access_token:'x',expires_in:3600,scope:'guilds.join'}, {access_token:'x',expires_in:31_536_001}]) {
      await expect(refresh('old',{fetchImpl:vi.fn().mockResolvedValue(Response.json(data))})).rejects.toThrow();
    }
  });
  it('keeps the deadline active while waiting for a stalled JSON response body',async()=>{
    process.env.CLIENT_SECRET='test-only-secret';
    vi.useFakeTimers();
    vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds=>{
      const controller=new AbortController();
      setTimeout(()=>controller.abort(new DOMException('request timeout','TimeoutError')),milliseconds);
      return controller.signal;
    });
    const readBody=vi.fn();
    const fetchImpl=vi.fn(async()=>new Response(new ReadableStream({start:readBody})));
    const pending=refresh('old',{fetchImpl});
    const assertion=expect(pending).rejects.toMatchObject({name:'TimeoutError'});
    await vi.advanceTimersByTimeAsync(11_999);
    expect(readBody).toHaveBeenCalledOnce();
    expect(AbortSignal.timeout).toHaveBeenCalledWith(12_000);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });
  it('retains a refresh token when Discord does not rotate it and rejects missing input before sending',async()=>{
    process.env.CLIENT_SECRET='test-only-secret';
    const fetchImpl=vi.fn().mockResolvedValue(Response.json({access_token:'access',expires_in:3600}));
    expect((await refresh('old',{fetchImpl})).refresh_token).toBe('old');
    await expect(refresh(' ',{fetchImpl})).rejects.toThrow('Token recovery không đầy đủ');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
