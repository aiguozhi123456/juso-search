// Baidu 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
import type { AnchorStrategy, SearchEngine } from './types';
import { isBaiduSerpHostname, isSerpUrl } from './scopes';

const SERP_URL_TEMPLATE = 'https://www.baidu.com/s?wd={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'wd';
const ANCHOR: AnchorStrategy = { selector: '#content_left', append: 'before', alignTo: '#content_left' };

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
  anchor: ANCHOR,
};
