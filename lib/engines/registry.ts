import type { EngineId, SearchEngine } from './types';

// 本轮仅接 Google + Bing（host_permissions 最小化，降低商店审核风险）。
// 国别域名（google.co.jp 等）后续按相同模式扩展。
const googleEngine: SearchEngine = {
  id: 'google',
  label: 'engine_google',
  favicon: '/icons/google.svg',
  serpUrlTemplate: 'https://www.google.com/search?q={q}',
  queryParam: 'q',
};

const bingEngine: SearchEngine = {
  id: 'bing',
  label: 'engine_bing',
  favicon: '/icons/bing.svg',
  serpUrlTemplate: 'https://www.bing.com/search?q={q}',
  queryParam: 'q',
};

const engines: Record<EngineId, SearchEngine> = {
  google: googleEngine,
  bing: bingEngine,
};

export function getEngine(id: EngineId): SearchEngine {
  const engine = engines[id];
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

export function allEngines(): SearchEngine[] {
  return [engines.google, engines.bing];
}

/** 构建某 engine 的 SERP 查询 URL。 */
export function buildSerpUrl(engine: SearchEngine, query: string): string {
  return engine.serpUrlTemplate.replace('{q}', encodeURIComponent(query));
}

/** 构建 engine 首页 URL（无查询时跳转用，如 https://www.google.com/）。 */
export function buildEngineHomeUrl(engine: SearchEngine): string {
  return new URL(engine.serpUrlTemplate).origin + '/';
}

/** 根据 URL 识别当前所在 engine（content script 注入栏高亮当前用）；不匹配返回 null。 */
export function matchEngineByUrl(url: string): SearchEngine | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const engine of allEngines()) {
    const templateHost = new URL(engine.serpUrlTemplate).host;
    if (parsed.host === templateHost) return engine;
  }
  return null;
}

/** 从当前 SERP URL 提取查询词；非已知 engine 或无查询参数返回 null。 */
export function extractQuery(url: string): string | null {
  const engine = matchEngineByUrl(url);
  if (!engine) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.searchParams.get(engine.queryParam);
}
