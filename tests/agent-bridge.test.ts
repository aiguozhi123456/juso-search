import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_BRIDGE_ACTION_DEADLINE_MS,
  AGENT_BRIDGE_ENGINE_INNER_MARGIN_MS,
  AGENT_BRIDGE_MAX_TIMEOUT_MS,
  AGENT_BRIDGE_MIN_TIMEOUT_MS,
  AGENT_BRIDGE_PROTOCOL,
  AGENT_BRIDGE_TIMEOUT_RESERVE_MS,
  buildAgentEndpoint,
  clampTimeoutMs,
  effectiveActionDurationMs,
  engineInnerBudgetMs,
  extractLooseBridgeCredentials,
  isTrustedBridgeSender,
  parseAgentClaim,
  parseBridgeFragment,
  runAgentBridge,
} from '@/lib/agent-bridge';

const token = 'a'.repeat(24);
const claim = { protocol: 1, requestId: 'request-1', request: { action: 'search', query: ' hello ', providerId: 'tavily' } };

describe('agent bridge input validation', () => {
  it('rejects SSRF ports and malformed tokens', () => {
    expect(buildAgentEndpoint(0, '/v1/claim')).toBeNull();
    expect(buildAgentEndpoint(65536, '/v1/claim')).toBeNull();
    expect(parseBridgeFragment('#v=1&p=80&t=bad')).toMatchObject({ ok: false });
    expect(parseBridgeFragment(`#v=1&p=3210&t=${token}`)).toMatchObject({ ok: true });
  });

  it('accepts only the exact internal bridge page', () => {
    expect(isTrustedBridgeSender({ id: 'id', url: 'chrome-extension://id/bridge.html' }, 'id')).toBe(true);
    expect(isTrustedBridgeSender({ id: 'id', url: 'chrome-extension://id/bridge.html/other' }, 'id')).toBe(false);
    expect(isTrustedBridgeSender({ id: 'other', url: 'chrome-extension://id/bridge.html' }, 'id')).toBe(false);
  });

  it('accepts Firefox moz-extension: sender (hostname is per-install random UUID)', () => {
    const ffId = 'juso-search@extension';
    const ffUrl = 'moz-extension://a1b2c3d4-e5f6-7890-abcd-ef1234567890/bridge.html';
    expect(isTrustedBridgeSender({ id: ffId, url: ffUrl }, ffId)).toBe(true);
    expect(isTrustedBridgeSender({ id: ffId, url: 'moz-extension://a1b2c3d4/bridge.html/other' }, ffId)).toBe(false);
    expect(isTrustedBridgeSender({ id: 'other@extension', url: ffUrl }, ffId)).toBe(false);
  });

  it('extracts loose credentials for abort even when strict parsing rejects the version', () => {
    // Strict parsing rejects v=2, but loose extraction still recovers port+token
    // so the bridge can notify the skill via /v1/abort instead of hanging.
    expect(parseBridgeFragment(`#v=2&p=3210&t=${token}`)).toMatchObject({ ok: false });
    expect(extractLooseBridgeCredentials(`#v=2&p=3210&t=${token}`)).toEqual({ port: 3210, token });
    // Missing port or token → null (no way to reach the server)
    expect(extractLooseBridgeCredentials('#v=2&t=abc')).toBeNull();
    expect(extractLooseBridgeCredentials('#v=2&p=3210')).toBeNull();
    // Malformed port or token → null
    expect(extractLooseBridgeCredentials('#v=2&p=0&t=abc')).toBeNull();
    expect(extractLooseBridgeCredentials('#v=2&p=3210&t=short')).toBeNull();
  });

  it('strictly validates claim schema and normalizes query', () => {
    expect(parseAgentClaim(claim)).toMatchObject({ ok: true, value: { request: { query: 'hello' } } });
    expect(parseAgentClaim({ ...claim, request: { action: 'search', query: '', providerId: 'tavily' } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ ...claim, request: { action: 'search', query: 'x', providerId: 'unknown' } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ protocol: 1, requestId: 'providers', request: { action: 'list-providers' } })).toMatchObject({ ok: true });
    expect(parseAgentClaim({ protocol: 1, requestId: 'providers', request: { action: 'list-providers', query: 'x' } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ ...claim, extra: true })).toMatchObject({ ok: false });
  });
});

