import type { SearchReply, SearchRequest, AggregateSearchReply } from './messaging';
import { isEngineId, isProviderId } from './sources';
import { isProviderInstanceId } from './provider-instances';
import type { ProviderInstanceId } from './provider-instances';
import { isSiteInstanceId } from './site-instances';
import type { SiteInstanceId } from './site-instances';
import { isAggregateInstanceId } from './aggregate-instances';
import type { AggregateInstanceId, AggregateMemberId } from './aggregate-instances';
import type { ProviderId } from './providers/types';
import type { EngineId } from './engines/types';
import type { EngineExtractionResult, EngineResult } from './engines/extractors';

export const AGENT_BRIDGE_PROTOCOL = 2;
export const AGENT_BRIDGE_MAX_BODY_BYTES = 64 * 1024;
// 所有 action 共用的默认截止（35s：沿用 engine-search 原有余量，覆盖 engine-search.ts 的
// 30s 加载+握手总预算，慢引擎页实测可达 ~20s；其余 action 由 30s 放宽到 35s）。
export const AGENT_BRIDGE_ACTION_DEADLINE_MS = 35_000;
export const AGENT_BRIDGE_COMPLETE_DEADLINE_MS = 5_000;
// claim 可选 timeoutMs：声明端到端预算（complete 阶段计入预留；claim fetch 不从其中扣除，
// 仅受上面 35s 预 arm 上限约束——回环 claim 服务常驻内存，延迟为毫秒级），区间与换算如下。
export const AGENT_BRIDGE_MIN_TIMEOUT_MS = 7_000;
export const AGENT_BRIDGE_MAX_TIMEOUT_MS = 300_000;
// timeoutMs 中为 complete 阶段（5s）+ 1s 松弛预留的部分，剩余才是 action 可用时长。
export const AGENT_BRIDGE_TIMEOUT_RESERVE_MS = 6_000;
// engine-search 内层预算比外层截止提前的余量：保证内层 timeout 错误先于外层 aborted 判定。
export const AGENT_BRIDGE_ENGINE_INNER_MARGIN_MS = 750;

export type BridgeCredentials = { port: number; token: string };
export type AgentSearchRequest = { action: 'search'; query: string; providerId: ProviderId; forceRefresh?: boolean; timeoutMs?: number };
// list-* 请求同样接受可选 timeoutMs（传输预算）：CLI --timeout / MCP JUSO_TIMEOUT 对任意命令统一生效。
export type AgentListProvidersRequest = { action: 'list-providers'; timeoutMs?: number };
export type AgentListEnginesRequest = { action: 'list-engines'; timeoutMs?: number };
export type AgentEngineSearchRequest = { action: 'engine-search'; query: string; engineId: EngineId; maxResults?: number; timeoutMs?: number };
export interface AgentSearchInstanceRequest {
  action: 'search-instance';
  query: string;
  instanceId: ProviderInstanceId;
  forceRefresh?: boolean;
  timeoutMs?: number;
}
export interface AgentListInstancesRequest {
  action: 'list-instances';
  timeoutMs?: number;
}
export type AgentSearchSiteRequest = { action: 'search-site'; query: string; siteId: SiteInstanceId; maxResults?: number; timeoutMs?: number };
export type AgentListSitesRequest = { action: 'list-sites'; timeoutMs?: number };
export interface AgentSearchAggregateRequest {
  action: 'search-aggregate';
  query: string;
  aggregateId: AggregateInstanceId;
  forceRefresh?: boolean;
  timeoutMs?: number;
}
export type AgentListAggregatesRequest = { action: 'list-aggregates'; timeoutMs?: number };
export type AgentV2Request =
  | AgentSearchInstanceRequest
  | AgentListInstancesRequest
  | AgentListEnginesRequest
  | AgentSearchSiteRequest
  | AgentListSitesRequest
  | AgentSearchAggregateRequest
  | AgentListAggregatesRequest;
