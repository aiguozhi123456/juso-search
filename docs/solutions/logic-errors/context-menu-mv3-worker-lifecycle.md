---
title: "Right-click context menu search and MV3 worker lifecycle defects"
date: 2026-08-12
category: logic-errors
module: "lib/context-menu / entrypoints/background / lib/storage / lib/sources / lib/source-groups / lib/serp-handoff / lib/i18n / wxt.config"
problem_type: logic_error
component: background_job
severity: high
symptoms:
  - "First context-menu click after an MV3 worker wakeup silently does nothing; the second click works (module-level sourceById Map is empty, rebuild not yet awaited)"
  - "Two storage changes arriving while a menu rebuild is in flight drop the second; the menu stays permanently stale (no self-heal)"
  - "Context menu language ignores the user's localePref and only follows the browser UI language; changing the preference does not rebuild the menu"
  - "Menu layout auto-flattens small source sets even when the flatLayoutFewSources preference is off (groups are not preserved)"
  - "Inject-type AI engines (ChatGPT/DeepSeek/Doubao/Gemini) auto-submit from the menu even when aiAutoEnter is off"
root_cause: async_timing
resolution_type: code_fix
related_components: [lib/sources.ts, lib/source-groups.ts, lib/serp-handoff.ts, lib/storage.ts, lib/i18n.ts, entrypoints/background.ts, wxt.config.ts]
tags: [context-menu, chrome-mv3, service-worker, worker-lifecycle, contextmenus, source-groups, storage-watch, preference-sync]
---

# 右键菜单搜索：镜像快切栏布局的菜单树 + MV3 worker 生命周期缺陷（S1/S2）与修复

## 背景

为 Chrome MV3 搜索扩展「双面搜」（WXT + React + TypeScript）新增「选中文本 → 右键 → 用 juso 搜索 → 镜像快切栏分组布局的菜单树 → 点击某源在新标签页搜索」功能。功能本身属于知识型实践（镜像快切栏布局、i18n 参与菜单、偏好在两处 UI 同源），实现过程中被 Oracle 代码审查发现了 7 个缺陷（S1/S2 严重、M1/M2/M3 中等、L1/L2 轻微），全部修复并验证。本文档同时覆盖两块学习：**功能如何正确实现**（知识）与 **MV3 worker 生命周期/异步竞态缺陷如何诊断与修复**（Bug）。

---

# Bug Track（S1/S2 严重缺陷）

## Problem

- **S1（严重）**：右键菜单项点击处理器依赖模块级内存 `Map<string, SearchSource>`（`sourceById`）来解析 source。MV3 的 background worker 在空闲约 30s 后会被浏览器终止，worker 内的模块级变量全部清零。worker 被唤醒时，`entrypoints/background.ts` 中 `void setupContextMenu()` 先 `await getProviderConfigSnapshot()`（读 `chrome.storage.local` 全部配置键），而此时 Chrome 已经把用户点击派发到 `browser.contextMenus.onClicked` → `handleContextMenuClick` → `sourceById.get(sourceId)` 返回 `undefined` → 函数静默 return。**菜单由浏览器持久持有（不随 worker 终止消失），用户看到菜单点了却没反应，第二次点击才生效**——首次点击前 worker 尚未完成重建，map 恰好是空。
- **S2（严重）**：`if (rebuilding) return` 的防重入逻辑在重建 in-flight 期间丢弃新到达的重建请求。两次 storage 变更在首次重建的 in-flight 窗口内先后到达时，第二次被静默丢弃；若首次重建的快照读取发生在第二次变更提交之前，菜单停留在旧状态，且之后没有新的 storage 事件触发重建（**非自愈**）。典型触发场景：UI 连续调用 `setSourceOrder` → `setSourceHidden` 两次独立的 `storage.set`；或 `importConfig` 批量写入多个配置键。

## Symptoms

- 菜单在右键菜单中显示正常，但点击叶子项「无反应」——特别是 worker 刚被唤醒后的**第一次点击**（30s 空闲后典型复现路径）；第二次点击正常。
- 连续两次快速修改来源顺序/显隐（或导入配置）后，菜单结构与快切栏不一致，且**不再自愈**——即使再触发其他配置变更也不一定恢复。
- 这两个缺陷都是「偶发、依赖时序」的行为，无报错日志，排障困难。

