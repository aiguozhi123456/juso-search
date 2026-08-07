---
title: "AI Engine Auto-Submit Consent via enter=1 URL Contract (Decoupled from Native Prefill)"
date: 2026-08-05
last_updated: 2026-08-07
category: architecture-patterns
module: "ai-engines / storage / serp-handoff / content-script / config-io / options-ui"
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "An inject-type AI engine natively prefills from ?q= but does not auto-submit, and the extension must not change that default"
  - "Auto-submit must be an explicit, user-consented action rather than a side effect of any ?q= URL"
  - "A single URL contract must distinguish 'prefill only' from 'prefill + auto-submit' across multiple inject-type targets"
  - "A user-facing toggle must gate whether the auto-submit signal is appended to the navigation URL"
related_components:
  - "lib/ai-engines/registry.ts"
  - "lib/ai-engines/types.ts"
  - "lib/ai-engines/injectors"
  - "lib/serp-handoff.ts"
  - "lib/storage.ts"
  - "lib/config-io.ts"
  - "entrypoints/ai-engine-inject.content.ts"
  - "entrypoints/search/App.tsx"
  - "entrypoints/options"
tags: [ai-engine, url-contract, auto-submit, consent, prefill, toggle, content-script, injector]
---

# AI Engine 自动提交与原生预填解耦：`enter=1` URL 契约 + `aiAutoEnter` 开关

## Context

Juso（Chrome MV3，WXT + React + TypeScript）的 AI Engine 功能（见姊妹文档 `ai-engine-conversation-navigation-source-type.md`）把当前查询通过 `?q=` URL 参数带到 AI 对话站。注入型站点（ChatGPT / DeepSeek / 豆包 / Gemini）由 content script 填充输入框并提交（点击发送按钮或派发合成 Enter，取决于目标站编辑器框架）；url-only 站点（Grok）原生支持 `?q=` 预填+自动提交，零注入。

**问题**：注入型 content script 把「URL 上存在 `?q=`」当作自动提交的信号——只要带 `?q=` 就补一个 Enter。这改变了站点原生行为：ChatGPT 的 `?q=` 原生只预填、不提交，扩展却额外自动提交。这是**同意权 / 行为耦合缺陷**：扩展劫持了一个原生预填参数，让它同时隐含「自动提交」语义。用户无法只预填不提交，也无法区分「扩展主动提交」与「站点原生预填」。

**方案**：把「自动提交」从「原生预填」中解耦，引入 `enter=1` URL 参数契约：

- `?q=<query>` = 原生预填（不自动提交）——恢复站点原生行为；
- `?q=<query>&enter=1` = 预填 + 自动提交（扩展显式意图）；
- 新增 `aiAutoEnter` 开关（默认 ON）控制注入型 AI engine 的 URL 是否追加 `enter=1`；
- 覆盖注入型 4 站（ChatGPT / DeepSeek / 豆包 / Gemini）；Grok 是 url-only（原生自动提交，永不追加 `enter=1`，不受开关影响）。

关键模块：`lib/serp-handoff.ts`、`lib/ai-engines/injectors/`（`generic-enter.ts` / `deepseek.ts` / `doubao.ts` / `gemini.ts` / `shared.ts`）、`entrypoints/ai-engine-inject.content.ts`、`lib/storage.ts`、`lib/config-io.ts`、`lib/messaging.ts`、`lib/gateway.ts`、`lib/schema.ts`（`CONFIG_KEYS`）、`components/AiAutoEnterToggle.tsx`、`entrypoints/options/App.tsx`、`entrypoints/search/App.tsx`、`entrypoints/serp-bar.content.ts`。

## Guidance

### 1. URL 作为契约，而非 worker 往返

核心决策：**开关控制 URL 生成，content script 读 URL 意图**。`aiAutoEnter` 只在 `resolveSerpHandoff` 决定是否追加 `enter=1`；content script 从 URL 提取 `enter` 参数决定是否自动提交。这样每次 AI 页面加载**无需异步向 worker 查询开关状态**——意图已编码在 URL 里，content script 保持纯 DOM、无消息通道。

`lib/serp-handoff.ts` 中，注入型 engine 在开关开启时追加 `enter=1`，url-only 型永不追加：

