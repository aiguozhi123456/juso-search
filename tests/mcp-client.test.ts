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

  it('passes an optional cancellation signal to all three MCP requests (initialize, notification, tools/call)', async () => {
    const controller = new AbortController();
    const fetchMock = mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } },
    );
    vi.stubGlobal('fetch', fetchMock);

    await mcpWebSearch('https://x/mcp', 'k', 'q', controller.signal);

    expect(fetchMock.mock.calls).toHaveLength(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal });
    }
  });

  it('sends notifications/initialized between initialize and tools/call (MCP lifecycle)', async () => {
    const fetchMock = mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } },
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await mcpWebSearch('https://x/mcp', 'k', 'q');

    expect(text).toBe('ok');
    const methods = fetchMock.mock.calls.map(
      (call) => (JSON.parse(String((call[1] as RequestInit).body)) as { method: string }).method,
    );
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    // 通知无 id（JSON-RPC notification 形状）。
    const notification = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as { id?: unknown };
    expect('id' in notification).toBe(false);
  });

  it('throws parse when the JSON-RPC response id does not match the request id', async () => {
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 99, result: { content: [{ type: 'text', text: 'wrong reply' }] } },
    ));
    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({ kind: 'parse' });
  });

  it('picks the id-matching event out of an interleaved SSE stream (notifications must not be taken as the reply)', async () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"progress":50}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"MATCHED"}]}}',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      sse,
      'text/event-stream',
    ));
    const text = await mcpWebSearch('https://x/mcp', 'k', 'q');
    expect(text).toBe('MATCHED');
  });

  it('throws parse when no SSE event carries the matching id', async () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":42,"result":{"content":[{"type":"text","text":"OTHER"}]}}',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      sse,
      'text/event-stream',
    ));
    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({ kind: 'parse' });
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

  it('throws provider carrying the tool error text when result.isError is set', async () => {
    vi.stubGlobal('fetch', mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'quota exceeded for plan' }] } },
    ));
    await expect(mcpWebSearch('https://x/mcp', 'k', 'q')).rejects.toMatchObject({
      kind: 'provider',
      message: expect.stringContaining('quota exceeded for plan'),
    });
  });
});
