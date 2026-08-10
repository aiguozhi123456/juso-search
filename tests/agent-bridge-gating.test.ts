import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getAgentBridgeEnabled,
  getEngineSearchEnabled,
  setAgentBridgeEnabled,
  setEngineSearchEnabled,
} from '@/lib/storage';
import { runAgentBridge } from '@/lib/agent-bridge';
import type { AgentEngineSearchRequest } from '@/lib/agent-bridge';
import type { EngineExtractionResult } from '@/lib/engines/extractors';
import type { SearchReply } from '@/lib/messaging';

// 这些测试锁定 background.ts 的 agentBridgeClaim handler 双层门控契约。
// handler 本身包在 defineBackground 闭包里无法直接 import，所以这里复刻其决策序列
// （用同一批真实函数）来锁死行为：
//   1) 总开关 off → 直接 { ok: false }，下游 runAgentBridge / handleSearch 不调。
//   2) 总开关 on + engine-search 子开关 off → engine-search 落 'extract-failed'，
//      search / list-providers 不受影响。
//   3) 总开关 on + 子开关 on → engine-search 正常执行。
//   4) 总开关 on → search / list-providers 正常（不受子开关影响）。

const token = 'a'.repeat(24);
const EXT_ID = 'fake-id';

function installStorage(): void {
  const store = new Map<string, unknown>();
  vi.stubGlobal('browser', {
    runtime: { id: EXT_ID },
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (store.has(k)) out[k] = store.get(k);
            return out;
          }
          return {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        },
      },
    },
  });
}

beforeEach(() => {
  installStorage();
});

// 复刻 background.ts handler 的 engine-search 子开关包装。
async function gatedEngineSearch(
  request: AgentEngineSearchRequest,
  signal: AbortSignal | undefined,
  runReal: (request: AgentEngineSearchRequest, signal: AbortSignal | undefined) => Promise<EngineExtractionResult>,
): Promise<EngineExtractionResult> {
  if (!(await getEngineSearchEnabled())) {
    return { engine: request.engineId, query: request.query, error: 'extract-failed' };
  }
  return runReal(request, signal);
}

describe('agent bridge gating: master switch off', () => {
  it('short-circuits to { ok: false } without invoking runAgentBridge', async () => {
    await setAgentBridgeEnabled(false);
    const runSpy = vi.fn(runAgentBridge);
    // 复刻 handler 入口的两个 guard：信任检查（假设通过）→ 总开关检查。
    if (await getAgentBridgeEnabled()) {
      runSpy({ port: 3210, token }, { fetch: vi.fn(), handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn() });
    }
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe('agent bridge gating: engine-search sub-switch', () => {
  const engineClaim = { protocol: 1, requestId: 'engine', request: { action: 'engine-search', query: 'hello', engineId: 'google' } };

  it('off → returns extract-failed without running real engine search', async () => {
    await setAgentBridgeEnabled(true);
    await setEngineSearchEnabled(false);
    const realEngineSearch = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(engineClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge(
      { port: 3210, token },
      {
        fetch: fetchMock,
        handleSearch: vi.fn(),
        listProviders: vi.fn(),
        handleEngineSearch: (request, signal) => gatedEngineSearch(request, signal, realEngineSearch),
      },
    );
    expect(realEngineSearch).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      reply: { engine: 'google', query: 'hello', error: 'extract-failed' },
    });
  });

  it('on → invokes the real engine search', async () => {
    await setAgentBridgeEnabled(true);
    await setEngineSearchEnabled(true);
    const realReply: EngineExtractionResult = {
      engine: 'google',
      query: 'hello',
      results: [{ title: 'T', url: 'https://t.test', snippet: 'S' }],
    };
    const realEngineSearch = vi.fn().mockResolvedValue(realReply);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(engineClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge(
      { port: 3210, token },
      {
        fetch: fetchMock,
        handleSearch: vi.fn(),
        listProviders: vi.fn(),
        handleEngineSearch: (request, signal) => gatedEngineSearch(request, signal, realEngineSearch),
      },
    );
    expect(realEngineSearch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: realReply });
  });
});

describe('agent bridge gating: search / list-providers unaffected by engine sub-switch', () => {
  it('search still runs with engine sub-switch off', async () => {
    await setAgentBridgeEnabled(true);
    await setEngineSearchEnabled(false);
    const searchClaim = { protocol: 1, requestId: 'search', request: { action: 'search', query: 'hello', providerId: 'tavily' } };
    const searchReply: SearchReply = { ok: false, error: { kind: 'unknown', message: 'safe' } };
    const handleSearch = vi.fn().mockResolvedValue(searchReply);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(searchClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge(
      { port: 3210, token },
      { fetch: fetchMock, handleSearch, listProviders: vi.fn(), handleEngineSearch: vi.fn() },
    );
    expect(handleSearch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: searchReply });
  });

  it('list-providers still runs with engine sub-switch off', async () => {
    await setAgentBridgeEnabled(true);
    await setEngineSearchEnabled(false);
    const providersClaim = { protocol: 1, requestId: 'p', request: { action: 'list-providers' } };
    const providersReply = { providers: [{ id: 'tavily' as const, supportsAnswer: true, configured: true }] };
    const listProviders = vi.fn().mockResolvedValue(providersReply);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(providersClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge(
      { port: 3210, token },
      { fetch: fetchMock, handleSearch: vi.fn(), listProviders, handleEngineSearch: vi.fn() },
    );
    expect(listProviders).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: providersReply });
  });

  it('list-engines still runs with engine sub-switch off', async () => {
    await setAgentBridgeEnabled(true);
    await setEngineSearchEnabled(false);
    const enginesClaim = { protocol: 2, requestId: 'e', request: { action: 'list-engines' } };
    const enginesReply = { engines: [{ id: 'google' }, { id: 'bing' }] };
    const listEngines = vi.fn().mockResolvedValue(enginesReply);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(enginesClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge(
      { port: 3210, token },
      { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), listEngines },
    );
    expect(listEngines).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: enginesReply });
  });
});

describe('agent bridge gating: defaults are off (policy compliance)', () => {
  it('both switches default to false on a fresh storage', async () => {
    expect(await getAgentBridgeEnabled()).toBe(false);
    expect(await getEngineSearchEnabled()).toBe(false);
  });
});