```ts
export function resolveSerpHandoff(
  source: SearchSource,
  query: string,
  opts?: { aiAutoEnter?: boolean },
): SerpHandoff | null {
  // ...
  if (source.kind === 'ai-engine' && isRegisteredAiEngineId(source.id)) {
    const aiEngine = getAiEngine(source.id);
    if (!trimmed) return { kind: 'navigate', url: aiEngine.buildHomeUrl() };
    // inject 型：aiAutoEnter 默认 true → 追加 enter=1（content script 据此自动提交）；
    // aiAutoEnter 关闭 → 仅原生预填（?q=），不自动回车。url-only 型原生自动提交，不追加。
    const wantsAutoEnter = aiEngine.execution.kind === 'inject' && opts?.aiAutoEnter !== false;
    const baseUrl = aiEngine.buildUrl(trimmed);
    const url = wantsAutoEnter ? withEnterParam(baseUrl, '1') : baseUrl;
    return { kind: 'navigate', url };
  }
  // ...
}
```

`withEnterParam` 用 `URL.searchParams.set('enter', value)`，同 key 已存在则覆盖；URL 解析失败原样返回，保证不破坏导航。

content script 侧严格解析 `enter` 参数（`entrypoints/ai-engine-inject.content.ts`）：

```ts
// 自动回车门控：URL 携带 enter=1 才自动提交；否则仅预填不提交（aiAutoEnter 开关关闭时
// URL 不带 enter=1，即原生 ?q= 预填场景）。SPA 清参兜底：从 navigation entry 原始 URL 取参。
const autoSubmit = extractQueryWithNavFallback(window.location.href, 'enter') === '1';
```

**严格 `=== '1'`**：拒绝 `enter=0`、`enter=true`、空值——只有字面量 `1` 才触发自动提交，避免宽松匹配把非契约值误判为提交意图。

### 2. 注入器 `fillAndSubmit` 的 `autoSubmit` 语义

`fillAndSubmit(query, opts?: { autoSubmit?: boolean; timeoutMs?: number })` 的 `autoSubmit` **默认 `true`**（向后兼容：旧调用方不传即自动提交）。为 `false` 时，注入器填充输入框但跳过提交（合成 Enter / 发送按钮点击 / `dispatchEnterFullChain`），仍执行 `clearUrlQuery()` 清参。

| 注入器 | `autoSubmit=false` 时跳过 | 仍执行 |
|--------|--------------------------|--------|
| `generic-enter.ts`（ChatGPT） | 发送按钮点击 + `dispatchEnterFullChain` 兜底 | 填充（若原生预填失败）+ `clearUrlQuery` |
| `deepseek.ts` | `dispatchEnter` | 填充 + `clearUrlQuery` |
| `doubao.ts` | `dispatchEnter` | 填充 + `clearUrlQuery` |
| `gemini.ts` | 发送按钮轮询 + 兜底 Enter | 填充 + `clearUrlQuery` |

`generic-enter.ts`（ChatGPT）示例——`autoSubmit=false` 时填充（若原生预填失败）但不提交：

```ts
async fillAndSubmit(query: string, opts?: { autoSubmit?: boolean; timeoutMs?: number }) {
  const autoSubmit = opts?.autoSubmit !== false;
  const el = await waitForElement(CHATGPT_INPUT_SELECTORS, opts?.timeoutMs);
  if (!el) return; // 静默降级
  const editor = el as HTMLElement;
  editor.focus();
  await sleep(200);

  // 原生 ?q= 预填可能已填入；若编辑器为空（预填失败/sec-fetch-site 门控），自行填充
  const current = (editor.textContent ?? '').trim();
  if (!current) {
    const inserted = execCommandInsertText(query);
    if (!inserted) {
      editor.textContent = query;
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, data: query, inputType: 'insertFromPaste',
      }));
    }
    await sleep(300);
  }

  if (!autoSubmit) {
    clearUrlQuery(); // 仅预填不提交
    return;
  }

  // 提交：优先点击发送按钮（ProseMirror 最可靠路径），兜底 dispatchEnterFullChain
  // （含 insertParagraph beforeinput/input，ProseMirror 监听此事件触发提交）
  await waitForElement(SEND_BUTTON_SELECTORS, 3000);
  const ready = await pollUntil(() => {
    const btn = document.querySelector(SEND_BUTTON_SELECTORS.join(', '));
    return btn ? clickIfEnabled(btn) : false;
  }, 3000, 200);
  if (ready) { clearUrlQuery(); return; }
  dispatchEnterFullChain(editor);
  clearUrlQuery();
}
```

