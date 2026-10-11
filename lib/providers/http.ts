import { ProviderError, type ProviderTransport, type SearchOptions } from './types';
import { t, MSG } from '@/lib/i18n';

// REST 适配器共享的最小 HTTP 辅助：JSON GET/POST + 统一 network/parse 错误映射。

/**
 * 判别联合：非 2xx 时 `ok: false` 且 **没有** data 字段——调用方必须先判 `ok`
 * （或经 mapStatus 抛错）才能拿到 data，杜绝「类型声明 data:T 实际为 null」的谎言
 * （旧形状靠调用方恰好先 mapStatus 才侥幸不炸）。
 */
export type PostJsonResult<T> =
  | { status: number; ok: true; data: T }
  | { status: number; ok: false; errorDetail?: string };

export interface RequestJsonInit {
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /**
   * 可选 fetch 注入（rerank 客户端等 worker 路径用）。注入值必须已是包装形态
   * `(...args) => fetch(...args)`：SW 里把裸 fetch 存为对象属性再以方法形式调用会丢
   * WorkerGlobalScope receiver（Illegal invocation）——
   * 见 docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md。
   * 缺省时用自由函数形态调用全局 fetch（与既有适配器一致，天然安全）。
   */
  fetch?: typeof fetch;
}

export async function postJson<T>(
  url: string,
  init: RequestJsonInit & { body: string },
): Promise<PostJsonResult<T>> {
  return requestJson<T>(url, { ...init, method: 'POST' });
}

export async function getJson<T>(
  url: string,
  init: RequestJsonInit & { params?: Record<string, string> },
): Promise<PostJsonResult<T>> {
  const requestUrl = init.params ? `${url}?${new URLSearchParams(init.params).toString()}` : url;
  return requestJson<T>(requestUrl, { headers: init.headers, signal: init.signal, fetch: init.fetch, method: 'GET' });
}

async function requestJson<T>(
  url: string,
  init: RequestJsonInit & { method: 'GET' | 'POST' },
): Promise<PostJsonResult<T>> {
  // 见 RequestJsonInit.fetch 的包装形态要求（service-worker-fetch-illegal-invocation 教训）。
  const doFetch = init.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let res: Response;
  try {
    res = await doFetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });
  } catch (e) {
    // 取消（bridge deadline / 调用方 abort）是预期控制流而非 provider 失败：原样抛出，
    // 避免 AbortError 被伪装成 network 污染错误分型与用户文案
    //（与 gateway runProviderSearch 中止后重抛 AbortError 的语义一致）。
    if (init.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
    throw new ProviderError('network', t(MSG.error_http_network));
  }
  // 非 2xx：保留状态码供 mapStatus 映射；尽量提取 provider 的安全错误摘要，便于定位 400。
  if (!res.ok) {
    return { status: res.status, ok: false, errorDetail: await readProviderErrorDetail(res) };
  }
  try {
    return { status: res.status, ok: true, data: (await res.json()) as T };
  } catch {
    throw new ProviderError('parse', t(MSG.error_http_parse));
  }
}

/** 把 HTTP 状态码映射为 ProviderError；仅 2xx 返回 null（1xx/3xx/4xx/5xx 一律按异常，
 *  避免 304 这类经缓存代理透出的非 2xx 被当作成功、拿 data=null 的形状继续往下走）。
 *  label 为已解析的 provider 显示名。 */
export function mapStatus(status: number, label: string, detail?: string): ProviderError | null {
  if (status === 401 || status === 403)
    return new ProviderError('unauthorized', appendProviderErrorDetail(t(MSG.error_http_unauthorized, label), detail), status);
  if (status === 429) return new ProviderError('rateLimit', appendProviderErrorDetail(t(MSG.error_http_rate_limit, label), detail), status);
  if (status >= 500) return new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_http_server, [label, String(status)]), detail), status);
  if (status >= 200 && status < 300) return null;
  // 其余一切非 2xx（300–499 + 理论上的 1xx）→ provider。
  return new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_http_generic, [label, String(status)]), detail), status);
}

export async function readProviderErrorDetail(res: Response): Promise<string | undefined> {
  try {
    return extractProviderErrorDetail(await res.text());
  } catch {
    return undefined;
  }
}

export function appendProviderErrorDetail(message: string, detail?: string): string {
  return detail ? `${message}: ${detail}` : message;
}

function extractProviderErrorDetail(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // JSON body：只取已知错误键的值。JSON 解析成功但无已知错误键时返回 undefined——
  // 整个 raw body 可能携带内部信息（stack/route/config），不能进会透传到 UI/日志的 errorDetail。
  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(trimmed);
    isJson = true;
  } catch {
    // 非 JSON：走纯文本兜底。
  }
  if (isJson) {
    const fromJson = findProviderErrorMessage(parsed);
    return fromJson ? sanitizeProviderErrorDetail(fromJson) : undefined;
  }
  if (trimmed.startsWith('<')) return undefined;
  return sanitizeProviderErrorDetail(trimmed);
}

function findProviderErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProviderErrorMessage(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'msg', 'reason']) {
    const found = findProviderErrorMessage(record[key]);
    if (found) return found;
  }
  return undefined;
}

function sanitizeProviderErrorDetail(detail: string): string | undefined {
  const redacted = detail
    // 凭据 token 形态：Authorization 头的 Bearer / Basic scheme 值。
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    // 键值对形态：JSON body 键或 header 名（覆盖 Brave 的 X-Subscription-Token 与
    // access_token / refresh_token / session / secret / password / query 的 key= 等
    // 常见回显形态；`token`/`key` 无左边界，故 access_token、x-subscription-token
    // 等 *token/*key 形态一并覆盖）。
    .replace(
      /((?:api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|x-subscription-token|session[_-]?(?:id|token)|authorization|token|secret|password|key)["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
      '$1[redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!redacted) return undefined;
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

/** REST 传输配置。label 为 i18n 消息名，restTransport 内部一次性 t() 解析（消灭每个 adapter 的 t(LABEL)）。 */
export interface RestTransportConfig {
  endpoint: string;
  label: string;
  method?: 'GET' | 'POST';
  /** 可选 fetch 注入（文档化注入点，见 RequestJsonInit.fetch 的包装形态要求）。 */
  fetch?: typeof fetch;
  buildRequest(query: string, opts: SearchOptions, apiKey: string): {
    headers?: Record<string, string>;
    body?: string;
    params?: Record<string, string>;
  };
}

/** 把 postJson + mapStatus + throw 包成一个 ProviderTransport —— 即原 3 个 REST adapter 里
 *  逐字重复的两行样板。失败抛 ProviderError；成功返回已解析的响应体。 */
export function restTransport<TRaw>(cfg: RestTransportConfig): ProviderTransport<TRaw> {
  return {
    async send(query, opts, apiKey) {
      const request = cfg.buildRequest(query, opts, apiKey);
      const response = cfg.method === 'GET'
        ? await getJson<TRaw>(cfg.endpoint, { headers: request.headers, params: request.params, signal: opts.signal, fetch: cfg.fetch })
        : await postJson<TRaw>(cfg.endpoint, { headers: request.headers, body: request.body ?? '', signal: opts.signal, fetch: cfg.fetch });
      if (!response.ok) {
        // mapStatus 对一切非 2xx 抛错（见其注释）；?? 分支仅为类型收窄的兜底。
        throw mapStatus(response.status, t(cfg.label), response.errorDetail)
          ?? new ProviderError('provider', t(MSG.error_http_generic, [t(cfg.label), String(response.status)]), response.status);
      }
      return response.data;
    },
  };
}
