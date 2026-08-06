import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';
import { mapDoubaoError, type DoubaoResponseMetadata } from './doubao-shared';
import { t } from '@/lib/i18n';

// POST https://open.feedcoopapi.com/search_api/web_search (Bearer)
// Custom版 web 搜索：返回 WebResults（title/url/snippet/summary/content/publishTime/rankScore）。
// 无综合答案字段（总结版已于 2026-06 起停止新增开通）。
interface DoubaoWebItem {
  Title?: string;
  Url?: string;
  Snippet?: string;
  Summary?: string;
  Content?: string;
  PublishTime?: string;
  LogoUrl?: string;
  RankScore?: number;
}
interface DoubaoResult {
  ResultCount?: number;
  WebResults?: DoubaoWebItem[];
}
interface DoubaoResponse {
  ResponseMetadata?: DoubaoResponseMetadata;
  Result?: DoubaoResult | null;
}

// ── Doubao Custom 可选设置（用户在设置页配置，gateway 读 storage 后通过 SearchOptions.providerSettings 传入）──

export const DOUBAO_TIME_RANGES = ['OneDay', 'OneWeek', 'OneMonth', 'OneYear'] as const;

export const DOUBAO_INDUSTRIES = ['finance', 'game', 'gov'] as const;
export type DoubaoIndustry = (typeof DOUBAO_INDUSTRIES)[number];

export interface DoubaoSettings {
  timeRange: string; // '' | 枚举值 | 'YYYY-MM-DD..YYYY-MM-DD'（含端点区间）
  needContent: boolean;
  needUrl: boolean;
  sites: string[]; // ≤20，| 分隔的完整域名
  blockHosts: string[]; // ≤5，| 分隔
  onlyAuthoritative: boolean; // Filter.AuthInfoLevel=1
  queryRewrite: boolean; // QueryControl.QueryRewrite
  contentFormat: 'text' | 'markdown';
  industry: '' | DoubaoIndustry;
}

export const DEFAULT_DOUBAO_SETTINGS: DoubaoSettings = {
  timeRange: '',
  needContent: false,
  needUrl: true,
  sites: [],
  blockHosts: [],
  onlyAuthoritative: false,
  queryRewrite: false,
  contentFormat: 'text',
  industry: '',
};

const DATE_RANGE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/;

/** Sanitize untrusted storage/UI input into a valid DoubaoSettings. */
export function normalizeDoubaoSettings(raw: unknown): DoubaoSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_DOUBAO_SETTINGS };
  const r = raw as Record<string, unknown>;
  const hostList = (v: unknown, limit: number): string[] =>
    Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim()).slice(0, limit) : [];
  const timeRange = (v: unknown): string =>
    typeof v === 'string'
      && ((DOUBAO_TIME_RANGES as readonly string[]).includes(v) || DATE_RANGE_PATTERN.test(v))
      ? v
      : '';
  const contentFormat = (v: unknown): 'text' | 'markdown' => (v === 'markdown' ? 'markdown' : 'text');
  const industry = (v: unknown): '' | DoubaoIndustry =>
    v === 'finance' || v === 'game' || v === 'gov' ? v : '';
  return {
    timeRange: timeRange(r.timeRange),
    needContent: r.needContent === true,
    // needUrl 默认 true（保持现状行为）：字段缺失时回落默认值，显式非 true 才视为关闭。
    needUrl: r.needUrl === undefined ? DEFAULT_DOUBAO_SETTINGS.needUrl : r.needUrl === true,
    sites: hostList(r.sites, 20),
    blockHosts: hostList(r.blockHosts, 5),
    onlyAuthoritative: r.onlyAuthoritative === true,
    queryRewrite: r.queryRewrite === true,
    contentFormat: contentFormat(r.contentFormat),
    industry: industry(r.industry),
  };
}

const ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search';
const LABEL = 'provider_doubao';

export const doubaoAdapter = defineProvider<DoubaoResponse>({
  id: 'doubao',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/doubao.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      const s = normalizeDoubaoSettings(opts.providerSettings);
      const filter: Record<string, unknown> = { NeedContent: s.needContent, NeedUrl: s.needUrl };
      if (s.sites.length) filter.Sites = s.sites.join('|');
      if (s.blockHosts.length) filter.BlockHosts = s.blockHosts.join('|');
      if (s.onlyAuthoritative) filter.AuthInfoLevel = 1;
      const body: Record<string, unknown> = {
        Query: query,
        SearchType: 'web',
        Count: opts.maxResults ?? 10,
        Filter: filter,
      };
      if (s.timeRange) body.TimeRange = s.timeRange;
      if (s.queryRewrite) body.QueryControl = { QueryRewrite: true };
      if (s.contentFormat !== 'text') body.ContentFormats = s.contentFormat;
      if (s.industry) body.Industry = s.industry;
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    if (!data.Result) throw mapDoubaoError(data.ResponseMetadata?.Error, t(LABEL));
    const results: NormalizedResult[] = (data.Result.WebResults ?? []).map((r) => ({
      title: r.Title ?? r.Url ?? '',
      url: r.Url ?? '',
      snippet: r.Snippet ?? r.Summary?.slice(0, 300) ?? '',
      content: r.Content || r.Summary || undefined,
      score: r.RankScore,
      publishedDate: r.PublishTime || undefined,
      favicon: r.LogoUrl || undefined,
    }));
    return { results };
  },
});
