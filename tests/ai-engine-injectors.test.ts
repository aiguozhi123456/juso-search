// AI engine 注入器 DOM 路径测试 + 门控纯函数测试。
//
// jsdom 环境（vitest.config.ts）。覆盖最脆弱的代码——选择器/填充/提交/清参/降级——
// 以及 M5 抽取的 resolveAllowedInjection 纯函数四分支。
//
// fillAndSubmit 的 timeoutMs 参数（M4 可测性）供测试注入短超时：waitForElement 默认
// WAIT_TIMEOUT=10s，降级路径（无元素）不能真等 10s——传 50ms 让用例在 <1s 内完成且不 flaky。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepseekInjector } from '@/lib/ai-engines/injectors/deepseek';
import { doubaoInjector } from '@/lib/ai-engines/injectors/doubao';
import { geminiInjector } from '@/lib/ai-engines/injectors/gemini';
import { chatgptInjector } from '@/lib/ai-engines/injectors/generic-enter';
import { clearUrlQuery, extractQueryWithNavFallback } from '@/lib/ai-engines/injectors/shared';
import { resolveAllowedInjection } from '@/lib/ai-engines/injection-gate';

beforeEach(() => {
  // 每个用例独立的 DOM 与 URL 基线（jsdom 单例环境，避免用例间互相污染）
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  // 清理用例内 stub 的全局（如 performance），避免泄漏到后续用例
  vi.unstubAllGlobals();
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
  it('只删 q/prompt/enter，保留其余参数与 hash', () => {
    window.history.pushState({}, '', '/?q=test&model=x&enter=1#top');

    clearUrlQuery();

    const url = new URL(window.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.has('enter')).toBe(false);
    expect(url.searchParams.get('model')).toBe('x');
    expect(url.hash).toBe('#top');
  });
});

describe('fillAndSubmit 降级路径', () => {
  it('无匹配元素时静默 resolve、不抛、不清 URL 参数（timeoutMs 注入短超时）', async () => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/?q=keep-me');

    await deepseekInjector.fillAndSubmit('你好', { timeoutMs: 50 });

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

    await geminiInjector.fillAndSubmit('你好 Juso', { timeoutMs: 50 });

    const url = new URL(window.location.href);
    expect(url.searchParams.get('q')).toBe('keep-me'); // 填充失败不清参 → 刷新可重试
  });
});

describe('fillAndSubmit autoSubmit 门控（enter=1 缺失场景）', () => {
  it('autoSubmit:false 时 deepseek 仅预填不派发 Enter，并清 URL 参数', async () => {
    document.body.innerHTML = '<textarea id="chat-input"></textarea>';
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const keydowns: KeyboardEvent[] = [];
    textarea.addEventListener('keydown', (e) => keydowns.push(e));
    window.history.pushState({}, '', '/?q=%E4%BD%A0%E5%A5%BD&enter=1');

    await deepseekInjector.fillAndSubmit('你好', { autoSubmit: false, timeoutMs: 50 });

    expect(textarea.value).toBe('你好'); // 预填成功
    expect(keydowns.some((e) => e.key === 'Enter')).toBe(false); // 未自动提交
    // 与提交路径一致清参（enter 是注入控制参数，避免刷新后语义漂移）
    const url = new URL(window.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('enter')).toBe(false);
  });

  it('autoSubmit:false 时 gemini 仅预填不提交（填充校验通过后提前返回，跳过发送按钮轮询）', async () => {
    document.body.innerHTML = '<rich-textarea><div contenteditable="true"></div></rich-textarea>';
    const inner = document.querySelector('div[contenteditable="true"]') as HTMLElement;
    window.history.pushState({}, '', '/?q=hello&enter=1');

    await geminiInjector.fillAndSubmit('hello', { autoSubmit: false, timeoutMs: 50 });

    expect(inner.innerText).toBe('hello'); // 预填成功
    // 仅预填路径在轮询发送按钮前就返回 → 不触发任何提交，且清掉 enter 控制参数
    const url = new URL(window.location.href);
    expect(url.searchParams.has('enter')).toBe(false);
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('autoSubmit:false 时 doubao 仅预填不提交（填充后提前返回，跳过发送按钮轮询）', async () => {
    document.body.innerHTML = '<textarea data-testid="chat_input_input"></textarea><button data-testid="chat_input_send_button"></button>';
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const sendBtn = document.querySelector('[data-testid="chat_input_send_button"]') as HTMLButtonElement;
    const clicks: Event[] = [];
    sendBtn.addEventListener('click', (e) => clicks.push(e));
    window.history.pushState({}, '', '/?q=test&enter=1');

    await doubaoInjector.fillAndSubmit('test', { autoSubmit: false });

    expect(textarea.value).toBe('test'); // 预填成功
    expect(clicks.length).toBe(0); // 未点击发送按钮（autoSubmit=false 在轮询前返回）
    // 与提交路径一致清参（enter 是注入控制参数，避免刷新后语义漂移）
    const url = new URL(window.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('enter')).toBe(false);
  });

  it('autoSubmit:false 时 chatgpt 仅聚焦不派发 Enter，并清 URL 参数', async () => {
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea>';
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const keydowns: KeyboardEvent[] = [];
    textarea.addEventListener('keydown', (e) => keydowns.push(e));
    window.history.pushState({}, '', '/?q=test&enter=1');

    await chatgptInjector.fillAndSubmit('test', { autoSubmit: false });

    expect(keydowns.some((e) => e.key === 'Enter')).toBe(false); // 未派发 Enter
    expect(document.activeElement).toBe(textarea); // 输入框已聚焦（原生预填，仅补提交）
    const url = new URL(window.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('enter')).toBe(false);
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

describe('extractQueryWithNavFallback — enter param (auto-submit 契约)', () => {
  it('extracts enter=1 as "1" (auto-submit on)', () => {
    expect(extractQueryWithNavFallback('https://chatgpt.com/?q=hello&enter=1', 'enter')).toBe('1');
  });

  it('extracts enter=0 as "0" (NOT auto-submit — strict === "1" rejects)', () => {
    expect(extractQueryWithNavFallback('https://chatgpt.com/?q=hello&enter=0', 'enter')).toBe('0');
  });

  it('returns null when enter param is absent (auto-submit off by default)', () => {
    expect(extractQueryWithNavFallback('https://chatgpt.com/?q=hello', 'enter')).toBeNull();
  });

  it('returns null for empty enter value (falsy → === "1" yields false)', () => {
    // 空串是 falsy，extractQueryWithNavFallback 的 `if (fromCurrent)` 不会命中，落到 nav 兜底返回 null。
    // 无论 '' 还是 null，content script 的 `=== '1'` 都正确判为 false → 不自动提交。
    expect(extractQueryWithNavFallback('https://chatgpt.com/?q=hello&enter=', 'enter')).toBeNull();
  });

  it('falls back to navigation entry when SPA stripped enter from current URL', () => {
    vi.stubGlobal('performance', {
      getEntriesByType: () => [{ name: 'https://chatgpt.com/?q=hello&enter=1' }],
    } as unknown as Performance);
    expect(extractQueryWithNavFallback('https://chatgpt.com/?q=hello', 'enter')).toBe('1');
  });
});
