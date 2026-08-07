---
title: "ChatGPT & Doubao AI Engine Injectors: Enter Auto-Submit Broken (ProseMirror events + sec-fetch-site gating + selector drift)"
date: 2026-08-07
category: integration-issues
module: "lib/ai-engines/injectors"
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "ChatGPT: ?q= 预填了文本但不自动发送（devtool 确认「有文字，没发送」）"
  - "豆包：三个发送按钮选择器全部失效，pollUntil 轮询 ~6s 才走 Enter 兜底，体感像坏了"
  - "仅 ChatGPT 与豆包失效；DeepSeek / Gemini / Grok 正常"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - "lib/ai-engines/injectors/generic-enter.ts"
  - "lib/ai-engines/injectors/shared.ts"
  - "lib/ai-engines/injectors/doubao.ts"
  - "lib/ai-engines/injectors/deepseek.ts"
tags: [chatgpt, doubao, prosemirror, contenteditable, auto-submit, sec-fetch-site, selector-drift, beforeinput]
---

# ChatGPT 与豆包注入器 Enter 自动提交失效：ProseMirror 事件 + sec-fetch-site 门控 + 选择器漂移

## Problem

`enter=1` URL 契约下的自动提交在两个 AI 引擎注入器上失效：ChatGPT 把文本预填进了编辑器却不发送（`sec-fetch-site` 门控 + 用了错误的事件类型对 ProseMirror 派发 Enter）；豆包则因三个发送按钮选择器全部漂移，`pollUntil` 空转 ~6 秒后才退化到合成 Enter，体感等于不可用。两者共同表现为「AI 引擎点了但没自动发出」，但根因完全不同。

## Symptoms

- **ChatGPT**：`?q=` 把查询文本填进了 `#prompt-textarea`，但回车从未触发——用户用 devtool 确认「有文字，没发送」。
- **豆包**：`[data-testid="chat_input_send_button"]`、`.send-btn-DDB6yN:not([disabled])`、`button[type="submit"]:not([disabled])` 三个选择器 devtool 探针全部返回 `false`；注入器在死选择器上 `pollUntil` 约 6 秒后才落到合成 Enter 兜底，延迟严重。
- **选择性失效**：仅 ChatGPT 与豆包受影响；DeepSeek、Gemini、Grok 的自动提交正常——这条线索是定位根因的关键。

## What Didn't Work

### ChatGPT —— 错误假设「编辑器是 Lexical」

第一轮修复把 `dispatchEnter(input)`（单次 `KeyboardEvent('keydown')`，`bubbles: true` 但无 `composed: true`）换成 `dispatchEnterFullChain`，补全 keydown→keypress→keyup 三段并加上 `composed: true`：

```ts
// 第一轮尝试（仍失败）—— 基于错误假设：以为 #prompt-textarea 是 Lexical
target.dispatchEvent(new KeyboardEvent('keydown', keyProps));
target.dispatchEvent(new KeyboardEvent('keypress', keyProps));
target.dispatchEvent(new KeyboardEvent('keyup', keyProps));
```

这个假设是错的。devtool 实测 `#prompt-textarea` 是 `tag: DIV, contenteditable: true`——ProseMirror 富文本编辑器，不是 Lexical、也不是 `<textarea>`。ProseMirror 的提交路径**不监听裸的合成 keydown**，它监听的是 `beforeinput` 事件且 `inputType === 'insertParagraph'`。补全键盘事件链 + `composed:true` 对 Lexical 足够，对 ProseMirror 仍然不触发提交。结论：**先确认目标编辑器框架，再选事件策略**，否则会把 Lexical 的解法套到 ProseMirror 上白费一轮。

### 豆包 —— 在已漂移的发送按钮选择器上空转

豆包三个发送按钮选择器全部漂移（实测 2026-08，devtool 三连 `false`）：

```ts
// 第一轮尝试（仍失败）—— 选择器全部失配，pollUntil 空转 ~6s
const SEND_BUTTON_SELECTORS = [
  '[data-testid="chat_input_send_button"]',        // 已移除
  '.send-btn-DDB6yN:not([disabled])',               // 已移除
  'button[type="submit"]:not([disabled])',          // 已移除
];

const sent = await pollUntil(() => {
  const btn = document.querySelector(SEND_BUTTON_SELECTORS.join(', '));
  return btn ? clickIfEnabled(btn) : false;
}, 6000);
if (!sent) {
  dispatchEnter(textarea); // 兜底——能发，但要等满 6s
}
```

兜底的合成 Enter 本身是有效的（豆包输入框是 Semi Design 普通 `<textarea>`，单次 keydown 即触发提交），但 6 秒空转让功能「能用但感觉坏了」。这里的教训：**选择器没有稳定契约时，不要把它当主提交路径**。

