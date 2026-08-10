import { describe, expect, it, vi } from 'vitest';
import { AGENT_BRIDGE_PROTOCOL, buildAgentEndpoint, extractLooseBridgeCredentials, isTrustedBridgeSender, parseAgentClaim, parseBridgeFragment, runAgentBridge } from '@/lib/agent-bridge';

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
