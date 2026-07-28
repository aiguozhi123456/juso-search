import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';
import { mapDoubaoError, type DoubaoResponseMetadata } from './doubao-shared';
import { t } from '@/lib/i18n';

// POST https://open.feedcoopapi.com/search_api/web_search (Bearer)
// Custom版 web 搜索：返回 WebResults（title/url/snippet/summary/content/publishTime/rankScore）。
// 无综合答案字段（总结版已于 2026-06 起停止新增开通）。
interface DoubaoWebItem {
  Title?: string;
  Url?: string;
  Snippet?: string;
  Summary?: string;
  Content?: string;
  PublishTime?: string;
  LogoUrl?: string;
  RankScore?: number;
}
interface DoubaoResult {
  ResultCount?: number;
  WebResults?: DoubaoWebItem[];
}
interface DoubaoResponse {
  ResponseMetadata?: DoubaoResponseMetadata;
  Result?: DoubaoResult | null;
}

const ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search';
const LABEL = 'provider_doubao';

export const doubaoAdapter = defineProvider<DoubaoResponse>({
  id: 'doubao',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/doubao.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          Query: query,
          SearchType: 'web',
          Count: opts.maxResults ?? 10,
          Filter: { NeedUrl: true },
        }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    if (!data.Result) throw mapDoubaoError(data.ResponseMetadata?.Error, t(LABEL));
    const results: NormalizedResult[] = (data.Result.WebResults ?? []).map((r) => ({
      title: r.Title ?? r.Url ?? '',
      url: r.Url ?? '',
      snippet: r.Snippet ?? r.Summary?.slice(0, 300) ?? '',
      content: r.Content || r.Summary || undefined,
      score: r.RankScore,
      publishedDate: r.PublishTime || undefined,
      favicon: r.LogoUrl || undefined,
    }));
    return { results };
  },
});
