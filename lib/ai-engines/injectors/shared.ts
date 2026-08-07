// AI engine 注入器共享 DOM 工具。
//
// 在 content script 上下文执行，使用标准 DOM API。不引用 browser.* —— 这些是纯 DOM 函数。
// 基于 @librarian 整理的社区油猴脚本已验证方案（来源与协议见 docs/solutions/architecture-patterns/ai-engine-conversation-navigation-source-type.md「社区来源与协议」节）。

/** 默认等待超时（ms）。 */
const WAIT_TIMEOUT = 10_000;
/** 轮询间隔（ms）。 */
const POLL_INTERVAL = 300;

/** 按优先级查找第一个匹配的元素。 */
function findFirst(selectors: readonly string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {
      // 非法选择器，跳过
    }
  }
  return null;
}

/**
 * 等待优先级选择器列表中第一个匹配的元素出现。
 * MutationObserver + 超时兜底。超时返回 null。
 */
export function waitForElement(
  selectors: readonly string[],
  timeout: number = WAIT_TIMEOUT,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = findFirst(selectors);
    if (found) {
      resolve(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = findFirst(selectors);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * 用 native setter 设置 React 受控 textarea 的 value，再派发 input 事件。
 * 直接 textarea.value = x 对 React 受控组件不生效——必须走原型链上的 native setter。
 */
export function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
}

/**
 * 用 document.execCommand('insertText') 填充文本。
 * 对 Lexical / Slate 等内部状态型富文本编辑器有效——它们监听真实 input 事件。
 * 需先 focus。execCommand 不可用时返回 false。
 */
export function execCommandInsertText(text: string): boolean {
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

/** 派发合成 Enter keydown。bubbles:true 供 React 事件委托捕获。 */
export function dispatchEnter(target: Element): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * 派发完整 Enter 事件链（keydown + keypress + keyup）。
 * Lexical 编辑器需要完整链 + composed:true 才能识别提交。
 */
export function dispatchEnterFullChain(target: Element): void {
  const keyProps: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: false,
    isComposing: false,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', keyProps));
  target.dispatchEvent(new KeyboardEvent('keypress', keyProps));
  // ProseMirror/Lexical 监听 beforeinput（inputType: insertParagraph）触发提交，
  // 而非原生 keydown——补 beforeinput/input 两步才能触达提交路径。
  target.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertParagraph',
    }),
  );
  target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      composed: true,
      inputType: 'insertParagraph',
    }),
  );
  target.dispatchEvent(new KeyboardEvent('keyup', keyProps));
}

/** 轮询直到 predicate 返回 true 或超时。 */
export async function pollUntil(
  predicate: () => boolean,
  timeout: number = WAIT_TIMEOUT,
  interval: number = POLL_INTERVAL,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(interval);
  }
  return predicate();
}

/** 点击元素如果存在且未禁用。返回是否成功点击。 */
export function clickIfEnabled(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (htmlEl.getAttribute('aria-disabled') === 'true') return false;
  if ((htmlEl as HTMLButtonElement).disabled) return false;
  htmlEl.click();
  return true;
}

/** 从 URL 字符串提取 query 参数。返回解码值或 null。 */
export function extractQueryParam(url: string, param: string): string | null {
  try {
    const u = new URL(url);
    const value = u.searchParams.get(param);
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * 从 URL 提取 query 参数，SPA 兜底：当前 URL 取不到时回退到
 * navigation entry 的原始 URL（部分 SPA 会在 content script 于
 * document_idle 运行前用 history.replaceState 清掉 query）。
 */
export function extractQueryWithNavFallback(url: string, param: string): string | null {
  const fromCurrent = extractQueryParam(url, param);
  if (fromCurrent) return fromCurrent;
  try {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navEntry) return extractQueryParam(navEntry.name, param);
  } catch { /* performance API 不可用 */ }
  return null;
}

/**
 * 清除 URL 中的 query 参数（q / prompt / enter），防止刷新重复提交。
 * 提交成功后调用。replaceState 不触发页面重载，不影响已填充的输入框。
 * 只删 q/prompt/enter，保留其余参数与 hash。
 */
export function clearUrlQuery(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    url.searchParams.delete('prompt');
    url.searchParams.delete('enter');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    // ignore
  }
}

/** sleep。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
