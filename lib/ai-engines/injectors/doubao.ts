// 豆包注入器（机制 3：完整注入）。
//
// 原生不支持 URL query 预填。关键点：
//   - document_idle 运行时 SPA 可能已重定向清参（/chat/?q= → /chat/{id}），
//     用 extractQueryWithNavFallback 回退到 navigation entry 的原始 URL 取参
//   - 必须用 execCommand('insertText') 填充（React 受控组件直接设 value 不同步）
//   - 发送按钮无稳定选择器（data-testid/class 均已漂移，实测 2026-08），
//     直接合成 Enter——textarea 是 Semi Design 普通 textarea，单 keydown 即可触发提交
//
// 来源：@librarian 规格表 §豆包（3 源交叉验证，技术细节最全）。

import type { AiEngineInjector } from '../types';
import {
  clearUrlQuery,
  dispatchEnter,
  execCommandInsertText,
  extractQueryWithNavFallback,
  setReactTextareaValue,
  sleep,
  waitForElement,
} from './shared';

const INPUT_SELECTORS = [
  'textarea[data-testid="chat_input_input"]',
  'textarea.semi-input-textarea',
  'textarea[placeholder*="发消息"]',
] as const;

export const doubaoInjector: AiEngineInjector = {
  extractQuery(url) {
    // 豆包 SPA 会重定向清参，但 content script 在 document_idle 运行时
    // location.href 可能已是重定向后的 URL。extractQueryWithNavFallback
    // 优先用当前 URL，回退到 navigation entry 的原始 URL。
    return extractQueryWithNavFallback(url, 'q');
  },
  async fillAndSubmit(query, opts?: { autoSubmit?: boolean; timeoutMs?: number }) {
    const autoSubmit = opts?.autoSubmit !== false;
    const el = await waitForElement(INPUT_SELECTORS, opts?.timeoutMs);
    if (!el) return; // 静默降级
    const textarea = el as HTMLTextAreaElement;
    if (textarea.tagName !== 'TEXTAREA') return;

    textarea.focus();
    await sleep(300); // 初始加载后输入框可能短暂 disabled

    // 优先 execCommand（豆包 React 组件对此兼容，直接设 value 不同步）
    const inserted = execCommandInsertText(query);
    if (!inserted) {
      // 回退 native setter + input/change 事件
      setReactTextareaValue(textarea, query);
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(300);

    // 校验填充
    if (textarea.value !== query) {
      setReactTextareaValue(textarea, query);
      await sleep(200);
      if (textarea.value !== query) return; // 静默降级
    }

    if (autoSubmit) {
      // 豆包发送按钮无稳定选择器（data-testid/class 均已漂移），
      // 直接合成 Enter——textarea 是 Semi Design 普通 textarea，单 keydown 即可触发提交。
      dispatchEnter(textarea);
    }
    clearUrlQuery(); // 清 URL 参数，防刷新重复提交
  },
};