export type AgentRequest = AgentSearchRequest | AgentListProvidersRequest | AgentEngineSearchRequest | AgentV2Request;
export type AgentProvider = { id: ProviderId; supportsAnswer: boolean; configured: boolean; hasInstances?: boolean };
export interface AgentInstance {
  id: ProviderInstanceId;
  providerId: ProviderId;
  label: string;
  description: string;
  configured: boolean;
}
export type AgentEngine = { id: EngineId };
export type AgentListProvidersReply = { providers: AgentProvider[] };
export type AgentListInstancesReply = { instances: AgentInstance[] };
export type AgentListEnginesReply = { engines: AgentEngine[] };
/** 站点实例清单条目（脱敏）：target 是规范化 public hostname，不含任何密钥。 */
export type AgentSiteInfo = { id: SiteInstanceId; label: string; engineId: EngineId; target: string; description: string };
export type AgentListSitesReply = { sites: AgentSiteInfo[] };
/** 聚合实例清单条目：members 是成员 id 数组（非敏感）；eligible 与 worker eligibility 判定同源。 */
export type AgentAggregateInfo = { id: AggregateInstanceId; label: string; eligible: boolean; topN: number; members: AggregateMemberId[] };
export type AgentListAggregatesReply = { aggregates: AgentAggregateInfo[] };
/**
 * search-site 回复：SearchReply 式 envelope（与 search-instance 对未知实例的处理同先例）——
 * 未知/已删 id、engine-search 子开关 off、URL 构造失败统一走 ok:false，抽取成功才 ok:true。
 */
export type AgentSiteSearchReply =
  | { ok: true; response: { query: string; engine: EngineId; results: EngineResult[] }; cache: { hit: false } }
  | { ok: false; error: { kind: 'keyMissing' | 'providerError' | 'unknown'; message: string } };
