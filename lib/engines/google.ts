// Google 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// serpUrlTemplate / queryParam 是本模块私有构造细节，不进 SearchEngine 公共契约。
import type { AnchorStrategy, SearchEngine } from './types';
import { isGoogleSerpHostname, isSerpUrl } from './scopes';

const SERP_URL_TEMPLATE = 'https://www.google.com/search?q={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'q';
// 锚点候选（按优先级降序）：
//   首选 `#rcnt + before + alignTo #center_col`：host 在 #rcnt 之外，排在 AI Overview 上方。
//   回退 `#center_col + first`：当 #rcnt 缺失时使用——会落到 AIO 下方（AIO 与 #center_col
//   在 #rcnt 内为兄弟节点，AIO 在前），仅作防御性兜底。详见
//   docs/solutions/ui-bugs/serp-bar-engine-specific-anchors.md 的 Update 段。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#rcnt', append: 'before', alignTo: '#center_col' },
  { selector: '#center_col', append: 'first' },
];

export const googleEngine: SearchEngine = {
  id: 'google',
  label: 'engine_google',
  favicon: '/icons/google.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_URL.origin + '/';
  },
  matches(url: string): boolean {
    try {
      return isSerpUrl(new URL(url), isGoogleSerpHostname);
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
