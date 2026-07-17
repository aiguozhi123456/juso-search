---
title: "Adding a persisted config preference: the end-to-end pipeline"
date: 2026-07-17
category: architecture-patterns
module: config-preferences
problem_type: architecture_pattern
component: tooling
severity: low
applies_when:
  - "Adding a new persisted user preference to this extension"
  - "Adding a second array-of-SourceId source-bar preference on top of sourceOrder"
  - "A preference must round-trip through worker messaging, config export/import, and multiple UI hosts"
related_components:
  - lib/sources.ts
  - lib/storage.ts
  - lib/schema.ts
  - lib/messaging.ts
  - lib/gateway.ts
  - lib/config-io.ts
  - entrypoints/background.ts
  - entrypoints/options/App.tsx
  - entrypoints/search/App.tsx
  - entrypoints/serp-bar.content.ts
tags:
  - config-preference
  - source-bar
  - chrome-storage
  - worker-messaging
  - config-import
  - normalization
  - i18n-parity
  - optimistic-ui
---

# 添加持久化配置偏好：端到端管线（以 sourceHidden 为实例）

## Context

本扩展的用户偏好散落在一条分层管线上：投影层、存储层、schema 域、worker 消息契约、gateway handler、background 路由、配置导入导出、i18n，再由两个 UI 宿主（Juso 搜索页、SERP 注入栏）和设置页共同消费。`sourceOrder` 是第一个 `SourceId[]` 型快切栏偏好，并确立了先例（见 *persistent-source-order-and-visible-projection*）。

`sourceHidden`（把个别 engine/provider 从快切栏隐藏）是第二个走同一管线的 `SourceId[]` 偏好。重走这条管线后得到两样可复用的东西：(1) 一份「加一个偏好要碰哪几层」的清单；(2) 第二个快切栏偏好必须在何处**刻意偏离** `sourceOrder`。把它们记下来，第三个偏好应是分钟级而非重新推导。

## Guidance

### 八层触点清单（沿 sourceOrder 先例）

新增一个持久化偏好时，按顺序碰这些层；漏掉任何一层都会在奇怪的地方（i18n parity 测试、导入报告类型错误、配置无法导出/导入）失败：

1. **模型 + 规范化**（`lib/sources.ts`）：加 `normalizeX`，并在 `allSources` 投影里消费新参数。
2. **存储**（`lib/storage.ts`）：键常量、写串行队列（`withXMutation`）、getter/setter；getter 精确读自身键，绝不 `get(null)`。
3. **schema 白名单**（`lib/schema.ts`）：把新键加进 `CONFIG_KEYS`，否则 `ensureSchema` 不会读/写它。默认值安全（如空数组）时**无需 bump 版本**——getter 会把缺失规范化为默认。
4. **消息契约**（`lib/messaging.ts`）：把字段加进 `ProviderConfigReply`，并在 `ProtocolMap` 加一个 setter 消息。
5. **gateway**（`lib/gateway.ts`）：在 `handleGetProviderConfig` 读取并在返回值带上；新增 `handleSetX`。
6. **background 路由**（`entrypoints/background.ts`）：`onMessage` 注册 setter。
7. **配置导入/导出**（`lib/config-io.ts`）：`ConfigExport` 字段、`buildExportPayload` 读取、`parseImportPayload` 校验（区分**字段缺失**与**字段存在**）、`previewImport` diff、`mergeImport` 覆盖（由 `applyPrefs` 把关）+ 新 `ImportReport` 字段、`PrefDiff` key 联合类型；把新键加进每一处 `get([...])`，并把写串行队列嵌进 `mergeImport`。
8. **i18n**（`lib/i18n.ts` 的 `MSG` + `_locales/{zh_CN,en}/messages.json`）：三方一致性测试（`tests/i18n-parity.test.ts`）强制 `MSG` ⊆ 两个 locale 且两侧键集相同。

加上消费端：搜索页与 SERP content script 把新参数透传给 `allSources`；设置页加一个乐观更新 + 失败回滚的开关（沿用 `moveSource` 的 revision/epoch 防陈旧模式，详见 sourceOrder 文档，此处不重复）。

### sourceHidden 刻意偏离 sourceOrder 之处

第二个快切栏偏好不能无脑复制第一个。以下分歧是本次的真正陷阱：

