import type { NormalizedAnswer, NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

// POST https://api.exa.ai/search (x-api-key)
// outputSchema:{type:'text'} -> output.content（综合答案）+ output.grounding（字段级引用）
// contents:{text,highlights} -> 富结果。
interface ExaResult {
  title?: string;
  url: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
  favicon?: string;
}
interface ExaGroundingCitation {
  url: string;
  title?: string;
}
interface ExaGrounding {
  citations?: ExaGroundingCitation[];
}
interface ExaOutput {
  content?: string;
  grounding?: ExaGrounding[];
}
interface ExaResponse {
  results?: ExaResult[];
  output?: ExaOutput;
}

const ENDPOINT = 'https://api.exa.ai/search';
const LABEL = 'provider_exa';

export const exaAdapter = defineProvider<ExaResponse>({
  id: 'exa',
  label: LABEL,
  supportsAnswer: true,
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          query,
          type: 'auto',
          numResults: opts.maxResults ?? 8,
          outputSchema: { type: 'text', description: 'A concise synthesized answer to the query.' },
          contents: { text: true, highlights: true },
        }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.results ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.highlights?.join(' … ') ?? r.text?.slice(0, 300) ?? '',
      content: r.text,
      publishedDate: r.publishedDate,
      favicon: r.favicon,
    }));

    let answer: NormalizedAnswer | undefined;
    if (data.output?.content) {
      const seen = new Set<string>();
      const citations: { url: string; title?: string }[] = [];
      for (const g of data.output.grounding ?? []) {
        for (const c of g.citations ?? []) {
          if (c.url && !seen.has(c.url)) {
            seen.add(c.url);
            citations.push({ url: c.url, title: c.title });
          }
        }
      }
      const fallback = results.map((r) => ({ url: r.url, title: r.title }));
      answer = {
        text: data.output.content,
        citations: citations.length ? citations : fallback,
      };
    }

    return { answer, results };
  },
});
