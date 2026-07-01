import type {
  NormalizedAnswer,
  NormalizedResult,
  NormalizedSearchResponse,
  ProviderAdapter,
  SearchOptions,
} from './types';
import { ProviderError } from './types';
import { mapStatus, postJson } from './http';

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
const LABEL = 'Tavily';

export const tavilyAdapter: ProviderAdapter = {
  id: 'tavily',
  label: LABEL,
  supportsAnswer: true,
  async search(
    query: string,
    opts: SearchOptions,
    apiKey: string,
  ): Promise<NormalizedSearchResponse> {
    const { status, data } = await postJson<TavilyResponse>(ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        include_answer: true,
        max_results: opts.maxResults ?? 8,
      }),
    });

    const err = mapStatus(status, LABEL);
    if (err) throw err;

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

    return { query, provider: 'tavily', answer, results };
  },
};

export { ProviderError };
