// 小红书网页版常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// SERP URL 形如 https://www.xiaohongshu.com/search_result?keyword={关键词}。
import type { AnchorStrategy, SearchEngine } from './types';
import { isSerpUrl, isXiaohongshuSerpHostname } from './scopes';

const SERP_URL_TEMPLATE = 'https://www.xiaohongshu.com/search_result?keyword={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'keyword';
// 锚点候选（按优先级降序）；真机 devtools 复核（2026-07-22 / 07-23）：
//   小红书 SPA 会延迟渲染；#search-input 通常更早稳定，且 review 前正确位置在搜索栏下。
//   若把 .feeds-container 放首位，会在它出现后从搜索栏下「升级」到分类栏下 → 必然抖动。
//   因此：首选 #search-input（搜索栏下，稳定位置）；.feeds-container 仅作回退；
//   末位 #app 为 last-resort（仅预算将尽或仅它存在时挂；出现非兜底后再升级一次）。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#search-input', append: 'after' },
  { selector: '.feeds-container', append: 'before', alignTo: '.feeds-container' },
  { selector: '#app', append: 'first' },
];

export const xiaohongshuEngine: SearchEngine = {
  id: 'xiaohongshu',
  label: 'engine_xiaohongshu',
  favicon: '/icons/xiaohongshu.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_URL.origin + '/';
  },
  matches(url: string): boolean {
    try {
      // 小红书 SERP 路径有两种形式：/search_result 或 /search_result/（带尾斜杠），两者都接受。
      const parsed = new URL(url);
      if (!isXiaohongshuSerpHostname(parsed.hostname)) return false;
      if (parsed.protocol !== 'https:' || parsed.port !== '') return false;
      return parsed.pathname === '/search_result' || parsed.pathname === '/search_result/';
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
