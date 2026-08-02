import type { SearchReply, SearchRequest } from './messaging';
import { isProviderId } from './sources';
import { isProviderInstanceId } from './provider-instances';
import type { ProviderInstanceId } from './provider-instances';
import type { ProviderId } from './providers/types';
import type { EngineId } from './engines/types';
import type { EngineExtractionResult } from './engines/extractors';

export const AGENT_BRIDGE_PROTOCOL = 2;
export const AGENT_BRIDGE_MAX_BODY_BYTES = 64 * 1024;
export const AGENT_BRIDGE_DEADLINE_MS = 30_000;
export const AGENT_BRIDGE_COMPLETE_DEADLINE_MS = 5_000;

export type BridgeCredentials = { port: number; token: string };
export type AgentSearchRequest = { action: 'search'; query: string; providerId: ProviderId; forceRefresh?: boolean };
export type AgentListProvidersRequest = { action: 'list-providers' };
export type AgentEngineSearchRequest = { action: 'engine-search'; query: string; engineId: EngineId; maxResults?: number };
export interface AgentSearchInstanceRequest {
  action: 'search-instance';
  query: string;
  instanceId: ProviderInstanceId;
  forceRefresh?: boolean;
}
export interface AgentListInstancesRequest {
  action: 'list-instances';
}
export type AgentV2Request = AgentSearchInstanceRequest | AgentListInstancesRequest;
export type AgentRequest = AgentSearchRequest | AgentListProvidersRequest | AgentEngineSearchRequest | AgentV2Request;
export type AgentProvider = { id: ProviderId; supportsAnswer: boolean; configured: boolean; hasInstances?: boolean };
export interface AgentInstance {
  id: ProviderInstanceId;
  providerId: ProviderId;
  label: string;
  description: string;
  configured: boolean;
}
export type AgentListProvidersReply = { providers: AgentProvider[] };
export type AgentListInstancesReply = { instances: AgentInstance[] };
export type AgentClaim = { protocol: 1 | 2; requestId: string; request: AgentRequest };
export type AgentComplete = { protocol: 1 | 2; requestId: string; reply: SearchReply | AgentListProvidersReply | AgentListInstancesReply | EngineExtractionResult };
export type AgentBridgeDeps = {
  fetch: typeof fetch;
  handleSearch: (request: SearchRequest, signal?: AbortSignal) => Promise<SearchReply>;
  listProviders: () => Promise<AgentListProvidersReply>;
  handleEngineSearch: (request: AgentEngineSearchRequest, signal?: AbortSignal) => Promise<EngineExtractionResult>;
  handleSearchInstance?: (request: AgentSearchInstanceRequest, signal?: AbortSignal) => Promise<SearchReply>;
  listInstances?: () => Promise<AgentListInstancesReply>;
  deadlineMs?: number;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseBridgeFragment(fragment: string): ParseResult<BridgeCredentials> {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const version = params.getAll('v');
  const ports = params.getAll('p');
  const tokens = params.getAll('t');
  if (
    [...params.keys()].some((key) => !['v', 'p', 't'].includes(key))
    || version.length !== 1
    || version[0] !== '1'
    || ports.length !== 1
    || tokens.length !== 1
  ) {
    return { ok: false, error: 'invalid bridge parameters' };
  }
  const port = parsePort(ports[0]);
  if (port === null || !isBase64UrlToken(tokens[0])) return { ok: false, error: 'invalid bridge credentials' };
  return { ok: true, value: { port, token: tokens[0] } };
}

export function isTrustedBridgeSender(sender: { id?: string; url?: string }, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && !url.username && !url.password && !url.port && url.pathname === '/bridge.html';
  } catch {
    return false;
  }
}

export function buildAgentEndpoint(port: number, pathname: '/v1/claim' | '/v1/complete'): string | null {
  return parsePort(String(port)) === null ? null : `http://127.0.0.1:${port}${pathname}`;
}

export function parseAgentClaim(payload: unknown): ParseResult<AgentClaim> {
  // Protocol 1 claims stay accepted so pre-v2 skills keep working; the bridge
  // replies on the same protocol the claim used.
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['protocol', 'requestId', 'request']) || (payload.protocol !== AGENT_BRIDGE_PROTOCOL && payload.protocol !== 1)) {
    return { ok: false, error: 'invalid claim' };
  }
  if (typeof payload.requestId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(payload.requestId)) {
    return { ok: false, error: 'invalid request id' };
  }
  const request = parseSearchRequest(payload.request);
  return request.ok ? { ok: true, value: { protocol: payload.protocol as 1 | 2, requestId: payload.requestId, request: request.value } } : request;
}

