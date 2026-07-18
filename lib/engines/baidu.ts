// Baidu 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
import type { AnchorStrategy, SearchEngine } from './types';
import { isBaiduSerpHostname, isSerpUrl } from './scopes';

const SERP_URL_TEMPLATE = 'https://www.baidu.com/s?wd={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'wd';
// 锚点候选（按优先级降序）：
//   首选 `#container + first`：作为 #container 的第一个子元素插入，自动继承父级宽度，
//   无需 alignTo rect 计算。
//   回退 `#content_left + before + alignTo #content_left`：当 #container 缺失时使用（旧布局）。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#container', append: 'first' },
  { selector: '#content_left', append: 'before', alignTo: '#content_left' },
];
// TODO(qa): 真机复核 — 值继承自 searchEngineJump v5.26.11，可能已过时
const PAGE_STYLES =
  '.headBlock,.se_common_hint{display:none !important} #wrapper>.result-molecule{z-index:300 !important} #searchTag{position:unset}';

export const baiduEngine: SearchEngine = {
  id: 'baidu',
  label: 'engine_baidu',
  favicon: '/icons/baidu.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_URL.origin + '/';
  },
  matches(url: string): boolean {
    try {
      return isSerpUrl(new URL(url), isBaiduSerpHostname, '/s');
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
  pageStyles: PAGE_STYLES,
};