`gemini.ts` 的机制 3 注入器在 `autoSubmit=false` 时提前返回（跳过发送按钮轮询与兜底 Enter）；`doubao.ts` 发送按钮选择器已漂移（2026-08），改为直接 `if (autoSubmit) dispatchEnter(textarea)` 条件式（无轮询、无提前返回）。两者仍清参：

```ts
if (!autoSubmit) {
  clearUrlQuery(); // 仅预填不提交（enter=1 缺失场景）；同样清参防刷新重复填充
  return;
}
```

`shared.ts` 的 `clearUrlQuery()` 现在同时删除 `q` / `prompt` / `enter` 三个参数（保留其余参数与 hash），防止刷新重放：

```ts
export function clearUrlQuery(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    url.searchParams.delete('prompt');
    url.searchParams.delete('enter');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}
```

### 3. `aiAutoEnter` 开关存储与协议

- 存储键 `AI_AUTO_ENTER_KEY = 'aiAutoEnter'`（`lib/storage.ts`），`getAiAutoEnter()` 用 `stored !== false` 判真（**默认 true**）。
- 加入 `CONFIG_KEYS` 白名单（`lib/schema.ts`）——getter 自带默认，**无需 schema 迁移**。
- `ProviderConfigReply.aiAutoEnter?: boolean`（可选，调用方用 `?? true`）。
- 消息协议 `setAiAutoEnter(value: boolean)`（`lib/messaging.ts`）+ gateway handler `handleSetAiAutoEnter`（`lib/gateway.ts`）委托 `setAiAutoEnter`。

```ts
// lib/storage.ts
export async function getAiAutoEnter(): Promise<boolean> {
  const got = await browser.storage.local.get(AI_AUTO_ENTER_KEY);
  return got[AI_AUTO_ENTER_KEY] !== false;
}
export async function setAiAutoEnter(v: boolean): Promise<void> {
  await browser.storage.local.set({ [AI_AUTO_ENTER_KEY]: v });
}
```

### 4. Config IO：导出 / 解析 / 合并 / 预览

`aiAutoEnter` 贯穿 config 导入导出全链路，遵循 `serpBarPosition` 的标量偏好模式：

- **导出**：`buildExportPayload` 输出 `aiAutoEnter: got[AI_AUTO_ENTER_KEY] !== false`（未设置时导出 `true`）。
- **解析**：`parseImportPayload` 校验 `aiAutoEnter` 必须为 boolean（非 boolean → `invalid_ai_auto_enter`）；**缺失字段（legacy 导出）→ `undefined`**，保留本地。
- **合并**：`applyPrefs=true` 且字段存在时写入并标记 `aiAutoEnterOverridden`；`applyPrefs` 缺省/`false` 不触碰本地。legacy 导出（缺字段）+ `applyPrefs=true` → 默认 `true`（与标量偏好模式一致）。
- **预览**：`previewImport` 报告 `aiAutoEnter` 的 from/to diff。

### 5. UI：`AiAutoEnterToggle`

`components/AiAutoEnterToggle.tsx` 是受控 2 态分段切换器（开/关），复用 StyleToggle 的滑动指示器机制（`useLayoutEffect` 测量激活按钮位置 → CSS 变量定位指示器）。放在 options 快切栏 section、`BarPositionToggle` 之后。

```tsx
<AiAutoEnterToggle enabled={aiAutoEnter} onChange={handleAiAutoEnterChange} />
<p className="hint">{t(MSG.ai_auto_enter_hint)}</p>
```

Hint 文案（`zh_CN`）明确语义边界：

> 仅对 ChatGPT、DeepSeek、豆包、Gemini 生效；关闭则仅预填不提交。Grok 原生自动提交，不受此开关影响。

### 6. 设计决策

1. **URL 作为契约，而非 worker 往返**：开关控制 URL 生成（`buildUrl`），content script 读 URL 意图。无需每次 AI 页面加载异步查 worker。
2. **默认 ON**：现有用户行为不变（仍自动提交）；想用原生预填行为的用户手动关闭。
3. **`enter=1` 仅注入型**：Grok（url-only）原生从 `?q=` 自动提交，追加 `enter=1` 无意义。`execution.kind === 'inject'` 门控强制这一点。
4. **手动构造 `?q=x&enter=1` 是预期行为**：content script 尊重 URL 契约，与开关状态无关。用户手写 `enter=1` 即显式表达自动提交意图。
5. **Grok 的语义对齐**：开关无法影响 Grok（无 content script、原生自动提交）。Hint 文案显式声明，避免「开关显示关、Grok 仍自动提交」的语义缺口。

