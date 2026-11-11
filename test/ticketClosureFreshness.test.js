import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ metadata:vi.fn(), export:vi.fn(), deliver:vi.fn() }));
vi.mock('../src/services/transcriptService.js', () => ({ getLatestTicketTranscriptMetadata:fixture.metadata,exportTicketTranscript:fixture.export }));
vi.mock('../src/services/notificationService.js', () => ({ deliverTranscript:fixture.deliver }));
import { archiveTicketConversation } from '../src/services/ticketClosureService.js';
const ticket = { id:1,ticket_code:'TKT_FIXTURE' };
const channel = { messages:{fetch:vi.fn()} };
beforeEach(() => { vi.resetAllMocks(); fixture.export.mockResolvedValue({ savedToDisk:true,archiveId:2,messageCount:5 });fixture.deliver.mockResolvedValue({}); });
describe('unpaid-ticket transcript freshness', () => {
  it('exports again when a previously aborted closure archive predates new ticket activity', async () => {
    fixture.metadata.mockReturnValueOnce({ id:1,createdAt:'2026-11-10T10:00:00Z' }).mockReturnValueOnce({id:2,createdAt:'2026-11-11T10:00:00Z'});
    const result = await archiveTicketConversation({ ticket,channel,minimumCreatedAt:'2026-11-10T11:00:00Z' });
    expect(fixture.export).toHaveBeenCalledOnce();expect(result).toMatchObject({archived:true,reused:false,transcript:{id:2}});
  });
  it('keeps retry idempotency when the current archive covers the latest human activity', async () => {
    fixture.metadata.mockReturnValue({id:1,createdAt:'2026-11-11T10:00:00Z'});
    expect(await archiveTicketConversation({ticket,channel,minimumCreatedAt:'2026-11-10T11:00:00Z'})).toMatchObject({archived:true,reused:true});
    expect(fixture.export).not.toHaveBeenCalled();
  });
  it('preserves the legacy archive-reuse contract for feedback/manual closures', async () => {
    fixture.metadata.mockReturnValue({id:1,createdAt:'2020-01-01T00:00:00Z'});
    expect(await archiveTicketConversation({ticket,channel})).toMatchObject({archived:true,reused:true});expect(fixture.export).not.toHaveBeenCalled();
  });
  it('fails closed for invalid freshness bounds or failed fresh export', async () => {
    fixture.metadata.mockReturnValue({id:1,createdAt:'2020-01-01T00:00:00Z'});
    expect(await archiveTicketConversation({ticket,channel,minimumCreatedAt:'invalid'})).toMatchObject({archived:false});
    expect(fixture.export).not.toHaveBeenCalled();fixture.export.mockResolvedValue({savedToDisk:false});
    expect(await archiveTicketConversation({ticket,channel,minimumCreatedAt:'2026-11-11T10:00:00Z'})).toMatchObject({archived:false});
  });
});