## What Didn't Work

- **模块级内存 Map + 启动时异步构建**：`sourceById` 依赖「worker 存活期间 build 已完成」这一隐含时序。MV3 中 worker 可被随时终止，内存态不是可靠的事实来源。
- **`if (rebuilding) return` 丢弃请求**：以为「重建期间再来请求直接返回」是安全的防重入，但忽略了「请求必须被处理」的语义——存储事件是状态变更的通知，丢弃它等于丢失最终状态同步。
- **S1 的替代尝试「在 rebuild 前先清空 map」**：把 `sourceById = new Map()` 放到构建前，扩大而非缩小了竞态窗口——build 期间任何一次点击都必然 miss。

## Solution

### S1 修复：快照回退自解析 + 一次性赋值

三个变化协同修复「worker 唤醒后首次点击失效」：

1. **回退自解析**：`handleContextMenuClick` 中，map 命中失败时从配置快照按同参投影重新解析 source：
   ```ts
   export async function handleContextMenuClick(
     info: { menuItemId: string | number; selectionText?: string },
   ): Promise<void> {
     const itemId = String(info.menuItemId);
     if (!itemId.startsWith(SOURCE_PREFIX)) return; // 只处理叶子源项
     const sourceId = itemId.slice(SOURCE_PREFIX.length);
     const query = info.selectionText?.trim();
     if (!query) return;

     // 先读一次配置快照：M3 的 aiAutoEnter 偏好 + S1 回退自解析共用同一份，避免重复读
     const snapshot = await getProviderConfigSnapshot();
     const source = sourceById.get(sourceId) ?? resolveSourceFromSnapshot(snapshot, sourceId);
     if (!source) return;

     const handoff = resolveSerpHandoff(source, query, { aiAutoEnter: snapshot.aiAutoEnter });
     if (!handoff) return;
     // navigate → browser.tabs.create({ url }); openSearchPage → buildSafeSearchUrl(deepLink) 后 create
     ...
   }
   ```
2. **新增私有 `resolveSourceFromSnapshot`**：与菜单构建同参调用 `allSources(...)` 投影源列表后 `find`，保证「菜单里的源」与「快照解析出的源」严格一致：
   ```ts
   function resolveSourceFromSnapshot(
     snapshot: Awaited<ReturnType<typeof getProviderConfigSnapshot>>,
     sourceId: string,
   ): SearchSource | undefined {
     return allSources(
       snapshot.configuredProviderIds,
       snapshot.sourceOrder,
       snapshot.sourceHidden,
       snapshot.siteEngines,
       snapshot.customEngines,
       snapshot.providerInstances,
     ).find((s) => s.id === sourceId);
   }
   ```
3. **一次性赋值消除 clear/set 窗口期**：`sourceById` 从 `const` 改 `let`；在 `rebuildMenuOnce` 内先在局部构建 `nextSourceById`，全部填充完成后一次性 `sourceById = nextSourceById`——全程没有中间态，map 要么是旧完整态要么是新完整态：
   ```ts
   const nextSourceById = new Map<string, SearchSource>();
   for (const source of sources) nextSourceById.set(source.id, source);
   sourceById = nextSourceById;
   ```

### S2 修复：pending 标记 + do/while 排队重跑

把「丢弃请求」改为「排队重跑」，重建期间到达的新请求标记 `rebuildPending`，当前轮结束后自动再跑一轮：

```ts
let rebuilding = false;
let rebuildPending = false;
export async function setupContextMenu(): Promise<void> {
  if (rebuilding) {
    rebuildPending = true; // 请求排队，不丢弃
    return;
  }
  rebuilding = true;
  try {
    do {
      rebuildPending = false;
      await rebuildMenuOnce();
    } while (rebuildPending);
  } finally {
    rebuilding = false; // 异常路径也解锁
  }
}
```

