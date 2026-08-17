---
title: "Adding a New Source Type Silently Drops Its Order/Visibility Unless Threaded Through Every Source-Graph Mutation Path"
date: 2026-08-02
last_updated: 2026-08-17
category: logic-errors
module: "sources / storage / source-groups"
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "With one or more custom engines saved, creating/updating/deleting ANY site engine silently resets the custom engines' quick-switch order (they jump to the tail)"
  - "Hidden custom engines become visible again after an unrelated site-engine mutation"
  - "No error is thrown; the loss is written to chrome.storage.local immediately and persists"
root_cause: logic_error
resolution_type: code_fix
related_components: [lib/storage/, lib/sources.ts, lib/source-groups.ts, lib/schema.ts]
tags: [source-graph, normalize, source-order, source-hidden, data-loss, custom-engine, site-engine, config-keys]
---

# Adding a New Source Type Silently Drops Its Order/Visibility Unless Threaded Through Every Source-Graph Mutation Path

## Problem

引入 Custom Engine 这一新来源类型时，`customDefinitions` 被正确地穿过了**新增的** custom-engine CRUD（`createCustomEngineDefinition` / `updateCustomEngineDefinition` / `deleteCustomEngineDefinition`）以及大多数 source-graph 函数，却漏掉了**早已存在**的 site-engine CRUD 三件套：`createSiteEngineDefinition` / `updateSiteEngineDefinition` / `deleteSiteEngineDefinition`（`lib/storage/site-engine-store.ts`）。

这三个函数在写入时会调用 `normalizeSourceOrder` / `normalizeSourceHidden` / `ensureVisibleUsable` / `visibleUsableSource`（`lib/sources.ts` 与 `lib/storage/` 各 store 模块），但当时只传入了 site 定义，`customDefinitions` 走了默认值 `[]`。而这些 normalizer 的契约是「丢弃任何它不认识的 id」——于是每一次 site-engine 变更都会把所有 `custom:*` id 从持久化的 `sourceOrder` 中剥掉（顺序丢失 → 下次读取时被 `normalizeSourceOrder` 的补尾逻辑追加到末尾），并从 `sourceHidden` 中剥掉（被隐藏的 custom engine 重新可见）。

触发条件：只要存在 ≥1 个 custom engine，**任意一次** site-engine 增删改都会触发。整个过程不抛异常、立即写入 `chrome.storage.local` 并持久化——是一次静默的数据丢失。

## Symptoms

- 已保存一个或多个 custom engine 时，创建/更新/删除**任意**一个 site engine 后，custom engine 的快切顺序被静默重置（它们跳到栏尾）。
- 被隐藏的 custom engine 在一次与之无关的 site-engine 变更后重新显示出来。
- 全程无报错；丢失结果立刻写入 `chrome.storage.local` 并持久存在。

## What Didn't Work

这个 bug 之所以能存活，是测试盲区造成的：storage 层**没有任何**让 site engine 与 custom engine 共存的测试。site CRUD 的测试从未 seed 过 custom engine；custom CRUD 则只有 mock 掉 gateway 的测试和纯函数测试。新写的代码路径本身是正确的，所以「单类型」测试全部通过——只有当两种类型同时存在于 storage、且变更的是 site 一侧时，丢失才会显现，而这恰好没有被任何测试覆盖。

换言之：新增的代码路径正确 ≠ 整张 source graph 正确。漏掉的是**旧路径对新类型的感知**。

## Solution

在三个 site-engine CRUD 函数里，与 `clearKey` 和 custom-engine CRUD 已有的做法对齐：

1. 在同一次 `browser.storage.local.get([...])` 调用中一并读取 `CUSTOM_ENGINES_KEY`；
2. 用 `normalizeCustomEngineDefinitions` 规范化得到 `customDefinitions`；
3. 把它作为第三个实参传给 `normalizeSourceOrder` / `normalizeSourceHidden` / `ensureVisibleUsable` / `visibleUsableSource`。

修复后 `createSiteEngineDefinition`（`lib/storage/site-engine-store.ts`）的读取与写入：

```ts
const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
// ...
await browser.storage.local.set({
  [SITE_ENGINES_KEY]: next,
  [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next, customDefinitions, instances),
  [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next, customDefinitions, instances),
});
```

（后续 Provider Instance 成为新来源类型时，同一清单又被执行了一遍——第四个实参 `instances` 即那次补穿；本文的教训随 registry 演进持续适用。）

`updateSiteEngineDefinition`（`lib/storage/site-engine-store.ts`）同理；`deleteSiteEngineDefinition`（`lib/storage/site-engine-store.ts`） additionally 把 `customDefinitions` 与 `instances` 传进 `ensureVisibleUsable` 与 `visibleUsableSource`，保证删除 site engine 后挑选 fallback 激活源时也不会误判 custom engine / provider instance 的可用性。

