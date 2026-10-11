import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { isRenderedElement, normalizeText, SOCIAL_CHALLENGE_SELECTOR, SOCIAL_LOGIN_MODAL_SELECTOR } from './shared';

// 抖音搜索结果抽取器（www.douyin.com/search/{keyword}，query 在 path 段）。
// 真机 DevTools 复核（2026-07-31、2026-09-13）：重 SPA + 强反爬，与 B站/小红书 本质不同。
//
// 反爬/结构特征（决定了抽取方式）：
//   ① 视频卡内部无 <a> 标签——跳转走 JS 路由，DOM 挖不到 /video/ href；
//   ② 卡片根 .search-result-card，外层 [id^="waterfall_item_"] 带数字 id（= aweme_id）；
//   ③ class 多为混淆短哈希（Urz0LwnE/AMqhOzPC…），随构建变化，不可用作选择器；
//   ④ 视频无独立标题元素，文案/时长/点赞/作者混在一起。
//
// 文本契约不可靠——2026-09-13 回归的根因：抖音会随时抹掉 token 间空白。
//   2026-07-31 文本形如「00:10 15.8万 文案 @作者 · 时间」，2026-09-13 变成
//   「10:041.3万新疆…文案…#话题@作者 · 时间」（时长与点赞、话题与 @ 全部紧贴）。
//   依赖空白分隔的解析会整卡失配，表现为 no-results（卡片在、抽出 0 条）。
//   因此解析绝不依赖空白，按两层抽取、字段级合并：
//
//   • 主解析（叶子形状）：收集无元素子节点的叶子元素，按文本形状识别——
//     时长叶子（^\d{1,2}:\d{2}$）→ 视频卡；「图文」叶子 → 图文卡；皆无 → 非结果卡丢弃。
//     点赞 = 首个 ^[\d.]+万?$ 叶子；正文 = 最长叶子；作者 = 「@」叶子的下一兄弟元素。
//   • 兜底解析（宽容 blob）：叶子层未分类时对整卡 textContent 用不要求空白的
//     前缀正则分类（^\d{1,2}:\d{2} / ^图文），兼容旧空格格式与文案为裸文本节点的变体。
const WATERFALL_SELECTOR = '[id^="waterfall_item_"]';
const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

// 从 waterfall item 的 id 提取数字 aweme_id。
function awemeId(item: Element): string | null {
  const raw = item.id.replace('waterfall_item_', '');
  return /^\d{10,}$/.test(raw) ? raw : null;
}

// 卡片字段：kind 为 'video' | 'note'；缺失字段为空串。author 带前导 @（snippet 直接拼）。
interface CardFields { kind: 'video' | 'note'; likes: string; author: string; body: string }

const DURATION_LEAF = /^\d{1,2}:\d{2}$/;
// 亿：抖音确有「3.3亿获赞」级计数（见 douyin-basic fixture 用户聚合卡），缺单位会整字段丢失。
const LIKE_COUNT_LEAF = /^[\d.]+[万亿]?$/;
const NOTE_MARKER = '图文';

// 尾部「@作者 · 时间」拆分（时间可为「9小时前/32分钟前/6月25日/2025-12-08」等）。
// 锚定最后一个 @ 且其后存在「·」才拆——文案中段的 @ 提及/· 分隔不被误伤。
function splitAuthorTail(text: string): { body: string; author: string } {
  const at = text.lastIndexOf('@');
  if (at < 0) return { body: text, author: '' };
  const tail = text.slice(at + 1);
  const dot = tail.indexOf('·');
  if (dot < 0) return { body: text, author: '' };
  const name = tail.slice(0, dot).trim();
  return { body: text.slice(0, at).trim(), author: name ? `@${name}` : '' };
}

