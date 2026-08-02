---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "Provider Instances — Plan"
type: feat
date: 2026-08-02
---

# Provider Instances — Plan

## Goal Capsule

**目标**：让用户能为同一个 provider（先 Exa）创建多个调好参数的"实例"（如"AI 研究""创业资讯"），每个实例是快切栏里的一等可切换目标，并能让 agent 智能选择实例。

**权威层级**：本计划由 `ce-plan` bootstrap 产生（无上游 brainstorm），产品行为与技术决策以本文件为准。

**停止条件**：实例框架就绪 + Exa pilot 端到端可用（创建实例→快切栏显示→搜索注入 options→缓存正确→agent v2 可选实例）+ `npm run typecheck && npm run lint && npm test && npm run build` 全绿。

**执行画像**：无特殊测试优先要求；adapter 用 stubbed fetch 契约测试，storage/gateway 用内存 mock，UI 用组件测试。镜像 site-engines/custom-engines 的测试模式。

**Product Contract 保全**：无上游产品契约。本计划同时定义 WHAT 和 HOW。

---

## Product Contract

### 问题与用户

- **目标用户**：已为多个 AI 搜索 API 付费、想在不同搜索场景间快速切换的开发者。
- **痛点**：当前每个 provider 只能有一个配置（一个 key + 一个 maxResults）。想给 Exa 配"AI 论文"和"创业新闻"两套 category/domain 参数，必须回设置页改，无法快切。agent 也无法区分同一 provider 的不同调优方向。
- **价值主张**：把调好参数的 provider 配置变成快切栏里的一等公民，点一下就切；agent 能看到实例的 label/description 并智能选择。

### Requirements

- **R1. 实例模型**：用户可为任意已配置 key 的 provider 创建多个"实例"，每个实例绑定一个 base provider + 一份 per-instance options。配 key 时自动创建一个默认实例（options 为空 = adapter 默认值），确保每个支持实例的 provider 永远有 ≥1 实例。
- **R2. 快切栏一等公民**：有实例的 provider，其实例作为独立 pill 出现在快切栏（共享 favicon，靠 label 副标题区分）；不再显示裸 provider pill。0 实例的 provider 保持现状（1 个裸 pill）——但自动创建机制保证支持实例的 provider 不会处于 0 实例状态。
- **R3. per-instance options**：Phase 1 支持 Exa 的 6 个选项（searchType / category / includeDomains / excludeDomains / textMaxCharacters / highlightsMaxCharacters）。结果条数（numResults）不由实例控制——provider 级 maxResults stepper 是唯一条数控制点。options 通过 `SearchOptions.providerSettings` 通用通道注入 adapter，框架 schema-agnostic。
- **R4. 默认实例**：隐式第一个。agent v1 `search` 给有实例的 provider 时路由到第一个实例 + 注入其 options。唯一实例不可删除（保护默认稳定性），可隐藏。删除非唯一实例时第二个自动成为默认。
- **R5. agent v2（additive）**：新增 `search-instance`（按 instanceId 搜索）和 `list-instances`（返回实例列表带 label/description）两个 action。v1 `search` / `list-providers` 不变，老 skill 不受影响。v1 `list-providers` 的 `AgentProvider` 加 `hasInstances?: boolean` 字段（additive），让 agent 知道哪些 provider 有实例、是否该调 `list-instances`。
- **R6. 缓存正确**：cache key 按 `instanceId ?? providerId` 区分，不同实例的同查询结果不冲突。
- **R7. BYOK 不变**：API key 仍 per-provider-type 共享（符合 BYOK 本意）。实例不持有 key。
- **R8. 边界纪律**：实例 id 进 `SourceId`（UI/storage 组合点），绝不进 `ProviderId`（worker BYOK 路径）。gateway 在边界解析 `ProviderInstanceId → { providerId, options }`。

### Scope Boundaries

**Phase 1 范围**：实例框架（类型 + storage + CRUD + 投影 + 缓存 + agent v2）+ Exa pilot（7 options）+ 设置页实例管理 UI + config 导入导出 + SERP bar / deep link 支持。

**Phase 1 非目标**：
- 其他 provider 的 options schema（Phase 2 按需扩，框架已 schema-agnostic）
- per-instance API key 覆盖（边缘场景，后续）
- options schema descriptor 抽象（Phase 2，当第二个 provider 接入时）
- worker 自动路由（明确不做——搜索正确性不耦合到不可见启发式）
- 实例级遥测（代码库无遥测基础设施）