export async function runAgentBridge(credentials: BridgeCredentials, deps: AgentBridgeDeps): Promise<{ ok: boolean }> {
  const claimUrl = buildAgentEndpoint(credentials.port, '/v1/claim');
  if (!claimUrl || !isBase64UrlToken(credentials.token)) return { ok: false };
  const actionController = new AbortController();
  const actionTimeout = setTimeout(() => actionController.abort(), deps.deadlineMs ?? AGENT_BRIDGE_DEADLINE_MS);
  try {
    const claimResponse = await deps.fetch(claimUrl, claimRequestOptions(credentials.token, actionController.signal));
    if (!claimResponse.ok) return { ok: false };
    const claimText = await readBoundedText(claimResponse);
    if (claimText === null) return { ok: false };
    let rawClaim: unknown;
    try {
      rawClaim = JSON.parse(claimText);
    } catch {
      return { ok: false };
    }
    const claim = parseAgentClaim(rawClaim);
    if (!claim.ok) return { ok: false };
    let reply: AgentComplete['reply'];
    try {
      reply = claim.value.request.action === 'search' ? await deps.handleSearch(claim.value.request, actionController.signal)
        : claim.value.request.action === 'engine-search' ? await deps.handleEngineSearch(claim.value.request, actionController.signal)
          : claim.value.request.action === 'search-instance'
            ? (await deps.handleSearchInstance?.(claim.value.request, actionController.signal)) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
            : claim.value.request.action === 'list-instances'
              ? (await deps.listInstances?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
              : await deps.listProviders();
    } catch (error) {
      reply = claim.value.request.action === 'engine-search'
        ? {
            engine: claim.value.request.engineId,
            query: claim.value.request.query,
            error: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'extract-failed',
          }
        : { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } };
    }
    clearTimeout(actionTimeout);
    const completeUrl = buildAgentEndpoint(credentials.port, '/v1/complete')!;
    const complete: AgentComplete = { protocol: claim.value.protocol, requestId: claim.value.requestId, reply };
    const completeController = new AbortController();
    const completeTimeout = setTimeout(() => completeController.abort(), AGENT_BRIDGE_COMPLETE_DEADLINE_MS);
    try {
      const response = await deps.fetch(completeUrl, {
        ...requestOptions(credentials.token, completeController.signal),
        body: JSON.stringify(complete),
        headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      });
      return { ok: response.ok };
    } finally {
      clearTimeout(completeTimeout);
    }
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(actionTimeout);
  }
}

function claimRequestOptions(token: string, signal: AbortSignal): RequestInit {
  return { method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store', signal };
}

function requestOptions(token: string, signal: AbortSignal): RequestInit {
  return { ...claimRequestOptions(token, signal), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

async function readBoundedText(response: Response): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > AGENT_BRIDGE_MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseSearchRequest(value: unknown): ParseResult<AgentRequest> {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return { ok: false, error: 'invalid search request' };
  }
  if (value.action === 'list-providers') {
    return hasOnlyKeys(value, ['action'])
      ? { ok: true, value: { action: 'list-providers' } }
      : { ok: false, error: 'invalid list providers request' };
  }
  if (value.action === 'engine-search') {
    if (!hasOnlyKeys(value, ['action', 'query', 'engineId', 'maxResults']) || typeof value.query !== 'string' || !['google', 'bing', 'baidu', 'yandex', 'duckduckgo', 'bilibili', 'xiaohongshu', 'douyin'].includes(value.engineId as string)) return { ok: false, error: 'invalid engine search request' };
    const query = value.query.trim();
    if (!query || query.length > 8192 || (value.maxResults !== undefined && (typeof value.maxResults !== 'number' || !Number.isInteger(value.maxResults) || value.maxResults < 1 || value.maxResults > 20))) return { ok: false, error: 'invalid engine search request' };
    return { ok: true, value: { action: 'engine-search', query, engineId: value.engineId as EngineId, ...(value.maxResults === undefined ? {} : { maxResults: value.maxResults as number }) } };
  }
  if (value.action === 'list-instances') {
    return hasOnlyKeys(value, ['action'])
      ? { ok: true, value: { action: 'list-instances' } }
      : { ok: false, error: 'invalid list instances request' };
  }
  if (value.action === 'search-instance') {
    if (!hasOnlyKeys(value, ['action', 'query', 'instanceId', 'forceRefresh']) || typeof value.query !== 'string') return { ok: false, error: 'invalid search instance request' };
    const query = value.query.trim();
    if (!query || query.length > 8192 || typeof value.instanceId !== 'string' || !isProviderInstanceId(value.instanceId)) return { ok: false, error: 'invalid search instance request' };
    if (value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') return { ok: false, error: 'invalid search instance request' };
    return { ok: true, value: { action: 'search-instance', query, instanceId: value.instanceId, ...(value.forceRefresh === undefined ? {} : { forceRefresh: value.forceRefresh }) } };
  }
  if (value.action !== 'search' || !hasOnlyKeys(value, ['action', 'query', 'providerId', 'forceRefresh']) || typeof value.query !== 'string') {
    return { ok: false, error: 'invalid search request' };
  }
  const query = value.query.trim();
  if (!query || query.length > 8192 || typeof value.providerId !== 'string' || !isProviderId(value.providerId)) {
    return { ok: false, error: 'invalid search request' };
  }
  if (value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') return { ok: false, error: 'invalid search request' };
  return { ok: true, value: { action: 'search', query, providerId: value.providerId, ...(value.forceRefresh === undefined ? {} : { forceRefresh: value.forceRefresh }) } };
}

function parsePort(value: string): number | null {
  return /^(?:[1-9]\d{0,4})$/.test(value) && Number(value) <= 65535 ? Number(value) : null;
}

function isBase64UrlToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,2048}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
