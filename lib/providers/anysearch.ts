import { ProviderError, type NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport, appendProviderErrorDetail } from './http';
import { t, MSG } from '@/lib/i18n';

// POST https://api.anysearch.com/v1/search (Bearer)
// 免 key 免费层：/v1/* key 可选（官方匿名层，按 IP 限速/限额）；无 key 省略 Bearer。
// 匿名 402 = 免费额度触顶、上游回自动注册凭证：响应体敏感（含生成的 key），必须丢弃
// errorDetail、只回专用限速文案（overrideStatusError 特判，绝不进透传链）。
// 业务码信封 {code, message, request_id, data}：错误按 HTTP 状态码传递，HTTP 200 +
// code!==0 仅防御分支。title 可为空串（回退 url）；无综合答案字段；max_results 上限 10
// （maxResults 存储侧 clamp 是 1–20，适配器内再收到上游上限）。
interface AnySearchResult {
  title?: string;
  url: string;
  snippet?: string;
  content?: string;
}
interface AnySearchResponse {
  code?: number;
  message?: string;
  request_id?: string;
  data?: { results?: AnySearchResult[] };
}

const ENDPOINT = 'https://api.anysearch.com/v1/search';
const LABEL = 'provider_anysearch';

export const anysearchAdapter = defineProvider<AnySearchResponse>({
  id: 'anysearch',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/anysearch.svg',
  keyOptional: true,
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    overrideStatusError(status, label, _detail, apiKey) {
      // 仅匿名（免 key）路径特判 402；keyed 402 是计费问题，走默认 provider 分型。
      if (status === 402 && !apiKey) {
        return new ProviderError('rateLimit', t(MSG.error_anysearch_anonymous_exhausted, label));
      }
      return null;
    },
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ query, max_results: Math.min(Math.max(opts.maxResults ?? 10, 1), 10) }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    if (data.code !== undefined && data.code !== 0) {
      // code 是业务码不是 HTTP 状态码，复用 error_http_generic（"$1：HTTP $2"）会误导，
      // 与 doubao-shared 的 error_doubao_business 同理用专用模板。
      throw new ProviderError(
        'provider',
        appendProviderErrorDetail(t(MSG.error_anysearch_business, [t(LABEL), String(data.code)]), data.message),
      );
    }
    const results: NormalizedResult[] = (data.data?.results ?? []).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.snippet ?? '',
      content: r.content || undefined,
    }));
    return { results };
  },
});
