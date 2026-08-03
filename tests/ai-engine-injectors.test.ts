// AI engine 注入器 DOM 路径测试 + 门控纯函数测试。
//
// jsdom 环境（vitest.config.ts）。覆盖最脆弱的代码——选择器/填充/提交/清参/降级——
// 以及 M5 抽取的 resolveAllowedInjection 纯函数四分支。
//
// fillAndSubmit 的 timeoutMs 参数（M4 可测性）供测试注入短超时：waitForElement 默认
// WAIT_TIMEOUT=10s，降级路径（无元素）不能真等 10s——传 50ms 让用例在 <1s 内完成且不 flaky。

import { beforeEach, describe, expect, it } from 'vitest';
import { deepseekInjector } from '@/lib/ai-engines/injectors/deepseek';
import { geminiInjector } from '@/lib/ai-engines/injectors/gemini';
import { clearUrlQuery } from '@/lib/ai-engines/injectors/shared';
import { resolveAllowedInjection } from '@/lib/ai-engines/injection-gate';

beforeEach(() => {
  // 每个用例独立的 DOM 与 URL 基线（jsdom 单例环境，避免用例间互相污染）
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('deepseek fillAndSubmit（快乐路径）', () => {
  it('填入 query、派发 Enter keydown、清掉 q/prompt 但保留其余参数与 hash', async () => {
    document.body.innerHTML = '<textarea id="chat-input"></textarea>';
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const keydowns: KeyboardEvent[] = [];
    textarea.addEventListener('keydown', (e) => keydowns.push(e));
    window.history.pushState({}, '', '/?q=%E4%BD%A0%E5%A5%BD%20Juso&model=x#top');

    await deepseekInjector.fillAndSubmit('你好 Juso');

    // ① 填充成功
    expect(textarea.value).toBe('你好 Juso');
    // ② 派发了 Enter keydown
    expect(keydowns.some((e) => e.key === 'Enter')).toBe(true);
    // ③ q/prompt 被清；M2 语义：其余参数与 hash 保留
    const url = new URL(window.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.get('model')).toBe('x');
    expect(url.hash).toBe('#top');
  });
});

describe('clearUrlQuery（M2 语义）', () => {
  it('只删 q/prompt，保留其余参数与 hash', () => {
    window.history.pushState({}, '', '/?q=test&model=x#top');

    clearUrlQuery();

    const url = new URL(window.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.get('model')).toBe('x');
    expect(url.hash).toBe('#top');
  });
});

describe('fillAndSubmit 降级路径', () => {
  it('无匹配元素时静默 resolve、不抛、不清 URL 参数（timeoutMs 注入短超时）', async () => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/?q=keep-me');

    await deepseekInjector.fillAndSubmit('你好', 50);

    const url = new URL(window.location.href);
    expect(url.searchParams.get('q')).toBe('keep-me'); // 降级不清参 → 用户可刷新重试
  });
});

describe('gemini fillAndSubmit 填充校验（S2 语义）', () => {
  it('编辑器拒绝写入（innerText 只读）时提前 return，且不清 URL 的 q', async () => {
    const editor = document.createElement('rich-textarea');
    // 模拟 A/B 变体拒绝程序化写入：set 为 no-op、get 恒空 → filled 不含 query
    Object.defineProperty(editor, 'innerText', {
      configurable: true,
      get() {
        return '';
      },
      set() {
        // 拒绝写入
      },
    });
    document.body.appendChild(editor);
    window.history.pushState({}, '', '/?q=keep-me');

    await geminiInjector.fillAndSubmit('你好 Juso', 50);

    const url = new URL(window.location.href);
    expect(url.searchParams.get('q')).toBe('keep-me'); // 填充失败不清参 → 刷新可重试
  });
});

describe('resolveAllowedInjection（M5 门控纯函数）', () => {
  it('engineId 缺失 → false', async () => {
    await expect(resolveAllowedInjection(undefined, async () => true)).resolves.toBe(false);
  });

  it('worker 返回 true → true', async () => {
    await expect(resolveAllowedInjection('ai:deepseek', async () => true)).resolves.toBe(true);
  });

  it('worker 返回 false → false', async () => {
    await expect(resolveAllowedInjection('ai:deepseek', async () => false)).resolves.toBe(false);
  });

  it('查询抛错 → false（fail-closed）', async () => {
    await expect(
      resolveAllowedInjection('ai:deepseek', async () => {
        throw new Error('boom');
      }),
    ).resolves.toBe(false);
  });
});
