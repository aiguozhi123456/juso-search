---
title: "Re-Resolve Dynamic (User-Defined) Sources From Fresh Config Before Navigating"
date: 2026-08-02
category: design-patterns
module: "serp / sources / search"
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "A UI surface navigates to a user-defined source whose definition can be edited or deleted elsewhere (Options) mid-session"
  - "A render-time source snapshot may be stale by the time the user triggers navigation"
  - "A navigation resolver returns the same null for an empty query and for a deleted definition"
related_components: [lib/serp-handoff.ts, entrypoints/search/App.tsx, entrypoints/serp-bar.content.ts]
tags: [dynamic-source, stale-navigation, post-write-re-resolve, race-guard, serp, custom-engine, site-engine]
---

# Re-Resolve Dynamic (User-Defined) Sources From Fresh Config Before Navigating

## Context

用户定义的源（`site:<uuid>`、`custom:<uuid>`）可以在 Options 里被编辑或删除，而搜索页或 SERP 栏此时还持有渲染时的快照。从快照直接导航，可能用到一个已被删除或已修改的模板。该模式最早作为 Site Engine 的「P1 SERP stale navigate」修复出现，随后在 Custom Engine（review finding M1）上复用。

## Guidance

导航到一个动态源之前，做一次全新的 `getProviderConfig` 读取，并用 `resolveCurrent<Type>Handoff(id, query, freshDefinitions)` 重新解析（`resolveCurrentSiteEngineHandoff` / `resolveCurrentCustomEngineHandoff`，`lib/serp-handoff.ts:109`、`lib/serp-handoff.ts:126`）：

- **未解析（定义已消失）** → 丢弃过期 chip（应用 config 快照），**不**导航，也**不**替用户持久化新的 active source。
- **已解析** → 用 fresh / post-write 的 URL 导航。

每次 `await` 之后都要复检 generation / race 守卫（搜索页的 `switchReqIdRef`、SERP 栏的 `selectGen`）。不要在一个依赖该源存在的导航之前，吞掉 `setActiveSource` 的失败。

**新增细节（review finding L5）：** 解析器对「空 query」和「已删除定义」返回**同一个** `null`。用一个 `stillDefined` 检查来消歧（该 id 是否仍在 `freshDefinitions` 里）：

- 仍定义的源 + 空 query → 静默 no-op（无谓的 config 往返 / 重渲染都不做）。
- 已删除 → 丢弃 chip。

搜索页从一开始就这么做；SERP 栏后来被精化以对齐——此前它在每次空 query 点击时都会跑 unresolved 回调（以及一次无谓的重渲染）。

**各 surface 行为（不要混为一谈）：**

- 搜索页 = 当前 tab `location.assign`；
- SERP 栏 custom engine = 新标签页 `openNewTab`；
- SERP 栏**不**为 engine / custom engine 持久化 active source（与内建 engine 一致）。

## Why This Matters

- 导航一个过期模板会落到死链或错误 URL。
- 吞掉写失败会导致 active 状态分叉。
- 把「空 query」与「已删除」混为一谈，会引入无谓的工作和误导性的控制流。
- 从 fresh config 重新解析，使并发的 Options 编辑变得安全。

## When to Apply

- 任何可能在会话中途消失的动态 id（`prefix:<uuid>`）。
- 共享同一个源的双 surface（页面 + 内容脚本）。
- 导航前有 `await` 的异步 select 路径。

## Examples

Before（从渲染时快照导航）：

```ts
const handoff = resolveSerpHandoff(clickedSource, query); // 用 chip 内嵌的旧定义
if (handoff?.kind === 'navigate') location.assign(handoff.url); // 可能导航到已删除/已改的模板
```

After（fresh 读取 → 重新解析 → 导航或丢弃）：

```ts
const config = await sendMessage('getProviderConfig', undefined);
if (!isCurrent()) return; // race 守卫：每个 await 后复检
const handoff = resolveCurrentCustomEngineHandoff(source.id, query, config.customEngines ?? []);
const stillDefined = (config.customEngines ?? []).some((d) => d.id === source.id);
if (!handoff || handoff.kind !== 'navigate') {
  if (stillDefined) return;       // 空 query + 仍定义：静默 no-op
  onUnresolvedSource?.(config);   // 已删除：丢弃过期 chip，不导航
  return;
}
void sendMessage('openNewTab', handoff.url); // SERP 栏 custom engine：新标签页
```

`resolveCurrentCustomEngineHandoff` 的签名（`lib/serp-handoff.ts:126`）：

```ts
export function resolveCurrentCustomEngineHandoff(
  customId: SourceId,
  query: string,
  customDefinitions: readonly CustomEngineDefinition[],
): SerpHandoff | null
```

## Related

- `../architecture-patterns/site-engine-third-source-and-safe-persistence.md` — 其「Post-write navigation」一节是本模式的首个实例。
- `../architecture-patterns/custom-engine-arbitrary-url-source-type.md` — Custom Engine 源类型。
- `../runtime-errors/serp-to-extension-page-blocked-by-client.md` — worker 导航 / `openSearchPage` 路径。
- `../ui-bugs/provider-switch-current-query-and-async-state.md` — 序列化 switch 写入的先例。
- `../../../CONCEPTS.md` — 项目领域词汇。
