import type { NormalizedAnswer, NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

// POST https://api.tavily.com/search (Bearer)
// include_answer=true -> answer 字符串；results[].content 是短摘要（snippet）。
interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  raw_content?: string | null;
  favicon?: string;
}
interface TavilyResponse {
  query?: string;
  answer?: string;
  results?: TavilyResult[];
}

const ENDPOINT = 'https://api.tavily.com/search';
const LABEL = 'provider_tavily';

export const tavilyAdapter = defineProvider<TavilyResponse>({
  id: 'tavily',
  label: LABEL,
  supportsAnswer: true,
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, include_answer: true, max_results: opts.maxResults ?? 8 }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? '',
      score: r.score,
      favicon: r.favicon,
      content: r.raw_content ?? undefined,
    }));

    const answer: NormalizedAnswer | undefined = data.answer
      ? { text: data.answer, citations: results.map((r) => ({ url: r.url, title: r.title })) }
      : undefined;

    return { answer, results };
  },
});