describe('agent bridge v2 actions', () => {
  it('bumps the protocol version to 2', () => {
    expect(AGENT_BRIDGE_PROTOCOL).toBe(2);
  });

  it('keeps v1 search claims parsing unchanged (backward compatibility)', () => {
    const v1 = { protocol: 1, requestId: 'v1', request: { action: 'search', query: ' hello ', providerId: 'exa' } };
    expect(parseAgentClaim(v1)).toMatchObject({ ok: true, value: { protocol: 1, request: { action: 'search', query: 'hello', providerId: 'exa' } } });
  });

  it('parses a v2 search-instance claim with a valid instance id', () => {
    const claim = { protocol: 2, requestId: 'v2', request: { action: 'search-instance', query: ' hello ', instanceId: 'inst:exa:abc123', forceRefresh: true } };
    expect(parseAgentClaim(claim)).toMatchObject({ ok: true, value: { protocol: 2, request: { action: 'search-instance', query: 'hello', instanceId: 'inst:exa:abc123', forceRefresh: true } } });
  });

  it('rejects a v2 search-instance claim with an invalid instance id', () => {
    const unknownProvider = { protocol: 2, requestId: 'v2', request: { action: 'search-instance', query: 'x', instanceId: 'inst:unknown:abc' } };
    expect(parseAgentClaim(unknownProvider)).toMatchObject({ ok: false });
    const malformed = { protocol: 2, requestId: 'v2', request: { action: 'search-instance', query: 'x', instanceId: 'exa:abc' } };
    expect(parseAgentClaim(malformed)).toMatchObject({ ok: false });
  });

  it('rejects a v2 search-instance claim with a missing query', () => {
    const missingQuery = { protocol: 2, requestId: 'v2', request: { action: 'search-instance', instanceId: 'inst:exa:abc123' } };
    expect(parseAgentClaim(missingQuery)).toMatchObject({ ok: false });
    const emptyQuery = { protocol: 2, requestId: 'v2', request: { action: 'search-instance', query: '', instanceId: 'inst:exa:abc123' } };
    expect(parseAgentClaim(emptyQuery)).toMatchObject({ ok: false });
  });

  it('parses a v2 list-instances claim', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'v2', request: { action: 'list-instances' } })).toMatchObject({ ok: true, value: { request: { action: 'list-instances' } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'v2', request: { action: 'list-instances', query: 'x' } })).toMatchObject({ ok: false });
  });

  it('parses a v2 list-engines claim', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'v2', request: { action: 'list-engines' } })).toMatchObject({ ok: true, value: { request: { action: 'list-engines' } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'v2', request: { action: 'list-engines', query: 'x' } })).toMatchObject({ ok: false });
  });

  it('rejects unknown actions', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'v2', request: { action: 'teleport', query: 'x' } })).toMatchObject({ ok: false });
  });
});