// ── 主解析：叶子形状（不依赖空白、不依赖拼接顺序）──────────────────────
// 实测 DOM（2026-09-13）：时长徽标/「图文」标记/点赞数/「@」/作者名/「· 时间」
// 各是独立叶子，文案是最长文本叶子（含 #话题）。相关搜索卡全是 <p> 叶子、
// 用户聚合卡无时长/图文叶子，两者皆在此层自然落空。
function parseCardFromLeaves(card: Element): CardFields | null {
  const leaves = [...card.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && clean(el.textContent) !== '',
  );
  const texts = leaves.map((el) => clean(el.textContent));
  let kind: 'video' | 'note';
  if (texts.some((t) => DURATION_LEAF.test(t))) kind = 'video';
  else if (texts.includes(NOTE_MARKER)) kind = 'note';
  else return null; // 用户聚合 / 相关搜索 / 直播 / 百科 —— 非结果卡
  const likes = texts.find((t) => LIKE_COUNT_LEAF.test(t)) ?? '';
  const caption = texts.reduce((a, b) => (b.length > a.length ? b : a), '');
  // 作者：优先「@」叶子的下一兄弟元素（作者名紧跟其后），退化用文案内尾拆分。
  const atLeaf = leaves[texts.indexOf('@')];
  const name = clean(atLeaf?.nextElementSibling?.textContent ?? null);
  // 作者已从叶子结构解析出时，caption 即完整文案本体（@ 尾是独立叶子）——
  // 不得再对 caption 跑 splitAuthorTail：文案自含「@某人 · …」中段提及会被误截甚至清空。
  const tail = name ? { body: caption, author: '' } : splitAuthorTail(caption);
  return { kind, likes, author: name ? `@${name}` : tail.author, body: tail.body };
}

// ── 兜底解析：宽容 blob（不要求空白，兼容 2026-07-31 空格格式与裸文本变体）──
// 形如「10:041.3万新疆…#话题@作者 · 时间」或「图文408文案…@作者 · 时间」。
function parseCardFromText(text: string): CardFields | null {
  let kind: 'video' | 'note';
  let rest: string;
  const videoMatch = text.match(/^\d{1,2}:\d{2}/);
  if (videoMatch) {
    kind = 'video';
    rest = text.slice(videoMatch[0].length);
  } else if (text.startsWith(NOTE_MARKER)) {
    kind = 'note';
    rest = text.slice(NOTE_MARKER.length);
  } else {
    return null;
  }
  let likes = '';
  const likeMatch = rest.match(/^\s*([\d.]+[万亿]?)/);
  if (likeMatch) {
    likes = likeMatch[1]!;
    rest = rest.slice(likeMatch[0].length);
  }
  const tail = splitAuthorTail(rest.trim());
  return { kind, likes, author: tail.author, body: tail.body };
}

// 字段级合并：叶子形状优先（结构化、可靠），blob 补缺（旧格式/裸文本变体）。
function parseCard(card: Element): CardFields | null {
  const fromLeaves = parseCardFromLeaves(card);
  const fromText = parseCardFromText(clean(card.textContent));
  if (!fromLeaves && !fromText) return null;
  return {
    kind: fromLeaves?.kind ?? fromText!.kind,
    likes: fromLeaves?.likes || fromText?.likes || '',
    author: fromLeaves?.author || fromText?.author || '',
    body: fromLeaves?.body || fromText?.body || '',
  };
}

export const douyinExtractor: EngineExtractor = {
  pageState(document): EngineExtractionErrorKind | null {
    // 验证码 / 滑块 / 风控挑战（共享社媒选择器 + 抖音特有 slider 滑块 token）。
    if (document.querySelector(`${SOCIAL_CHALLENGE_SELECTOR}, [class*="slider" i]`)) return 'challenge';
    // 全屏登录遮罩；SPA 常驻隐藏节点不算。
    const loginWall = document.querySelector(SOCIAL_LOGIN_MODAL_SELECTOR);
    if (loginWall && isRenderedElement(loginWall)) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector(`${WATERFALL_SELECTOR}, #search-result-container`) !== null,
  extract(document): EngineResult[] {
    const items = [...document.querySelectorAll(WATERFALL_SELECTOR)];
    return items.flatMap((item) => {
      const id = awemeId(item);
      if (!id) return [];
      const card = item.querySelector('.search-result-card') || item;
      const fields = parseCard(card);
      if (!fields) return [];
      const url = `https://www.douyin.com/${fields.kind === 'video' ? 'video' : 'note'}/${id}`;
      // title 取整段文案（normalizeText 截断到 300，语义正文在 title，不动）。
      const title = normalizeText(fields.body, 300) || '(无文案)';
      const snippetParts: string[] = [];
      if (fields.author) snippetParts.push(`作者: ${fields.author}`);
      if (fields.likes) snippetParts.push(`点赞: ${fields.likes}`);
      const snippet = snippetParts.join(' · ');
      return [{ title, url, snippet, snippetKind: 'metadata' }];
    });
  },
};
