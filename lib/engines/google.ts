// Google 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// serpUrlTemplate / queryParam 是本模块私有构造细节，不进 SearchEngine 公共契约。
import type { AnchorStrategy, SearchEngine } from './types';
import { isGoogleSerpHostname, isSerpUrl } from './scopes';

const SERP_URL_TEMPLATE = 'https://www.google.com/search?q={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'q';
// Google → #rcnt + before + #center_col 对齐：AI Overview 是 #rcnt 内、#center_col 前的
// 结果模块；host 必须置于 #rcnt 外才能排在 AIO 上方，同时按 #center_col content box 对齐。
const ANCHOR: AnchorStrategy = { selector: '#rcnt', append: 'before', alignTo: '#center_col' };

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
  anchor: ANCHOR,
};
