// 搜索页深链解析（v2 快切）：从 search.html?provider=X&query=Y 提取初始状态。
// 供 SERP 注入栏「点 AI chip → 跳 Juso 搜索页」与 background tabs.create 共用。

import type { ProviderId } from './providers/types';
import { isProviderId } from './sources';

export interface SearchDeepLink {
  provider?: ProviderId;
  query?: string;
}

/**
 * 解析搜索页深链参数。provider 仅在合法且已配置时返回（是否已配置由调用方比对）；
 * 此处只做 id 合法性校验。query 原样返回（去首尾空白前的原值，由调用方 trim）。
 */
export function parseSearchDeepLink(search: string): SearchDeepLink {
  const params = new URLSearchParams(search);
  const result: SearchDeepLink = {};
  const provider = params.get('provider');
  if (provider && isProviderId(provider)) result.provider = provider;
  const query = params.get('query');
  if (query) result.query = query;
  return result;
}

/** 构建 Juso 搜索页深链 URL（供 SERP 栏跳转用）。 */
export function buildSearchDeepLink(provider: ProviderId, query: string): string {
  const params = new URLSearchParams();
  params.set('provider', provider);
  params.set('query', query);
  return `search.html?${params.toString()}`;
}
