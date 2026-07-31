import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, titleText } from './shared';

// 白空格规整（与 shared.normalizeText 同语义，但这些数字/作者字段都很短，无需截断长度参数）。
const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

// 哔哩哔哩搜索结果抽取器（search.bilibili.com/all?keyword=…）。
// 真机 DevTools 复核（2026-07-31）：结果为 Vue SPA，卡片根 .bili-video-card，标题
// .bili-video-card__info--tit（H3，纯文本无 <a>），视频链接在封面区且为 protocol-relative
// （//www.bilibili.com/video/BVxxx/）。列表含两类卡（统一抽取，按 skill 文档说明）：
//   ① 真结果卡：含 .bili-video-card__info--owner（UP主 + 日期）、stats 为「播放 弹幕」两项；
//   ② 顶部「作者最新视频」聚合卡：无 owner、stats 仅播放一项——缺失字段优雅降级跳过。
// snippet 为富元数据拼接：UP主: X · 播放: X · 弹幕: X · 时长: X，缺哪项跳哪项。

const CARD_SELECTOR = '.bili-video-card';
const VIDEO_LINK_SELECTOR = 'a[href*="/video/"], a[href*="/bangumi/"], a[href*="/cheese/"]';
// 广告/推广兜底排除（真机未见广告卡，保留以备布局变动）。
const AD_SELECTOR = '[class*="advert" i], [data-ad], [class*="promotion" i]';

function cardUrl(item: Element, pageUrl: string): string | null {
  const anchor = item.querySelector<HTMLAnchorElement>(VIDEO_LINK_SELECTOR);
  return anchor ? absoluteHttpUrl(anchor.getAttribute('href'), pageUrl) : null;
}

// 将数字字段（播放/弹幕）从 .bili-video-card__stats--left 的 .bili-video-card__stats--item 子项中取出。
// 返回顺序：[播放, 弹幕?]；聚合卡仅 1 项（无弹幕）。
function statItems(item: Element): string[] {
  const left = item.querySelector('.bili-video-card__stats--left');
  if (!left) return [];
  return [...left.querySelectorAll('.bili-video-card__stats--item')]
    .map((el) => clean(el.textContent))
    .filter(Boolean);
}

function buildSnippet(item: Element): string {
  const parts: string[] = [];
  const author = clean(item.querySelector('.bili-video-card__info--author')?.textContent);
  if (author) parts.push(`UP主: ${author}`);
  const stats = statItems(item);
  if (stats[0]) parts.push(`播放: ${stats[0]}`);
  if (stats[1]) parts.push(`弹幕: ${stats[1]}`);
  const duration = clean(item.querySelector('.bili-video-card__stats__duration')?.textContent);
  if (duration) parts.push(`时长: ${duration}`);
  return parts.join(' · ');
}

export const bilibiliExtractor: EngineExtractor = {
  pageState(document): EngineExtractionErrorKind | null {
    // 极验验证码 / 风控挑战。
    if (document.querySelector('.geetest, #geetest-wrap, .captcha, #captcha, [class*="verify" i]')) return 'challenge';
    // 全屏登录遮罩（搜索本身不强制登录，此检测主要捕获风控/拦截态）。
    if (document.querySelector('.bili-mini-login-warp, .login-panel, [class*="login" i][class*="mask" i]')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector(`${CARD_SELECTOR}, .search-content`) !== null,
  extract(document, pageUrl): EngineResult[] {
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    return cards.flatMap((item) => {
      if (item.matches(AD_SELECTOR) || item.querySelector(AD_SELECTOR)) return [];
      const url = cardUrl(item, pageUrl);
      const title = titleText(item.querySelector('.bili-video-card__info--tit'));
      if (!url || !title) return [];
      const snippet = buildSnippet(item);
      return [{ title, url, snippet }];
    });
  },
};
