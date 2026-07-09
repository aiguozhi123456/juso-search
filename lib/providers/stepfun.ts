import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

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
const LABEL = 'provider_stepfun';

export const stepfunAdapter = defineProvider<StepfunResponse>({
  id: 'stepfun',
  label: LABEL,
  supportsAnswer: false,
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, n: opts.maxResults ?? 8 }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet ?? '',
      content: r.content,
      publishedDate: r.time,
    }));

    return { results };
  },
});