describe('agent bridge protocol', () => {
  it('claims, searches, and completes successfully', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(claim), { headers: { 'content-length': '100' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const handleSearch = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'unknown', message: 'safe' } });
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch, listProviders: vi.fn(), handleEngineSearch: vi.fn() })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3210/v1/claim');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store' });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Content-Type');
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(handleSearch.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:3210/v1/complete');
  });

  it('does not search or complete an invalid claim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocol: 2 })));
    const handleSearch = vi.fn();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch, listProviders: vi.fn(), handleEngineSearch: vi.fn() })).resolves.toEqual({ ok: false });
    expect(handleSearch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('completes list-providers without searching', async () => {
    const providerReply = { providers: [{ id: 'tavily' as const, supportsAnswer: true, configured: true }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 1, requestId: 'providers', request: { action: 'list-providers' } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const handleSearch = vi.fn();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch, listProviders: vi.fn().mockResolvedValue(providerReply), handleEngineSearch: vi.fn() })).resolves.toEqual({ ok: true });
    expect(handleSearch).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: providerReply });
  });

  it('rejects a streamed claim over 64 KiB without a Content-Length header', async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(oversized));

    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn() })).resolves.toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('strictly validates engine-search claims', () => {
    const engineClaim = { protocol: 1, requestId: 'engine', request: { action: 'engine-search', query: ' hello ', engineId: 'google', maxResults: 2 } };
    expect(parseAgentClaim(engineClaim)).toMatchObject({ ok: true, value: { request: { query: 'hello', engineId: 'google', maxResults: 2 } } });
    expect(parseAgentClaim({ ...engineClaim, request: { ...engineClaim.request, engineId: 'ddg' } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ ...engineClaim, request: { ...engineClaim.request, maxResults: 21 } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ ...engineClaim, request: { ...engineClaim.request, extra: true } })).toMatchObject({ ok: false });
  });

  it('accepts yandex and duckduckgo engine-search claims', () => {
    const engineClaim = { protocol: 1, requestId: 'engine', request: { action: 'engine-search', query: 'hello', engineId: 'google' } };
    expect(parseAgentClaim({ ...engineClaim, request: { ...engineClaim.request, engineId: 'yandex' } })).toMatchObject({ ok: true, value: { request: { engineId: 'yandex' } } });
    expect(parseAgentClaim({ ...engineClaim, request: { ...engineClaim.request, engineId: 'duckduckgo' } })).toMatchObject({ ok: true, value: { request: { engineId: 'duckduckgo' } } });
  });

  it('uses a fresh bounded signal to complete an aborted engine search', async () => {
    const engineClaim = { protocol: 1, requestId: 'engine', request: { action: 'engine-search', query: 'hello', engineId: 'google' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(engineClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const handleEngineSearch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[1][1].signal).not.toBe(handleEngineSearch.mock.calls[0][1]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: { engine: 'google', query: 'hello', error: 'aborted' } });
  });
});

describe('agent bridge v2 dispatch', () => {
  it('dispatches a v2 search-instance claim to handleSearchInstance', async () => {
    const v2Claim = { protocol: 2, requestId: 'v2-search', request: { action: 'search-instance', query: 'hello', instanceId: 'inst:exa:abc123' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(v2Claim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const searchReply = { ok: false, error: { kind: 'unknown', message: 'safe' } };
    const handleSearchInstance = vi.fn().mockResolvedValue(searchReply);
    const listInstances = vi.fn();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), handleSearchInstance, listInstances })).resolves.toEqual({ ok: true });
    expect(handleSearchInstance).toHaveBeenCalledTimes(1);
    expect(handleSearchInstance.mock.calls[0][0]).toMatchObject({ action: 'search-instance', query: 'hello', instanceId: 'inst:exa:abc123' });
    expect(handleSearchInstance.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(listInstances).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: searchReply });
  });

  it('dispatches a v2 list-instances claim to listInstances', async () => {
    const v2Claim = { protocol: 2, requestId: 'v2-list', request: { action: 'list-instances' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(v2Claim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const instancesReply = { instances: [{ id: 'inst:exa:abc123', providerId: 'exa', label: 'Default', description: '', configured: true }] };
    const listInstances = vi.fn().mockResolvedValue(instancesReply);
    const handleSearchInstance = vi.fn();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), handleSearchInstance, listInstances })).resolves.toEqual({ ok: true });
    expect(listInstances).toHaveBeenCalledTimes(1);
    expect(handleSearchInstance).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: instancesReply });
  });

  it('dispatches a v2 list-engines claim to listEngines', async () => {
    const v2Claim = { protocol: 2, requestId: 'v2-engines', request: { action: 'list-engines' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(v2Claim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const enginesReply = { engines: [{ id: 'google' }, { id: 'bing' }] };
    const listEngines = vi.fn().mockResolvedValue(enginesReply);
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), listEngines })).resolves.toEqual({ ok: true });
    expect(listEngines).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: enginesReply });
  });
});

