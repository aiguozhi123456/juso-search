// 机制 2 注入器：ChatGPT。
//
// ChatGPT 的 #prompt-textarea 是 ProseMirror contenteditable 编辑器（非 textarea/Lexical）。
// 原生 ?q= 预填仍可用（填入文本），但 2025-07 后 ChatGPT 自身的 auto-submit 被
// sec-fetch-site 门控（web-initiated 跨站导航不触发自动提交），需注入器自行提交。
//
// 提交策略：优先点击发送按钮（ProseMirror 最可靠路径），兜底完整 Enter 链
// （含 insertParagraph beforeinput，ProseMirror 监听此事件触发提交）。
//
// 来源：@librarian 规格表 §ChatGPT（MCP-SuperAssistant #195、steipete/oracle、Tenable TRA-2025-22）。

import type { AiEngineInjector } from '../types';
import {
  clearUrlQuery,
  clickIfEnabled,
  dispatchEnterFullChain,
  execCommandInsertText,
  extractQueryWithNavFallback,
  pollUntil,
  sleep,
  waitForElement,
} from './shared';

/** ChatGPT 输入框选择器（ProseMirror contenteditable div，主 + 兜底）。 */
const CHATGPT_INPUT_SELECTORS = [
  '#prompt-textarea',
  'div.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
] as const;

/** ChatGPT 发送按钮选择器（主 + 兜底）。 */
const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]',
  'button[aria-label="发送提示"]',
] as const;

/** ChatGPT 注入器：?q= 预填（兜底自行填充）+ 点击发送按钮 / Enter 链提交。 */
export const chatgptInjector: AiEngineInjector = {
  extractQuery(url) {
    // SPA 兜底：ChatGPT 原生预填后可能在 document_idle 前用 replaceState 清掉 ?q=，
    // 回退到 navigation entry 的原始 URL 取参，避免漏补 Enter（仅 autoSubmit=true 时）。
    return extractQueryWithNavFallback(url, 'q');
  },
  async fillAndSubmit(query: string, opts?: { autoSubmit?: boolean; timeoutMs?: number }) {
    const autoSubmit = opts?.autoSubmit !== false;
    const el = await waitForElement(CHATGPT_INPUT_SELECTORS, opts?.timeoutMs);
    if (!el) return; // 静默降级
    const editor = el as HTMLElement;

    editor.focus();
    await sleep(200); // 等 focus 生效

    // 原生 ?q= 预填可能已填入文本（但 ChatGPT 自身 auto-submit 被 sec-fetch-site 门控）。
    // 若编辑器为空（预填失败/延迟），自行填充——ProseMirror 需 execCommand('insertText')
    // 产生 beforeinput 事件才能同步内部状态。
    const current = (editor.textContent ?? '').trim();
    if (!current) {
      const inserted = execCommandInsertText(query);
      if (!inserted) {
        // 回退：textContent + insertFromPaste input 事件（ProseMirror 会重新同步 DOM）
        editor.textContent = query;
        editor.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            composed: true,
            data: query,
            inputType: 'insertFromPaste',
          }),
        );
      }
      await sleep(300); // 等 ProseMirror 状态同步
    }

    if (!autoSubmit) {
      clearUrlQuery(); // 仅预填不提交（enter=1 缺失场景）；同样清参防刷新重复填充
      return;
    }

    // 提交：优先点击发送按钮（ProseMirror 最可靠路径）
    await waitForElement(SEND_BUTTON_SELECTORS, 3000);
    const ready = await pollUntil(() => {
      const btn = document.querySelector(SEND_BUTTON_SELECTORS.join(', '));
      return btn ? clickIfEnabled(btn) : false;
    }, 3000, 200);
    if (ready) {
      clearUrlQuery(); // 清 URL 参数，防刷新重复提交
      return;
    }

    // 兜底：完整 Enter 链（含 insertParagraph beforeinput/input）
    dispatchEnterFullChain(editor);
    clearUrlQuery();
  },
};