1. **稀疏 vs 完整规范化——最高杠杆陷阱。** `normalizeSourceOrder` 是**完整**列表：保留已知 id 首现后，把遗漏项按 registry 顺序**补尾**（前向韧性）。隐藏清单必须是**稀疏**的：只过滤 + 去重，**绝不补尾**。若把 sourceOrder 的规范化复用给隐藏清单，每次规范化都会把所有隐藏来源重新补回来，功能静默失效——而 `normalizeSourceOrder` 的单测甚至会通过。

   ```ts
   // sourceOrder：完整——补尾遗漏项（前向韧性）
   export function normalizeSourceOrder(order: unknown): SourceId[] {
     // ...保留已知 id 首现、去重...
     for (const id of DEFAULT_SOURCE_ORDER) {
       if (!seen.has(id)) normalized.push(id); // ← 关键差异：补尾
     }
     return normalized;
   }

   // sourceHidden：稀疏——只过滤 + 去重，绝不补尾
   export function normalizeSourceHidden(ids: unknown): SourceId[] {
     const list = Array.isArray(ids) ? ids : [];
     const seen = new Set<SourceId>();
     const normalized: SourceId[] = [];
     for (const id of list) {
       if (typeof id !== 'string' || (!isProviderId(id) && !isEngineId(id)) || seen.has(id as SourceId)) continue;
       seen.add(id as SourceId);
       normalized.push(id as SourceId);
     }
     return normalized; // ← 无补尾
   }
   ```

2. **筛选只作用于投影，不作用于管理列表。** 隐藏参数只传给快切栏消费端（搜索页 + SERP 栏）的 `allSources`。设置页**不能**传该参数——否则被隐藏的来源在管理列表里也消失，用户无法再取消隐藏。`allSources` 的 doc 注释明确标注了这一不变量。

3. **隐藏与「激活来源」正交。** 不要阻止用户隐藏当前激活/默认来源；隐藏是显示层选择，选择是执行层状态，二者独立。空栏（全部隐藏）是用户自选的合法边界态。

4. **默认安全则不 bump 版本，但必须进白名单。** 新键有空数组默认、getter 把缺失规范化为默认时，无需 schema 迁移；但 `CONFIG_KEYS` 仍必须列入新键，config 域才会感知它（见 *dual-domain-storage-schema-versioning*）。

5. **ImportReport 字段追加的连锁反应。** 给 `ImportReport` 加一个**必填**字段（如 `sourceHiddenOverridden`）会迫使所有渲染导入报告的组件（`ConfigExportImport`）及其测试同步更新——这是一处不明显的波及面，TS 会在这些地方报错提醒。

6. **写串行队列嵌套。** `mergeImport` 对新偏好做读-改-写，必须把新队列嵌进去，使直接 setter 与导入不会互相覆盖（沿用 `mergeImport = withSourceOrderMutation(withProviderKeysMutation(...))` 的嵌套模式，现扩展为 `withSourceHiddenMutation(withSourceOrderMutation(withProviderKeysMutation(...)))`）。

## Why This Matters

这条管线不直观：八层以上、跨 worker 信任边界、config-io 的「字段缺失 vs 字段存在」语义、i18n 三方一致性。漏掉一层会在远离改动点的地方失败——parity 测试、导入报告的类型错误、或「能设置却不能导出」。

稀疏 vs 完整的规范化区别是最高杠杆的学习：为隐藏清单默认采用「完整」规范化会让功能静默失效，而且 `normalizeSourceOrder` 的单测照过不误——只有针对 `normalizeSourceHidden` 的断言（不补尾）才能抓住。把「投影筛选」与「管理列表」分开，则避免了「隐藏后无法取消隐藏」的脚枪。

## When to Apply

- 给本扩展新增任何持久化配置偏好（标量型如 theme/locale，或 `SourceId[]` 型快切栏偏好）。
- 在 `sourceOrder` 之上再加一个快切栏来源偏好。
- 新偏好需要进入配置导入/导出并出现在导入 diff/报告中。
- 任何需要跨「扩展页 + content script + 多标签」一致消费、且要与乐观 UI/后台刷新并发的偏好。

## Examples

- **稀疏 vs 完整：** 见上文两个规范化函数的对照——这是本学习唯一需要记进代码的分歧。
- **第二个偏好的完整触点：** `sourceHidden` 按 §八层清单依次落地于 `lib/sources.ts`、`lib/storage.ts`、`lib/schema.ts`、`lib/messaging.ts`、`lib/gateway.ts`、`entrypoints/background.ts`、`lib/config-io.ts`、`lib/i18n.ts` + 两份 locale，外加三个 entrypoints 消费端与设置页开关。
- **设置页防陈旧：** 开关沿用 sourceOrder 的 revision 守卫——请求发出后只要本地隐藏态经历乐观切换，陈旧配置响应就不能再写回隐藏状态（实现细节见 *persistent-source-order-and-visible-projection*）。

## Related

- [persistent-source-order-and-visible-projection](./persistent-source-order-and-visible-projection.md) — 第一个 `SourceId[]` 快切栏偏好先例；本文是其「加一个偏好」的配套清单，共享的乐观/回滚/revision 细节在此不重复。
- [dual-domain-storage-schema-versioning](./dual-domain-storage-schema-versioning.md) — `CONFIG_KEYS` 白名单、默认安全则不 bump 版本、mutation queue 嵌套模式。
- [serp-switch-bar-and-unified-source-model](./serp-switch-bar-and-unified-source-model.md) — `allSources` 投影与两个快切栏宿主的基础设计。
- [theme-persistence-i18n-key-hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) — worker 脱敏配置与 i18n 三方一致性守卫。
