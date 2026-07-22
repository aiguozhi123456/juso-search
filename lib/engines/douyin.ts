// 抖音网页版常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// SERP URL 形如 https://www.douyin.com/search/{关键词}（query 在 path 段，非 query 参数）。
import type { AnchorStrategy, SearchEngine } from './types';
import { isDouyinSerpHostname, isSerpUrl } from './scopes';

const SERP_ORIGIN = 'https://www.douyin.com';
const SERP_PATH_PREFIX = '/search/';
// 锚点候选（按优先级降序）；真机 devtools 复核（2026-07-22）：
//   首选 `#search-result-container + before`：稳定挂载点。
//   回退 `#search-content-area + before`。
// 栏本身 position:fixed（见 serp-bar-styles.ts）；alignTo 用 #search-content-area
// （与搜索框同列、w≈801），不用更窄的 #search-result-container（w≈741）。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#search-result-container', append: 'before', alignTo: '#search-content-area' },
  { selector: '#search-content-area', append: 'before', alignTo: '#search-content-area' },
];
// 搜索框在 #douyin-header(fixed, h=56)；筛选区(综合/视频/用户…)在
// #search-toolbar-container(fixed, top=56, h=112) 内。栏 fixed 贴在 header 正下方(top=56)，
// 工具栏整体下移 ~66px（栏高）到 top=122，结果区同步 padding 避免被盖住。
// 真机复核：栏高约 66px，header 56 + 栏 66 = 122。
const PAGE_STYLES =
  '#search-toolbar-container{top:122px !important}'
  + '#search-content-area{padding-top:66px !important}'
  + '#search-result-container{padding-top:0 !important}';

export const douyinEngine: SearchEngine = {
  id: 'douyin',
  label: 'engine_douyin',
  favicon: '/icons/douyin.svg',
  buildSerpUrl(query: string): string {
    return `${SERP_ORIGIN}${SERP_PATH_PREFIX}${encodeURIComponent(query)}`;
  },
  buildHomeUrl(): string {
    return `${SERP_ORIGIN}/`;
  },
  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      // 仅 canonical 单段：/search/<keyword> 或 /search/<keyword>/，拒绝 /search/a/b 等嵌套路径。
      if (!isSerpUrl(parsed, isDouyinSerpHostname, SERP_PATH_PREFIX, 'prefix')) return false;
      return /^\/search\/[^/]+\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!isDouyinSerpHostname(parsed.hostname)) return null;
      // 抖音 query 在 path 单段：/search/<keyword>[/]；部分入口也会带 keyword 参数，作为兜底。
      const m = parsed.pathname.match(/^\/search\/([^/]+)\/?$/);
      if (m) return decodeURIComponent(m[1]!);
      return parsed.searchParams.get('keyword');
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
  pageStyles: PAGE_STYLES,
};
