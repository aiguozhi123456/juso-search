import { ProviderError } from './types';

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
    throw new ProviderError('network', '网络错误：无法连接服务');
  }
  // 非 2xx：保留状态码供 mapStatus 映射，不强制解析 body（错误体常为 HTML/纯文本）。
  if (!res.ok) {
    return { status: res.status, data: null as T };
  }
  try {
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    throw new ProviderError('parse', '响应解析失败');
  }
}

/** 把 HTTP 状态码映射为 ProviderError；2xx 返回 null。 */
export function mapStatus(status: number, label: string): ProviderError | null {
  if (status === 401 || status === 403)
    return new ProviderError('unauthorized', `${label}：无效或缺失 API key`, status);
  if (status === 429) return new ProviderError('rateLimit', `${label}：请求过频`, status);
  if (status >= 500) return new ProviderError('provider', `${label}：服务端错误 ${status}`, status);
  if (status >= 400) return new ProviderError('provider', `${label}：HTTP ${status}`, status);
  return null;
}
