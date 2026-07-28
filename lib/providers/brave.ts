import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

interface BraveResult {
  title?: string;
  url: string;
  description?: string;
  extra_snippets?: string[];
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const LABEL = 'provider_brave';

export const braveAdapter = defineProvider<BraveResponse>({
  id: 'brave',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/brave.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    method: 'GET',
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
        params: {
          q: query,
          count: String(Math.min(opts.maxResults ?? 8, 20)),
          result_filter: 'web',
          text_decorations: 'false',
        },
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.web?.results ?? []).map((result) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: result.description || result.extra_snippets?.join(' … ') || '',
    }));
    return { results };
  },
});
