// 聚合合并纯函数（aggregate-search-rerank plan R5/KTD2/KTD8）。
//
// 输入 = 各成功成员的 NormalizedSearchResponse（成员序），输出 = answers 聚合 +
// URL 归一去重合并 + provenance 合并 + 候选池裁剪。全部纯函数、无 IO，
// gateway（Lane B）在 rerank 前调用；不触碰任何密钥。

import type { NormalizedAnswer, NormalizedSearchResponse, NormalizedResult } from '../providers/types';
import type { AggregateAnswerEntry, AggregateMemberId, AggregateMergedResult } from './types';

/** rerank 前的候选池上限（KTD8）：topN ≤ 20 展示，候选池 40 留出重排挑选空间。 */
export const AGGREGATE_CANDIDATE_POOL_SIZE = 40;

/** rerank 文档 snippet 截断长度（KTD2：文档 = title + '\n' + snippet 截 512，不用 content）。 */
export const RERANK_DOCUMENT_SNIPPET_MAX = 512;

/**
 * 已知点击跟踪参数（R5「剥 utm_* 与 fbclid 等跟踪参数」的固定集合，键名不区分大小写）。
 * utm_ 前缀族单独按前缀匹配；此处只收列常见跨站 click-id / 营销参数。
 */
const TRACKING_PARAM_NAMES: ReadonlySet<string> = new Set([
  'fbclid', // Meta
  'gclid', 'gbraid', 'wbraid', 'dclid', // Google Ads / DoubleClick
  'msclkid', // Bing Ads
  'twclid', // X (Twitter)
  'ttclid', // TikTok
  'li_fat_id', // LinkedIn
  'igshid', // Instagram
  'mc_eid', // Mailchimp
  'yclid', // Yandex
]);

/**
 * URL 归一（R5）：小写 host、剥 utm_ 前缀与已知跟踪参数、去 hash、去尾斜杠（根路径 `/` 保留）。
 * 解析失败的输入原样（trim 后）返回——去重键退化为精确字符串比较，不丢结果。
 */
export function normalizeResultUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  const trackingParams: string[] = [];
  url.searchParams.forEach((_value, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAM_NAMES.has(lower)) trackingParams.push(name);
  });
  for (const name of trackingParams) url.searchParams.delete(name);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

/** 单个成员对合并的输入：成员 id + 该成员的归一化响应。数组顺序即成员序。 */
export interface AggregateMemberContribution {
  sourceId: AggregateMemberId;
  response: NormalizedSearchResponse;
}

export interface AggregateMergeOutput {
  /** 各成功成员的综合答案，成员序（R4：全部展示、不做取舍；无答案的成员跳过）。 */
  answers: AggregateAnswerEntry[];
  /** URL 归一去重 + provenance 合并后的结果，首现序，已裁剪到候选池上限（KTD3：rerank 输入即此池）。 */
  results: AggregateMergedResult[];
  /** 因 URL 归一后重复而被并入首现条目的结果条数（R13 meta 条「去重 D 条」）。 */
  dedupedCount: number;
}

/**
 * 合并全部成员贡献（R5）：首现保留去重；同 URL 多源命中时把 sourceId 并入首现条目的
 * sources（多徽标），不重复计条；answers 按成员序全部保留。纯函数。
 */
export function mergeAggregateMembers(contributions: readonly AggregateMemberContribution[]): AggregateMergeOutput {
  const answers: AggregateAnswerEntry[] = [];
  const byUrl = new Map<string, AggregateMergedResult>();
  const results: AggregateMergedResult[] = [];
  let dedupedCount = 0;
  for (const { sourceId, response } of contributions) {
    const answer: NormalizedAnswer | undefined = response.answer;
    if (answer) answers.push({ sourceId, answer });
    for (const result of response.results) {
      const key = normalizeResultUrl(result.url);
      const existing = byUrl.get(key);
      if (existing) {
        dedupedCount += 1;
        if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
        continue;
      }
      const merged: AggregateMergedResult = { ...result, sources: [sourceId] };
      byUrl.set(key, merged);
      results.push(merged);
    }
  }
  return { answers, results: results.slice(0, AGGREGATE_CANDIDATE_POOL_SIZE), dedupedCount };
}

/**
 * rerank 文档构造（KTD2）：恒为 title + '\n' + snippet(截 512)——不用 content。
 * 缓存 slim 白名单不含 content，用 content 会让排序随缓存命中状态漂移。
 *
 * 例外（KTD2 + 用户反馈修复）：`snippetKind === 'metadata'` 的结果（小红书/B站/抖音抽取器的
 * 纯展示元数据 snippet：作者/点赞/播放等，无语义正文）**剔除出重排文档**，文档 = 仅 title——
 * cross-encoder 被展示元数据稀释，实测（bge-reranker-v2-m3，query「三亚旅游攻略」）B站
 * 标题+元数据 0.086 vs 仅标题 0.483（塌 5.6 倍），社媒结果系统性沉底。元数据 snippet 仍保留
 * UI 展示（ResultCard 照常），仅不进重排。无标题笔记（'(无标题)' 占位）无文本信号、沉底是
 * 诚实行为，不做特殊处理。
 */
export function buildRerankDocument(result: Pick<NormalizedResult, 'title' | 'snippet' | 'snippetKind'>): string {
  if (result.snippetKind === 'metadata') return result.title;
  return `${result.title}\n${result.snippet.slice(0, RERANK_DOCUMENT_SNIPPET_MAX)}`;
}
