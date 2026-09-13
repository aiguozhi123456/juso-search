// 外部 rerank 客户端（aggregate-search-rerank plan KTD6/KTD14）。
//
// 建在 lib/providers/http.ts 的 postJson + mapStatus 之上（错误映射/响应体脱敏免费获得）。
// 协议 = Cohere/Jina 风格 `/v1/rerank`（KTD14，vLLM/XInference/LiteLLM 兼容）：
//   请求  { model?, query, documents: string[], top_n? }
//   响应  { results: [{ index, relevance_score }] }
// ⚠️ 不是 "OpenAI-compatible"——OpenAI 没有 rerank API，勿按 OpenAI 规范实现。
//
// 错误分型（RerankError.kind）：endpoint 未配置 → keyMissing；401/403 → unauthorized；
// 429 → rateLimit；5xx/4xx → provider；JSON 畸形/形状非法 → parse；传输失败/超时/取消 → network。
// gateway（Lane B）经 toSearchError 同款映射把 kind 免费映射进 reply。

import { mapStatus, postJson } from '../providers/http';
import { ProviderError } from '../providers/types';
import type { RerankConfig } from './types';

/** rerank 请求超时（KTD6：~10s，AbortController+setTimeout 与调用方 signal 组合）。 */
export const RERANK_TIMEOUT_MS = 10_000;

/** i18n 占位键名（Lane D 落 lib/i18n.ts + _locales/{zh_CN,en}/messages.json 双语条目；现阶段 t() 回退键名本身）。 */
export const MSG_RERANK_ENDPOINT_INVALID = 'error_rerank_endpoint_invalid';
export const MSG_RERANK_ENDPOINT_REWRITTEN = 'opts_rerank_endpoint_rewritten';

/**
 * mapStatus 的 provider 显示名。复用 http.ts 的错误文案模板（含脱敏 detail）；
 * rerank 专用 i18n 文案由 plan Phase 2（UI 车道）接管，此处用协议字面量作 label。
 */
const RERANK_LABEL = 'Rerank';

/** Cohere/Jina 风格 /v1/rerank 请求体（KTD14）。 */
export interface RerankRequestBody {
  model?: string;
  query: string;
  documents: string[];
  top_n?: number;
}

/** 单条重排结果：documents 数组的下标 + 相关性分数。 */
export interface RerankResultItem {
  index: number;
  relevance_score: number;
}

/** 原始响应体（宽松形状，validateRerankResults 收紧）。 */
interface RerankResponseBody {
  results?: unknown;
}

export type RerankErrorKind = 'keyMissing' | 'unauthorized' | 'rateLimit' | 'provider' | 'parse' | 'network';

/** rerank 客户端统一错误：kind 语义与 ProviderError 对齐，另加 keyMissing（未配置）。 */
export class RerankError extends Error {
  readonly kind: RerankErrorKind;
  readonly status?: number;
  constructor(kind: RerankErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'RerankError';
    this.kind = kind;
    this.status = status;
  }
}

export interface RerankCallOptions {
  /** 可选取消信号（与内部 ~10s 超时组合；任一触发即中断请求）。 */
  signal?: AbortSignal;
  /**
   * fetch 注入。worker 调用方必须传包装形态 `(...args) => fetch(...args)`
   * （service-worker-fetch-illegal-invocation 教训：裸函数引用存入 deps 再以方法形式
   * 调用会丢 WorkerGlobalScope receiver → Illegal invocation；
   * 见 docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md）。
   * 缺省时本模块同样以自由函数形态调用全局 fetch，测试经 vi.stubGlobal('fetch') 注入。
   */
  fetch?: typeof fetch;
  /** 超时毫秒数；缺省 RERANK_TIMEOUT_MS。测试可调小。 */
  timeoutMs?: number;
}

/** rerank 是否已配置（R3 隐式可见性轴 + eligibility 输入）：仅看 endpoint 非空。apiKey 可选（本地服务常无鉴权）。 */
export function isRerankConfigured(config: RerankConfig | null | undefined): boolean {
  return !!config && typeof config.endpoint === 'string' && config.endpoint.trim().length > 0;
}

/** 存储读侧归一（Default-by-Getter）：缺键/畸形 → 未配置态 `{ endpoint: '' }`；空串 apiKey/model 丢弃。 */
export function normalizeRerankConfig(value: unknown): RerankConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { endpoint: '' };
  const candidate = value as Record<string, unknown>;
  const endpoint = typeof candidate.endpoint === 'string' ? candidate.endpoint.trim() : '';
  const model = typeof candidate.model === 'string' && candidate.model.trim() !== '' ? candidate.model.trim() : undefined;
  const apiKey = typeof candidate.apiKey === 'string' && candidate.apiKey !== '' ? candidate.apiKey : undefined;
  return { endpoint, ...(model ? { model } : {}), ...(apiKey ? { apiKey } : {}) };
}