export type AgentClaim = { protocol: 1 | 2; requestId: string; request: AgentRequest };
export type AgentComplete = {
  protocol: 1 | 2;
  requestId: string;
  reply:
    | SearchReply
    | AgentListProvidersReply
    | AgentListInstancesReply
    | AgentListEnginesReply
    | AgentListSitesReply
    | AgentListAggregatesReply
    | AgentSiteSearchReply
    | AggregateSearchReply
    | EngineExtractionResult;
};
export type AgentBridgeDeps = {
  fetch: typeof fetch;
  handleSearch: (request: SearchRequest, signal?: AbortSignal) => Promise<SearchReply>;
  listProviders: () => Promise<AgentListProvidersReply>;
  handleEngineSearch: (request: AgentEngineSearchRequest, signal: AbortSignal | undefined, deadline: number) => Promise<EngineExtractionResult>;
  handleSearchInstance?: (request: AgentSearchInstanceRequest, signal?: AbortSignal) => Promise<SearchReply>;
  listInstances?: () => Promise<AgentListInstancesReply>;
  listEngines?: () => Promise<AgentListEnginesReply>;
  handleSearchSite?: (request: AgentSearchSiteRequest, signal: AbortSignal | undefined, deadline: number) => Promise<AgentSiteSearchReply>;
  listSites?: () => Promise<AgentListSitesReply>;
  handleSearchAggregate?: (request: AgentSearchAggregateRequest, signal?: AbortSignal) => Promise<AggregateSearchReply>;
  listAggregates?: () => Promise<AgentListAggregatesReply>;
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

/**
 * Best-effort loose extraction of port+token from a bridge fragment, used to
 * notify the Python server when strict {@link parseBridgeFragment} fails (e.g.
 * version mismatch). Returns null when port or token are missing/malformed —
 * in that case there is no way to reach the server and the skill must wait for
 * its own timeout.
 */
export function extractLooseBridgeCredentials(fragment: string): BridgeCredentials | null {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const portStr = params.get('p');
  const token = params.get('t');
  if (!portStr || !token) return null;
  const port = parsePort(portStr);
  if (port === null || !isBase64UrlToken(token)) return null;
  return { port, token };
}

export function isTrustedBridgeSender(sender: { id?: string; url?: string }, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    // Chrome: chrome-extension://{id}/bridge.html（hostname == extensionId）。
    // Firefox: moz-extension://{per-install-uuid}/bridge.html（hostname 是随机 UUID，非 gecko ID；
    //   sender.id 已确认身份，仅校验协议 + pathname）。
    const protocolOk = url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:';
    const hostnameOk = url.protocol === 'moz-extension:' || url.hostname === extensionId;
    return protocolOk && hostnameOk && !url.username && !url.password && !url.port && url.pathname === '/bridge.html';
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

/** 校验 timeoutMs：仅接受 [MIN, MAX] 内的整数，非法返回 null（parse 据此拒绝 claim）。 */
export function clampTimeoutMs(value: number): number | null {
  return Number.isInteger(value) && value >= AGENT_BRIDGE_MIN_TIMEOUT_MS && value <= AGENT_BRIDGE_MAX_TIMEOUT_MS ? value : null;
}

/** action 实际可用时长：claim 的 timeoutMs（扣除 complete 预留）优先，其次测试 override，否则默认截止。 */
export function effectiveActionDurationMs(timeoutMs: number | undefined, overrideDeadlineMs: number | undefined): number {
  if (timeoutMs !== undefined) return timeoutMs - AGENT_BRIDGE_TIMEOUT_RESERVE_MS;
  return overrideDeadlineMs ?? AGENT_BRIDGE_ACTION_DEADLINE_MS;
}

/** engine-search 内层预算：比外层截止提前 MARGIN，保证内层 timeout 先于外层 aborted；负数钳为 0。 */
export function engineInnerBudgetMs(deadline: number, now: number): number {
  return Math.max(0, deadline - now - AGENT_BRIDGE_ENGINE_INNER_MARGIN_MS);
}

// 所有 action（含 list-*，2026-09-14 放宽）的 claim 均接受可选 timeoutMs：CLI --timeout /
// MCP JUSO_TIMEOUT 对任意命令统一生效，list-* 声明不再因携带 timeoutMs 被拒。
function claimTimeoutMs(request: AgentRequest): number | undefined {
  return request.timeoutMs;
}

export async function runAgentBridge(credentials: BridgeCredentials, deps: AgentBridgeDeps): Promise<{ ok: boolean }> {
  const claimUrl = buildAgentEndpoint(credentials.port, '/v1/claim');
  if (!claimUrl || !isBase64UrlToken(credentials.token)) return { ok: false };
  const actionController = new AbortController();
  // claim fetch 前先按默认/override 时长武装（fetch 与解析计入预算，保守）：认领前不知道 claim
  // 是否携带 timeoutMs，先兜底；认领后统一替换为按 pure 函数算出的唯一截止。
  let actionTimeout = setTimeout(() => actionController.abort(), deps.deadlineMs ?? AGENT_BRIDGE_ACTION_DEADLINE_MS);
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
    // 端到端唯一截止：所有 action 共用（engine-search 不再单独放宽），由 claim 的 timeoutMs
    // 扣除 complete 预留、测试 override 或默认值决定；engine-search 额外拿到绝对 epoch 截止
    // 用于收窄 runEngineSearch 的内部预算。
    const actionDurationMs = effectiveActionDurationMs(claimTimeoutMs(claim.value.request), deps.deadlineMs);
    clearTimeout(actionTimeout);
    actionTimeout = setTimeout(() => actionController.abort(), actionDurationMs);
    const actionDeadline = Date.now() + actionDurationMs;
    let reply: AgentComplete['reply'];
    try {
      reply = claim.value.request.action === 'search' ? await deps.handleSearch(claim.value.request, actionController.signal)
        : claim.value.request.action === 'engine-search' ? await deps.handleEngineSearch(claim.value.request, actionController.signal, actionDeadline)
          : claim.value.request.action === 'search-instance'
            ? (await deps.handleSearchInstance?.(claim.value.request, actionController.signal)) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
            : claim.value.request.action === 'list-instances'
              ? (await deps.listInstances?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
              : claim.value.request.action === 'list-engines'
                ? (await deps.listEngines?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
                : claim.value.request.action === 'search-site'
                  ? (await deps.handleSearchSite?.(claim.value.request, actionController.signal, actionDeadline)) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
                  : claim.value.request.action === 'list-sites'
                    ? (await deps.listSites?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
                    : claim.value.request.action === 'search-aggregate'
                      ? (await deps.handleSearchAggregate?.(claim.value.request, actionController.signal)) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
                      : claim.value.request.action === 'list-aggregates'
                        ? (await deps.listAggregates?.()) ?? { ok: false, error: { kind: 'unknown', message: 'Service unavailable.' } }
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
    if (!hasOnlyKeys(value, ['action', 'timeoutMs']) || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) return { ok: false, error: 'invalid list providers request' };
    return { ok: true, value: { action: 'list-providers', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'engine-search') {
    if (!hasOnlyKeys(value, ['action', 'query', 'engineId', 'maxResults', 'timeoutMs']) || typeof value.query !== 'string' || typeof value.engineId !== 'string' || !isEngineId(value.engineId)) return { ok: false, error: 'invalid engine search request' };
    const query = value.query.trim();
    if (!query || query.length > 8192 || (value.maxResults !== undefined && (typeof value.maxResults !== 'number' || !Number.isInteger(value.maxResults) || value.maxResults < 1 || value.maxResults > 20))) return { ok: false, error: 'invalid engine search request' };
    if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null)) return { ok: false, error: 'invalid engine search request' };
    return { ok: true, value: { action: 'engine-search', query, engineId: value.engineId as EngineId, ...(value.maxResults === undefined ? {} : { maxResults: value.maxResults as number }), ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'list-instances') {
    if (!hasOnlyKeys(value, ['action', 'timeoutMs']) || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) return { ok: false, error: 'invalid list instances request' };
    return { ok: true, value: { action: 'list-instances', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'list-engines') {
    if (!hasOnlyKeys(value, ['action', 'timeoutMs']) || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) return { ok: false, error: 'invalid list engines request' };
    return { ok: true, value: { action: 'list-engines', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'search-instance') {
    if (!hasOnlyKeys(value, ['action', 'query', 'instanceId', 'forceRefresh', 'timeoutMs']) || typeof value.query !== 'string') return { ok: false, error: 'invalid search instance request' };
    const query = value.query.trim();
    if (!query || query.length > 8192 || typeof value.instanceId !== 'string' || !isProviderInstanceId(value.instanceId)) return { ok: false, error: 'invalid search instance request' };
    if (value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') return { ok: false, error: 'invalid search instance request' };
    if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null)) return { ok: false, error: 'invalid search instance request' };
    return { ok: true, value: { action: 'search-instance', query, instanceId: value.instanceId, ...(value.forceRefresh === undefined ? {} : { forceRefresh: value.forceRefresh }), ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'list-sites') {
    if (!hasOnlyKeys(value, ['action', 'timeoutMs']) || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) return { ok: false, error: 'invalid list sites request' };
    return { ok: true, value: { action: 'list-sites', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'search-site') {
    if (!hasOnlyKeys(value, ['action', 'query', 'siteId', 'maxResults', 'timeoutMs']) || typeof value.query !== 'string') return { ok: false, error: 'invalid site search request' };
    const query = value.query.trim();
    if (!query || query.length > 8192 || typeof value.siteId !== 'string' || !isSiteInstanceId(value.siteId)) return { ok: false, error: 'invalid site search request' };
    if (value.maxResults !== undefined && (typeof value.maxResults !== 'number' || !Number.isInteger(value.maxResults) || value.maxResults < 1 || value.maxResults > 20)) return { ok: false, error: 'invalid site search request' };
    if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null)) return { ok: false, error: 'invalid site search request' };
    return { ok: true, value: { action: 'search-site', query, siteId: value.siteId, ...(value.maxResults === undefined ? {} : { maxResults: value.maxResults as number }), ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'list-aggregates') {
    if (!hasOnlyKeys(value, ['action', 'timeoutMs']) || (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null))) return { ok: false, error: 'invalid list aggregates request' };
    return { ok: true, value: { action: 'list-aggregates', ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action === 'search-aggregate') {
    if (!hasOnlyKeys(value, ['action', 'query', 'aggregateId', 'forceRefresh', 'timeoutMs']) || typeof value.query !== 'string') return { ok: false, error: 'invalid aggregate search request' };
    const query = value.query.trim();
    if (!query || query.length > 8192 || typeof value.aggregateId !== 'string' || !isAggregateInstanceId(value.aggregateId)) return { ok: false, error: 'invalid aggregate search request' };
    if (value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') return { ok: false, error: 'invalid aggregate search request' };
    if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null)) return { ok: false, error: 'invalid aggregate search request' };
    return { ok: true, value: { action: 'search-aggregate', query, aggregateId: value.aggregateId, ...(value.forceRefresh === undefined ? {} : { forceRefresh: value.forceRefresh }), ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
  }
  if (value.action !== 'search' || !hasOnlyKeys(value, ['action', 'query', 'providerId', 'forceRefresh', 'timeoutMs']) || typeof value.query !== 'string') {
    return { ok: false, error: 'invalid search request' };
  }
  const query = value.query.trim();
  if (!query || query.length > 8192 || typeof value.providerId !== 'string' || !isProviderId(value.providerId)) {
    return { ok: false, error: 'invalid search request' };
  }
  if (value.forceRefresh !== undefined && typeof value.forceRefresh !== 'boolean') return { ok: false, error: 'invalid search request' };
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || clampTimeoutMs(value.timeoutMs) === null)) return { ok: false, error: 'invalid search request' };
  return { ok: true, value: { action: 'search', query, providerId: value.providerId, ...(value.forceRefresh === undefined ? {} : { forceRefresh: value.forceRefresh }), ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number }) } };
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
