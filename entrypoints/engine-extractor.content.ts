import { extractEngineSearch } from '@/lib/engines/extractors';
import { getEngine } from '@/lib/engines/registry';
import {
  BAIDU_SERP_HOSTS,
  BING_SERP_HOSTS,
  ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS,
  GOOGLE_SERP_HOSTS,
  isEngineChallengeOrConsentUrlForHost,
} from '@/lib/engines/scopes';
import type { EngineId } from '@/lib/engines/types';

type Request = { type: 'juso:extract-engine-results'; requestId: string; engineId: EngineId; query: string; maxResults?: number };

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
  const engine = getEngine(request.engineId);
  const url = new URL(location.href);
  return isEngineChallengeOrConsentUrlForHost(url, hostsForEngine(request.engineId))
    || (engine.matches(location.href) && engine.extractQuery(location.href)?.trim() === request.query.trim());
}

function hostsForEngine(engineId: EngineId): readonly string[] {
  return engineId === 'google' ? GOOGLE_SERP_HOSTS : engineId === 'bing' ? BING_SERP_HOSTS : BAIDU_SERP_HOSTS;
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
    && ['google', 'bing', 'baidu'].includes((value as Request).engineId) && ((value as Request).maxResults === undefined || (Number.isInteger((value as Request).maxResults) && (value as Request).maxResults! >= 1 && (value as Request).maxResults! <= 20));
}