// === KTD12：endpoint 强制 loopback（127.0.0.1-only）校验/规范化 ===
//
// 消费方：worker 侧 handleSetRerankConfig 与 config-io 导入（KTD13）共用本校验，保证两条写路径
// 语义一致。理由：manifest host_permissions 已含 `http://127.0.0.1/*`（Chrome match pattern 忽略
// 端口；localhost/[::1]/https 不被覆盖）；「本地」威胁模型（搜索内容 + apiKey 不出 loopback）在
// 校验层硬约束。manifest 零 host-permission 变更。

export type RerankEndpointValidation =
  | { ok: true; /** 规范化后的 endpoint（localhost/[::1] 已改写为 127.0.0.1）。 */ endpoint: string; /** 输入是否经 localhost/[::1] 自动改写（reply 提示已改写）。 */ rewritten: boolean }
  | { ok: false; reason: 'invalid_url' | 'not_http' | 'not_loopback' };

/**
 * 校验并规范化 rerank endpoint（KTD12）：
 * - 解析 URL（不可解析 → invalid_url）；
 * - host 为 `localhost` / `[::1]` → 自动改写 `127.0.0.1`（保留端口/路径，rewritten=true）；
 * - 最终必须 `scheme === 'http' && hostname === '127.0.0.1'`，否则拒绝（not_http / not_loopback）。
 */
export function validateRerankEndpoint(raw: string): RerankEndpointValidation {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  let rewritten = false;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1')) {
    url.hostname = '127.0.0.1';
    rewritten = true;
  }
  if (url.protocol !== 'http:') return { ok: false, reason: 'not_http' };
  if (url.hostname !== '127.0.0.1') return { ok: false, reason: 'not_loopback' };
  return { ok: true, endpoint: url.href, rewritten };
}

/**
 * 调用 /v1/rerank：返回按服务端给出顺序的 results（调用方自行按 relevance_score 降序稳定排序后写 score）。
 * 绝不把 apiKey 放进任何返回值——key 只进请求头。
 */
export async function rerankDocuments(config: RerankConfig, request: RerankRequestBody, options: RerankCallOptions = {}): Promise<RerankResultItem[]> {
  const timeoutMs = options.timeoutMs ?? RERANK_TIMEOUT_MS;
  if (!isRerankConfigured(config)) {
    // keyMissing 语义对齐 R3：未配置 → 上层驱动 ErrorState 的设置入口 CTA。
    throw new RerankError('keyMissing', 'rerank endpoint is not configured');
  }
  // 超时与调用方 signal 组合（KTD6）：内部 timer 与外部 abort 都汇到同一 controller。
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const external = options.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const body: RerankRequestBody = {
      query: request.query,
      documents: request.documents,
      ...(config.model ? { model: config.model } : {}),
      ...(request.top_n !== undefined ? { top_n: request.top_n } : {}),
    };
    const response = await postJson<RerankResponseBody>(config.endpoint, {
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const statusError = mapStatus(response.status, RERANK_LABEL, response.errorDetail);
    if (statusError) throw statusError;
    return validateRerankResults(response.data);
  } catch (e) {
    if (e instanceof RerankError) throw e;
    // 超时优先于通用 network 文案，便于上层区分「服务没起」与「起了但 10s 没回」。
    if (timedOut) throw new RerankError('network', `rerank request timed out after ${timeoutMs}ms`);
    if (e instanceof ProviderError) throw new RerankError(e.kind, e.message, e.status);
    if (e instanceof Error && e.name === 'AbortError') throw new RerankError('network', 'rerank request aborted');
    throw new RerankError('provider', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

/** KTD14 响应形状收紧：非对象 / results 非数组 / 条目缺 index:int 或 relevance_score:number → parse。 */
function validateRerankResults(data: unknown): RerankResultItem[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RerankError('parse', 'rerank response is not a JSON object');
  }
  const results = (data as RerankResponseBody).results;
  if (!Array.isArray(results)) {
    throw new RerankError('parse', 'rerank response is missing a results array');
  }
  return results.map((item): RerankResultItem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new RerankError('parse', 'rerank result entry is not an object');
    }
    const { index, relevance_score } = item as Record<string, unknown>;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      throw new RerankError('parse', 'rerank result entry has an invalid index');
    }
    if (typeof relevance_score !== 'number' || !Number.isFinite(relevance_score)) {
      throw new RerankError('parse', 'rerank result entry has an invalid relevance_score');
    }
    return { index, relevance_score };
  });
}

/**
 * 设置页「测试连接」（KTD6/R12）：mini 请求 = 1 query + 2 小文档，复用同一客户端与错误分型。
 * gateway（Lane B）包成 TestKeyReply 同款 ok/error 回复。
 */
export async function testRerank(config: RerankConfig, options: RerankCallOptions = {}): Promise<RerankResultItem[]> {
  return rerankDocuments(
    config,
    {
      query: 'rerank connectivity test',
      documents: [
        'Juso aggregate search connectivity probe document one.',
        'Juso aggregate search connectivity probe document two.',
      ],
      top_n: 2,
    },
    options,
  );
}
