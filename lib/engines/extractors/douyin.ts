import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { normalizeText } from './shared';

// 抖音搜索结果抽取器（www.douyin.com/search/{keyword}，query 在 path 段）。
// 真机 DevTools 复核（2026-07-31）：重 SPA + 强反爬，与 B站/小红书 本质不同。
//
// 反爬特征（决定了抽取方式）：
//   ① 视频卡内部无 <a> 标签——跳转走 JS 路由，DOM 挖不到 /video/ href；
//   ② 卡片根 .search-result-card，外层 [id^="waterfall_item_"] 带数字 id（= aweme_id）；
//   ③ class 多为混淆短哈希（Urz0LwnE/AMqhOzPC…），随构建变化，不可用作选择器；
//   ④ 视频无独立标题元素，只有「时长 点赞 文案 @作者 · 时间」拼接的整段文本。
//
// 抽取策略：
//   • 卡片根 [id^="waterfall_item_"]（带数字 id）；内层 .search-result-card。
//   • URL 由 id 拼接：视频卡 → https://www.douyin.com/video/{id}，图文卡 → /note/{id}。
//   • 卡片按文本前缀分类：视频卡（^\d{1,2}:\d{2} 时长）、图文卡（^图文）；其余（用户聚合/
//     相关搜索/直播/百科）无有效结果内容，丢弃。
//   • title 取整段文案（截 300）；snippet 拆出尾部 @作者·时间 + 点赞数。
const WATERFALL_SELECTOR = '[id^="waterfall_item_"]';
const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

// 从 waterfall item 的 id 提取数字 aweme_id。
function awemeId(item: Element): string | null {
  const raw = item.id.replace('waterfall_item_', '');
  return /^\d{10,}$/.test(raw) ? raw : null;
}

// 拆分文案文本。抖音视频/图文卡文本形如：
//   「00:10 15.8万 #原神 ... 文案正文 @原神 · 9小时前」或「图文 461 文案 @作者 · 时间」
// 返回 { kind, likes, author, body }：kind 为 'video' | 'note'；缺失字段为空串。
interface CardFields { kind: 'video' | 'note'; likes: string; author: string; body: string }

function parseCardFields(text: string): CardFields | null {
  let kind: 'video' | 'note';
  let rest: string;
  if (/^\d{1,2}:\d{2}(?:\s|$)/.test(text)) {
    kind = 'video';
    rest = text;
  } else if (/^图文(?:\s|$)/.test(text)) {
    kind = 'note';
    rest = text;
  } else {
    return null; // 用户聚合 / 相关搜索 / 直播 / 百科 —— 非结果卡
  }
  let likes = '';
  const likeMatch = rest.match(/^\s*(?:\d{1,2}:\d{2}|图文)\s+([\d.]+万?)\s/);
  if (likeMatch) {
    likes = likeMatch[1]!;
    rest = rest.slice(likeMatch[0].length).trim();
  }
  // 尾部「@作者 · 时间」拆分（时间可为「9小时前/32分钟前/6月26日/2025-12-08」等）。
  let author = '';
  const tailMatch = rest.match(/^([\s\S]*?)\s+(@[^\s·][^·]*?)\s*·\s*[^@]+$/);
  if (tailMatch) {
    author = tailMatch[2]!.trim();
    rest = tailMatch[1]!.trim();
  }
  return { kind, likes, author, body: rest };
}

export const douyinExtractor: EngineExtractor = {
  pageState(document): EngineExtractionErrorKind | null {
    // 验证码 / 滑块 / 风控挑战。
    if (document.querySelector('.captcha, #captcha, .geetest, #geetest-wrap, [class*="verify" i], [class*="slider" i]')) return 'challenge';
    // 全屏登录遮罩。
    if (document.querySelector('[class*="login" i][class*="modal" i], [class*="login" i][class*="mask" i], #login-container')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector(`${WATERFALL_SELECTOR}, #search-result-container`) !== null,
  extract(document): EngineResult[] {
    const items = [...document.querySelectorAll(WATERFALL_SELECTOR)];
    return items.flatMap((item) => {
      const id = awemeId(item);
      if (!id) return [];
      const card = item.querySelector('.search-result-card') || item;
      const text = clean(card.textContent);
      if (!text) return [];
      const fields = parseCardFields(text);
      if (!fields) return [];
      const url = `https://www.douyin.com/${fields.kind === 'video' ? 'video' : 'note'}/${id}`;
      // title 取整段文案（normalizeText 截断到 300）。
      const title = normalizeText(fields.body, 300) || '(无文案)';
      const snippetParts: string[] = [];
      if (fields.author) snippetParts.push(`作者: ${fields.author}`);
      if (fields.likes) snippetParts.push(`点赞: ${fields.likes}`);
      const snippet = snippetParts.join(' · ');
      return [{ title, url, snippet }];
    });
  },
};