### Acceptance Examples

- **AE1**：用户在设置页为 Exa 创建实例"AI 研究"（category=publication, includeDomains=[arxiv.org]）和"创业资讯"（category=news）。快切栏 AI 搜索组出现两个 Exa pill（同图标，不同 label），不出现裸 Exa pill。配 Exa key 时已自动创建一个默认 Exa 实例，用户可编辑它或新建更多。
- **AE2**：用户快切到"AI 研究"→ 搜索"transformers" → 请求体含 `category:'publication', includeDomains:['arxiv.org']`。切到"创业资讯"搜同词 → 请求体含 `category:'news'`，且缓存命中不同条目。结果条数由 provider 级 maxResults stepper 控制（实例不设条数）。
- **AE3**：用户删掉"AI 研究"（第一个实例，有 2 个实例时）→ "创业资讯"自动成为默认。agent v1 `search {providerId:'exa'}` 路由到"创业资讯"的 options。若"AI 研究"是唯一实例，删除按钮禁用（保护默认实例）。
- **AE4**：agent 调 `list-providers` → Exa 条目含 `hasInstances:true`。agent 调 `list-instances` → 返回 `[{id:'inst:exa:abc', providerId:'exa', label:'创业资讯', description:'', configured:true}]`。agent 调 `search-instance {instanceId:'inst:exa:abc', query:'...'}` → 走该实例 options。
- **AE5**：用户导出配置 → 导入到另一台机器 → 实例定义完整恢复（含 sourceOrder/sourceHidden/groupConfig 中的实例 id）。
- **AE6**：用户删除 Exa key → Exa 实例从快切栏消失（定义保留），重新加 key 后恢复（不重复创建默认实例）。

### 关键假设

- 实例数量有上限（镜像 `MAX_SITE_ENGINES = 50`），防止存储膨胀。
- 实例名有长度上限（镜像 `MAX_SITE_ENGINE_NAME_LENGTH = 40`）。
- 实例 id 用 UUID，稳定且 storage-safe（镜像 site-engine id 生成）。
- `providerSettings` 字段名复用 `feat/exa-settings` 参考实现（已 generic，描述"这次 provider 调用的设置"，不耦合来源）。

---

## Planning Contract

### Key Technical Decisions

**KTD1. 实例模型，非预设模型。**
用户痛点是"快切栏切换调好的变体"。预设模型（命名参数包应用到单一 provider）无法成为 `SourceId`，会和 `activeSource` / `sourceOrder` / `sourceHidden` / `groupConfig` 四条正交轴冲突。实例 = source，走现有通道，零新布局概念。site-engines/custom-engines 已证明此模式可组合。*参考：`docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md`*

**KTD2. `ProviderInstance` 新类型，不复用 `SearchSource`，不扩 engine 模式。**
`SearchSource` 是 view 层投影；`ProviderInstance` 是 config 实体，*投影进* `SearchSource`。实例 id 进 `SourceId`（UI/storage 组合点），绝不进 `ProviderId`（worker BYOK 路径）。`ProviderId` 封闭联合类型保持不变——它是 BYOK 边界的类型级强制。

**KTD3. agent v2 additive actions，不放宽 v1。**
v1 `search` 的 `providerId: ProviderId` 保持不变（有实例时路由到默认实例 + 注入 options）。新增 v2 `search-instance`（`instanceId: SourceId`）和 `list-instances`。`AGENT_BRIDGE_PROTOCOL` 升到 2。老 skill 不受影响。*理由：放宽 `providerId` 会破坏 BYOK 边界（`getAdapter` 对未知 id 抛错）和 wire 协议兼容性。*

**KTD4. 缓存 key 按 instanceId 区分，schema v2。**
`makeSearchCacheKey` 变为 `${instanceId ?? providerId}:${query}`。`SearchCacheEntry` / `SearchCacheSummary` 加 `instanceId?`。`CURRENT_CACHE_SCHEMA_VERSION` 1→2，加第一个 `CacheMigration`（drop 全部条目，缓存可重建）。这是代码库迁移链的第一次真实使用。*不做这步会导致两个 Exa 实例搜同词撞 cache key。*

