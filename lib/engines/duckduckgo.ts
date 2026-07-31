// DuckDuckGo 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// SERP URL 形如 https://duckduckgo.com/?q=<query>（query 在 q 参数，canonical 路径为根 /）。
// DuckDuckGo 主站为 React 渲染：结果由客户端 hydration 异步挂载，
// 结果抽取的异步等待由 engine-extractor 的 waitAndExtract 轮询循环负责，本适配器只管导航。
import type { AnchorStrategy, SearchEngine } from './types';
import { isDuckDuckGoSerpHostname } from './scopes';

const SERP_URL_TEMPLATE = 'https://duckduckgo.com/?q={q}';
const SERP_ORIGIN = new URL(SERP_URL_TEMPLATE).origin;
const QUERY_PARAM = 'q';
// 锚点候选（按优先级降序），真机 DevTools 复核（2026-07-31）：
// DuckDuckGo 主站为 React 渲染，#react-results / main 实际不存在。
//   首选 `nav + after + alignTo nav`：tabs 导航条，与结果列同宽同列（left≈31, w≈672），
//   host 作为其后置兄弟落在 tabs 与结果列之间，沿 nav 宽度对齐。nav 由 SSR/早期渲染产出，持久。
//   回退 `#header_wrapper + after + alignTo #header_wrapper`：整页 header 外壳（w≈1000），更靠上但持久。
const ANCHORS: AnchorStrategy[] = [
  { selector: 'nav', append: 'after', alignTo: 'nav' },
  { selector: '#header_wrapper', append: 'after', alignTo: '#header_wrapper' },
];

export const duckduckgoEngine: SearchEngine = {
  id: 'duckduckgo',
  label: 'engine_duckduckgo',
  favicon: '/icons/duckduckgo.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_ORIGIN + '/';
  },
  matches(url: string): boolean {
    try {
      // DuckDuckGo canonical SERP 路径为根 /（与 google/bing 的 /search 不同）。
      const parsed = new URL(url);
      return parsed.protocol === 'https:'
        && parsed.port === ''
        && isDuckDuckGoSerpHostname(parsed.hostname)
        && parsed.pathname === '/';
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!isDuckDuckGoSerpHostname(parsed.hostname)) return null;
      return parsed.searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
