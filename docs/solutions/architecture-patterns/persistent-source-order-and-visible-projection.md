---
title: "Persist Complete Source Order and Project Only Visible Sources"
date: 2026-07-14
category: architecture-patterns
module: search-source-ordering
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "A user-defined order must stay consistent across multiple UI entry points"
  - "Some ordered items are temporarily hidden by configuration but must retain their positions"
  - "Direct preference edits and config imports can mutate the same persisted ordering concurrently"
  - "Optimistic UI updates can race with background refresh responses"
related_components:
  - lib/sources.ts
  - lib/storage.ts
  - lib/messaging.ts
  - lib/gateway.ts
  - lib/config-io.ts
  - entrypoints/options/App.tsx
  - entrypoints/search/App.tsx
  - entrypoints/serp-bar.content.ts
tags:
  - source-order
  - visibility-projection
  - chrome-storage
  - worker-messaging
  - mutation-queue
  - optimistic-ui
  - config-import
  - react
---

# 在动态可见来源上维护完整快切栏顺序

## Context

Juso 的快切栏同时包含需要 BYOK key 的 AI provider 和始终可用的常规搜索引擎。provider 是否可见取决于当前是否已配置 key，因此用户看见的列表只是完整来源集合的动态投影，不适合作为持久化偏好本身。

顺序调节也不只是 `SourceSwitcher` 的渲染问题。顺序必须在设置页可编辑，由 background worker 持久化，经脱敏配置消息返回，并由 Juso 搜索页和注入 SERP 的快切栏共同消费；同时还要进入配置导入导出，并保持旧备份兼容。

以下局部方案都不足：

- 只修改 `SourceSwitcher`，只能改变一次渲染，无法保证多宿主一致性。
- 只保存当前可见列表，会永久丢失未配置 provider 的相对位置。
- 把旧导入文件中缺失的 `sourceOrder` 立即默认化，会把“没有表达这个偏好”误读为“恢复默认顺序”。
- 只做乐观 UI，不处理陈旧读取和交叉写入，会让较早的响应或导入覆盖较新的移动。

## Guidance

### 持久化完整顺序，最后才投影可见来源

将偏好建模为完整的 `SourceId[]`，覆盖 provider registry 与 engine registry 中的全部已知来源。`normalizeSourceOrder` 是唯一规范化入口，其不变量是：

1. 按输入顺序保留每个已知 ID 的首次出现。
2. 丢弃未知 ID、非字符串值和重复出现。
3. 将遗漏来源按 registry 默认顺序补到末尾。

```ts
normalizeSourceOrder(['bing', 'ghost', 'tavily', 'bing']);
// ['bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'baidu']
```

`allSources(configuredProviderIds, sourceOrder)` 先遍历规范化后的完整顺序，最后才过滤未配置 provider；engine 始终保留。不要先构造可见列表再排序，否则隐藏项的位置已经丢失。

### 在完整顺序中交换相邻可见来源

设置页展示可见投影，但移动操作必须修改完整顺序：

1. 在可见列表中找到当前来源及其上一个或下一个可见邻居。
2. 在完整 `sourceOrder` 中找到这两个 ID。
3. 交换完整数组中的两个位置，并把完整数组发送给 worker。

例如仅 Exa 已配置时，完整顺序可能是：

```ts
['tavily', 'stepfun', 'exa', 'stepfun-plan', 'google', 'bing', 'baidu']
```

可见顺序是 `exa, google, bing, baidu`。将 Exa 下移时，应交换完整数组中的 `exa` 与 `google`：

```ts
['tavily', 'stepfun', 'google', 'stepfun-plan', 'exa', 'bing', 'baidu']
```

隐藏 provider 仍保留在偏好中，重新配置后会按用户原有位置意图重新出现。

移动控件还应具备完整交互状态：本地化 `aria-label` 和 `title`；首项上移、末项下移禁用；保存 pending 时禁用所有移动按钮；点击后乐观更新；写入失败时回滚到 `previousOrder`，并用 `role="alert"` 告知用户。

### 将读写留在 worker，并让所有宿主同源消费

页面不直接读写 `sourceOrder`。它作为 `ProviderConfigReply` 脱敏配置快照的一部分返回，`setSourceOrder` 消息由 background 路由到 gateway，再由 storage helper 规范化并持久化。这延续了 BYOK worker-only 边界，不会让页面接触 `providerKeys` 或已存明文 key；主题、语言等非敏感 UI 偏好仍可通过各自 helper 精确读写。

`getSourceOrder` 精确读取自身键：

```ts
const got = await browser.storage.local.get(SOURCE_ORDER_KEY);
return normalizeSourceOrder(got[SOURCE_ORDER_KEY]);
```

不要用 `get(null)` 读取一个偏好；那会把敏感 key 和缓存池等无关数据读入同一个 record。`sourceOrder` 同时属于 config storage domain 白名单。

设置页、搜索页和 SERP content script 都从同一个 worker 快照取得 `configuredProviderIds` 与 `sourceOrder`，再调用 `allSources(configuredProviderIds, sourceOrder)`。各宿主不应重复实现排序规则。

### 分别防住 UI 陈旧响应与 worker 交叉写入

这里有两类不同竞态，不能用同一种保护替代另一种。

设置页读取侧记录：

