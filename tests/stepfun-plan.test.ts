import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stepfunPlanAdapter } from '@/lib/providers/stepfun-plan';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

function mockMcp(initializeBody: unknown, callBody: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.method === 'initialize') return res(200, initializeBody);
    return res(200, callBody);
  });
}

describe('stepfunPlanAdapter', () => {
  it('maps embedded results JSON and stays answer-less', async () => {
    const payload = {
      query: 'q',
      results: [
        { url: 'https://a.com', position: 1, title: 'A', time: '', snippet: 's', content: 'c' },
        { url: 'https://b.com', position: 2, title: 'B', time: '2026-03-20T00:00:00', snippet: 'sb' },
      ],
    };
    vi.stubGlobal(
      'fetch',
      mockMcp(
        { jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} } } },
        { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } },
      ),
    );
    const out = await stepfunPlanAdapter.search('q', {}, 'sf-plan-key');
    expect(stepfunPlanAdapter.supportsAnswer).toBe(false);
    expect(out.answer).toBeUndefined();
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({ title: 'A', url: 'https://a.com', snippet: 's', content: 'c' });
    expect(out.results[0].publishedDate).toBeUndefined(); // 空 time -> undefined
    expect(out.results[1].publishedDate).toBe('2026-03-20T00:00:00');
  });

  it('targets the MCP endpoint with Bearer header', async () => {
    const fetchMock = mockMcp(
      { jsonrpc: '2.0', id: 1, result: { capabilities: {} } },
      { jsonrpc: '2.0', id: 2, result: { content: [{ text: '{"results":[]}' }] } },
    );
    vi.stubGlobal('fetch', fetchMock);
    await stepfunPlanAdapter.search('q', {}, 'sf-plan-key');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp');
    expect(init.headers.Authorization).toBe('Bearer sf-plan-key');
  });

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, {})));
    await expect(stepfunPlanAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(stepfunPlanAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