**KTD5. 默认实例 = 隐式第一个；自动创建 + sole-instance 保护。**
不新增 `defaultInstanceId` 存储字段。默认实例 = `providerInstances` 数组里该 provider 的第一个。用户通过调整 `sourceOrder`（已存在）改默认。删除第一个时第二个自动成为默认，无需 fallback 逻辑。配 key 时自动创建一个默认实例（`ensureDefaultInstance`，原子化在 `withProviderInstancesMutation` 队列内），确保支持实例的 provider 永远有 ≥1 实例——模型更统一，永远没有裸 pill。唯一实例不可删除（保护默认稳定性），可隐藏。删 key 时实例定义保留，重新加 key 不重复创建（`ensureDefaultInstance` 检查已有实例）。

**KTD9. `effectiveActiveSource` 共享函数 + 裸 provider id → 实例 id 映射。**
`resolveEffectiveActiveSource`（`lib/sources.ts`）是纯函数，统一了 storage.ts 和 config-io.ts 两处副本。当存储的 active source 是裸 provider id 且该 provider 有实例时，返回第一个实例 id（与 `allSources` 投影一致——有实例时不投影裸 pill）。这避免了"存储的 active 是裸 id 但投影里找不到"导致的高亮错位和搜错 provider 问题。

**KTD6. `SearchOptions.providerSettings` 通用通道，不加 provider 专属字段。**
复用 `feat/exa-settings` 的 `providerSettings?: Record<string, unknown>`。每个 adapter 声明自己的 options schema（Phase 1 只有 Exa），`buildRequest` 读 `opts.providerSettings?.category` 等，忽略未知字段。Phase 2 抽象 options-schema registry 时只重构 adapter，不动框架。*不加 `exaCategory?: string` 这种字段——那是 Phase 2 抽象的陷阱。*

**KTD7. API key per-provider-type 共享。**
`providerKeys: Record<ProviderId, string>` 不变。实例不持有 key。删 key 时该 provider 所有实例从投影消失（定义保留），重新加 key 恢复——与现有"未配置 provider 临时消失"规则一致。

**KTD8. 快切栏不新增布局概念。**
实例通过 `defaultGroupForSourceId` 进 `AI_SEARCH_GROUP`（加一行 `isProviderInstanceId` 分支）。flyout 内同 provider 实例相邻排列（排序启发式，非结构变更）。用户用现有 pin 机制把常用实例置顶到顶层快切。不自动建 per-provider 子组（现有自定义组已能做此事）。

### Alternatives Considered

- **预设模型**：命名参数包应用到单一 provider。被否——预设不是 `SourceId`，无法进快切栏/activeSource，与四条正交轴冲突。见 KTD1。
- **放宽 `ProviderId` 到含实例 id**：被否——破坏 BYOK 边界类型强制，`getAdapter` 抛错，wire 协议破坏性变更。见 KTD3。
- **worker 自动路由（query + 实例描述 → 选实例）**：被否——搜索正确性耦合到不可见、不可调、非确定性启发式。用户应 pin 默认实例，agent 显式选或用默认。
- **per-provider 自动子组**：被否——现有 layout 是扁平 `source | group` 二态，不支持嵌套。用户可用自定义组手动达成。

### Patterns to Follow

- **`lib/site-engines.ts`** — 实例类型/id guard/normalizer/byte-budget 的模板。`ProviderInstance` 镜像 `SiteEngineDefinition` 结构。
- **`lib/storage.ts:406-512`** — site-engines CRUD + `withSiteEnginesMutation` 队列模式。实例加第四个同类队列。
- **`lib/sources.ts:163-174`** — site/custom-engine 投影进 `SearchSource` 的分支模式。实例加同形分支。
- **`lib/source-groups.ts:66`** — `defaultGroupForSourceId` 按类型入组。实例加 `isProviderInstanceId` 分支。
- **`feat/exa-settings` 分支 `lib/providers/exa.ts`** — Exa options 的 `ExaSettings` 类型 / `DEFAULT_EXA_SETTINGS` / `normalizeExaSettings` / `buildRequest` 读取模式。直接复用，重构为 per-instance。
- **`feat/exa-settings` 分支 `lib/gateway.ts`** — `handleSearch` 里 `providerId === 'exa'` 注入点。重构为 instance 解析。
- **`docs/solutions/architecture-patterns/per-provider-config-worker-injection.md`** — worker 注入 options 的既定模式（`maxResults` 先例）。实例 options 走同模式：worker 读 storage，注入 `SearchOptions`，消息不携带 options。

