import type { AnchorStrategy, EngineId, SearchEngine } from './types';
import { DEFAULT_ANCHORS } from './types';
import { googleEngine } from './google';
import { bingEngine } from './bing';
import { baiduEngine } from './baidu';

// 注册 Google、Bing 与 Baidu；各自支持的 SERP 主机由 scopes.ts 集中定义。
const engines: Record<EngineId, SearchEngine> = {
  google: googleEngine,
  bing: bingEngine,
  baidu: baiduEngine,
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

/** 解析某 engine（可能为 null/未知）的锚点候选列表；null 时回退 DEFAULT_ANCHORS（= google 策略）。 */
export function anchorsFor(engine: SearchEngine | null): AnchorStrategy[] {
  return engine?.anchors ?? DEFAULT_ANCHORS;
}
