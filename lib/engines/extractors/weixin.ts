import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, snippetText, titleText } from './shared';

// 搜狗微信公众号文章搜索结果抽取器（weixin.sogou.com/weixin?type=2&query=…）。
// 真机 DevTools + 6 个生产实现交叉验证（WechatSogou / RSSHub / SearXNG / SearchOS / feedgrab / BasicWebCrawler）：
// 结果列表容器 ul.news-list，单项 li（id 形如 sogou_vr_11002601_box_N）。
// 标题在 h3 a，摘要在 p.txt-info，公众号名在 .s-p a / .s-p .all-time-y2。
//
// ⚠️ URL 策略：h3 a 的 href 是搜狗跳转壳（weixin.sogou.com/link?url=…），不是 mp.weixin.qq.com 直链。
// 真实文章 URL 未嵌入 SERP DOM（服务端加密，无法客户端解码），需跟随重定向才能拿到。
// 本 extractor 同步返回跳转壳 URL（浏览器打开时会重定向到真实文章），与 SearXNG 做法一致。
const ITEM_SELECTOR = 'ul.news-list > li';
const TITLE_SELECTOR = 'h3 a';
const SNIPPET_SELECTOR = 'p.txt-info';
const ACCOUNT_SELECTOR = '.s-p .all-time-y2, .s-p a';

export const weixinExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    // 搜狗反爬：重定向到 /antispider/ 验证码页。
    if (/\/antispider(?:\/|$)/i.test(new URL(pageUrl, 'https://invalid.local').pathname)) return 'challenge';
    // 内容标记：验证码 / 异常访问提示。
    const bodyText = document.body?.textContent ?? '';
    if (/请输入验证码|此验证码用于确认|异常访问|用户您好/i.test(bodyText)) return 'challenge';
    // 反爬样式表加载。
    if (document.querySelector('link[href*="anti.min.css" i]')) return 'challenge';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector(ITEM_SELECTOR) !== null,
  extract(document, pageUrl): EngineResult[] {
    return [...document.querySelectorAll(ITEM_SELECTOR)].flatMap((item) => {
      const anchor = item.querySelector<HTMLAnchorElement>(TITLE_SELECTOR);
      const title = titleText(anchor);
      // 搜狗跳转壳 URL（weixin.sogou.com/link?url=…），解析为绝对地址。
      const url = anchor ? absoluteHttpUrl(anchor.getAttribute('href'), pageUrl) : null;
      if (!title || !url) return [];
      const snippet = snippetText(item.querySelector(SNIPPET_SELECTOR)) || buildWeixinSnippet(item);
      return [{ title, url, snippet }];
    });
  },
};

/** 摘要降级：无 p.txt-info 时，从公众号名 + 时间戳拼接富元数据。 */
function buildWeixinSnippet(item: Element): string {
  const parts: string[] = [];
  const account = (item.querySelector(ACCOUNT_SELECTOR)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (account) parts.push(`公众号: ${account}`);
  const scriptText = item.querySelector('.s-p script')?.textContent ?? '';
  const match = scriptText.match(/timeConvert\('(\d+)'\)/);
  if (match) {
    const date = new Date(Number.parseInt(match[1], 10) * 1000);
    if (!Number.isNaN(date.getTime())) parts.push(`时间: ${date.toISOString().slice(0, 10)}`);
  }
  return parts.join(' · ');
}
