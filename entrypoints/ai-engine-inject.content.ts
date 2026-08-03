// AI engine 注入 content script。
//
// 单入口按 host 分发到对应 injector。matches 仅列需要注入的 host（机制 2+3），
// 机制 1（纯 URL 导航）的站不在此声明——它们不需要任何 content script。
//
// MV3 下 content_scripts.matches 本身就是注入授权，不需要进 host_permissions。
// 按站精确匹配（https://chat.deepseek.com/*）而非宽匹配，遵循 KTD6 最小权限原则。
//
// 解析链：host → INJECT_HOST_TABLE（单一 host 表）取 engineId → registry.getAiEngine
// → execution.injectorKey → INJECTORS。registry 是 injectorKey 的唯一真相源。
//
// 可见性门控：AI engine 全部默认隐藏（见 ai-engines/registry.ts），用户显式显示后才
// 允许注入。fillAndSubmit 前向 worker 查 aiInjectAllowed（只读 sourceHidden，不碰 BYOK
// key）；门控查询失败 → fail closed，静默不注入。

import { HOST_TO_ENGINE_ID, INJECT_MATCH_PATTERNS, INJECTORS } from '@/lib/ai-engines/injectors';
import { resolveAllowedInjection } from '@/lib/ai-engines/injection-gate';
import { getAiEngine, isRegisteredAiEngineId } from '@/lib/ai-engines/registry';
import { sendMessage } from '@/lib/messaging';

export default defineContentScript({
  matches: [...INJECT_MATCH_PATTERNS],
  runAt: 'document_idle',
  async main() {
    const host = window.location.hostname;
    const engineId = HOST_TO_ENGINE_ID[host];
    if (!engineId || !isRegisteredAiEngineId(engineId)) return; // 非注入站/未注册，静默退出

    // 从 registry 解析注入器——registry 是 injectorKey 的唯一真相源
    const engine = getAiEngine(engineId);
    if (engine.execution.kind !== 'inject') return; // url-only 机制不在此列
    const injector = INJECTORS[engine.execution.injectorKey];
    if (!injector) return;

    const query = injector.extractQuery(window.location.href)?.trim();
    if (!query) return; // 无 query 参数（含纯空白，如 ?q=%20），静默退出（用户正常访问首页）

    // 可见性门控：仅当该 AI engine 未被 sourceHidden 收录时才注入（fail-closed）
    const allowed = await resolveAllowedInjection(
      HOST_TO_ENGINE_ID[host],
      async (id) => sendMessage('aiInjectAllowed', id),
    );
    if (!allowed) return; // 未启用或门控失败 → 静默退出

    try {
      await injector.fillAndSubmit(query);
    } catch {
      // 静默降级——任何异常都不打扰用户，让用户看到带 q 的页面手动操作
    }
  },
});
