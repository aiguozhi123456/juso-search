import type {
  NormalizedResult,
  NormalizedSearchResponse,
  ProviderAdapter,
  SearchOptions,
} from './types';
import { mapStatus, postJson } from './http';

// POST https://api.stepfun.com/v1/search (Bearer，按量计费)
// 仅返回 results（snippet + content），无综合答案 -> supportsAnswer=false。
interface StepfunResult {
  url: string;
  position: number;
  title: string;
  time?: string;
  snippet?: string;
  content?: string;
}
interface StepfunResponse {
  query?: string;
  results?: StepfunResult[];
}

const ENDPOINT = 'https://api.stepfun.com/v1/search';
const LABEL = 'Stepfun 按量';

export const stepfunAdapter: ProviderAdapter = {
  id: 'stepfun',
  label: LABEL,
  supportsAnswer: false,
  async search(
    query: string,
    opts: SearchOptions,
    apiKey: string,
  ): Promise<NormalizedSearchResponse> {
    const { status, data } = await postJson<StepfunResponse>(ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, n: opts.maxResults ?? 8 }),
    });

    const err = mapStatus(status, LABEL);
    if (err) throw err;

    const results: NormalizedResult[] = (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet ?? '',
      content: r.content,
      publishedDate: r.time,
    }));

    return { query, provider: 'stepfun', answer: undefined, results };
  },
};
