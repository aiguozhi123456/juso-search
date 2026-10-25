// 外部 rerank 客户端（aggregate-search-rerank plan KTD6/KTD14）。
//
// 建在 lib/providers/http.ts 的 postJson + mapStatus 之上（错误映射/响应体脱敏免费获得）。
// 双协议，按 RerankConfig.protocol 分发（缺省 'cohere'，兼容旧数据）：
// - cohere：Cohere/Jina 风格 `/v1/rerank`（KTD14，vLLM/XInference/LiteLLM 兼容）：
//     请求  { model?, query, documents: string[], top_n? }
//     响应  { results: [{ index, relevance_score }] }
//   ⚠️ 不是 "OpenAI-compatible"——OpenAI 没有 rerank API，勿按 OpenAI 规范实现。
// - jev：TypeSafe SystemOne 决策模型（默认模型 jev-latest，线格式对齐 hotchpotch/jev-reranker
//   的 listwise 路径）：query + 全部候选文档放共享 state，每文档一条 noul 问题，
//     请求  { model, state: { query, documents: { doc_N } }, questions: { doc_N: { type:'noul', instructions, criteria } } }
//     响应  { answers: { doc_N: { type: 'noul', noul: 0~1 } } }——noul 即 relevance_score。
//
// 错误分型（RerankError.kind）：endpoint 未配置 → keyMissing；401/403 → unauthorized；
// 429 → rateLimit；5xx/4xx → provider；JSON 畸形/形状非法 → parse；传输失败/超时/取消 → network。
// gateway（Lane B）经 toSearchError 同款映射把 kind 免费映射进 reply。

import { extractProviderErrorDetail, mapStatus, postJson } from '../providers/http';
import { t, MSG } from '@/lib/i18n';
import { ProviderError } from '../providers/types';
import type { RerankConfig } from './types';

/** rerank 请求超时（KTD6：~10s，AbortController+setTimeout 与调用方 signal 组合）。 */
export const RERANK_TIMEOUT_MS = 10_000;

/** i18n 占位键名（Lane D 落 lib/i18n.ts + _locales/{zh_CN,en}/messages.json 双语条目；现阶段 t() 回退键名本身）。 */
export const MSG_RERANK_ENDPOINT_INVALID = 'error_rerank_endpoint_invalid';

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

/** 存储读侧归一（Default-by-Getter）：缺键/畸形 → 未配置态 `{ endpoint: '' }`；空串 apiKey/model 丢弃。
 *  protocol 仅 'jev' 落盘——缺省/其他值一律剥掉（= cohere 缺省），旧存储/旧导出零迁移。 */
export function normalizeRerankConfig(value: unknown): RerankConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { endpoint: '' };
  const candidate = value as Record<string, unknown>;
  const endpoint = typeof candidate.endpoint === 'string' ? candidate.endpoint.trim() : '';
  const model = typeof candidate.model === 'string' && candidate.model.trim() !== '' ? candidate.model.trim() : undefined;
  const apiKey = typeof candidate.apiKey === 'string' && candidate.apiKey.trim() !== '' ? candidate.apiKey : undefined;
  const protocol = candidate.protocol === 'jev' ? 'jev' as const : undefined;
  return { endpoint, ...(model ? { model } : {}), ...(apiKey ? { apiKey } : {}), ...(protocol ? { protocol } : {}) };
}

// === KTD12：endpoint 白名单（loopback + 硅基流动云端 + TypeSafe 云端）校验/规范化 ===
//
// 消费方：worker 侧 handleSetRerankConfig 与 config-io 导入（KTD13）共用本校验，保证两条写路径
// 语义一致。三条白名单分支：
// - loopback：`http://127.0.0.1`（manifest host_permissions 已含 `http://127.0.0.1/*`；localhost/
//   [::1]/https 不被覆盖）——「本地」威胁模型（搜索内容 + apiKey 不出 loopback）；
// - 硅基流动云端：`https://api.siliconflow.cn`（host 精确匹配，需 manifest 声明该 host permission）；
// - TypeSafe 云端（jev 协议官方端点）：`https://api.typesafe.ai`（host 精确匹配，同上）。
// 除白名单外不开放任意 https，保持收紧式校验。

export type RerankEndpointValidation =
  | { ok: true; /** 规范化后的 endpoint（localhost/[::1] 已改写为 127.0.0.1）。 */ endpoint: string; /** 输入是否经 localhost/[::1] 自动改写（reply 提示已改写）。 */ rewritten: boolean }
  | { ok: false; reason: 'invalid_url' | 'not_http' | 'not_loopback' };

