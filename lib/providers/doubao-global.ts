import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';
import { mapDoubaoError, type DoubaoResponseMetadata } from './doubao-shared';
import { t } from '@/lib/i18n';

// POST https://open.feedcoopapi.com/search_api/global_search (Bearer)
// Global版：覆盖全球站点，返回 Documents（url/title/snippet[text]/publishTime）。
// 无综合答案字段。
interface DoubaoGlobalSnippet {
  Type?: string;
  Text?: string;
}
interface DoubaoGlobalDocument {
  Rank?: number;
  Url?: string;
  Title?: string;
  Snippet?: DoubaoGlobalSnippet[];
  DocumentInfo?: { PublishTime?: string };
  HostInfo?: { Hostname?: string; IconUrl?: string };
}
interface DoubaoGlobalResult {
  TotalDocCount?: number;
  Documents?: DoubaoGlobalDocument[];
}
interface DoubaoGlobalResponse {
  ResponseMetadata?: DoubaoResponseMetadata;
  Result?: DoubaoGlobalResult | null;
}

const ENDPOINT = 'https://open.feedcoopapi.com/search_api/global_search';
const LABEL = 'provider_doubao_global';

export const doubaoGlobalAdapter = defineProvider<DoubaoGlobalResponse>({
  id: 'doubao-global',
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
          DocCount: opts.maxResults ?? 10,
          MaxSnippetLength: 1000,
        }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    if (!data.Result) throw mapDoubaoError(data.ResponseMetadata?.Error, t(LABEL));
    const results: NormalizedResult[] = (data.Result.Documents ?? []).map((d) => {
      const textSnippets = (d.Snippet ?? []).filter((s) => s.Type === 'text').map((s) => s.Text ?? '');
      const joined = textSnippets.join('\n');
      return {
        title: d.Title ?? d.Url ?? '',
        url: d.Url ?? '',
        snippet: joined.slice(0, 300),
        content: joined || undefined,
        publishedDate: d.DocumentInfo?.PublishTime || undefined,
        favicon: d.HostInfo?.IconUrl || undefined,
      };
    });
    return { results };
  },
});