describe('agent bridge timeout budget helpers', () => {
  it('clampTimeoutMs accepts only integers within [MIN, MAX]', () => {
    expect(clampTimeoutMs(AGENT_BRIDGE_MIN_TIMEOUT_MS - 1)).toBeNull();
    expect(clampTimeoutMs(AGENT_BRIDGE_MIN_TIMEOUT_MS)).toBe(AGENT_BRIDGE_MIN_TIMEOUT_MS);
    expect(clampTimeoutMs(AGENT_BRIDGE_MAX_TIMEOUT_MS)).toBe(AGENT_BRIDGE_MAX_TIMEOUT_MS);
    expect(clampTimeoutMs(AGENT_BRIDGE_MAX_TIMEOUT_MS + 1)).toBeNull();
    expect(clampTimeoutMs(7000.5)).toBeNull();
    expect(clampTimeoutMs(NaN)).toBeNull();
    expect(clampTimeoutMs(Infinity)).toBeNull();
  });

  it('effectiveActionDurationMs prefers claim timeoutMs over override over default', () => {
    expect(effectiveActionDurationMs(40_000, undefined)).toBe(40_000 - AGENT_BRIDGE_TIMEOUT_RESERVE_MS);
    expect(effectiveActionDurationMs(40_000, 1_000)).toBe(34_000); // timeoutMs 胜过 override
    expect(effectiveActionDurationMs(undefined, 1_000)).toBe(1_000); // override 胜过默认
    expect(effectiveActionDurationMs(undefined, undefined)).toBe(AGENT_BRIDGE_ACTION_DEADLINE_MS);
  });

  it('engineInnerBudgetMs subtracts the margin and clamps negatives to zero', () => {
    expect(engineInnerBudgetMs(10_000, 2_000)).toBe(10_000 - 2_000 - AGENT_BRIDGE_ENGINE_INNER_MARGIN_MS);
    expect(engineInnerBudgetMs(1_000, 2_000)).toBe(0);
  });
});

describe('agent bridge claim timeoutMs parsing', () => {
  it('accepts timeoutMs on search, engine-search, and search-instance claims', () => {
    expect(parseAgentClaim({ protocol: 1, requestId: 'r', request: { action: 'search', query: 'x', providerId: 'tavily', timeoutMs: 12_000 } }))
      .toMatchObject({ ok: true, value: { request: { action: 'search', query: 'x', providerId: 'tavily', timeoutMs: 12_000 } } });
    expect(parseAgentClaim({ protocol: 1, requestId: 'r', request: { action: 'engine-search', query: 'x', engineId: 'google', timeoutMs: 12_000 } }))
      .toMatchObject({ ok: true, value: { request: { action: 'engine-search', engineId: 'google', timeoutMs: 12_000 } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-instance', query: 'x', instanceId: 'inst:exa:abc123', timeoutMs: 12_000 } }))
      .toMatchObject({ ok: true, value: { request: { action: 'search-instance', instanceId: 'inst:exa:abc123', timeoutMs: 12_000 } } });
  });

  it('rejects out-of-range, non-integer, and non-number timeoutMs like other invalid fields', () => {
    const base = { protocol: 1, requestId: 'r', request: { action: 'search', query: 'x', providerId: 'tavily' } };
    for (const bad of [6_999, 300_001, 7_000.5, '12000', null, true]) {
      expect(parseAgentClaim({ ...base, request: { ...base.request, timeoutMs: bad } })).toMatchObject({ ok: false, error: 'invalid search request' });
    }
    // 闭区间边界值仍接受
    expect(parseAgentClaim({ ...base, request: { ...base.request, timeoutMs: AGENT_BRIDGE_MIN_TIMEOUT_MS } })).toMatchObject({ ok: true });
    expect(parseAgentClaim({ ...base, request: { ...base.request, timeoutMs: AGENT_BRIDGE_MAX_TIMEOUT_MS } })).toMatchObject({ ok: true });
    // engine-search / search-instance 同样按各自错误串拒绝
    expect(parseAgentClaim({ protocol: 1, requestId: 'r', request: { action: 'engine-search', query: 'x', engineId: 'google', timeoutMs: 6_999 } })).toMatchObject({ ok: false, error: 'invalid engine search request' });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-instance', query: 'x', instanceId: 'inst:exa:abc123', timeoutMs: 300_001 } })).toMatchObject({ ok: false, error: 'invalid search instance request' });
  });

  it('accepts timeoutMs on list-* claims (transport budget relax); out-of-range and unknown fields still rejected', () => {
    for (const action of ['list-providers', 'list-instances', 'list-engines', 'list-sites', 'list-aggregates']) {
      expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action, timeoutMs: 45_000 } }))
        .toMatchObject({ ok: true, value: { request: { action, timeoutMs: 45_000 } } });
      expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action, timeoutMs: 6_999 } })).toMatchObject({ ok: false });
    }
    // 放宽仅限 timeoutMs：其余未知字段照旧拒绝
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'list-providers', query: 'x' } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'list-sites', extra: 1 } })).toMatchObject({ ok: false });
  });

  it('parses claims without timeoutMs unchanged (no stray field on the parsed request)', () => {
    const parsed = parseAgentClaim(claim);
    expect(parsed).toMatchObject({ ok: true, value: { request: { query: 'hello' } } });
    expect(parsed.ok && 'timeoutMs' in parsed.value.request).toBe(false);
  });
});