/**
 * 校验并规范化 rerank endpoint（KTD12）：
 * - 解析 URL（不可解析 → invalid_url）；
 * - 携带 userinfo 凭据（user:pass@）→ invalid_url：url.href 会把凭据持久化并回显进
 *   page-facing snapshot（credential-exposure），且 UA 可能据 userinfo 注入与 Bearer apiKey
 *   竞争的 Authorization: Basic 头；
 * - host 为 `localhost` / `[::1]` → 自动改写 `127.0.0.1`（保留端口/路径，rewritten=true）；
 * - 白名单三选一，否则拒绝：`http + 127.0.0.1`（loopback）、`https + api.siliconflow.cn`
 *   （硅基流动云端）或 `https + api.typesafe.ai`（TypeSafe 云端，jev 协议官方端点；
 *   其他 https host 拒绝 not_loopback）。
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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not_http' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'invalid_url' };
  const loopback = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  const siliconflow = url.protocol === 'https:' && url.hostname === 'api.siliconflow.cn';
  const typesafe = url.protocol === 'https:' && url.hostname === 'api.typesafe.ai';
  if (!loopback && !siliconflow && !typesafe) return { ok: false, reason: 'not_loopback' };
  return { ok: true, endpoint: url.href, rewritten };
}

/**
 * 协议分发：cohere（缺省）→ Cohere/Jina 风格 /v1/rerank；jev → TypeSafe SystemOne listwise。
 * 两协议返回条目含义一致：documents 下标 + 相关性分数（调用方按分数降序稳定排序后写 score）。
 * 绝不把 apiKey 放进任何返回值——key 只进请求头。
 */
export async function rerankDocuments(config: RerankConfig, request: RerankRequestBody, options: RerankCallOptions = {}): Promise<RerankResultItem[]> {
  if (!isRerankConfigured(config)) {
    // keyMissing 语义对齐 R3：未配置 → 上层驱动 ErrorState 的设置入口 CTA。
    throw new RerankError('keyMissing', 'rerank endpoint is not configured');
  }
  if (config.protocol === 'jev') return jevRerankDocuments(config, request, options);
  return cohereRerankDocuments(config, request, options);
}