do/while 天然合并突发重建请求（第一轮结束前的多次请求只触发一轮补跑），`finally` 保证抛错也能复位 `rebuilding`，不会永久锁死。

## Why This Works

- **S1**：浏览器持久持有的菜单 + 可被终止的 worker，二者生命周期不一致是 MV3 的固有现实。把「点击解析」从「依赖内存态」改为「依赖可重新读取的持久配置快照」，使解析路径在 worker 冷启动后依然自洽。map 只是优化（避免每次点击重投影全部源），快照回退是正确性兜底。`resolveSourceFromSnapshot` 与构建路径共用同一投影函数和同一份快照参数，保证了菜单可见性与可点击性的判定一致。
- **S2**：storage 变更事件代表「状态已变，请同步」，语义上是**命令**而非**通知**。丢弃请求破坏了命令语义；标记 pending 并在当前轮结束后续跑，既保留防重入（同一时刻至多一个重建 in-flight），又保证每个变更最终被反映。快照读取发生在第一轮、而变更提交在第二轮重跑时才被读到，所以「旧菜单 + 无事件」的非自愈状态不会出现——总有后续一轮兜底。

## Prevention

- **教训一：MV3 worker 内，模块级内存态永远不是事实来源。** 任何「worker 启动时构建、之后靠内存态服务」的模式都必须考虑 worker 被终止后重建的空窗期。防御策略：把关键解析做成「从持久存储自解析」的回退路径，内存态只做缓存。
- **教训二：in-flight 防重入绝不能丢弃请求。** 防重入要回答「第二次调用怎么办」，正确选项是「排队」「合并」「串行化」，而不是「忽略」。若忽略会造成非自愈的最终不一致状态。
- **测试用例**（见 `tests/context-menu.test.ts`）：
  - S1：`vi.resetModules()` 后重新 import 全新模块实例（map 为空），`handleContextMenuClick` 仍能从快照解析并 `tabs.create` 正确 URL —— 直接复现「worker 冷启动首次点击」。
  - S2（间接）：无重建后可直接验证；并发时序测试覆盖成本高，由 S1 的幂等性 + do/while 结构保障。
  - 菜单树结构精确断言（18 项 id 序列）、无源时仅 `removeAll` 不 `create`。

---

# Knowledge Track（右键菜单搜索功能的正确实现）

## Context

「双面搜」是 WXT + React + TypeScript 的 Chrome MV3 搜索扩展。快切栏（SourceSwitcher，`entrypoints/search` 内）是主选源 UI，其布局由 `lib/source-groups.ts` 的 `projectLayout` / `resolveEffectiveLayout` 投影（置顶源平铺 + 分组子菜单），源列表由 `lib/sources.ts` 的 `allSources` 投影（按 `configuredProviderIds` 过滤、`sourceHidden` 剔除）。新功能要把这套布局镜像到浏览器右键菜单，让用户在任意网页选中文本即可用任一已配置源搜索，并新标签页打开结果。关键词：右键菜单搜索、镜像快切栏布局、菜单树与 worker 生命周期。

## Guidance

### 1. 菜单结构：镜像快切栏的布局投影

- 新建 `lib/context-menu.ts` 承载全部逻辑（模块边界清晰、可单测）。菜单项 id 编码类型前缀：根 `juso-search-root`、叶子源 `juso-src:<sourceId>`、分组 `juso-group:<groupId>`，全部 `contexts: ['selection']`。id 前缀约定让点击处理器只凭 `juso-src:` 前缀即可识别叶子项，无需维护额外映射。
- 布局决策与快切栏同源：`flatLayoutFewSources` 偏好开启时用 `resolveEffectiveLayout(sources, groupConfig, null)`（≤4/≤6 自动平铺），关闭时用 `projectLayout(sources, groupConfig, null)`（保留分组）。**同一个布局偏好在两处 UI 必须一致读取**，否则「镜像」承诺落空（这是 M2 的教训）。
- 构建顺序：先 `removeAll()` 清旧菜单（含空源场景——无可用源时也清空，避免残留陈旧项），再 `await` 串行创建 root → children（逐项 `await` 保持确定性顺序，也天然避免未处理 rejection，见 L1）。

