import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mcpWebSearch } from '@/lib/mcp-client';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('mcpWebSearch', () => {
  it('returns content[0].text from a JSON tools/call response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === 'initialize')
          return res(200, { jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} }, protocolVersion: '2025-11-25' } });
        return res(200, { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{"results":[]}' }] } });
      }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (body.method === 'initialize')
          return res(200, { jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
        return res(200, sse, 'text/event-stream');
      }),
    );
    const text = await mcpWebSearch('https://x/mcp', 'k', 'q');
    expect(text).toBe('SSE_OK');
  });

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(401, { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'unauthorized' } })),
    );
    await expect(mcpWebSearch('https://x/mcp', 'bad', 'q')).rejects.toBeInstanceOf(ProviderError);
    await expect(mcpWebSearch('https://x/mcp', 'bad', 'q')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