## Solution

### 1. `shared.ts` —— `dispatchEnterFullChain` 补 `insertParagraph` 两步

在 keydown/keypress 与 keyup 之间，插入 `inputType: 'insertParagraph'` 的 `beforeinput` + `input` 两个 `InputEvent`，这正是 ProseMirror（及 Lexical）触发提交的真实监听点：

```ts
// 修复后 —— 对 ProseMirror 生效
export function dispatchEnterFullChain(target: Element): void {
  const keyProps: KeyboardEventInit = {
    key: 'Enter', code: 'Enter', keyCode: 13,
    bubbles: true, cancelable: true, composed: true,
    shiftKey: false, isComposing: false,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', keyProps));
  target.dispatchEvent(new KeyboardEvent('keypress', keyProps));
  // ProseMirror/Lexical 监听 beforeinput（inputType: insertParagraph）触发提交
  target.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, composed: true,
      inputType: 'insertParagraph',
    }),
  );
  target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true, cancelable: false, composed: true,
      inputType: 'insertParagraph',
    }),
  );
  target.dispatchEvent(new KeyboardEvent('keyup', keyProps));
}
```

### 2. `generic-enter.ts`（ChatGPT）—— 选择器修正 + 点击发送按钮为主路径 + ProseMirror 填充兜底

**选择器**：移除已失效的 `textarea[data-testid="prompt-textarea"]` 等，改用 ProseMirror contenteditable 选择器：

```ts
// 修复后 —— ProseMirror contenteditable div（主 + 兜底）
const CHATGPT_INPUT_SELECTORS = [
  '#prompt-textarea',
  'div.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
] as const;

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]',
  'button[aria-label="发送提示"]',
] as const;
```

**填充兜底**：原生 `?q=` 预填若把编辑器留空，用 `execCommand('insertText')`（产生 ProseMirror 所需的 `beforeinput`）填充，再退化到 `textContent` + `insertFromPaste` InputEvent：

```ts
const current = (editor.textContent ?? '').trim();
if (!current) {
  const inserted = execCommandInsertText(query);
  if (!inserted) {
    editor.textContent = query;
    editor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true, composed: true, data: query,
        inputType: 'insertFromPaste',
      }),
    );
  }
  await sleep(300); // 等 ProseMirror 状态同步
}
```

**提交主路径**：轮询点击 `button[data-testid="send-button"]`（poll 到 enabled 才点）——对 ProseMirror 最可靠（2026-07 验证）；失败再退化到上面的 `dispatchEnterFullChain`：

```ts
// 提交：优先点击发送按钮（ProseMirror 最可靠路径）
await waitForElement(SEND_BUTTON_SELECTORS, 3000);
const ready = await pollUntil(() => {
  const btn = document.querySelector(SEND_BUTTON_SELECTORS.join(', '));
  return btn ? clickIfEnabled(btn) : false;
}, 3000, 200);
if (ready) { clearUrlQuery(); return; }

// 兜底：完整 Enter 链（含 insertParagraph beforeinput/input）
dispatchEnterFullChain(editor);
clearUrlQuery();
```

### 3. `doubao.ts` —— 移除死选择器轮询，直接合成 Enter

豆包输入框是 Semi Design 普通 `<textarea>`，与 DeepSeek 同构——单次 `dispatchEnter` 即可触发提交。删除整段发送按钮轮询，避免 6 秒空转：

```ts
// 修复后 —— 豆包发送按钮无稳定选择器，直接合成 Enter
if (autoSubmit) {
  // textarea 是 Semi Design 普通 textarea，单 keydown 即可触发提交
  dispatchEnter(textarea);
}
clearUrlQuery();
```

这与 DeepSeek 注入器的提交路径完全一致（`deepseek.ts` 同样用 `dispatchEnter(textarea)`，故 DeepSeek 从未受影响）。

## Why This Works

### 根因一：ChatGPT 编辑器是 ProseMirror，不是 Lexical/textarea

`#prompt-textarea` 是 `<div contenteditable="true">`，由 ProseMirror 驱动（devtool 实测确认）。ProseMirror 的提交分支**不响应裸的合成 `KeyboardEvent`**，它监听 `beforeinput` 事件并检查 `inputType === 'insertParagraph'`。旧代码只派发 keydown（甚至没有 `composed: true`），事件从未进入 ProseMirror 的提交路径——这就是「有文字，没发送」的直接原因。`dispatchEnterFullChain` 补上 `insertParagraph` 的 `beforeinput`/`input` 两步后，事件链才触达 ProseMirror 的提交监听点。同时把主提交路径改为**点击发送按钮**（`button[data-testid="send-button"]` 轮询到 enabled 再点），绕开编辑器框架差异，最可靠。

