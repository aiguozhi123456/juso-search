// AI 对话引擎注册表：5 个预置站。
//
// 纯数据模块——被 worker（config 投影）、UI（快切栏渲染）、content script（host 分发）共享。
// 不引用 DOM API（injector 函数在 injectors/ 下，仅 content script 使用）。
//
// 三种执行机制：
//   - url-only（1 站）：Grok——原生预填+自动提交
//   - inject + generic-enter（1 站）：ChatGPT——原生预填但不提交，补 Enter
//   - inject + per-site（3 站）：DeepSeek / 豆包 / Gemini——完整注入
//
// 全部默认隐藏（需登录）——schema v6→v7 迁移并入 sourceHidden。
// 用户在设置页手动显示后才进快切栏。

import type { AiEngine, AiEngineId } from './types';

function buildUrlWithParam(baseUrl: string, param: string, query: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(param, query);
  return url.href;
}

export const AI_ENGINES: readonly AiEngine[] = [
  // ── 机制 1：纯 URL 导航（原生预填+自动提交） ──
  {
    id: 'ai:grok' as AiEngineId,
    label: 'ai_engine_grok',
    favicon: '/icons/ai-grok.svg',
    buildUrl: (q) => buildUrlWithParam('https://grok.com/', 'q', q),
    buildHomeUrl: () => 'https://grok.com/',
    execution: { kind: 'url-only' },
  },

  // ── 机制 2：原生预填但不提交（补 Enter） ──
  {
    id: 'ai:chatgpt' as AiEngineId,
    label: 'ai_engine_chatgpt',
    favicon: '/icons/ai-chatgpt.svg',
    buildUrl: (q) => buildUrlWithParam('https://chatgpt.com/', 'q', q),
    buildHomeUrl: () => 'https://chatgpt.com/',
    execution: { kind: 'inject', injectorKey: 'generic-enter:chatgpt' },
  },

  // ── 机制 3：完整注入 ──
  {
    id: 'ai:deepseek' as AiEngineId,
    label: 'ai_engine_deepseek',
    favicon: '/icons/ai-deepseek.svg',
    buildUrl: (q) => buildUrlWithParam('https://chat.deepseek.com/', 'q', q),
    buildHomeUrl: () => 'https://chat.deepseek.com/',
    execution: { kind: 'inject', injectorKey: 'deepseek' },
  },
  {
    id: 'ai:doubao' as AiEngineId,
    label: 'ai_engine_doubao',
    favicon: '/icons/ai-doubao-chat.svg',
    buildUrl: (q) => buildUrlWithParam('https://www.doubao.com/chat/', 'q', q),
    buildHomeUrl: () => 'https://www.doubao.com/chat/',
    execution: { kind: 'inject', injectorKey: 'doubao' },
  },
  {
    id: 'ai:gemini' as AiEngineId,
    label: 'ai_engine_gemini',
    favicon: '/icons/ai-gemini.svg',
    buildUrl: (q) => buildUrlWithParam('https://gemini.google.com/app', 'q', q),
    buildHomeUrl: () => 'https://gemini.google.com/app',
    execution: { kind: 'inject', injectorKey: 'gemini' },
  },
] as const;

const AI_ENGINE_MAP: ReadonlyMap<string, AiEngine> = new Map(
  AI_ENGINES.map((e) => [e.id, e]),
);

const AI_ENGINE_IDS: ReadonlySet<string> = new Set(AI_ENGINES.map((e) => e.id));

/** 全部 5 个预置 AI engine 默认隐藏（需登录）。schema v6→v7 迁移用。 */
export const DEFAULT_HIDDEN_AI_ENGINE_IDS: readonly string[] = AI_ENGINES.map((e) => e.id);

/** 获取某个 AI engine；未知 id 抛错。 */
export function getAiEngine(id: AiEngineId): AiEngine {
  const engine = AI_ENGINE_MAP.get(id);
  if (!engine) throw new Error(`Unknown AI engine: ${id}`);
  return engine;
}

/** 全部预置 AI engine。 */
export function allAiEngines(): AiEngine[] {
  return [...AI_ENGINES];
}

/** 全部预置 AI engine id。 */
export function allAiEngineIds(): AiEngineId[] {
  return AI_ENGINES.map((e) => e.id);
}

/** 判断字符串是否为已注册的预置 AI engine id。 */
export function isRegisteredAiEngineId(id: string): id is AiEngineId {
  return AI_ENGINE_IDS.has(id);
}
