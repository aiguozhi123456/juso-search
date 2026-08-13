import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

// POST https://api.parallel.ai/v1/search (x-api-key)
// 无 answer 字段；results[].excerpts 是字符串数组，join('\n\n') 作为 snippet/content。
interface ParallelResult {
  url: string;
  title: string;
  publish_date: string | null;
  excerpts: string[];
}
interface ParallelResponse {
  search_id?: string;
  results?: ParallelResult[];
  session_id?: string;
}

const ENDPOINT = 'https://api.parallel.ai/v1/search';
const LABEL = 'provider_parallel';

export const parallelAdapter = defineProvider<ParallelResponse>({
  id: 'parallel',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/parallel.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, _opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ objective: query, search_queries: [query] }),
      };
    },
  }),
  normalize(_query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.results ?? []).map((r) => {
      const joined = (r.excerpts ?? []).join('\n\n');
      return {
        title: r.title,
        url: r.url,
        snippet: joined,
        content: joined,
        publishedDate: r.publish_date ?? undefined,
      };
    });

    return { results };
  },
});