### 根因二：ChatGPT 原生 auto-submit 被 sec-fetch-site 门控（2025-07）

ChatGPT 自身的 `?q=` 原生 auto-submit 在 2025-07 被加固（Tenable TRA-2025-22）：只有浏览器 UI 发起的导航（`Sec-Fetch-Site: none`）才可靠触发自动提交。扩展通过 `location.assign` 导航属于 web-initiated 跨站（`Sec-Fetch-Site: cross-site`），所以 ChatGPT 虽然预填了文本，却**永不自动发送**——必须由注入器自行提交。这解释了为什么即使文本已正确填入，仍需要注入器主动点发送按钮 / 派发完整 Enter 链。

### 根因三：豆包选择器漂移

豆包 DOM 重构后，三个发送按钮选择器全部失配。`pollUntil` 在死选择器上空转满超时才退化到合成 Enter，而 Enter 兜底对 Semi Design `<textarea>` 本就有效——只是被 6 秒延迟拖垮。移除轮询、直接 Enter 后，提交即刻生效。

### 为什么 DeepSeek 从未受影响

DeepSeek 用同一个 `dispatchEnter` helper，但它的输入框是普通 `<textarea>`（`#chat-input`），不是 contenteditable 富文本编辑器——单次合成 keydown 即可触发提交。这正好匹配症状「仅 ChatGPT 和豆包失效」：富文本编辑器（ProseMirror）需要 `insertParagraph` 事件，普通 textarea 不需要。豆包的失效则是独立的选择器漂移问题，与事件机制无关。

## Prevention

- **先确认编辑器框架，再选事件策略**：用 devtool 看 `#prompt-textarea` 的 `tag` / `contenteditable`，判定是 ProseMirror / Lexical / Slate / 普通 textarea，再决定走 `insertParagraph` beforeinput 还是单次 keydown。不要把 Lexical 的解法（完整键盘链）套到 ProseMirror 上。
- **对 contenteditable 富文本编辑器，优先点击发送按钮，而非合成 Enter**：点击绕开框架差异，最可靠；合成 Enter 作为兜底，且必须含 `insertParagraph` 的 `beforeinput`/`input` 两步。
- **无稳定选择器契约的目标，不要把选择器当主路径**：豆包 `data-testid`/class 均会漂移，普通 textarea 直接合成 Enter 比轮询死选择器更稳。把「选择器轮询」限制在有 `data-testid` 稳定契约的站点（如 ChatGPT `send-button`）。
- **留意第三方站点的安全加固**：`sec-fetch-site` 门控会无声地让 web-initiated 导航的原生 auto-submit 失效（Tenable TRA-2025-22）。依赖原生 `?q=` auto-submit 的注入型站点，需把「扩展自行提交」作为兜底。
- **选择器漂移监测**：可考虑对关键 `data-testid`/class 选择器加最小存活探测（如 devtool 探针 / 冒烟测试），选择器全失配时告警，而非等用户报「6 秒才发」。
- **事件链要有 `composed: true`**：合成事件要穿透 Shadow DOM / React 事件委托，`bubbles: true` 不够，`composed: true` 是富文本编辑器识别的前提。

## Related Issues

- 姊妹文档 `docs/solutions/architecture-patterns/ai-engine-enter-param-auto-submit-contract.md` —— `enter=1` URL 契约把「自动提交」从「原生预填」解耦；本文是该契约在 ChatGPT（sec-fetch-site 门控）与豆包（选择器漂移）上的运行时修复。该文档的注入器行为表已过时，待 ce-compound-refresh 更新。
- `docs/solutions/architecture-patterns/ai-engine-conversation-navigation-source-type.md` —— 注入型 content script 的社区来源与协议，`shared.ts` DOM 工具基于此。该文档的框架分类（Lexical/Slate）与 ChatGPT 机制描述已过时，待 ce-compound-refresh 更新。
- MCP-SuperAssistant issue #195（2026-04）—— 完整诊断 + 修复，症状与本 bug 一致（ProseMirror `#prompt-textarea` + `insertParagraph` beforeinput 方案）。
- Tenable TRA-2025-22 —— ChatGPT `?q=` auto-submit 的 `sec-fetch-site` 门控安全公告。
- steipete/oracle `promptComposer.ts` —— 2026 生产环境驱动，验证 ProseMirror 点击发送按钮为主路径。
- mem0-chrome-extension（2026-06）—— `#prompt-textarea` 的 ProseMirror 标记佐证。
