import { ProviderError, type NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport, appendProviderErrorDetail } from './http';
import { t, MSG } from '@/lib/i18n';

// POST https://api.anysearch.com/v1/search (Bearer)
// 上游另有匿名 IP 限流层（402 时自动注册发凭证）；v1 不接——网关对所有 provider 有
// keyMissing 门，BYOK 一致要求配 key，匿名接入需"key 可选"机制，超出当前范围。
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
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
