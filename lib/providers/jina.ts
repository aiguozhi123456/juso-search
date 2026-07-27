import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

// POST https://s.jina.ai/ (Bearer + Accept: application/json)
// X-Respond-With: no-content -> 轻量 SERP：data[] 含 title/description/url（无综合答案字段）。
interface JinaResult {
  title?: string;
  description?: string;
  url: string;
  content?: string;
  usage?: { tokens?: number };
}
interface JinaResponse {
  code?: number;
  status?: number;
  data?: JinaResult[];
}

const ENDPOINT = 'https://s.jina.ai/';
const LABEL = 'provider_jina';

export const jinaAdapter = defineProvider<JinaResponse>({
  id: 'jina',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/jina.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Retain-Images': 'none',
          'X-Respond-With': 'no-content',
        },
        body: JSON.stringify({ q: query, num: opts.maxResults ?? 5 }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.data ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.description ?? r.content?.slice(0, 300) ?? '',
      content: r.content || undefined,
    }));
    return { results };
  },
});
