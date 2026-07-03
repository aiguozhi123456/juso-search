import { ProviderError } from './types';
import { t, MSG } from '@/lib/i18n';

// REST 适配器共享的最小 HTTP 辅助：POST JSON + 统一 network/parse 错误映射。

export interface PostJsonResult<T> {
  status: number;
  data: T;
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
  // 非 2xx：保留状态码供 mapStatus 映射，不强制解析 body（错误体常为 HTML/纯文本）。
  if (!res.ok) {
    return { status: res.status, data: null as T };
  }
  try {
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    throw new ProviderError('parse', t(MSG.error_http_parse));
  }
}

/** 把 HTTP 状态码映射为 ProviderError；2xx 返回 null。label 为已解析的 provider 显示名。 */
export function mapStatus(status: number, label: string): ProviderError | null {
  if (status === 401 || status === 403)
    return new ProviderError('unauthorized', t(MSG.error_http_unauthorized, label), status);
  if (status === 429) return new ProviderError('rateLimit', t(MSG.error_http_rate_limit, label), status);
  if (status >= 500) return new ProviderError('provider', t(MSG.error_http_server, [label, String(status)]), status);
  if (status >= 400) return new ProviderError('provider', t(MSG.error_http_generic, [label, String(status)]), status);
  return null;
}