### 2. 点击跳转：复用 SERP 跳转解析，遵守扩展页白名单

- 点击时从 `info.selectionText` 取查询词（`trim()` 后为空则静默 return），用 `resolveSerpHandoff(source, query, opts)`（`lib/serp-handoff.ts`）解析跳转意图，得到判别联合 `{kind:'navigate', url}` / `{kind:'openSearchPage', deepLink}`。
- `navigate`（engine/ai-engine/site/custom）→ 直接 `browser.tabs.create({ url })`。
- `openSearchPage`（provider/provider-instance）→ **必须**经 `buildSafeSearchUrl(deepLink)`（`lib/search-page-url.ts`）生成 URL——该函数固定 `base=/search.html` 并白名单转发 `provider/query` 参数，防止任意跳转到 `options.html` 等特权扩展页。安全边界在 URL 构建处，而不是信任调用方。
- 用户偏好必须透传：`aiAutoEnter` 决定注入型 AI 引擎（ChatGPT/DeepSeek/豆包/Gemini）是否追加 `enter=1` 自动提交。`resolveSerpHandoff(source, query, { aiAutoEnter: snapshot.aiAutoEnter })`——**两处 UI 用同一个快照键，行为才一致**（M3 的教训）。点击处理先读一次配置快照，让 M3 偏好与 S1 回退自解析共用同一份，避免重复读存储。

### 3. 生命周期接线：worker 启动 + 安装 + storage 变更三路重建

`entrypoints/background.ts` 中三处接线：

```ts
void setupContextMenu();                                        // worker 启动
browser.runtime.onInstalled.addListener(() => void setupContextMenu()); // 安装/更新
browser.contextMenus.onClicked.addListener((info) => void handleContextMenuClick(info));
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (contextMenuNeedsRebuild(changes)) void setupContextMenu();
});
```

- **重建触发判定集中一处**：`contextMenuNeedsRebuild(changes)` 用 `REBUILD_KEYS` Set 判断，key 集合 = 影响菜单结构与可用源的配置键：`sourceOrder` / `sourceHidden` / `siteEngines` / `customEngines` / `providerInstances` / `groupConfig` / `providerKeys` / `localePref` / `flatLayoutFewSources`。**新增一个影响菜单的 storage 键时，必须同步加入 REBUILD_KEYS**——这是 M1（`localePref`）与 M2（`flatLayoutFewSources`）漏掉的共同根因。
- storage 监听器**独立注册**（与 UI pref 广播的 onChanged 分开），职责单一。

### 4. i18n 参与菜单语言

- 根菜单标题用 i18n 消息 `context_menu_root`（zh_CN「用 juso 搜索」/ en "Search with juso"），在 `lib/i18n.ts` MSG 常量注册、`public/_locales/{zh_CN,en}/messages.json` 各加一项。分组标签同理经 `resolveLabel`（`kind === 'literal'` 直接取值，否则 `t(key)`）。
- 菜单语言跟随**用户存储的 `localePref`**，而不是 worker 里 `t()` 的默认解析（浏览器 UI 语言）。`rebuildMenuOnce` 开头读 `localePref`，经 `isLocalePref` 校验后 `applyLocalePref(pref)`（非法值回退 `'auto'`），并把 `localePref` 加入 REBUILD_KEYS——切语言触发重建（M1 的完整修复）。

## Why This Matters

- **镜像一致性**：右键菜单是快切栏的"外置延伸"，两者必须读同一份投影函数、同一份快照、同一份偏好（布局 + aiAutoEnter + 语言），任何一处不一致都是用户可见的体验断裂。
- **安全**：provider 深链必须经 `buildSafeSearchUrl` 白名单，不能信任调用方传入的任意 URL。
- **可靠**：menu 由浏览器持久持有而 worker 可被终止，跨生命周期一致性是这类功能的正确性核心——这正是 S1/S2 缺陷的来源。

## When to Apply

