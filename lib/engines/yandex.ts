// Yandex 常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// SERP URL 形如 https://yandex.com/search?text=<query>（query 在 text 参数，canonical 路径 /search 无尾斜杠）。
// 主机覆盖全球站 yandex.com 与俄罗斯站 yandex.ru。
//
// ⚠️ 路径必须用无尾斜杠的 /search（非 /search/）：带尾斜杠会触发 Yandex 302 重定向到 /search，
// 而重定向链是 Yandex 反爬的高权重信号之一——每次跳转都极易触发人机验证（真机复核 2026-07-31）。
// matches() 仍兼容 /search 与 /search/（Yandex 重定向过程中两种都会出现），但 buildSerpUrl 只产 canonical 无斜杠形式。
import type { AnchorStrategy, SearchEngine } from './types';
import { isSerpUrl, isYandexSerpHostname } from './scopes';

const SERP_URL_TEMPLATE = 'https://yandex.com/search?text={q}';
const SERP_ORIGIN = new URL(SERP_URL_TEMPLATE).origin;
const QUERY_PARAM = 'text';
// 锚点候选（按优先级降序）：
//   首选 `#search-result + before + alignTo #search-result`：Yandex SSR 即渲染的稳定结果外壳，
//   host 作为其前置兄弟，沿其 content box 对齐宽度。
//   回退 `main + first`：当 #search-result 缺失时作为页面主区的第一个子元素兜底。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#search-result', append: 'before', alignTo: '#search-result' },
  { selector: 'main', append: 'first' },
];

export const yandexEngine: SearchEngine = {
  id: 'yandex',
  label: 'engine_yandex',
  favicon: '/icons/yandex.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return SERP_ORIGIN + '/';
  },
  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Yandex canonical SERP 路径为 /search（无尾斜杠）或 /search/（重定向过程中出现）。
      // 真机复核：验证后真实 URL 形如 /search?text=...&utm_referrer=...&lr=87，路径为 /search。
      // 用精确 boundary 拒绝 /searching、/search-result 等前缀巧合的非 canonical 路径。
      if (!isSerpUrl(parsed, isYandexSerpHostname, '/search', 'prefix')) return false;
      return /^\/search\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!isYandexSerpHostname(parsed.hostname)) return null;
      return parsed.searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