### Risks

- **R-1（高）**：`ProviderId` 封闭联合贯穿 storage/messaging/agent-bridge/registry/cache/config-io/deep-link/serp-handoff。实例 id 绝不能漏进 `ProviderId`-typed 的洞。缓解：`isProviderInstanceId` 并行 guard，所有 `isKnownProvider` 调用点审计。
- **R-2（高）**：cache schema v2 迁移是迁移链首次真实使用。缓解：迁移函数先写测试（drop 全部 + stamp v2），再集成。
- **R-3（中）**：`selectActiveSourceId` 双写扩展（实例 id → 解析 base provider 写 `activeProvider`）。缓解：镜像现有 `isKnownProvider` 分支，加 `isProviderInstanceId` 分支。
- **R-4（中）**：agent v2 协议升级。缓解：additive only，v1 不变，老 skill 测试保持绿。
- **R-5（低）**：Exa options 从 per-provider-type blob 重构为 per-instance。缓解：参考实现已验证 options 逻辑，只需把 storage key 从全局改为按 instance id。

---

## Implementation Units

### IU1: `lib/provider-instances.ts` — 实例类型与归一化

**文件**：`lib/provider-instances.ts`（新建）

**内容**：镜像 `lib/site-engines.ts` 结构。
- `ProviderInstanceId = \`inst:${ProviderId}:${string}\``
- `ProviderInstance { id; baseProviderId: ProviderId; name: string; options: Record<string, unknown> }`
- `isProviderInstanceId(id)` type guard（镜像 `isSiteEngineId`）
- `normalizeProviderInstance(value)` / `normalizeProviderInstances(value)`（镜像 `normalizeSiteEngineDefinition` / `normalizeSiteEngineDefinitions`）
- 常量：`MAX_PROVIDER_INSTANCES = 50`、`MAX_INSTANCE_NAME_LENGTH = 40`、`MAX_INSTANCES_SERIALIZED_BYTES = 128 * 1024`
- `isBoundedProviderInstanceCollection(value)`（import 防御，镜像 `isBoundedSiteEngineCollection`）
- `providerInstancesSerializedBytes(value)`

**测试**：`tests/provider-instances.test.ts`（新建）
- id guard：合法/非法前缀、未知 base provider
- normalizer：垃圾→null、超长 name 截断/拒绝、重复 id 去重、超 cap 截断
- byte-budget guard：超限拒绝

**依赖**：无（纯类型/纯函数）

---

### IU2: Storage 层 — 实例持久化与 active 双写

**文件**：`lib/storage.ts`、`lib/schema.ts`

**内容**：
- `lib/schema.ts`：`CONFIG_KEYS` 加 `'providerInstances'`（强制规则：新增 config 键必须同步加入）
- `lib/storage.ts`：
  - `PROVIDER_INSTANCES_KEY = 'providerInstances'`
  - `getProviderInstances(): Promise<ProviderInstance[]>` / `setProviderInstances(list)`（getter 走 `normalizeProviderInstances`，setter 走归一化）
  - `withProviderInstancesMutation` 队列（第四个，镜像 `withSiteEnginesMutation`）
  - CRUD：`createProviderInstance(baseProviderId, name, options)` / `updateProviderInstance(id, patch)` / `deleteProviderInstance(id)`（删除时级联清缓存，见 IU6）
  - `selectActiveSourceId`（`:265`）扩展：`isProviderInstanceId(id)` 时解析 base provider 写 `activeProvider`
  - `effectiveActiveSource`（`:248`）、`visibleUsableSource`（`:514`）、`ensureVisibleUsable`（`:521`）、`getProviderConfigSnapshot`（`:528`）加实例分支（镜像 site-engine 分支 `:252`）
  - `clearKey`（`:128`）：不删实例定义，仅投影过滤（与"未配置 provider 临时消失"规则一致）

**测试**：`tests/storage.test.ts`（扩展）
- 实例 CRUD 读写
- `selectActiveSourceId` 实例 id 双写 `activeProvider` = base provider
- 删 key 后实例定义保留、投影过滤
- 删实例后 active 回退

**依赖**：IU1

---

### IU3: `SearchOptions.providerSettings` + Exa adapter options

**文件**：`lib/providers/types.ts`、`lib/providers/exa.ts`