- `configRequestEpoch`：只有最新配置请求可以应用顺序。
- `sourceOrderRevision`：请求发出后只要本地顺序经历乐观移动、成功或回滚，该响应就不能再写入顺序状态。

因此只有“仍是最新请求，且请求期间顺序 revision 未变化”的响应才能更新 `sourceOrder`。响应中的 active source 和 configured providers 仍可同步，陈旧顺序快照则被丢弃。

worker 写入侧则让配置导入 `mergeImport` 与直接移动 `setSourceOrder` 共用 `withSourceOrderMutation` 队列。队列按调用顺序执行，且前一个 mutation 失败后仍继续服务后续 mutation。只给直接移动加队列、让导入绕过队列，仍会发生丢失更新。

### 区分字段缺失与字段值

新导出始终包含规范化后的完整 `sourceOrder`。为了接受旧导出，导入类型中的 `sourceOrder` 保持可选。

```ts
const hasSourceOrder = Object.prototype.hasOwnProperty.call(obj, 'sourceOrder');
// absent -> undefined; present -> strict validation, then normalization
```

导入规则是：

- 字段缺失表示旧文件没有表达该偏好，解析结果保留 `undefined`。
- 字段存在时必须是数组，且每项都是 known `SourceId`，不能重复。
- 合法的部分数组可经规范化按 registry 补尾，以兼容未来新增来源。
- preview 仅在字段显式存在时生成顺序 diff。
- merge 仅在字段显式存在且 `applyPrefs === true` 时写入顺序。

这样旧文件即使选择“导入偏好”，也不会覆盖当前顺序；新文件则会在 preview-confirm 流程中明确展示并应用顺序变化。

### 测试跨层不变量，而不只测试按钮点击

回归测试应覆盖：

- 规范化的未知项剔除、首次出现去重、遗漏补尾和先排序后过滤。
- storage 的规范化读写往返与非法已存值恢复。
- worker 配置响应和写入 handler 的消息转发。
- 设置页完整数组交换、边界和 pending 禁用、乐观更新、失败回滚、陈旧响应屏蔽。
- 搜索页按非默认顺序渲染，同时继续隐藏未配置 provider。
- 新旧配置导入、严格显式字段校验、preview/apply 语义和导入/移动串行顺序。
- 仅顺序变化时也进入偏好确认，并在导入报告中显示该偏好。

本次最终验证：`npm test` 通过 32 个测试文件、342 项测试；`npm run typecheck`、`npm run lint` 与 `npm run build` 均通过。

## Why This Matters

动态可见列表与用户偏好不是同一个数据模型。可见列表是当前配置状态下的派生视图，完整顺序才是能够跨 key 增删、版本演进、页面切换和导入导出保存用户意图的稳定状态。把派生视图持久化，会让暂时隐藏的信息永久消失。

规范化提供前向韧性：registry 新增来源时，旧顺序无需迁移即可补尾；损坏或历史数据中的未知项和重复项不会传播到 UI。导入入口则采用更严格的“拒绝无效显式输入”策略，避免静默接受用户文件中的歧义。

两层并发保护分别维护界面所有权与存储线性顺序。revision/epoch 防止陈旧读取夺回刚完成的 UI 状态，mutation queue 防止两个 worker 写入口互相覆盖。只实现其中一层，仍会在另一个边界丢失更新。

## When to Apply

- 用户可排序一个会因权限、配置、能力、租户或 feature flag 动态隐藏成员的列表。
- 隐藏项将来可能重新出现，并且应继承原有位置意图。
- 同一偏好由扩展页、content script、popup 或多个标签页共同消费。
- 乐观 UI 会与后台刷新或重新获取配置并发。
- 同一个持久化字段有直接编辑、批量导入、同步或迁移等多个写入口。
- 配置格式需要兼容旧文件，且字段缺失必须表示“不覆盖当前值”。

如果列表成员永远全部可见、顺序不持久化、没有跨上下文消费，也没有第二个写入口，则无需完整采用 revision、worker queue 和导入兼容层；但仍应避免把派生列表误当作领域状态。

## Examples

- **完整顺序后过滤：** Bing 被放在最前，Tavily 暂时因未配置而隐藏；重新保存 Tavily key 后，它按原完整顺序出现，而不是被追加到可见列表末尾。
- **乐观移动遇到陈旧读取：** 保存 key 触发的配置请求先发出，移动保存成功后才返回；revision 已变化，因此响应可以更新 provider 配置状态，但不能覆盖新顺序。
- **导入与移动交错：** 导入先进入共享顺序队列，移动后到达；导入释放后移动再写入，最终 storage 保留后发生的用户动作。
- **旧备份导入：** payload 没有 `sourceOrder`；preview 不显示顺序 diff，merge 不写顺序键，当前设备顺序保持不变。
- **未来新增来源：** registry 新增 engine 时，规范化保留旧 ID 顺序并把新 engine 补到末尾，无需迁移所有用户数据。

## Related

- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md` — 统一来源视图和搜索页/SERP 两个快切栏宿主的基础设计。
- `docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md` — `SourceId` 视图偏好与 provider-only 执行状态的边界。
- `docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md` — config domain、精确键 IO、导入导出和 mutation queue 模式。
- `docs/solutions/ui-bugs/provider-switch-current-query-and-async-state.md` — provider 切换中的异步状态与陈旧响应防护先例。
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — worker 脱敏配置与未配置 provider 的 surface 可见性规则。
