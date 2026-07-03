import type {
  NormalizedResult,
  NormalizedSearchResponse,
  ProviderAdapter,
  SearchOptions,
} from './types';
import { ProviderError } from './types';
import { mcpWebSearch } from '../mcp-client';
import { t, MSG } from '@/lib/i18n';

// Stepfun Step Plan（订阅）：经 MCP web_search tool-call，复用月度 Credit。
// web_search 返回的 text 与按量 REST /v1/search 同构（探查确认），无综合答案。
interface StepfunResult {
  url: string;
  position: number;
  title: string;
  time?: string;
  snippet?: string;
  content?: string;
}
interface StepfunPayload {
  query?: string;
  results?: StepfunResult[];
}

const ENDPOINT = 'https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp';
const LABEL = 'provider_stepfun_plan';

export const stepfunPlanAdapter: ProviderAdapter = {
  id: 'stepfun-plan',
  label: LABEL,
  supportsAnswer: false,
  async search(
    query: string,
    _opts: SearchOptions,
    apiKey: string,
  ): Promise<NormalizedSearchResponse> {
    const text = await mcpWebSearch(ENDPOINT, apiKey, query);
    let payload: StepfunPayload;
    try {
      payload = JSON.parse(text) as StepfunPayload;
    } catch {
      throw new ProviderError('parse', t(MSG.error_mcp_parse));
    }
    const results: NormalizedResult[] = (payload.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet ?? '',
      content: r.content,
      publishedDate: r.time || undefined,
    }));
    return { query, provider: 'stepfun-plan', answer: undefined, results };
  },
};
