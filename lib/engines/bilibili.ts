// 哔哩哔哩网页版常规搜索引擎适配器：纯导航目标，无 key / 无 answer / 无 search()。
// SERP URL 形如 https://search.bilibili.com/all?keyword={关键词}（全站搜索 canonical 路由在 search.bilibili.com 子域）。
import type { AnchorStrategy, SearchEngine } from './types';
import { isBilibiliSerpHostname } from './scopes';

const SERP_URL_TEMPLATE = 'https://search.bilibili.com/all?keyword={q}';
const QUERY_PARAM = 'keyword';
// 锚点候选（按优先级降序）；真机 devtools 复核（2026-07-26）：
//   .search-header 直接子级顺序：① .search-input（搜索框行）② .search-tabs（多功能栏：综合/视频/番剧…）
//   ③ .search-line（分隔线）④ 空 div。要求「搜索栏下方、多功能栏上方」→ 挂在 .search-input 之后。
//   搜索框 `.search-input-wrap`（在 .search-input 内）是 width:480px + margin:auto 居中（视口中心恒定），
//   外层都是全宽；alignTo 用它 → 栏宽≈469px、水平居中，中心对齐搜索框中心。
//   chips 在栏内默认 inline-flex 左对齐，由 serp-bar-styles.ts 的 [data-engine="bilibili"] 规则居中。
//   回退：.search-header（旧版结构，after 挂搜索头下）；末位 #i_cecream（应用根）作 last-resort。
const ANCHORS: AnchorStrategy[] = [
  { selector: '.search-input', append: 'after', alignTo: '.search-input-wrap' },
  { selector: '.search-header', append: 'after', alignTo: '.search-input-wrap' },
  { selector: '#i_cecream', append: 'first' },
];

export const bilibiliEngine: SearchEngine = {
  id: 'bilibili',
  label: 'engine_bilibili',
  favicon: '/icons/bilibili.svg',
  buildSerpUrl(query: string): string {
    return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query));
  },
  buildHomeUrl(): string {
    return 'https://www.bilibili.com/';
  },
  matches(url: string): boolean {
    try {
      // 哔哩哔哩 SERP 路径：/all 或 /all/（带尾斜杠），两者都接受；仅 canonical HTTPS、无端口。
      const parsed = new URL(url);
      if (!isBilibiliSerpHostname(parsed.hostname)) return false;
      if (parsed.protocol !== 'https:' || parsed.port !== '') return false;
      return parsed.pathname === '/all' || parsed.pathname === '/all/';
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!isBilibiliSerpHostname(parsed.hostname)) return null;
      return parsed.searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
