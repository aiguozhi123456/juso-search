// Google 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// serpUrlTemplate / queryParam 是本模块私有构造细节，不进 SearchEngine 公共契约。
import type { AnchorStrategy, SearchEngine } from './types';

const SERP_URL_TEMPLATE = 'https://www.google.com/search?q={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'q';
// Google → #search + before：host 作为 #search 前置兄弟落在 #center_col 内，自动继承
// 居中列对齐 search box（dogfood 验证定位准）。SPA 导航时 #search 元素身份保持、只更新
// 内部 #rso 子树，host 存活。
// 注：若日后 Google 改为像 Bing 那样重建 #search，需切到 #cnt/外壳 + alignTo 方案。
const ANCHOR: AnchorStrategy = { selector: '#search', append: 'before' };

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
      return new URL(url).host === SERP_URL.host;
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
  anchor: ANCHOR,
};
