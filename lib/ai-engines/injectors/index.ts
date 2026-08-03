// 注入器注册表：InjectorKey → AiEngineInjector 映射 + host 单一事实表。
//
// 仅 content script 上下文使用——injector 函数引用 DOM API，不能被 worker/UI import。
// registry.ts（纯数据）用 InjectorKey 标记，content script 经 host → INJECT_HOST_TABLE
// 取 engineId → registry.getAiEngine 取到 execution.injectorKey，再查此表——registry 是
// injectorKey 的唯一真相源。
//
// host 收敛（M1）：INJECT_HOST_TABLE 是 host 事实的唯一来源，INJECT_HOSTS /
// INJECT_MATCH_PATTERNS / HOST_TO_ENGINE_ID 全部由它派生。新增注入站只需改这一张表 +
// registry + INJECTORS + InjectorKey 联合，漏改任一处在不变量测试中立即暴露。

import type { AiEngineId, AiEngineInjector, InjectorKey } from '../types';
import { chatgptInjector } from './generic-enter';
import { deepseekInjector } from './deepseek';
import { doubaoInjector } from './doubao';
import { geminiInjector } from './gemini';

/** InjectorKey → injector 映射。content script 按 registry 的 execution.injectorKey 查此表。 */
export const INJECTORS: Record<InjectorKey, AiEngineInjector> = {
  'generic-enter:chatgpt': chatgptInjector,
  'deepseek': deepseekInjector,
  'doubao': doubaoInjector,
  'gemini': geminiInjector,
};

/** host 表条目：engineId 必须指向 registry 中已注册的 inject 型 engine；
 *  match 为可选的 matches 模式覆盖（默认整站 https://<host>/*，个别站收窄到指定路径）。 */
type InjectHostEntry = { engineId: AiEngineId; match?: string };

/** 注入站 host 事实表（唯一来源）。仅列需要注入的 host——grok 是 url-only，
 *  无 content script，不在此列。 */
const INJECT_HOST_TABLE: Record<string, InjectHostEntry> = {
  'chatgpt.com': { engineId: 'ai:chatgpt' },
  'chat.deepseek.com': { engineId: 'ai:deepseek' },
  'www.doubao.com': { engineId: 'ai:doubao', match: 'https://www.doubao.com/chat/*' },
  'gemini.google.com': { engineId: 'ai:gemini' },
};

/** host → AI engine id（门控与 content script 用；由 INJECT_HOST_TABLE 派生）。 */
export const HOST_TO_ENGINE_ID: Record<string, AiEngineId> = Object.fromEntries(
  Object.entries(INJECT_HOST_TABLE).map(([host, entry]) => [host, entry.engineId] as const),
);

/** 需要注入的 host 列表（用于 content script matches 声明）。 */
export const INJECT_HOSTS: readonly string[] = Object.keys(INJECT_HOST_TABLE);

/** matches 模式数组（默认整站 https://<host>/*，个别站用表内 match 覆盖），供 defineContentScript matches 使用。 */
export const INJECT_MATCH_PATTERNS: readonly string[] = INJECT_HOSTS.map(
  (host) => INJECT_HOST_TABLE[host].match ?? `https://${host}/*`,
);
