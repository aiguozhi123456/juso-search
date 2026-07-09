import { ProviderError, type ProviderTransport, type SearchOptions } from './types';
import { t, MSG } from '@/lib/i18n';

// REST 适配器共享的最小 HTTP 辅助：POST JSON + 统一 network/parse 错误映射。

export interface PostJsonResult<T> {
  status: number;
  data: T;
  errorDetail?: string;
}

export async function postJson<T>(
  url: string,
  init: { headers?: Record<string, string>; body: string },
): Promise<PostJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: init.headers, body: init.body });
  } catch {
    throw new ProviderError('network', t(MSG.error_http_network));
  }
  // 非 2xx：保留状态码供 mapStatus 映射；尽量提取 provider 的安全错误摘要，便于定位 400。
  if (!res.ok) {
    return { status: res.status, data: null as T, errorDetail: await readProviderErrorDetail(res) };
  }
  try {
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    throw new ProviderError('parse', t(MSG.error_http_parse));
  }
}

/** 把 HTTP 状态码映射为 ProviderError；2xx 返回 null。label 为已解析的 provider 显示名。 */
export function mapStatus(status: number, label: string, detail?: string): ProviderError | null {
  if (status === 401 || status === 403)
    return new ProviderError('unauthorized', appendProviderErrorDetail(t(MSG.error_http_unauthorized, label), detail), status);
  if (status === 429) return new ProviderError('rateLimit', appendProviderErrorDetail(t(MSG.error_http_rate_limit, label), detail), status);
  if (status >= 500) return new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_http_server, [label, String(status)]), detail), status);
  if (status >= 400) return new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_http_generic, [label, String(status)]), detail), status);
  return null;
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
  try {
    const fromJson = findProviderErrorMessage(JSON.parse(trimmed));
    if (fromJson) return sanitizeProviderErrorDetail(fromJson);
  } catch {
    // Fall through to plain-text handling.
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
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!redacted) return undefined;
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

/** REST 传输配置。label 为 i18n 消息名，restTransport 内部一次性 t() 解析（消灭每个 adapter 的 t(LABEL)）。 */
export interface RestTransportConfig {
  endpoint: string;
  label: string;
  buildRequest(query: string, opts: SearchOptions, apiKey: string): {
    headers?: Record<string, string>;
    body: string;
  };
}

/** 把 postJson + mapStatus + throw 包成一个 ProviderTransport —— 即原 3 个 REST adapter 里
 *  逐字重复的两行样板。失败抛 ProviderError；成功返回已解析的响应体。 */
export function restTransport<TRaw>(cfg: RestTransportConfig): ProviderTransport<TRaw> {
  return {
    async send(query, opts, apiKey) {
      const { status, data, errorDetail } = await postJson<TRaw>(cfg.endpoint, cfg.buildRequest(query, opts, apiKey));
      const err = mapStatus(status, t(cfg.label), errorDetail);
      if (err) throw err;
      return data;
    },
  };
}