/** cohere 协议（缺省）：单条 /v1/rerank 请求，~10s 超时（KTD6）；top_n 转发服务端。 */
async function cohereRerankDocuments(config: RerankConfig, request: RerankRequestBody, options: RerankCallOptions): Promise<RerankResultItem[]> {
  const timeoutMs = options.timeoutMs ?? RERANK_TIMEOUT_MS;
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
    if (!response.ok) {
      // mapStatus 对一切非 2xx 抛错；?? 分支仅为类型收窄的兜底。
      const statusError = mapStatus(response.status, RERANK_LABEL, response.errorDetail)
        ?? new ProviderError('provider', `Rerank: HTTP ${response.status}`, response.status);
      throw statusError;
    }
    return validateRerankResults(response.data);
  } catch (e) {
    if (e instanceof RerankError) throw e;
    // 超时优先于通用 network 文案，便于上层区分「服务没起」与「起了但 10s 没回」。
    if (timedOut) throw new RerankError('network', `rerank request timed out after ${timeoutMs}ms`);
    if (e instanceof ProviderError) throw new RerankError(e.kind, e.message, e.status);
    // 注意不能加 instanceof Error 收窄：jsdom / 部分运行时的 DOMException 不继承 Error。
    if ((e as { name?: string } | null)?.name === 'AbortError') throw new RerankError('network', 'rerank request aborted');
    throw new RerankError('provider', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

// === jev 协议（TypeSafe SystemOne）===
//
// listwise：一次请求带 query + 全部候选文档（共享 state），每文档一条 noul 问题，响应
// answers.doc_N.noul ∈ [0,1] 直接作 relevance_score。线格式对齐 hotchpotch/jev-reranker
// 默认路径（model/instructions/criteria 命名、{document} → `documents.doc_N` 占位替换）。
// 无 top_n——SystemOne 无此参数，topN 截断由调用方 applyRerankOrdering 统一处理。
// 云端对全池判定较慢（生成式逐文档判断），整体超时放宽 30s（cohere 保持 10s）。

/** SystemOne 缺省模型 id（对齐 jev-reranker 缺省）：protocol=jev 且 model 未填时使用。 */
export const JEV_DEFAULT_MODEL = 'jev-latest';

/** jev 协议整体超时：云端判定全池慢于本地 cross-encoder；KTD6 语义不变（与调用方 signal 同 controller）。 */
export const RERANK_JEV_TIMEOUT_MS = 30_000;

/** jev 单请求分块上限（防御性；候选池 40 × 文档 ≤ ~550 字符通常单请求即可）：文档条数与文档总字符双约束。 */
const JEV_CHUNK_MAX_DOCS = 20;
const JEV_CHUNK_MAX_DOC_CHARS = 20_000;

/** jev rerank 问题 preset（照搬 jev-reranker instructions.py 的 RERANK_INSTRUCTION）。 */
const JEV_RERANK_INSTRUCTIONS = 'Does {document} help answer `query`? Prefer passages with the specific facts needed.';
const JEV_RERANK_CRITERIA = {
  true: 'Contains specific information that answers or is necessary for answering the query',
  false: 'Unrelated, only tangentially related, or lacks the needed facts',
} as const;

/** SystemOne noul 问题。 */
interface JevQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

/** SystemOne 请求体：共享 state（query + doc_N 文档）+ 每文档一条问题。 */
interface JevRequestBody {
  model: string;
  state: { query: string; documents: Record<string, string> };
  questions: Record<string, JevQuestion>;
}

/** 原始响应体（宽松形状，validateJevAnswers 收紧）。 */
interface JevResponseBody {
  answers?: unknown;
}

/** 块内文档键：块内局部下标（全局下标 = 块起始 + 局部，由调用方映射回）。 */
function jevDocKey(localIndex: number): string {
  return `doc_${localIndex}`;
}

/** 构造一条 noul 问题：preset 的 {document} 占位替换为 `documents.doc_N` 引用（对齐 jev-reranker
 *  的 _question；用函数形态替换，防止替换文本中的 $ 序列被 replace 重解释）。 */
function buildJevQuestion(localIndex: number): JevQuestion {
  return {
    type: 'noul',
    instructions: JEV_RERANK_INSTRUCTIONS.replace('{document}', () => `\`documents.${jevDocKey(localIndex)}\``),
    criteria: { ...JEV_RERANK_CRITERIA },
  };
}

/** 组装一个 chunk 的 SystemOne 请求：model 未填用 jev-latest（normalizeRerankConfig 保证 model 已 trim）。 */
function buildJevRequest(config: RerankConfig, query: string, documents: string[], chunk: number[]): JevRequestBody {
  const stateDocuments: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  chunk.forEach((docIndex, localIndex) => {
    stateDocuments[jevDocKey(localIndex)] = documents[docIndex];
    questions[jevDocKey(localIndex)] = buildJevQuestion(localIndex);
  });
  return {
    model: config.model ?? JEV_DEFAULT_MODEL,
    state: { query, documents: stateDocuments },
    questions,
  };
}

/**
 * jev 分块：全局下标的顺序切分，文档条数 / 文档总字符触顶即断（候选池 40 × ~550 字符通常
 * 单请求即达；上限纯防御——防止候选池/文档上限日后调整后超大请求拖垮费用与延迟）。
 */
export function partitionJevChunks(documents: string[]): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  for (let i = 0; i < documents.length; i++) {
    const len = documents[i].length;
    if (current.length > 0 && (current.length >= JEV_CHUNK_MAX_DOCS || chars + len > JEV_CHUNK_MAX_DOC_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(i);
    chars += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 识别 SystemOne 的 400/422 `detail.error_type = "max_tokens_exceeded"`（拆分重试信号）。
 *  看原始 body：脱敏 errorDetail 只保留 message 型键值，不能可靠携带 error_type。 */
function isJevMaxTokensExceeded(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { detail?: { error_type?: unknown } } | null;
    return parsed?.detail?.error_type === 'max_tokens_exceeded';
  } catch {
    return false;
  }
}

/**
 * jev 专用 POST：不走 postJson——需要检视原始错误体识别 max_tokens_exceeded
 * （脱敏/映射仍复用 http.ts 链：extractProviderErrorDetail + mapStatus）。
 * AbortError 原样重抛，语义与 requestJson 一致。
 */
async function postJev(
  endpoint: string,
  body: JevRequestBody,
  apiKey: string | undefined,
  signal: AbortSignal,
  doFetch: typeof fetch,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; maxTokensExceeded: boolean; errorDetail?: string }> {
  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
    throw new ProviderError('network', t(MSG.error_http_network));
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      maxTokensExceeded: isJevMaxTokensExceeded(raw),
      errorDetail: extractProviderErrorDetail(raw),
    };
  }
  try {
    return { ok: true, data: await res.json() };
  } catch {
    throw new ProviderError('parse', t(MSG.error_http_parse));
  }
}

/** jev 响应收紧：answers 键与 doc_0..doc_N-1 一一对应、type === 'noul'、noul ∈ [0,1] 有限数 → parse。 */
function validateJevAnswers(data: unknown, localCount: number): number[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RerankError('parse', 'jev response is not a JSON object');
  }
  const answers = (data as JevResponseBody).answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new RerankError('parse', 'jev response is missing an answers object');
  }
  const scores: number[] = new Array(localCount).fill(Number.NaN);
  for (const [key, answer] of Object.entries(answers as Record<string, unknown>)) {
    const match = /^doc_(\d+)$/.exec(key);
    const localIndex = match ? Number(match[1]) : -1;
    if (localIndex < 0 || localIndex >= localCount) {
      throw new RerankError('parse', `jev answer key ${key} is out of range`);
    }
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new RerankError('parse', `jev answer ${key} is not an object`);
    }
    const { type, noul } = answer as Record<string, unknown>;
    if (type !== 'noul') {
      throw new RerankError('parse', `jev answer ${key} has an unexpected type`);
    }
    if (typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) {
      throw new RerankError('parse', `jev answer ${key} has an invalid noul score`);
    }
    scores[localIndex] = noul;
  }
  if (scores.some((score) => Number.isNaN(score))) {
    throw new RerankError('parse', 'jev response is missing answer entries');
  }
  return scores;
}

