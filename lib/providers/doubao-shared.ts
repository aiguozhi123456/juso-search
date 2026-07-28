import { ProviderError } from './types';
import { appendProviderErrorDetail } from './http';
import { t, MSG } from '@/lib/i18n';

// 豆包搜索（Custom版 / Global版）共享的响应元信息与业务错误码映射。
// 两版接口均以 HTTP 200 + ResponseMetadata.Error + Result=null 返回逻辑错误，
// 需在 normalize 中检测并映射为 ProviderError（restTransport 仅处理非 2xx HTTP 错误）。

export interface DoubaoError {
  CodeN?: number;
  Code?: string;
  Message?: string;
}

export interface DoubaoResponseMetadata {
  RequestId?: string;
  Error?: DoubaoError;
}

/** 把豆包业务错误码映射为 ProviderError。label 为已解析的 provider 显示名。 */
export function mapDoubaoError(error: DoubaoError | undefined, label: string): ProviderError {
  const code = error?.CodeN ?? parseInt(error?.Code ?? '', 10);
  const message = error?.Message;
  // 10401 无效 Token / 10403 权限错误 / 700901 APIKey 无效 → unauthorized
  if (code === 10401 || code === 10403 || code === 700901) {
    return new ProviderError('unauthorized', appendProviderErrorDetail(t(MSG.error_http_unauthorized, label), message));
  }
  // 700429 并发限流 / 10406 免费额度用尽 / 10412 套餐额度不足 → rateLimit
  if (code === 700429 || code === 10406 || code === 10412) {
    return new ProviderError('rateLimit', appendProviderErrorDetail(t(MSG.error_http_rate_limit, label), message));
  }
  return new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_http_generic, [label, String(code ?? 'unknown')]), message));
}
