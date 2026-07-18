// Bing 常规搜索引擎适配器：纯导航目标。
// 锚点说明（从原 serp-anchor.ts 迁移）：host 插在 #b_content **之前**（不进入结果外壳内部，
// 避开 overlay/inline 布局），运行时按 #b_content 的 content box 同步 host 宽度/左边距。
// #b_content 是 Bing SPA 导航的外壳：首屏 SSR 即存在，SPA 导航只重建其内部 main/#b_results，
// host 作为它的前置兄弟既不会被内部重建带走，也不继承 Bing BM 对 #b_content 的 visibility 隐藏。
// Bing 故意**无锚点级联**：searchEngineJump v5.26.11 的 Bing 规则同样是 `#b_content + before`，
// 没有更优的首选锚点可借鉴，因此只保留单元素候选数组。
// dogfood 维护说明：Google/Bing 改版可能改这些 ID；真机复核后再改此处即可。
import type { AnchorStrategy, SearchEngine } from './types';
import { isBingSerpHostname, isSerpUrl } from './scopes';

const SERP_URL_TEMPLATE = 'https://www.bing.com/search?q={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'q';
const ANCHORS: AnchorStrategy[] = [
  { selector: '#b_content', append: 'before', alignTo: '#b_content' },
];

export const bingEngine: SearchEngine = {
  id: 'bing',
  label: 'engine_bing',
  favicon: '/icons/bing.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_URL.origin + '/';
  },
  matches(url: string): boolean {
    try {
      return isSerpUrl(new URL(url), isBingSerpHostname);
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      return new URL(url).searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
