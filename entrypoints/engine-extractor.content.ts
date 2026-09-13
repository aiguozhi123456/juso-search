import { extractEngineSearch } from '@/lib/engines/extractors';
import { matchEngineByUrl } from '@/lib/engines/registry';
import {
  BAIDU_SERP_HOSTS,
  BILIBILI_SERP_HOSTS,
  BING_SERP_HOSTS,
  DOUYIN_SERP_HOSTS,
  DUCKDUCKGO_SERP_HOSTS,
  ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS,
  GOOGLE_SERP_HOSTS,
  WEIXIN_SERP_HOSTS,
  XIAOHONGSHU_SERP_HOSTS,
  YANDEX_SERP_HOSTS,
  ZHANNEI_SERP_HOSTS,
  isEngineChallengeOrConsentUrlForHost,
} from '@/lib/engines/scopes';
import type { EngineId } from '@/lib/engines/types';

type Request = { type: 'juso:extract-engine-results'; requestId: string; engineId: EngineId; query: string; maxResults?: number; matchQuery?: string };

export default defineContentScript({
  matches: ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS,
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isRequest(message) || !matchesRequestUrl(message)) return undefined;
      return waitAndExtract(message).then((result) => ({ requestId: message.requestId, ...result }));
    });
  },
});

function matchesRequestUrl(request: Request): boolean {
  const url = new URL(location.href);
  if (isEngineChallengeOrConsentUrlForHost(url, hostsForEngine(request.engineId))) return true;
  // 站点实例搜索会落在 zhannei surface（baidu backing）上，主 registry 认不出该 host——
  // 用 matchEngineByUrl（主 registry + zhannei surface）识别后按 backing id 比对；
  // 构造模式把 site: 前缀并入 query 时，URL 实际携带文本由 matchQuery 提供。
  const surface = matchEngineByUrl(location.href);
  if (!surface || surface.id !== request.engineId) return false;
  const expected = (request.matchQuery ?? request.query).trim();
  return surface.extractQuery(location.href)?.trim() === expected;
}

function hostsForEngine(engineId: EngineId): readonly string[] {
  switch (engineId) {
    case 'google': return GOOGLE_SERP_HOSTS;
    case 'bing': return BING_SERP_HOSTS;
    case 'baidu': return [...BAIDU_SERP_HOSTS, ...ZHANNEI_SERP_HOSTS];
    case 'douyin': return DOUYIN_SERP_HOSTS;
    case 'xiaohongshu': return XIAOHONGSHU_SERP_HOSTS;
    case 'bilibili': return BILIBILI_SERP_HOSTS;
    case 'yandex': return YANDEX_SERP_HOSTS;
    case 'duckduckgo': return DUCKDUCKGO_SERP_HOSTS;
    case 'weixin': return WEIXIN_SERP_HOSTS;
  }
}

async function waitAndExtract(request: Request) {
  const deadline = Date.now() + 4000;
  while (true) {
    const result = extractEngineSearch({ document, engine: request.engineId, query: request.query, maxResults: request.maxResults, pageUrl: location.href });
    if ('results' in result || result.error === 'challenge' || result.error === 'consent' || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isRequest(value: unknown): value is Request {
  return typeof value === 'object' && value !== null && (value as Request).type === 'juso:extract-engine-results'
    && typeof (value as Request).requestId === 'string' && typeof (value as Request).query === 'string'
    && ['google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', 'weixin'].includes((value as Request).engineId)
    && ((value as Request).maxResults === undefined || (Number.isInteger((value as Request).maxResults) && (value as Request).maxResults! >= 1 && (value as Request).maxResults! <= 20))
    && ((value as Request).matchQuery === undefined || typeof (value as Request).matchQuery === 'string');
}
