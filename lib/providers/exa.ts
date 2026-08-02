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

// ── Exa 可选设置（用户在设置页配置，gateway 读 storage 后通过 SearchOptions.providerSettings 传入）──

export type ExaSearchType = 'auto' | 'fast' | 'instant' | 'deep-lite' | 'deep' | 'deep-reasoning';
export const EXA_SEARCH_TYPES: readonly ExaSearchType[] = ['auto', 'fast', 'instant', 'deep-lite', 'deep', 'deep-reasoning'];

export type ExaCategory = '' | 'company' | 'publication' | 'news' | 'personal site' | 'financial report' | 'people';
export const EXA_CATEGORIES: readonly ExaCategory[] = ['', 'company', 'publication', 'news', 'personal site', 'financial report', 'people'];

export interface ExaSettings {
  searchType: ExaSearchType;
  category: ExaCategory;
  includeDomains: string[];
  excludeDomains: string[];
  textMaxCharacters: number | null;
  highlightsMaxCharacters: number | null;
}

export const DEFAULT_EXA_SETTINGS: ExaSettings = {
  searchType: 'auto',
  category: '',
  includeDomains: [],
  excludeDomains: [],
  textMaxCharacters: null,
  highlightsMaxCharacters: null,
};

function isExaSearchType(v: unknown): v is ExaSearchType {
  return typeof v === 'string' && (EXA_SEARCH_TYPES as readonly string[]).includes(v);
}
function isExaCategory(v: unknown): v is ExaCategory {
  return typeof v === 'string' && (EXA_CATEGORIES as readonly string[]).includes(v);
}

/** Sanitize untrusted storage/UI input into a valid ExaSettings. */
export function normalizeExaSettings(raw: unknown): ExaSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_EXA_SETTINGS, includeDomains: [], excludeDomains: [] };
  const r = raw as Record<string, unknown>;
  const clampInt = (v: unknown, lo: number, hi: number, fallback: number | null): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : fallback;
  const domains = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim()) : [];
  return {
    searchType: isExaSearchType(r.searchType) ? r.searchType : 'auto',
    category: isExaCategory(r.category) ? r.category : '',
    includeDomains: domains(r.includeDomains),
    excludeDomains: domains(r.excludeDomains),
    textMaxCharacters: clampInt(r.textMaxCharacters, 1, 10000, null),
    highlightsMaxCharacters: clampInt(r.highlightsMaxCharacters, 1, 10000, null),
  };
}

const ENDPOINT = 'https://api.exa.ai/search';
const LABEL = 'provider_exa';

export const exaAdapter = defineProvider<ExaResponse>({
  id: 'exa',
  label: LABEL,
  supportsAnswer: true,
  favicon: '/icons/exa.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      const s = normalizeExaSettings(opts.providerSettings);
      const numResults = opts.maxResults ?? 8;
      const text = s.textMaxCharacters != null ? { maxCharacters: s.textMaxCharacters } : true;
      const highlights = s.highlightsMaxCharacters != null ? { maxCharacters: s.highlightsMaxCharacters } : true;
      return {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          query,
          type: s.searchType,
          numResults,
          ...(s.category ? { category: s.category } : {}),
          ...(s.includeDomains.length ? { includeDomains: s.includeDomains } : {}),
          ...(s.excludeDomains.length ? { excludeDomains: s.excludeDomains } : {}),
          outputSchema: { type: 'text', description: 'A concise synthesized answer to the query.' },
          contents: { text, highlights },
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
