// DeepSeek 注入器（机制 3：完整注入）。
//
// 原生不支持 URL query 预填。需等 DOM 渲染 → 找 textarea → native setter 填充 → 提交。
//
// 来源：@librarian 规格表 §DeepSeek（5 源交叉验证）。
//   - 输入框：#chat-input（最稳）或 textarea[placeholder*="DeepSeek"]
//   - 填充：native value setter + InputEvent('input', {bubbles, composed})
//   - 提交：合成 Enter keydown {bubbles:true}
//   - 等待：MutationObserver + 10s 超时

import type { AiEngineInjector } from '../types';
import {
  clearUrlQuery,
  dispatchEnter,
  extractQueryWithNavFallback,
  setReactTextareaValue,
  sleep,
  waitForElement,
} from './shared';

const INPUT_SELECTORS = [
  '#chat-input',
  'textarea[placeholder*="DeepSeek"]',
  'textarea[name="search"]',
] as const;

export const deepseekInjector: AiEngineInjector = {
  extractQuery(url) {
    return extractQueryWithNavFallback(url, 'q');
  },
  async fillAndSubmit(query, timeoutMs) {
    const el = await waitForElement(INPUT_SELECTORS, timeoutMs);
    if (!el) return; // 静默降级
    const textarea = el as HTMLTextAreaElement;
    if (textarea.tagName !== 'TEXTAREA') return;

    textarea.focus();
    await sleep(100);
    setReactTextareaValue(textarea, query);
    await sleep(200); // 等 React 状态同步

    // 校验填充成功（React 有概率清空程序化写入）
    if (textarea.value !== query) {
      // 重试一次
      setReactTextareaValue(textarea, query);
      await sleep(200);
      if (textarea.value !== query) return; // 仍失败，静默降级
    }

    dispatchEnter(textarea);
    clearUrlQuery(); // 清 URL 参数，防刷新重复提交
  },
};