**内容**：
- `lib/providers/types.ts:34`：`SearchOptions` 加 `providerSettings?: Record<string, unknown>`（复用 `feat/exa-settings` 字段名）
- `lib/providers/exa.ts`：从 `feat/exa-settings` 移植 `ExaSettings` 类型 / `ExaSearchType` / `ExaCategory` / `DEFAULT_EXA_SETTINGS` / `normalizeExaSettings`。`buildRequest` 读 `opts.providerSettings`（sanitize at boundary），fallback 到默认。`maxResults` override 优先级保持。

**测试**：`tests/exa.test.ts`（扩展，镜像 `feat/exa-settings` 的测试）
- options 注入：`providerSettings` 各字段落到请求体
- 空省略：`providerSettings: {}` → 默认值
- override 优先级：`maxResults` beats `providerSettings.numResults`
- `normalizeExaSettings` 单元套件

**依赖**：无（types 改动独立）

---

### IU4: Gateway — 实例解析与 options 注入

**文件**：`lib/gateway.ts`、`entrypoints/background.ts`

**内容**：
- `lib/gateway.ts`：
  - 新 `resolveInstance(sourceId: SourceId | undefined)`：查实例定义，返回 `{ providerId: ProviderId; providerSettings?: Record<string, unknown> } | null`。无实例时回退裸 provider。
  - `handleSearch` 扩展：调 `resolveInstance`，把 `providerSettings` 注入 `SearchOptions`（镜像 `maxResults` 注入模式）。`handleSearch` 签名保持 `ProviderId`-typed——实例解析在边界完成。
  - 实例 CRUD handler：`handleCreateProviderInstance` / `handleUpdateProviderInstance` / `handleDeleteProviderInstance`（删除时清该实例缓存）
  - `handleListAgentInstances`（v2）：返回 `{ id, providerId, label, description, configured }[]`
  - `handleSearchInstance`（v2）：按 `instanceId` 解析 + 搜索
  - `handleListAgentProviders`（v1）不变
- `entrypoints/background.ts`：注册新 message handler

**测试**：`tests/gateway.test.ts`（扩展）
- `resolveInstance`：实例 id → base provider + options；裸 provider id → 裸；未知 → null
- `handleSearch` 注入：实例 id 时 `adapter.search` 收到 `providerSettings`
- v1 `search` 有实例的 provider → 路由到第一个实例 options
- v2 `search-instance` → 指定实例
- 删实例 → 该实例缓存清除

**依赖**：IU2、IU3

---

### IU5: Messaging — 实例消息协议

**文件**：`lib/messaging.ts`

**内容**：
- `ProviderConfigReply` 加 `providerInstances: ProviderInstance[]`
- 新消息（镜像 `getExaSettings`/`saveExaSettings` 的简单 typed getter 模式）：
  - `createProviderInstance(input: { baseProviderId; name; options }): Promise<ProviderInstance>`
  - `updateProviderInstance(input: { id; patch }): Promise<ProviderInstance>`
  - `deleteProviderInstance(id: string): Promise<void>`
  - `listAgentInstances(): Promise<AgentInstance[]>`
- `SearchRequest` 不变（worker 注入 options，消息不携带——`maxResults` 先例）

**测试**：`tests/messaging.test.ts`（如存在）或覆盖在 gateway 测试中

**依赖**：IU1

---

### IU6: Cache schema v2 — 按 instanceId 区分

**文件**：`lib/search-cache.ts`、`lib/storage.ts`

**内容**：
- `lib/search-cache.ts`：
  - `CURRENT_CACHE_SCHEMA_VERSION` 1 → 2
  - `makeSearchCacheKey(id: string, query)` = `${id}:${query}`（id 已是 instanceId 或 providerId）
  - `SearchCacheEntry` / `SearchCacheSummary` 加 `instanceId?: string`
  - `cacheMigrations`（`:30`）加第一个迁移：v1→v2 drop 全部条目 + stamp v2
- `lib/storage.ts`：`getCachedSearch` 第一个参数接受 instanceId | providerId

**测试**：`tests/search-cache.test.ts`（扩展）
- 两个实例同查询 → 不同 cache key → 各自命中
- v1→v2 迁移：旧条目全部清除，schema stamp v2
- 删实例 → 该实例缓存条目清除

**依赖**：IU2

---

### IU7: Sources 投影 — 实例进 SearchSource

**文件**：`lib/sources.ts`、`lib/source-groups.ts`

