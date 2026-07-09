import type { AnchorStrategy, EngineId, SearchEngine } from './types';
import { DEFAULT_ANCHOR } from './types';
import { googleEngine } from './google';
import { bingEngine } from './bing';

// 本轮仅接 Google + Bing（host_permissions 最小化，降低商店审核风险）。
// 国别域名（google.co.jp 等）后续按相同模式扩展：新增一个 lib/engines/<name>.ts + 在此注册。
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
  return Object.values(engines);
}

/** 根据 URL 识别当前所在 engine（content script 注入栏高亮当前用）；不匹配返回 null。 */
export function matchEngineByUrl(url: string): SearchEngine | null {
  return allEngines().find((e) => e.matches(url)) ?? null;
}

/** 从当前 SERP URL 提取查询词；非已知 engine 或无查询参数返回 null。 */
export function extractQuery(url: string): string | null {
  return matchEngineByUrl(url)?.extractQuery(url) ?? null;
}

/** 解析某 engine（可能为 null/未知）的锚点策略；null 时回退 DEFAULT_ANCHOR（= google 策略）。 */
export function anchorFor(engine: SearchEngine | null): AnchorStrategy {
  return engine?.anchor ?? DEFAULT_ANCHOR;
}
