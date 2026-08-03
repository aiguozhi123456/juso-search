// AI 注入可见性门控纯函数。
//
// 纯逻辑 + 依赖注入——不 import browser/DOM（content script 传入 sendMessage 回调，
// 单测直接注入 mock queryAllowed，无需 mock 消息层）。三分支一律 fail-closed：
// engineId 缺失 / worker 返回 false / 查询抛错 → 不注入。

import type { AiEngineId } from './types';

/** 解析注入许可：engineId 缺失、worker 拒绝或查询抛错均返回 false（fail-closed）。 */
export async function resolveAllowedInjection(
  engineId: AiEngineId | undefined,
  queryAllowed: (engineId: AiEngineId) => Promise<boolean>,
): Promise<boolean> {
  if (!engineId) return false;
  try {
    return await queryAllowed(engineId);
  } catch {
    return false; // 门控查询失败 → 不注入（fail-closed）
  }
}