describe('agent bridge action deadline pass-through', () => {
  it('derives the engine-search deadline from the claim timeoutMs', async () => {
    const engineClaim = { protocol: 1, requestId: 'engine', request: { action: 'engine-search', query: 'hello', engineId: 'google', timeoutMs: 120_000 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(engineClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const handleEngineSearch = vi.fn().mockResolvedValue({ engine: 'google', query: 'hello', error: 'no-results' });
    const before = Date.now();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch })).resolves.toEqual({ ok: true });
    const after = Date.now();
    expect(handleEngineSearch.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    const deadline = handleEngineSearch.mock.calls[0][2];
    expect(deadline).toBeGreaterThanOrEqual(before + 120_000 - AGENT_BRIDGE_TIMEOUT_RESERVE_MS);
    expect(deadline).toBeLessThanOrEqual(after + 120_000 - AGENT_BRIDGE_TIMEOUT_RESERVE_MS);
  });

  it('falls back to the default action deadline when the claim has no timeoutMs', async () => {
    const engineClaim = { protocol: 1, requestId: 'engine', request: { action: 'engine-search', query: 'hello', engineId: 'google' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(engineClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const handleEngineSearch = vi.fn().mockResolvedValue({ engine: 'google', query: 'hello', error: 'no-results' });
    const before = Date.now();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch })).resolves.toEqual({ ok: true });
    const after = Date.now();
    const deadline = handleEngineSearch.mock.calls[0][2];
    expect(deadline).toBeGreaterThanOrEqual(before + AGENT_BRIDGE_ACTION_DEADLINE_MS);
    expect(deadline).toBeLessThanOrEqual(after + AGENT_BRIDGE_ACTION_DEADLINE_MS);
  });
});

describe('agent bridge v2 site / aggregate actions (parse)', () => {
  it('parses search-site with a valid site id and trims the query', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-site', query: ' x ', siteId: 'site:abc-123', maxResults: 10 } }))
      .toMatchObject({ ok: true, value: { request: { action: 'search-site', query: 'x', siteId: 'site:abc-123', maxResults: 10 } } });
  });

  it('rejects search-site with a malformed or non-site id, or out-of-range maxResults', () => {
    for (const bad of ['inst:exa:abc123', 'agg:abc123', 'site:', 'custom:abc', '']) {
      expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-site', query: 'x', siteId: bad } })).toMatchObject({ ok: false, error: 'invalid site search request' });
    }
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-site', query: 'x' } })).toMatchObject({ ok: false });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-site', query: 'x', siteId: 'site:abc', maxResults: 0 } })).toMatchObject({ ok: false, error: 'invalid site search request' });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-site', query: 'x', siteId: 'site:abc', maxResults: 21 } })).toMatchObject({ ok: false, error: 'invalid site search request' });
  });

  it('parses search-aggregate with a valid aggregate id and forceRefresh', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc-123', forceRefresh: true } }))
      .toMatchObject({ ok: true, value: { request: { action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc-123', forceRefresh: true } } });
  });

  it('rejects search-aggregate with a malformed id or stray field', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-aggregate', query: 'x', aggregateId: 'site:abc' } })).toMatchObject({ ok: false, error: 'invalid aggregate search request' });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc', extra: 1 } })).toMatchObject({ ok: false });
  });

  it('parses list-sites and list-aggregates claims, timeoutMs included', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'list-sites' } })).toMatchObject({ ok: true, value: { request: { action: 'list-sites' } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'list-aggregates' } })).toMatchObject({ ok: true, value: { request: { action: 'list-aggregates' } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'list-sites', timeoutMs: 12_000 } })).toMatchObject({ ok: true, value: { request: { timeoutMs: 12_000 } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'list-aggregates', timeoutMs: 12_000 } })).toMatchObject({ ok: true, value: { request: { timeoutMs: 12_000 } } });
  });

  it('accepts timeoutMs on search-site and search-aggregate claims within the clamp range', () => {
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-site', query: 'x', siteId: 'site:abc', timeoutMs: 60_000 } }))
      .toMatchObject({ ok: true, value: { request: { timeoutMs: 60_000 } } });
    expect(parseAgentClaim({ protocol: 2, requestId: 'r', request: { action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc', timeoutMs: 300_001 } }))
      .toMatchObject({ ok: false, error: 'invalid aggregate search request' });
  });
});

describe('agent bridge v2 site / aggregate dispatch', () => {
  const baseDeps = { fetch: vi.fn(), handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn() };

  it('returns the Service unavailable fallback when a site/aggregate dep is missing', async () => {
    for (const request of [
      { action: 'search-site', query: 'x', siteId: 'site:abc' },
      { action: 'list-sites' },
      { action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc' },
      { action: 'list-aggregates' },
    ]) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 2, requestId: 'r', request })))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(runAgentBridge({ port: 3210, token }, { ...baseDeps, fetch: fetchMock })).resolves.toEqual({ ok: true });
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } } });
    }
  });

  it('dispatches search-site to handleSearchSite with signal and deadline', async () => {
    const siteClaim = { protocol: 2, requestId: 'site', request: { action: 'search-site', query: 'hello', siteId: 'site:abc123', maxResults: 5, timeoutMs: 60_000 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(siteClaim)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const siteReply = { ok: true, response: { query: 'hello', engine: 'bing', results: [] }, cache: { hit: false } };
    const handleSearchSite = vi.fn().mockResolvedValue(siteReply);
    const before = Date.now();
    await expect(runAgentBridge({ port: 3210, token }, { fetch: fetchMock, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), handleSearchSite })).resolves.toEqual({ ok: true });
    expect(handleSearchSite.mock.calls[0][0]).toMatchObject({ action: 'search-site', query: 'hello', siteId: 'site:abc123', maxResults: 5 });
    expect(handleSearchSite.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(handleSearchSite.mock.calls[0][2]).toBeGreaterThanOrEqual(before + 60_000 - AGENT_BRIDGE_TIMEOUT_RESERVE_MS);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ reply: siteReply });
  });

  it('dispatches list-sites / search-aggregate / list-aggregates to their deps', async () => {
    const sitesReply = { sites: [{ id: 'site:abc', label: 'S', engineId: 'bing', target: 'example.com', description: '' }] };
    const aggregatesReply = { aggregates: [{ id: 'agg:abc', label: 'A', eligible: true, topN: 20, members: ['tavily'] }] };
    const aggregateReply = { ok: false, error: { kind: 'keyMissing', message: 'm' } };
    const listSites = vi.fn().mockResolvedValue(sitesReply);
    const listAggregates = vi.fn().mockResolvedValue(aggregatesReply);
    const handleSearchAggregate = vi.fn().mockResolvedValue(aggregateReply);

    const sitesFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 2, requestId: 's', request: { action: 'list-sites' } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge({ port: 3210, token }, { fetch: sitesFetch, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), listSites });
    expect(listSites).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sitesFetch.mock.calls[1][1].body)).toMatchObject({ reply: sitesReply });

    const aggFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 2, requestId: 'a', request: { action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc', forceRefresh: true } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge({ port: 3210, token }, { fetch: aggFetch, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), handleSearchAggregate });
    expect(handleSearchAggregate.mock.calls[0][0]).toMatchObject({ action: 'search-aggregate', query: 'x', aggregateId: 'agg:abc', forceRefresh: true });
    expect(JSON.parse(aggFetch.mock.calls[1][1].body)).toMatchObject({ reply: aggregateReply });

    const listAggFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 2, requestId: 'l', request: { action: 'list-aggregates' } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runAgentBridge({ port: 3210, token }, { fetch: listAggFetch, handleSearch: vi.fn(), listProviders: vi.fn(), handleEngineSearch: vi.fn(), listAggregates });
    expect(listAggregates).toHaveBeenCalledTimes(1);
    expect(JSON.parse(listAggFetch.mock.calls[1][1].body)).toMatchObject({ reply: aggregatesReply });
  });
});
