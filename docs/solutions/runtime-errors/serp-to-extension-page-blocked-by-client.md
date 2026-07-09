---
title: "SERP Content Script Cannot Top-Level Navigate to an Extension Page (ERR_BLOCKED_BY_CLIENT)"
date: 2026-07-08
category: runtime-errors
module: "serp-bar content script / background worker / messaging"
problem_type: runtime_error
component: tooling
symptoms:
  - "快切从真实页面（Google/Bing SERP）切向拓展页报 ERR_BLOCKED_BY_CLIENT"
  - "Vivaldi 屏蔽页：此页面已被 Vivaldi 屏蔽 / invalid 已被拦截"
  - "Juso→SERP（扩展页→https）方向正常，反向 SERP→Juso（网页→扩展页）才报错"
root_cause: missing_permission
resolution_type: code_fix
severity: high
tags: [mv3, content-script, navigation, chrome-extension, vivaldi, serp-bar, quick-switch]
related_components:
  - entrypoints/serp-bar.content.ts
  - entrypoints/background.ts
  - lib/messaging.ts
  - lib/serp-handoff.ts
---

# SERP Content Script Cannot Top-Level Navigate to an Extension Page (ERR_BLOCKED_BY_CLIENT)

## Problem

快切栏（`SourceSwitcher`）在 Google/Bing SERP 页注入后，用户点一个 AI provider chip 想从真实页面跳到 Juso 搜索页（扩展页）时，当前 tab 报 `ERR_BLOCKED_BY_CLIENT`（Vivaldi：「此页面已被 Vivaldi 屏蔽 / invalid 已被拦截」），无法跳转。反向（Juso 搜索页 → SERP）与工具栏图标开页都正常。

## Symptoms

- 在 `https://www.google.com/search*` / `https://www.bing.com/search*` 上点 provider chip → 当前 tab 跳转失败，落到 Vivaldi/Chrome 的屏蔽页。
- 浏览器报 `ERR_BLOCKED_BY_CLIENT`。
- engine chip（→ SERP https URL）在同一栏里工作正常；Juso 搜索页内的 engine chip（扩展页 → https）也正常。
- 工具栏图标（background `tabs.create`）能正常打开搜索页。

## What Didn't Work

- **直接 `location.assign(getURL('search.html?...'))` from content script（原实现）。** 内容脚本运行在 `google.com`/`bing.com` 的网页上下文，对 `chrome-extension://<id>/search.html` 做**顶层导航**被客户端拦截。这是报错的根因。
- **仅把 `search.html` 加进 `web_accessible_resources`。** WAR 允许的是子框架嵌入和资源加载，并不保证网页能对扩展页做顶层 `location.assign`；Vivaldi 的客户端拦截器可能独立于 WAR 拦截 `chrome-extension://` 顶层导航。不可靠，且会把搜索页暴露给网页。
- **把内容脚本的 `onSelect` `export` 出去以便单测。** 这会让 `wxt build` 失败：WXT 把带命名 export 的内容脚本当作可被分析的模块，触发 `lib/i18n.ts` 顶层 `browser.i18n.getUILanguage()` 在 `@webext-core/fake-browser` 下的 `not implemented`。所以测试不能靠 export 内容脚本里的函数。

## Solution

把「跳扩展页」从网页上下文的 `location.assign` 改为**委托给 background worker** 在特权上下文用 `browser.tabs.update` 导航当前 tab。特权上下文发起的导航不被客户端拦截（与工具栏图标 `tabs.create` 同一路径）。

**1. 新增消息协议**（`lib/messaging.ts`）：

```ts
openSearchPage(deepLink: string): Promise<void>;
```

`deepLink` 是相对路径（`search.html?provider=X&query=Y` 或 `/search.html`），与 `buildSearchDeepLink` 输出一致。

**2. background 注册 handler**（`entrypoints/background.ts`），用 `sender.tab.id` 导航当前 tab：

```ts
onMessage('openSearchPage', ({ data, sender }) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return; // 非内容脚本来源（无 tab），安全跳过
  void browser.tabs.update(tabId, {
    url: (browser.runtime.getURL as (p: string) => string)(data),
  });
});
```

**3. 内容脚本 provider 分支改走消息**（`entrypoints/serp-bar.content.ts`），engine 分支（→ https SERP）保持 `location.assign` 不变：

```ts
function onSelect(source: SearchSource, query: string): void {
  const handoff = resolveSerpHandoff(source, query);
  if (!handoff) return;
  if (handoff.kind === 'navigate') {
    location.assign(handoff.url);      // engine → https，网页可导航
    return;
  }
  void sendMessage('openSearchPage', handoff.deepLink); // provider → 委托 worker
}
```

**4. 跳转意图抽到纯函数**（`lib/serp-handoff.ts`），避免内容脚本带命名 export 污染 `wxt build`，同时便于单测：

```ts
export type SerpHandoff =
  | { kind: 'navigate'; url: string }
  | { kind: 'openSearchPage'; deepLink: string };

export function resolveSerpHandoff(source, query): SerpHandoff | null { ... }
```

回归测试 `tests/serp-bar.test.ts` 锁定 provider 分支产出 `openSearchPage`、engine 分支产出 `navigate`。

## Why This Works

`ERR_BLOCKED_BY_CLIENT` 来自浏览器对「普通网页发起、指向扩展页的顶层导航」的反滥用拦截。三条现有导航路径的状态对照：

| 路径 | 代码 | 发起上下文 | 目标 | 结果 |
|---|---|---|---|---|
| 工具栏开页 | `background.ts` `tabs.create({url: getURL('/search.html')})` | background 特权 | 扩展页 | 正常 |
| Juso→SERP | `App.tsx` `location.assign(engine.buildSerpUrl(...))` | 扩展页 | https | 正常 |
| **SERP→Juso** | 原 `serp-bar.content.ts` `location.assign(getURL(...))` | **网页** | **扩展页** | **被拦** |

修复让 SERP→Juso 也从「特权上下文」发起（`tabs.update` 在 background 调用），与工具栏开页同属一条允许的路径。`sender.tab.id` 保证导航的是 chip 所在的当前 tab，用户体验仍是「当前 tab 跳转」。

`web_accessible_resources` 不是正确的解法：它的语义是资源/子框架可访问性，不是顶层导航许可。即便补上也未必绕过客户端拦截器，反而把搜索页暴露给任意匹配网页。

## Prevention

- **网页上下文不得顶层导航到 `chrome-extension://`。** 任何由内容脚本发起、目标是扩展页的跳转，都应委托 background 用 `tabs.update`/`tabs.create` 执行。引擎→SERP 这种「网页→https」的跳转用 `location.assign` 没问题。
- **内容脚本不要 `export` 命名成员。** WXT 会把带命名 export 的内容脚本当可分析模块，触发其依赖图顶层的浏览器 API 副作用（如 `browser.i18n.getUILanguage()`），在 `wxt build` 下炸开。需要单测的逻辑抽到独立的纯模块（本项目用 `lib/serp-handoff.ts`）。
- **快切两方向都要有测试。** 此前只有 Juso→SERP 方向（`search-page.test.tsx`）有覆盖，反向 SERP→Juso 零覆盖，所以回归没被拦住。新增 `tests/serp-bar.test.ts` 后，provider 分支产出 `openSearchPage`、engine 分支产出 `navigate` 被锁定。

## Related Issues

- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md` — 快切栏架构与「SERP→扩展页 current-tab 导航带状态交接」的设计意图（本文档修正了其中由网页上下文发起该导航的实现方式）。
