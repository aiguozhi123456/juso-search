import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

// POST https://api.deepseek.com/v1/tools/search (Bearer)
// 无综合答案字段；results[].snippet 供 UI 展示、summary 供模型阅读（映射进 content）。
// need_content 默认关：计费按成功请求计（与条数无关），但拉全文增加时延，snippet+summary 已覆盖两面。
// query 支持 site:/-site:/引号/lang:/after:/before: 运算符（透传即可）。
interface DeepSeekResult {
  title?: string;
  url: string;
  snippet?: string;
  summary?: string;
  content?: string;
  rerank_score?: number;
  site_name?: string | null;
  site_icon?: string | null;
  date?: string | null;
}
interface DeepSeekResponse {
  results?: DeepSeekResult[];
}

const ENDPOINT = 'https://api.deepseek.com/v1/tools/search';
const LABEL = 'provider_deepseek';

export const deepseekAdapter = defineProvider<DeepSeekResponse>({
  id: 'deepseek',
  label: LABEL,
  supportsAnswer: false,
  // 与 ai:deepseek 对话引擎同品牌，共享品牌图标。
  favicon: '/icons/ai-deepseek.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, count: Math.min(Math.max(opts.maxResults ?? 10, 1), 50) }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.results ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.snippet || r.summary || '',
      content: r.summary || undefined,
      score: r.rerank_score,
      publishedDate: r.date ?? undefined,
      favicon: r.site_icon ?? undefined,
    }));
    return { results };
  },
});