- 给 Chrome/Firefox MV3 扩展添加「选中文本 → 右键菜单 → 用扩展内任意已配置源搜索」类功能时。
- 任何「镜像 UI 布局/行为到另一个入口（菜单、快捷键、命令面板）」的扩展功能。
- 在 MV3 扩展中维护任何「启动时构建、之后靠内存态服务」的模块时（防御 worker 终止竞态）。

## Examples

- 真实实现参考：`C:\workspace\search\lib\context-menu.ts`（206 行，修复后最终版）、`entrypoints/background.ts`（接线）、`tests/context-menu.test.ts`（11 用例，覆盖 REBUILD_KEYS 判定、菜单树 18 项精确序列、navigate/openSearchPage 两跳转分支、空选词、非叶子前缀、M2 projectLayout 分支、M3 aiAutoEnter:false、S1 快照回退）。
- 测试断言示例（engine → navigate）：
  ```ts
  await handleContextMenuClick({ menuItemId: 'juso-src:google', selectionText: 'hello world' });
  expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://www.google.com/search?q=hello%20world' });
  ```
- 测试断言示例（provider → openSearchPage）：
  ```ts
  await handleContextMenuClick({ menuItemId: 'juso-src:tavily', selectionText: 'hello' });
  expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://fake-id/search.html?provider=tavily&query=hello' });
  ```

---

# 附：次要缺陷修复记录（供参考）

- **M1（中等）** `localePref` 未参与菜单语言：worker 的 `t()` 默认按浏览器 UI 语言解析，忽略用户存储的 `localePref`，且切语言不触发重建。修复见上文 Guidance §4。
- **M2（中等）** `flatLayoutFewSources` 被忽略：菜单始终用 `resolveEffectiveLayout`（自动平铺），而 SourceSwitcher 在 pref 关闭时用 `projectLayout`（保留分组）——布局镜像落空；且该 pref 不在 REBUILD_KEYS。修复：REBUILD_KEYS 加入该键，布局按偏好路由两分支。
- **M3（中等）** `aiAutoEnter` 偏好被忽略：`resolveSerpHandoff` 未传 opts，注入型 AI 引擎总是追加 `enter=1`，与用户设置相悖。修复：传 `{ aiAutoEnter: snapshot.aiAutoEnter }`。
- **L1（轻微）** `contextMenus.create` 未 await/未 catch，任一失败 → unhandled rejection；整体 `void setupContextMenu()` 无 catch，排障无日志。修复：`rebuildMenuOnce` 整体 try/catch 并 `console.warn('[contextMenu] rebuild failed', error)`；create 逐项 await 串行化。另按测试规范把 `removeAll` 提前到空源检查之前——语义变化：原「空源保留旧菜单」→ 现「空源清空菜单」。
- **L2（轻微）** 核心逻辑零测试覆盖。修复：新建 `tests/context-menu.test.ts` 11 用例。

## 验证

typecheck / lint / 60 文件 1239 测试全过；真实浏览器确认：选中文本 → 右键 → juso 搜索 → 菜单树结构与快切栏一致 → 点击各源正确新标签页打开（含 worker 冷启动首次点击）。

## Related

- [Source Group Layout](../architecture-patterns/source-group-layout-layer.md) — 菜单树镜像的布局契约（projectLayout / resolveEffectiveLayout / flatLayoutFewSources / groupOrders）
- [Dynamic Source Stale Navigation Guard](../design-patterns/dynamic-source-stale-navigation-guard.md) — 陈旧快照规则：动态源（site/custom）应在点击时从最新配置重新解析，菜单不得用渲染期快照导航
- [Local Search Cache (MV3)](../architecture-patterns/local-search-cache-mv3.md) — worker 侧模块级队列/唤醒纪律的同类先例（S2 的串行化模式）
- [Theme Persistence & i18n Key Hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) — worker 侧 storage.onChanged 观察者卫生（M1 的 locale 键、i18n 键一致性）
- [AI Engine Enter-Param Auto-Submit Contract](../architecture-patterns/ai-engine-enter-param-auto-submit-contract.md) — aiAutoEnter/enter=1 契约（M3）
- [Config Preference Pipeline](../architecture-patterns/config-preference-pipeline.md) — 影响菜单的偏好需随完整管线流动
