import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mcpWebSearch } from '@/lib/mcp-client';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

function mockMcp(initReply: unknown, callReply: unknown, callContentType = 'application/json') {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.method === 'initialize') return res(200, initReply);
    return res(200, callReply, callContentType);
  });
}

describe('mcpWebSearch', () => {
  it('returns content[0].text from a JSON tools/call response', async () => {
    vi.stubGlobal(
      'fetch',
      mockMcp(
        { jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} }, protocolVersion: '2025-11-25' } },
        { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{"results":[]}' }] } },
      ),
    );
    const text = await mcpWebSearch('https://x/mcp', 'k', 'q');
    expect(text).toBe('{"results":[]}');
  });

  it('parses an SSE tools/call response', async () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"SSE_OK"}]}}',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      sse,
      'text/event-stream',
    ));
    const text = await mcpWebSearch('https://x/mcp', 'k', 'q');
    expect(text).toBe('SSE_OK');
  });

  it('picks the last non-ping data event from a multi-event SSE stream', async () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"FIRST"}]}}',
      '',
      'event: ping',
      'data: {}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"FINAL"}]}}',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      sse,
      'text/event-stream',
    ));
    const text = await mcpWebSearch('https://x/mcp', 'k', 'q');
    expect(text).toBe('FINAL');
  });

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'unauthorized' } })));
    await expect(mcpWebSearch('https://x/mcp', 'bad', 'q')).rejects.toBeInstanceOf(ProviderError);
    await expect(mcpWebSearch('https://x/mcp', 'bad', 'q')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('keeps HTTP 400 details for request debugging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { error: { message: 'invalid tools/call arguments' } })));

    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({
      kind: 'provider',
      status: 400,
      message: expect.stringContaining('invalid tools/call arguments'),
    });
  });

  it('throws provider on envelope.error', async () => {
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, error: { code: -1, message: 'tool error' } },
    ));
    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({ kind: 'provider' });
  });

  it('throws provider on missing result', async () => {
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, result: undefined } as unknown as object,
    ));
    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({ kind: 'provider' });
  });

  it('throws parse on empty content[0].text', async () => {
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '' }] } },
    ));
    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({ kind: 'parse' });
  });
});
