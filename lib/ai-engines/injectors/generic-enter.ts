// 机制 2 注入器：ChatGPT。
//
// ChatGPT 原生支持 URL query 预填（?q=），但只填入输入框不自动提交。
// 注入器只需找到输入框、聚焦、派发合成 Enter——不碰选择器漂移、不碰状态管理，
// 因为原生预填已保证输入框内容正确。
//
// 来源：@librarian 规格表 §ChatGPT（zenn 2025-09、Reddit 实测）。

import type { AiEngineInjector } from '../types';
import { clearUrlQuery, dispatchEnter, extractQueryWithNavFallback, sleep, waitForElement } from './shared';

/** ChatGPT 输入框选择器（主 + 兜底）。 */
const CHATGPT_INPUT_SELECTORS = [
  '#prompt-textarea',
  'textarea[data-testid="prompt-textarea"]',
  'textarea[placeholder*="Message"]',
  'div[contenteditable="true"][id*="prompt"]',
] as const;

/** ChatGPT 注入器：?q= 预填 + 补 Enter。 */
export const chatgptInjector: AiEngineInjector = {
  extractQuery(url) {
    // SPA 兜底：ChatGPT 原生预填后可能在 document_idle 前用 replaceState 清掉 ?q=，
    // 回退到 navigation entry 的原始 URL 取参，避免漏补 Enter。
    return extractQueryWithNavFallback(url, 'q');
  },
  async fillAndSubmit(query: string, opts?: { autoSubmit?: boolean; timeoutMs?: number }) {
    void query;
    const autoSubmit = opts?.autoSubmit !== false;
    // 原生已预填，只需等输入框出现后补提交。
    const input = await waitForElement(CHATGPT_INPUT_SELECTORS, opts?.timeoutMs);
    if (!input) return; // 静默降级
    const htmlEl = input as HTMLElement;
    htmlEl.focus();
    await sleep(200); // 等 focus 生效
    if (autoSubmit) {
      dispatchEnter(input);
    }
    clearUrlQuery(); // 清 URL 参数，防刷新重复提交
  },
};