## Why This Matters

- **恢复站点原生行为**：`?q=` 回归「仅预填」语义，不再被扩展劫持为「自动提交」。这是同意权 / 行为耦合缺陷的修复，而非功能取舍。
- **意图显式化**：自动提交成为扩展显式表达的意图（`enter=1`），而非对任意 `?q=` 链接的隐式响应。
- **零运行时开销**：URL 契约把开关状态编码进导航 URL，content script 保持纯 DOM、无消息通道、无异步 worker 查询。
- **向后兼容**：`autoSubmit` 默认 `true`、`aiAutoEnter` 默认 `true`、legacy 导出缺字段默认 `true`——现有用户与旧配置无缝过渡。
- **语义对齐**：Grok 的例外被显式文档化，避免「开关关了但 Grok 还自动提交」的困惑。

## When to Apply

- 一个 URL 参数同时承载「原生预填」与「扩展自动提交」两种语义，需要解耦。
- 扩展需要给用户一个「只预填不提交」的选项，且不想为每次页面加载引入异步 worker 查询。
- 站点原生行为（如 ChatGPT 的 `?q=` 只预填）与扩展注入行为（补 Enter）冲突，需要显式区分。
- 存在「开关无法影响某站点」的例外（如 url-only 站点），需要显式声明语义边界。

## Examples

### Before：`?q=` 即自动提交（行为耦合）

```ts
// content script（旧）：只要 URL 带 ?q= 就自动提交
const query = injector.extractQuery(window.location.href)?.trim();
if (!query) return;
await injector.fillAndSubmit(query); // autoSubmit 恒为 true，无条件补 Enter
```

```ts
// serp-handoff（旧）：注入型 AI engine 一律只生成 ?q=
const url = aiEngine.buildUrl(trimmed);
return { kind: 'navigate', url }; // 无 enter 参数，content script 仍自动提交
```

结果：用户打开 ChatGPT 的 `?q=foo` 链接，扩展无条件补 Enter 自动提交，覆盖了站点「只预填」的原生行为。

### After：`enter=1` 显式表达自动提交意图

```ts
// serp-handoff（新）：开关开启才追加 enter=1
const wantsAutoEnter = aiEngine.execution.kind === 'inject' && opts?.aiAutoEnter !== false;
const baseUrl = aiEngine.buildUrl(trimmed);
const url = wantsAutoEnter ? withEnterParam(baseUrl, '1') : baseUrl;
```

```ts
// content script（新）：严格 === '1' 才自动提交
const autoSubmit = extractQueryWithNavFallback(window.location.href, 'enter') === '1';
await injector.fillAndSubmit(query, { autoSubmit });
```

| 场景 | URL | content script 行为 |
|------|-----|---------------------|
| 开关开（默认） | `?q=foo&enter=1` | 预填 + 自动提交 |
| 开关关 | `?q=foo` | 仅预填，不提交 |
| 手动构造 | `?q=foo&enter=1` | 预填 + 自动提交（尊重 URL 契约） |
| Grok（url-only） | `?q=foo` | 原生自动提交，无 content script |

## Related

- [./ai-engine-conversation-navigation-source-type.md](./ai-engine-conversation-navigation-source-type.md) — AI Engine 第五类 Source 的整体架构（5 源类型、3 执行机制、injectorKey 桥接、可见性门控）。本文档聚焦 `enter=1` URL 契约设计，是同一领域的不同角度。
- [./testable-content-script-helpers-via-lib-extraction.md](./testable-content-script-helpers-via-lib-extraction.md) — content script 逻辑抽到 lib 以便测试（`extractQueryWithNavFallback` 可纯函数测试）。
- [./persistent-source-order-and-visible-projection.md](./persistent-source-order-and-visible-projection.md) — sourceHidden 规范化（`aiInjectAllowed` 可见性门控依赖它）。
- CONCEPTS.md — 项目领域词汇（Search Source / AI Engine / 注入型 vs url-only 执行机制）。