**内容**：
- `lib/sources.ts`：
  - `SourceId` 联合加 `ProviderInstanceId`
  - `SearchSource` 加 `providerInstance?: ProviderInstance` 字段（镜像 `siteEngine?` / `customEngine?`）
  - `allSources()`（`:133`）加实例分支：有实例的 provider 投影实例 pill（不投影裸 pill）；0 实例的投影裸 pill
  - `allKnownSourceIds`（`:51`）含实例 id
  - 实例 `labelDescriptor = { kind: 'literal', value: instance.name }`，`favicon` = base adapter favicon，`supportsAnswer` = base adapter
- `lib/source-groups.ts:66`：`defaultGroupForSourceId` 加 `isProviderInstanceId` → `AI_SEARCH_GROUP`
- 排序启发式：`projectLayout` 组内同 base provider 的实例相邻（按 `sourceOrder` 内顺序）

**测试**：`tests/sources.test.ts`、`tests/source-groups.test.ts`（扩展）
- 有实例的 provider → 投影实例 pill，不投影裸 pill
- 0 实例 → 投影裸 pill
- 实例进 AI_SEARCH_GROUP
- 同 provider 实例相邻排列

**依赖**：IU1、IU2

---

### IU8: Agent bridge v2 — additive actions

**文件**：`lib/agent-bridge.ts`

**内容**：
- `AGENT_BRIDGE_PROTOCOL` 1 → 2
- v1 `search` action / `AgentProvider` / `AgentSearchRequest` 不变
- 新 `AgentInstance { id: ProviderInstanceId; providerId: ProviderId; label: string; description: string; configured: boolean }`
- 新 v2 action：
  - `search-instance { action: 'search-instance'; query: string; instanceId: ProviderInstanceId; forceRefresh?: boolean }`
  - `list-instances { action: 'list-instances' }` → `{ instances: AgentInstance[] }`
- `parseSearchRequest` 扩展：识别 v2 action，`search-instance` 的 `instanceId` 用 `isProviderInstanceId` 校验

**测试**：`tests/agent-bridge.test.ts`（扩展）
- v1 `search` 不变（老 skill 兼容）
- v2 `search-instance` 解析 + 校验
- v2 `list-instances` 解析
- 非法 instanceId 拒绝

**依赖**：IU1

---

### IU9: SERP bar + deep link + serp-handoff

**文件**：`entrypoints/serp-bar.content.ts`、`lib/deep-link.ts`、`lib/serp-handoff.ts`

**内容**：
- `entrypoints/serp-bar.content.ts:547`：`allSources` 投影含实例（自动，因 IU7 改了 `allSources`）；`ProviderConfigReply` 消费 `providerInstances`
- `lib/deep-link.ts`：`buildSearchDeepLink` / `parseSearchDeepLink` 接受实例 id
- `lib/serp-handoff.ts:82`：`resolveSerpHandoff` 加 `provider-instance` 分支，deep link 带实例 id
- `entrypoints/search/App.tsx:66`：deep-link parser 解析实例 id → base provider 做 `configuredProviderIds.includes` 检查

**测试**：`tests/serp-bar.test.ts`、`tests/deep-link.test.ts`（如存在）、`tests/serp-handoff.test.ts`（扩展）
- SERP bar 显示实例 pill
- deep link 带 instance id 往返
- serp-handoff 实例分支

**依赖**：IU7

---

### IU10: Config 导入导出

**文件**：`lib/config-io.ts`

**内容**：镜像 `siteEngines` 处理（`:152-161`、`:294-299`、`:413`）。
- `ConfigExport` 加 `providerInstances?: ProviderInstance[]`
- `parseImportPayload`（`:124`）：校验每个实例（id 格式、base provider 已知、options 是 plain object、name bounded）
- `ImportReport`（`:223`）/ `PrefDiff`（`:253`）加 `providerInstancesOverridden`
- `mergeImport`（`:364`）：整数组覆盖（pref 语义，同 `siteEngines`）
- `previewImport`：diff 实例数组

**测试**：`tests/config-io.test.ts`（扩展）
- 导出含实例
- 导入合法实例 → 覆盖
- 导入非法实例（坏 id / 未知 base / 坏 options）→ 拒绝
- preview diff 实例变更

**依赖**：IU1

---

### IU11: Options 页 UI — 实例管理

