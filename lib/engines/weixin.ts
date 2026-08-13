// 搜狗微信公众号文章搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// SERP URL 形如 https://weixin.sogou.com/weixin?type=2&query={q}&ie=utf8
// （type=2 = 搜索文章；type=1 = 搜索公众号，DOM 不同，此处固定 type=2）。
// ie=utf8 必填——缺省时搜狗默认 GBK 编码，中文查询会乱码。
// 主机为 weixin.sogou.com 子域（搜狗主站 www.sogou.com 的微信频道）。
import type { AnchorStrategy, SearchEngine } from './types';
import { isSerpUrl, isWeixinSerpHostname } from './scopes';

const SERP_URL_TEMPLATE = 'https://weixin.sogou.com/weixin?type=2&query={q}&ie=utf8';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'query';
// 锚点候选（按优先级降序）：
//   首选 `#main + first`：作为 #main 的第一个子元素插入，继承父级宽度。
//   回退 `.results + before`：当 #main 缺失时，插在结果容器之前。
//   末位 `ul.news-list + before`：直接插在结果列表上方（最稳定的 SSR 元素）。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#main', append: 'first' },
  { selector: '.results', append: 'before' },
  { selector: 'ul.news-list', append: 'before' },
];

export const weixinEngine: SearchEngine = {
  id: 'weixin',
  label: 'engine_weixin',
  favicon: '/icons/weixin.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_URL.origin + '/';
  },
  matches(url: string): boolean {
    try {
      return isSerpUrl(new URL(url), isWeixinSerpHostname, '/weixin');
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!isWeixinSerpHostname(parsed.hostname)) return null;
      return parsed.searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