### 同类实例 L4：`normalizeGroupConfig` 漏补新内置组到非空 layout

`lib/source-groups.ts` 的 `normalizeGroupConfig` 把新增的 `custom` 内置组加进了 `groups`，却**没有**把它加进一个**非空**的 `layout`——它只对空 layout 做默认填充。升级用户持久化的 layout 是 `[ai-search, engines, sites]`，缺 `custom`，于是 custom 分组只能靠 `projectLayout` 末尾那段被注释标注为「理论上不会发生」的兜底扫描渲染出来，位置不可控、也不可持久化。

修复：对非空 layout，把缺失的**内置**组 id 按 `DEFAULT_GROUPS` 顺序追加到末尾（保持既有顺序、不重复、**绝不**自动追加用户自建组）。见 `lib/source-groups.ts:218` 起的补齐逻辑。同一 bug 类：新成员只在部分路径注册，没有覆盖全部路径。

### 同类实例 L1：新 storage key 未登记进 `CONFIG_KEYS`

新增的 `customEngines` storage key 最初没有被加进 `lib/schema.ts` 的 `CONFIG_KEYS`（该文件自己文档化的约定：新增 config 键必须同步进白名单）。当下无害——没有迁移会读写它，getter 回退到 `[]`，`ensureSchema` 也删不掉它（因为它从不出现在 before-snapshot 里）——但这是一处潜伏陷阱：**第一个**需要读取/转换 `customEngines` 的迁移会静默地看不到它。修复：把 `'customEngines'` 加进 `CONFIG_KEYS`（`lib/schema.ts:24`）。

## Why This Works

normalizer 的「丢弃未知 id」本身是**正确**的防御性设计，提供向前弹性：registry 追加新 engine 时不必改 normalizer，损坏/遗留的 id 也不会向下传播。bug 不在 normalizer，而在**调用方没有提供完整的已知 id 集合**。把 `customDefinitions` 传进去之后，`custom:*` id 就成了「已知」的，从而被保留——normalizer 的语义一行没改，只是调用方补全了输入。

L4 与 L1 同理：`normalizeGroupConfig` 的「只补内置组、不自动加用户组」是对的，缺的只是把新内置组登记进非空 layout 的那一步；`CONFIG_KEYS` 的白名单机制是对的，缺的只是把新键登记进去。三处都是「注册了新成员，但没注册到所有引用它的地方」。

## Prevention

持久教训——当你要向一个被多个 normalizer / mutation 引用的集合添加新成员时，按这份清单逐一排查：

- [ ] 枚举 `normalizeSourceOrder` 的**每一个**调用方，把新集合穿进去；
- [ ] 枚举 `normalizeSourceHidden` 的每一个调用方；
- [ ] 枚举 `ensureVisibleUsable` / `visibleUsableSource` 的每一个调用方；
- [ ] 检查分组 normalizer `normalizeGroupConfig`：新内置组是否同时进了 `groups` **和**非空 `layout`；
- [ ] 检查白名单（`lib/schema.ts` 的 `CONFIG_KEYS`）：新 storage key 是否登记；
- [ ] 检查 config 导入/导出（`lib/config-io.ts`）的字段合并是否覆盖新类型。

在**所有**这些地方穿入新集合 / 登记新 id，而不只是在新类型自己的 CRUD 里。

最后，补一个**共存回归测试**：同时 seed 类型 A 与类型 B，变更类型 A，断言类型 B 的顺序与显隐存活；再反向做一次（变更 B，断言 A 存活）。这次的 bug 正是因为缺这一个测试而存活。

## Related Issues

- [persistent-source-order-and-visible-projection](../architecture-patterns/persistent-source-order-and-visible-projection.md) — normalize 的不变量（sourceOrder / sourceHidden 投影契约）
- [site-engine-third-source-and-safe-persistence](../architecture-patterns/site-engine-third-source-and-safe-persistence.md) — site engine 作为第三类来源及其安全持久化
- [source-group-layout-layer](../architecture-patterns/source-group-layout-layer.md) — 分组布局层（L4 所在）
- [dual-domain-storage-schema-versioning](../architecture-patterns/dual-domain-storage-schema-versioning.md) — `CONFIG_KEYS` 白名单与 schema 版本（L1 所在）
- [custom-engine-arbitrary-url-source-type](../architecture-patterns/custom-engine-arbitrary-url-source-type.md) — Custom Engine 这一新来源类型本身
- [config-import-schema-version-range](../conventions/config-import-schema-version-range.md) — 同族「把新事物在所有地方注册/接受」教训
- [Project concepts](../../../CONCEPTS.md) — Search Source、Source Order、Source Hidden 等领域词汇