**文件**：`entrypoints/options/App.tsx`、`components/ProviderInstanceManager.tsx`（新建）、`entrypoints/options/styles.css`、`lib/i18n.ts`、`public/_locales/{en,zh_CN}/messages.json`

**内容**：
- `components/ProviderInstanceManager.tsx`：镜像 `SiteEngineManager` / `CustomEngineManager` 结构。列出实例 + 创建/编辑/删除。编辑器含 Exa 7 字段（从 `feat/exa-settings` 的 `ExaSettings.tsx` 移植表单）。
- `entrypoints/options/App.tsx`：在 `activeGroup === 'keys'` 分支加 `<section data-section="provider-instances">`，渲染 `ProviderInstanceManager`。`KeyInput` 保持 per-provider-type（key 共享）。
- i18n：实例管理相关 key（`opts_instances_heading` / `opts_instances_hint` / `opts_instance_add` / `opts_instance_name` / `opts_instance_delete` / Exa 字段 label 复用 `feat/exa-settings` 的 `opts_exa_*` key）

**测试**：`tests/options-page.test.tsx`（扩展）
- 实例管理器渲染
- 创建实例 → 列表更新
- 编辑实例 → 保存
- 删除实例 → 列表更新 + 确认

**依赖**：IU5、IU3（Exa options 表单）

---

### IU12: i18n 补全

**文件**：`lib/i18n.ts`、`public/_locales/en/messages.json`、`public/_locales/zh_CN/messages.json`

**内容**：所有实例相关 i18n key（IU11 列出 + agent v2 描述 key 如有 UI 暴露）。

**测试**：覆盖在 IU11 组件测试中。

**依赖**：IU11

---

## Sequencing

```
IU1 (类型) ──┬─→ IU2 (storage) ──┬─→ IU4 (gateway) ──→ IU9 (serp/deeplink)
             ├─→ IU5 (messaging) ─┘
             ├─→ IU7 (sources) ─────→ IU9
             ├─→ IU8 (agent v2)
             └─→ IU10 (config-io)
IU3 (exa options) ──→ IU4 (gateway 注入) ──→ IU11 (UI 表单)
IU6 (cache v2) ←─ IU2
IU11 (UI) ←─ IU5 + IU3
IU12 (i18n) ←─ IU11
```

**可并行**：IU1 完成后，IU2/IU3/IU5/IU7/IU8/IU10 可并行。IU6 依赖 IU2。IU4 依赖 IU2+IU3。IU9 依赖 IU7。IU11 依赖 IU5+IU3。

**建议执行顺序**：IU1 → (IU2 + IU3 并行) → (IU4 + IU5 + IU6 + IU7 + IU8 + IU10 并行) → IU9 → IU11 → IU12 → 全量验证。

---

## Verification Strategy

**单元/组件测试**（每个 IU 自带测试，见上）。

**集成验证**（Phase 1 完成后）：
1. `npm run typecheck` — 类型安全（`ProviderId` 边界未被实例 id 破坏）
2. `npm run lint` — 代码规范
3. `npm test` — 全量测试绿（含迁移链首次使用）
4. `npm run build` — MV3 构建产出
5. 手动 QA（AE1-AE6）：创建实例 → 快切 → 搜索 → 缓存隔离 → agent v2 → 导入导出 → 删 key 恢复

**关键审计点**：`isKnownProvider` 所有调用点确认未把实例 id 误传入；`getAdapter` 调用点确认只收 `ProviderId`。

---

## Sources & Research

- **`feat/exa-settings` 分支**（commit `9d8f5a3`）— Exa options 参考实现（`ExaSettings` 类型 / `normalizeExaSettings` / `buildRequest` / `providerSettings` 通道 / UI 表单 / 测试模式）。per-provider-type 单 blob 模式，重构为 per-instance。
- **`lib/site-engines.ts`** — 多实例 CRUD / id guard / normalizer / byte-budget 模板。
- **`docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md`** — `ProviderId` 边界纪律（实例 id 不进 `sendMessage('search')` / `resolveSearchProvider` / `getAdapter`）。
- **`docs/solutions/architecture-patterns/per-provider-config-worker-injection.md`** — worker 注入 options 模式（`maxResults` 先例，消息不携带 options）。
- **Oracle 架构评审**（`ses_03dcbfa57ffeCVTQF9lDhQsjAr`）— endorse-with-changes 裁定：实例模型对，agent 契约要拆 action 不放宽，cache key 是 P0 遗漏。
