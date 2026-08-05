// Gemini 注入器（机制 3：完整注入）。
//
// 原生不支持 URL query 预填。关键点：
//   - 输入框是 rich-textarea 自定义元素内嵌 contenteditable div
//   - 属"MutationObserver 自动同步 HTML"型——直接改 innerText/innerHTML 即可
//   - 发送按钮延迟激活——不能立即点，需轮询 !disabled && aria-disabled!=='true'
//   - 提交后 URL 残留 ?q=，需 history.replaceState 清参（防刷新重复提问）
//
// 来源：@librarian 规格表 §Gemini（4 源一致）。

import type { AiEngineInjector } from '../types';
import {
  clearUrlQuery,
  clickIfEnabled,
  extractQueryWithNavFallback,
  pollUntil,
  sleep,
  waitForElement,
} from './shared';

const INPUT_SELECTORS = [
  'rich-textarea.text-input-field_textarea',
  'rich-textarea',
] as const;

const SEND_BUTTON_SELECTORS = [
  '.send-button',
  'button[aria-label*="Send"]',
  'button[aria-label*="发送"]',
] as const;

export const geminiInjector: AiEngineInjector = {
  extractQuery(url) {
    // Gemini 也用 ?prompt= 参数，两个参数分别走 SPA 兜底取参
    return extractQueryWithNavFallback(url, 'q') ?? extractQueryWithNavFallback(url, 'prompt');
  },
  async fillAndSubmit(query, opts?: { autoSubmit?: boolean; timeoutMs?: number }) {
    const autoSubmit = opts?.autoSubmit !== false;
    const el = await waitForElement(INPUT_SELECTORS, opts?.timeoutMs);
    if (!el) return; // 静默降级

    // rich-textarea 内部的 contenteditable div
    const editor = (el as HTMLElement).querySelector('div[contenteditable="true"]')
      ?? (el as HTMLElement);
    const htmlEl = editor as HTMLElement;

    htmlEl.focus();
    await sleep(300);

    // Gemini 属 MutationObserver 同步型——直接设 innerText + input 事件
    htmlEl.innerText = query;
    htmlEl.dispatchEvent(new Event('input', { bubbles: true }));

    await sleep(500);

    // 校验填充：A/B 变体可能拒绝程序化写入，此时发送按钮永不激活，
    // 继续等待只会白耗 waitForElement 5s + pollUntil 10s。校验失败直接降级
    // return 且不清 URL 参数——用户可刷新重试（对齐 deepseek/doubao 降级语义）。
    const filled = (htmlEl.innerText ?? '').trim();
    if (!filled.includes(query)) return;

    if (!autoSubmit) {
      clearUrlQuery(); // 仅预填不提交（enter=1 缺失场景）；同样清参防刷新重复填充
      return;
    }

    // 先等发送按钮出现，再轮询点击——predicate 内每次重新查询，
    // 避免 React 重渲染替换按钮节点后对 detached 节点 click() 静默无效
    await waitForElement(SEND_BUTTON_SELECTORS, 5000);
    const ready = await pollUntil(() => {
      const btn = document.querySelector(SEND_BUTTON_SELECTORS.join(', '));
      return btn ? clickIfEnabled(btn) : false;
    }, 10_000, 500);
    if (ready) {
      clearUrlQuery();
      return;
    }

    // 兜底：合成 Enter
    htmlEl.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    clearUrlQuery();
  },
};
