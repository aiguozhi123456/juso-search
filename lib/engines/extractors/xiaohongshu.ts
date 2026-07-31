import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, titleText } from './shared';

// 小红书搜索结果抽取器（www.xiaohongshu.com/search_result?keyword=…）。
// 真机 DevTools 复核（2026-07-31）：笔记瀑布流 SPA，卡片根 .note-item（.feeds-container 内）。
// 每张卡 .title（笔记标题，部分笔记无标题）、.author .name（作者名，干净不含日期）、
// .like-wrapper .count（点赞数）、笔记链接为相对路径 /explore/{id}（a[href*="/explore/"]）。
//
// 卡片混有两类（用链接存在性区分，一石二鸟）：
//   ① 真笔记：含 a[href*="/explore/"]，20/26 张；
//   ② 广告/直播/热搜卡：无 /explore/ 链接（且带 [class*="ad"]），6/26 张 → 缺链接即被丢弃。
// snippet 为富元数据拼接：作者: X · 点赞: X（笔记卡无独立正文）。无标题的笔记标题填占位。
const CARD_SELECTOR = '.note-item';
const NOTE_LINK_SELECTOR = 'a[href*="/explore/"]';

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

function buildSnippet(item: Element): string {
  const parts: string[] = [];
  const author = clean(item.querySelector('.author .name')?.textContent);
  if (author) parts.push(`作者: ${author}`);
  const likes = clean(item.querySelector('.like-wrapper .count')?.textContent);
  if (likes) parts.push(`点赞: ${likes}`);
  return parts.join(' · ');
}

export const xiaohongshuExtractor: EngineExtractor = {
  pageState(document): EngineExtractionErrorKind | null {
    // 验证码 / 风控挑战。
    if (document.querySelector('.captcha, #captcha, .geetest, #geetest-wrap, [class*="verify" i]')) return 'challenge';
    // 全屏登录遮罩（未登录时小红书常弹登录拦截）。
    if (document.querySelector('.login-container, #login-container, [class*="login" i][class*="modal" i], [class*="login" i][class*="mask" i]')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector(`${CARD_SELECTOR}, .feeds-container`) !== null,
  extract(document, pageUrl): EngineResult[] {
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    return cards.flatMap((item) => {
      // 笔记链接同时是真笔记判定 + 广告排除（广告/直播/热搜卡无 /explore/ 链接）。
      const anchor = item.querySelector<HTMLAnchorElement>(NOTE_LINK_SELECTOR);
      if (!anchor) return [];
      const url = absoluteHttpUrl(anchor.getAttribute('href'), pageUrl);
      if (!url) return [];
      // 无标题的笔记填占位，保证每条结果都有 title。
      const title = titleText(item.querySelector('.title')) || '(无标题)';
      const snippet = buildSnippet(item);
      return [{ title, url, snippet }];
    });
  },
};