/** 单 chunk 计分（一次 listwise 请求）；max_tokens_exceeded → 对半拆分递归重试（两半并行；
 *  单文档仍超限 → 按状态码抛错，不无限递归）。 */
async function jevScoreChunk(
  config: RerankConfig,
  query: string,
  documents: string[],
  chunk: number[],
  doFetch: typeof fetch,
  signal: AbortSignal,
): Promise<number[]> {
  const response = await postJev(config.endpoint, buildJevRequest(config, query, documents, chunk), config.apiKey, signal, doFetch);
  if (!response.ok) {
    if (response.maxTokensExceeded && chunk.length > 1) {
      const mid = Math.floor(chunk.length / 2);
      const [left, right] = await Promise.all([
        jevScoreChunk(config, query, documents, chunk.slice(0, mid), doFetch, signal),
        jevScoreChunk(config, query, documents, chunk.slice(mid), doFetch, signal),
      ]);
      return [...left, ...right];
    }
    // mapStatus 对一切非 2xx 抛错；?? 分支仅为类型收窄的兜底。
    throw mapStatus(response.status, RERANK_LABEL, response.errorDetail)
      ?? new ProviderError('provider', `Rerank: HTTP ${response.status}`, response.status);
  }
  return validateJevAnswers(response.data, chunk.length);
}

/** jev 主流程：分块顺序请求（30s 整体超时/取消与 cohere 同语义），分数映射回全局下标。 */
async function jevRerankDocuments(config: RerankConfig, request: RerankRequestBody, options: RerankCallOptions): Promise<RerankResultItem[]> {
  const timeoutMs = options.timeoutMs ?? RERANK_JEV_TIMEOUT_MS;
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
    const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const items: RerankResultItem[] = [];
    for (const chunk of partitionJevChunks(request.documents)) {
      const scores = await jevScoreChunk(config, request.query, request.documents, chunk, doFetch, controller.signal);
      chunk.forEach((docIndex, localIndex) => {
        items.push({ index: docIndex, relevance_score: scores[localIndex] });
      });
    }
    return items;
  } catch (e) {
    if (e instanceof RerankError) throw e;
    // 超时优先于通用 network 文案，便于上层区分「服务没起」与「起了但 30s 没回」。
    if (timedOut) throw new RerankError('network', `rerank request timed out after ${timeoutMs}ms`);
    if (e instanceof ProviderError) throw new RerankError(e.kind, e.message, e.status);
    // 注意不能加 instanceof Error 收窄：jsdom / 部分运行时的 DOMException 不继承 Error。
    if ((e as { name?: string } | null)?.name === 'AbortError') throw new RerankError('network', 'rerank request aborted');
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
