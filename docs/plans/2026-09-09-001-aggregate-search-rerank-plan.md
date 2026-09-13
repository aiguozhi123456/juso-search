---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "Aggregate Search（实例化）+ External Rerank — Plan"
type: feat
date: 2026-09-09
---

# Aggregate Search（实例化）+ External Rerank — Plan

## Goal Capsule

**目标**：新增「聚合搜索」——第 7 种 SearchKind `aggregate-instance`（实例化源，动态 id `agg:${token}`，**无静态聚合源**）。每个聚合实例 = `{名称, 成员清单, topN}`，一次搜索并行扇出成员（已配置 provider / provider 实例 / 带 extractor 的 engine），结果去重合并后交**本地 rerank 模型 API**（127.0.0.1，Cohere/Jina 风格 `/v1/rerank` 协议，endpoint/model/apiKey 全局一份）重排，统一展示。rerank 强制要求（未配置/失败即报错，不降级）；各成员的综合答案全部展示于列表前。聚合实例归**新内置组 `aggregate`**（DEFAULT_GROUPS 中 ai-search 之后、custom 之前）。

**权威层级**：本计划 v1 由 2026-09-09 调研 + 用户决策 + Oracle 独立审查（APPROVE-WITH-CHANGES，5 阻断项已吸收）产生；**2026-09-11 实例化修订**由用户四轮决策（grilling）+ 两次代码事实探查（实例/分组机制、docs/solutions 全量串联） grounding，产品行为与技术决策以本文件为准。**2026-09-11 Oracle 复审**：APPROVE-WITH-CHANGES，9 findings（1 blocker + 3 should-fix + 5 notes；含组位置、导入失效两项用户裁决）已全部吸收进本版。

**停止条件**：P1–P4 全部落地；`npm run typecheck && npm run lint && npm test` 全绿；手动复核清单（见 Verification）通过。

**执行画像**：纯函数优先（merge/dedupe/eligibility/instance-normalize 全部可单测）；gateway/adapter 测试 mock fetch 与 storage；组件测试 mock `@/lib/messaging` 与 `@/lib/storage`（沿用 tests/ 既有模式）；i18n parity 测试自动锁定双语键。

---

## 调研结论（已核实，实施时无需重查）

### 既有事实（2026-09-09 首查 + 2026-09-11 复核）

- 搜索现状为单源执行：`sendMessage('search')` → worker `handleSearch`（lib/gateway.ts:85）→ `runProviderSearch`（lib/gateway.ts:504，内部：缓存 → worker 读 key → adapter → 写缓存）。九个 provider 适配器归一化为 `NormalizedSearchResponse`；`NormalizedResult` 已有 `score?`/`content?`。
- BYOK：key 仅存 `providerKeys` map，仅 worker 读（lib/storage/keys.ts、lib/storage/provider-keys-store.ts）。UI 只拿脱敏快照（lib/storage/snapshot.ts:18 `getProviderConfigSnapshot`）。
- 引擎抽取（lib/engine-search.ts:40 `runEngineSearch`）：worker 编排临时后台 tab → content script 抽取 → 结果或错误均为返回值，**从不抛异常**。deps 构造先例：`{ tabs: browser.tabs, completeTimeoutMs }`（background.ts:179）。
- 缓存池（lib/search-cache.ts + lib/storage/search-cache-store.ts）：`order` LRU、`SEARCH_CACHE_CAP = 50`、`MAX_CACHED_RESULTS = 20`、`makeSearchCacheKey(id, query)` = `` `${id}:${normalizedQuery}` ``（cache schema v2 起 key = `(instanceId ?? providerId):query`，IU6 先例）。`slimSearchResponse` 白名单不含 `content`。变更经 per-module promise 队列串行。
- Config 域 schema：CONFIG_KEYS 白名单（lib/schema.ts:24）+ Default-by-Getter 惯例（新键缺省值由 getter 兜底，无需 bump 版本）。
- Manifest（wxt.config.ts:62-72）：permissions 无 `unlimitedStorage`；host_permissions **已含 `http://127.0.0.1/*`**（Chrome match pattern 忽略端口；`localhost`/`[::1]`/`https://127.0.0.1` 不被覆盖）。WAR（wxt.config.ts:76-133）两处列表（SERP 匹配 + `<all_urls>`）承载 favicon 渲染。

### 实例机制事实（2026-09-11 探查，实例化修订的 grounding）

- **Provider instances**（lib/provider-instances.ts + lib/storage/provider-instance-store.ts）：`ProviderInstance { id: inst:${ProviderId}:${token}, baseProviderId, name, options }`；token 正则 `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`；caps `50 实例 / 名称≤40 / 序列化≤128KiB` 三件套；`normalizeProviderInstances` 逐条校验 + 首现去重 + **oversize 不当空**（trusted read）；`isBoundedProviderInstanceCollection` 仅用于 untrusted import。CRUD 全部 `withSourceMutation(() => withProviderInstancesMutation(...))` **双队列（source 优先）**；create 把新 id 追加进 sourceOrder 尾部；delete 剥离 order/hidden + activeSource 派生回退；实例**不持有任何密钥**；独苗不可删 + 懒 backfill 默认实例（聚合**显式不采用**，见 KTD18）。
- **Site instances**（lib/site-instances.ts）：`site:${token}` 同构三件套 caps；存储键 `siteInstances` 经 v9→v10 改名迁移（`readKeys` 声明旧键；**迁移花在名字上，绝不花在值上**）。
- **Source 投影**（lib/sources.ts）：6 种 SourceKind；`DEFAULT_SOURCE_ORDER`（:48-52）仅静态 id，动态 id 靠 normalize 补尾；`allKnownSourceIds`（:59-72）= 静态 id + 三组动态定义集；`normalizeSourceOrder/Hidden`（:93-139）只保留已知 id（**动态 id 须同时在传入定义集中**，定义删除即剥落）；`allSources`（:161-266）实例投影规则：有实例的 provider 不再投影裸 pill，整组实例 pill 替代，label = 实例名 literal，共享 base favicon。**警示**：新增带默认值 `[]` 的参数会让既有调用点变成静默剥除器（provider instances 引入时 ~15 处前科，provider-instance-multi-config-model.md:393-399）。
- **分组**（lib/source-groups.ts）：DEFAULT_GROUPS 实际顺序 = `engines → sites → ai-engines → ai-search → custom`（:59-65，与本项目早期文档描述有出入，以代码为准）；`defaultGroupForSourceId`（:76-82）是类型→组唯一分发点，未显式映射的 kind **静默落 `sites` 兜底**；`normalizeGroupConfig`（:168-274）以 DEFAULT_GROUPS 为骨架重排内置组 + **非空 layout 回填缺失内置组到末尾**（L4 修复，自动生效但须回归测试）；平铺阈值 `FEW_SOURCES_FLAT_THRESHOLD=4` / `SINGLE_GROUP_FLAT_THRESHOLD=6`。
- **config-io**（lib/config-io.ts）：providerInstances 字段 = 整数组合法性校验（isBounded + normalize 长度等值，非法拒收 `invalid_provider_instances`）+ 缺失保留本地 + `applyPrefs` 整组替换 + preview summary 逐条拼接 + `isKnownSource` 接受导入实例集中的 id。

### docs/solutions 串联（96 篇全扫，29 篇相关；引文已落位到下文各条）

- **贯穿性红线**：`source-graph-new-type-threading-data-loss.md`——新源类型必须穿透**每一个** normalize/投影调用方；「新代码路径正确 ≠ 整张 source 图正确」；硬性要求共存回归测试（seed A+B、变更 A 断言 B 存活、反向再测）。本次为该清单第 3 次重跑（site → provider-instance → aggregate）。
- **本次修订反转的 v1 结论**（6 处）：① KTD11「L4 不适用」→ 新内置组使 L4 完全适用；② KTD4「静态 id 无需实参穿透」→ 动态 id 须定义集参数穿透；③ KTD10「lock order 不涉及新键」→ CRUD 重写 sourceOrder 须双队列；④ KTD7 缓存键 `'aggregate'` → agg 实例 id；⑤ KTD9「成员/rerank 变更全聚合失效」→ 按触发源拆分（rerank 全失效 / 实例级变更仅该实例）；⑥ R1-R2 静态源 + 全局 `aggregateMembers` → 实例集合 + 全局 `rerankConfig`。
- 关键引用（详见各 KTD）：provider-instance-multi-config-model.md（实例实体母本 + 独苗/自动创建的反向对照 :176-180 + parallel-IU 缓存接缝 :383-389）、instance-crud-cross-queue-lock-order.md（:39, :74-77）、local-search-cache-mv3.md（缓存不变量 :192 区域）、per-provider-config-worker-injection.md（**设置不在缓存键内 ⇒ 写时失效** :137）、default-off-capability-gating-for-cws-compliance.md（**:83 用户显式 UI 豁免条款**，KTD15 判据）、engine-capability-is-per-registry-not-per-id-union.md（引擎勾选清单从 registry 派生）、source-level-favicon-field-pipeline.md（WAR 两处是易漏步）、theme-persistence-i18n-key-hygiene.md（parity 测试 + 页面侧禁 `get(null)`）、dynamic-source-stale-navigation-guard.md（stillDefined 消歧）、hidden-source-still-active-across-hosts.md（失效回退是派生视图，绝不持久化写）、edit-mode-base-provider-switch-silently-wipes-options.md + enum-timerange-silently-dropped-in-draft-conversion.md（编辑器契约）。

---

## Product Contract

### Requirements

- **R1. 聚合实例源**：`SourceKind += 'aggregate-instance'`，id 形如 `agg:${token}`（token 规则同 inst:/site:）。**无静态聚合源、无默认实例概念**。可见性隐式轴（per-instance）= **≥1 个有效成员 且 rerank endpoint 已配置**（单源 + rerank 是合法用法——用户决策放宽原 ≥2）；显式隐藏轴照常按实例 id 生效。失效实例的 activeSource 回退是**派生视图**（渲染/执行层 reselect），绝不持久化写（hidden-source-still-active 教训）。归新内置组 `aggregate`。
- **R2. 实例模型**：存储 `aggregateInstances: AggregateInstance[]`（空 = 功能整体隐藏）。`AggregateInstance = { id: AggregateInstanceId; name(≤40); members: AggregateMemberId[]; topN?(5-20，默认 20) }`；`AggregateMemberId = ProviderId | ProviderInstanceId | 带 extractor 的 EngineId`。新建实例**空白起步**（⚠️ 推翻 v1「预勾选全部已配置 provider」决策——避免意外计费面），保存以 ≥1 有效成员为启用条件。caps 镜像三件套：50 实例 / 名称 40 / 128KiB。无独苗保护、允许删光、无自动创建（KTD18 反向对照）。
- **R3. 强制 rerank（全局）**：`rerankConfig = { endpoint; model?; apiKey? }` 全局一份（**topN 不在全局**，随实例）。endpoint 未配置 → 全部聚合实例不可见 + 搜索报 `keyMissing`（驱动 ErrorState 设置入口 CTA）；rerank 调用失败 → `providerError` + 专用 i18n 文案。**不降级**为无重排合并。
- **R4. 答案聚合**：所有成功成员返回的 answer 全部展示（成员序，不做取舍），位于结果列表之前，每条带来源徽标（favicon + label）。
- **R5. 结果合并**：URL 归一去重（小写 host、剥 `utm_*`/`fbclid` 等跟踪参数、去 hash、去尾斜杠），首现保留，多源同 URL 合并 provenance（显示多徽标）。rerank 后按 `relevance_score` 降序写入 `NormalizedResult.score`。
- **R6. 成员状态透明**：per-member 状态（ok/failed、resultCount、`cached?`、errorKind/Message，保留 page-state vs orchestration 错误分型不折叠——engine-search-orchestration 教训）；engine 成员恒为「实时抽取」。聚合视图常驻 meta 条（R13）。
- **R7. 缓存**：两层——成员子缓存（provider/实例成员经 `runProviderSearch` 内部路径自然复用；engine 不缓存）+ 聚合级缓存（**键 = agg 实例 id**，KTD7）。共池 LRU，`SEARCH_CACHE_CAP` 50→100。**精确失效拆分**：`rerankConfig` 变更 → 删全部聚合条目（设置不在键内 ⇒ 写时失效）；实例 members/topN 变更或删除实例 → 仅删该实例条目（实例 id 即键，天然精确）；改名不失效；per-provider `maxResults` 变更沿用全池清空（连带聚合，接受）。无 TTL；聚合写缓存 best-effort（`.catch(() => null)`，gateway.ts:536 先例）。
- **R8. 强制全新搜索**：聚合 meta 条常驻「强制全新搜索」按钮 = `forceRefresh: true`：该实例聚合缓存绕读 + 传播到全部成员（子缓存绕读、全员实查）+ rerank 重跑 + 回写。不做持久「禁用缓存」偏好。
- **R9. Engine 成员**：勾选即用（并发信号量 ≤3，每引擎 ~20s 预算）；引擎勾选清单**从 extractor registry 派生**（engine-capability 分层教训，不手写、不按 EngineId union 推断）；清单附警示文案「将以后台标签页加载搜索页，可能被反爬拦截」。**不**复用 `engineSearchEnabled` 门控（判据：default-off 文档 :83 用户显式 UI 豁免条款 + CONCEPTS.md:126；决策落 docs/solutions，代码注释指向）。
- **R10. 快切栏/深链/菜单接线**：聚合实例 pill 进快切栏（含 SERP 栏、划词弹窗、右键菜单树——经 `allSources` 单点投影，label = 实例名、图标共用 aggregate.svg）；SERP/菜单/划词选择实例 → 深链 `search.html?provider=agg%3Axxx&query=...`（受理判据 = **该实例定义存在且 eligible**，非 configuredProviderIds；动态源导航前 fresh-config 重解析 + stillDefined 消歧——dynamic-source-stale 教训）；右键菜单重建触发键（`REBUILD_KEYS`）增加 `aggregateInstances`、`rerankConfig`。
- **R11. 历史面板**：聚合条目正常进 summaries/回放；`handleSelectCached`（App.tsx:505）增加 agg 分支——gate 改为「实例仍定义 && eligible」（绕过现有 `configuredProviderIds` gate），label/图标 = 实例名 + 共用 aggregate.svg；回放保真与 slim 白名单同构（answers/members/provenance/rerank 元信息完整，截断界与 solo 条目一致，Oracle F9）。**列表标签接线（Oracle F4）**：SearchCachePanel 自带 `providerLabel(summary.providerId)`（SearchCachePanel.tsx:115-118）——`'aggregate'` 哨兵须走专用分支显示 i18n「聚合」+ 实例名（经 props 注入 aggNameById 映射，或 summary 增加可选 displayName），锁组件测试。
- **R12. 配置面**：Options **search 导航组**新独立 section「聚合搜索与重排」（与站点实例并列；组件 `AggregateSearchManager`，骨架抄 ProviderInstanceManager + SiteInstanceManager 的 `onChange={syncConfig}`），含三块：
  - **rerank 全局卡**：endpoint（保存时 KTD12 校验 + `localhost`/`[::1]` 自动改写为 `127.0.0.1` 并提示）/ model（可选）/ apiKey（password 型，保存后不回显只显「已配置」+ 清除，镜像 provider key 处理）/「测试连接」按钮（worker `testRerank` 真实 mini 请求：1 query + 2 小文档，结果按 KTD6 分型显示）。endpoint 为空 → section 顶部常驻警示条「未配置重排服务，聚合实例不会显示」，**不锁定**下方实例管理。
  - **实例列表卡**：每行 = 实例名 + 成员摘要（「Tavily、Exa、google · 4 成员」）+ topN 徽标 + 有效性状态（失效 = 0 有效成员或 rerank 未配置 → 警示图标）+ 编辑/删除（两步确认，无独苗禁用）；容量 50 提示；空态「新建聚合」CTA；显示序 = 存储序（快切栏排序走既有 sourceOrder 机制，不在此重复）。
  - **实例编辑器（inline 展开，create/edit 共用）**：名称 ≤40 + 实时计数；edit 态无不可变身份字段（id 隐形不可改）；成员勾选**两节平铺**——「API 搜索」（已配置 providers，有实例的展开为「Exa · 实例名」行，数据源 snapshot）+「传统引擎」（仅 extractor 引擎，registry 派生，节头固定警示文案）；有效成员实时计数徽标，≥1 才可保存；topN stepper 5–20 默认 20；显式保存/取消；draft↔保存**全字段 round-trip**（enum-timerange 教训）。
  - 快照携带脱敏 `aggregate` 字段（KTD5），**永不返回 apiKey**。
- **R13. 聚合 meta 条**：常驻于聚合结果顶部——`N 源 · M 成功（K 缓存）/ X 失败 · 去重 D 条 · 重排 top Y` + [强制全新搜索] 按钮 + 明细可展开（失败原因/缓存时间，错误分型保留）；聚合缓存整条命中时同时显示命中时间；实例名作为视图标题。solo provider 搜索的现有缓存条不动。（用户反馈调整：meta 条位于成员 AI 回答区**上方**，沿常规搜索引擎统计条在上的惯例。）

### Scope Boundaries

**范围内**：R1–R13、实例实体三件套（KTD18）、消息与存储扩展、缓存路径与上限、新内置组、测试、i18n、图标与 WAR 登记、engine 门控决策文档。

**非目标**：
- 远程 rerank 服务（Cohere/Jina/SiliconFlow 云端）——后续按同协议加 endpoint 校验白名单即可；
- per-instance rerank 配置（endpoint/model/apiKey 恒全局）、per-instance 图标（共用 aggregate.svg）、默认实例自动创建、Options 列表内拖拽排序、新建成员预勾选；
- 聚合级 AI 综合答案（多答案对比/自选 LLM 综合）；
- engine 子搜索缓存、聚合 TTL、`unlimitedStorage` 权限；
- Agent Bridge / MCP 的聚合 action（后续 additive v2）；
- `https://127.0.0.1`（自签证书）端点；`localhost`/`[::1]` 输入自动改写为 127.0.0.1。

### Acceptance Examples

- **AE1**：新建实例「全家桶」（空白起步，勾选 Tavily + Exa + google）+ rerank `http://127.0.0.1:8000/v1/rerank` → 快切栏「聚合」组出现实例 pill → 搜索 → 答案区展示各成员 answer（带徽标）→ 重排后的列表每条带来源徽标、多源去重条目显示多徽标。
- **AE2**：某成员子缓存命中（同 query 之前单独搜过该 provider）→ meta 条显示「M 成功（1 缓存）」→ 点「强制全新搜索」→ 全员实查 + rerank 重跑 + 回写。
- **AE3**：rerank 服务关闭后搜索 → 明确报错（providerError，rerank 专用文案），不吐未重排结果；endpoint 清空 → **全部**聚合实例 pill 消失（隐式轴），已存 activeSource 经有效源派生回退。
- **AE4**：勾选 google engine 成员 → 搜索时后台 tab 抽取（≤3 并发）→ 抽取被反爬拦截时该成员标记失败（分型保留）、不阻塞其余成员。
- **AE5（精确失效拆分）**：改实例 A 的 topN 或成员 → 仅 A 的聚合缓存条目失效（实例 B 条目与 provider 历史条目存活）；改 rerankConfig → 全部聚合条目失效；改某 provider 的 maxResults → 全池清空（既有行为，聚合连带）。
- **AE6**：导出配置含 `aggregateInstances` + `rerankConfig`（明文 apiKey，与 providerKeys 同设计）；导入 apiKey 仅填空、其余随 applyPrefs（实例整数组替换）；预览 diff 不显示 apiKey。
- **AE7**：历史面板点聚合条目 → 渲染完整聚合响应（保真与 slim 白名单同构，label = 实例名）；同一 query 再搜 → 聚合缓存命中，0 扇出 0 计费。
- **AE8**：endpoint 输入 `http://localhost:8000/v1/rerank` → 保存时自动改写为 `http://127.0.0.1:8000/v1/rerank`（提示已改写）；输入远程 host 或 https → 保存被拒（校验文案）。
- **AE9（清零）**：删除最后一个聚合实例 → 允许（无独苗保护）→ 「聚合」组整体消失、`agg` 相关 order/hidden/activeSource 残留被 normalize 剥落/回退；再建新实例一切如常；删除实例 B 不影响实例 A 的缓存与历史。
- **AE10（单成员实例）**：只勾 google 一个成员的实例 → 合法可见可用（单源 + rerank）；成员后续失效（如 engine 被移除）→ 该实例隐藏、activeSource 回退。

### 关键假设

- 本地 rerank 服务兼容 Cohere/Jina 风格 `/v1/rerank`（vLLM/XInference/LiteLLM 均可服务）；loopback fetch 无混合内容问题（potentially trustworthy）。
- MV3 worker 在扇出窗口（最坏 ~60s）内有事件保活，被杀风险低；engine tab 的 finally 清理已有（engine-search.ts:64-67）。
- 聚合条目大小与 provider 条目同量级（≤20 结果 + answers + members），cap 100 最坏 ~3–6MB << 10MB 配额。
- 实例管线为第 4 次复制（site → provider-instance → aggregate），机械镜像每个既有分支即可；L4 非空 layout 回填由 `normalizeGroupConfig` 现有逻辑自动生效（仅需回归测试，不需新代码）。

---

## Planning Contract

### Key Technical Decisions

**KTD1. 新消息族，不动 `search`。**
`ProtocolMap` 增加：`aggregateSearch(request: { instanceId: AggregateInstanceId; query; forceRefresh? }): Promise<AggregateSearchReply>`、`createAggregateInstance(input)`、`updateAggregateInstance(id, patch)`、`deleteAggregateInstance(id)`、`setRerankConfig(config)`、`testRerank(): Promise<TestKeyReply 同款>`。`AggregateSearchReply` 与 `SearchReply` 同构（ok: `{response: AggregateSearchResponse; cache: {hit; entryId?; createdAt?}}` / error: `{kind: 'keyMissing'|'providerError'|'unknown'; message; providerErrorKind?}`）。全员失败 → `providerError` + 汇总文案。bridge v1 `search` 契约零影响。

**KTD2. 响应模型（新 `lib/aggregate/types.ts`）。**
```ts
type AggregateInstanceId = string; // 'agg:<token>'，guard 见 KTD18
type AggregateMemberId = ProviderId | ProviderInstanceId | EngineId;
interface AggregateSearchResponse {
  instanceId: AggregateInstanceId;
  query: string;
  kind: 'aggregate';
  answers: { sourceId: AggregateMemberId; answer: NormalizedAnswer }[];
  results: (NormalizedResult & { sources: AggregateMemberId[] })[];
  members: { sourceId: AggregateMemberId; ok: boolean; cached?: boolean;
             resultCount?: number; errorKind?: string; errorMessage?: string }[];
  rerank: { model?: string; rerankedAt: number };
}
```
文档构造恒为 `title + '\n' + snippet(截 512 字符)`——**不用 `content`**（缓存 slim 不含 content，避免排序随缓存状态漂移）。**例外（用户反馈调整）**：`snippetKind === 'metadata'` 的结果（小红书/B站/抖音抽取器的纯展示元数据 snippet：作者/点赞/播放等，无语义正文）不进重排文档，文档 = 仅 title——cross-encoder 被展示元数据稀释，实测相关度塌 5.6 倍、社媒结果系统性沉底；元数据 snippet 仍保留 UI 展示。无标题笔记（占位标题）无文本信号、沉底是诚实行为。`instanceId` 入响应供历史回放 gate 与 label 解析。

**KTD3. Worker 流程（`handleAggregateSearch`，lib/gateway.ts）。**
解析实例定义（未知 id → error）→ 校验 rerank 配置 →（非 forceRefresh）按 **agg 实例 id** 查聚合缓存 → `resolveAggregateEligibility` 复核有效成员 → 扇出 `Promise.allSettled`：
- provider/实例成员：经 `resolveSearchSource` 语义执行（裸 provider → 默认实例注入；实例 id → `resolveInstance` 的 `{providerId, providerSettings, cacheKeyId}`），复用 `runProviderSearch` 内部路径（各自缓存优先、forceRefresh 传播、各自写缓存、`cache.hit` 记入 member.cached）。**聚合级缓存的读与写必须从同一边界贯穿同一实例 id**（parallel-IU 接缝教训）；
- engine 成员（P3）：`runEngineSearch({tabs: browser.tabs 包装, completeTimeoutMs: 20_000})`，信号量 ≤3；错误 → member 失败（`runEngineSearch` 不抛异常）。
≥1 成功即继续；全员失败 → error。合并去重（纯函数 `lib/aggregate/merge.ts`）→ 候选池 top 40 → rerank → 按 `relevance_score` 降序写 `score` → `saveCachedAggregateSearch`（best-effort）→ 返回。

**KTD4. `allSources` 投影：第 7 参传聚合实例投影集。**
`allSources(configuredProviderIds, sourceOrder?, hiddenSourceIds?, siteDefinitions?, customDefinitions?, providerInstances?, aggregateSources?: {id; name; eligible}[])`——eligibility 由 snapshot 单点计算，**ineligible 实例不投影**（隐式轴，UI 不重算）。投影形态：每个 eligible 实例一枚 pill（label = 实例名 literal，图标 = aggregate.svg 经 favicon 管线）。**调用点清单**（全部需传，或显式确认该面不渲染聚合 pill；grep 防 default-`[]` 静默剥除）：context-menu.ts:92,198；serp-bar.content.ts:146,593；selection-search.content.ts:143；search/App.tsx:90,150,173,251,306,370,426,559；options/App.tsx:225,228,296；onboarding demo 四处（QuickbarDemo.tsx:53,54、SelectionDemo.tsx:24、SourceLayoutDemo.tsx:18、WelcomeDemo.tsx:64）**显式确认不投影**（Oracle F7，保持 default 空）。`DEFAULT_SOURCE_ORDER` **不增加**任何聚合条目（无静态源）；agg id 靠 normalize 定义集补尾（追加链 = 既有 site → custom → providerInstances 尾部规则的同族扩展，确定性由测试锁定）。
**分层铁律（Oracle F2）**：normalize/持久层（normalizeSourceOrder/Hidden、allKnownSourceIds、CRUD 剥落）的 agg 定义集 = **全部已定义实例，与 eligibility 无关**——rerank 清空等 eligibility 抖动期间重写 order/hidden 不得剥落 agg id；eligibility 仅作用于投影（allSources 不投影 ineligible）与可用性解析（visibleUsableSource / resolveEffectiveActiveSource 回退 / selectActiveSourceId 拒选）。测试锁定：rerank 未配置时改 hidden/order，恢复后 agg id 原位存活。

**KTD5. Eligibility 穿透（新纯函数 + 接线）。**
`resolveAggregateEligibility(instance, {configuredProviderIds, providerInstances, rerankConfig}) → {eligible, validMembers}`（lib/aggregate/eligibility.ts；engine 成员恒有效——按 extractor registry 存在性）。`agg` 实例作为 active source 的可用性依赖它，穿入：
- `resolveEffectiveActiveSource` / `visibleUsableSource`（lib/sources.ts:276/:308，经定义集 + eligibility，**不做 activeProvider 双写**——聚合无 base provider，与 provider 实例的显式分歧）；
- `ensureVisibleUsable`（lib/storage/source-graph-store.ts:59 附近）；
- `selectActiveSourceId`（source-graph-store.ts:67-90——清单外 id throw `invalid_source`，经 `allKnownSourceIds` 家族 + eligibility 受理 `agg:*`）；
- snapshot.ts:27,36 与 config-io.ts:95-101/622-651 的 fallback 共用上述函数，自动一致。
snapshot 增加脱敏字段（ProviderConfigReply 可选）：`aggregate?: { instances: AggregateInstance[]; eligibility: Record<AggregateInstanceId, {eligible: boolean; validMembers: number}>; rerank: {configured: boolean; endpoint?: string; model?: string} }`——**永不返回 apiKey**；页面代码禁 `get(null)` 直读（i18n-key-hygiene 教训）。

**KTD6. Rerank 客户端建在 http.ts 之上（新 `lib/aggregate/rerank-client.ts`）。**
`postJson` + `mapStatus`（lib/providers/http.ts，错误映射/脱敏免费获得）；超时 ~10s 用 `AbortController`+`setTimeout` 与调用方 signal 组合。worker 注入 fetch 必须 `(...args) => fetch(...args)` 包装（CONCEPTS.md:128 / service-worker-fetch-illegal-invocation.md:48 教训）。错误分型：未配置 → `keyMissing`；401/403 → unauthorized；429 → rateLimit；5xx/4xx → provider；JSON 畸形 → parse。走 `toSearchError`（gateway.ts:590）免费映射进 reply。`testRerank` 复用同一客户端（mini 请求：1 query + 2 小文档）。

**KTD7. 聚合缓存专用路径（不复用 `saveCachedSearch`）。**
新 `buildAggregateCacheEntry(response)` + `slimAggregateResponse`（lib/search-cache.ts）与 `saveCachedAggregateSearch` / `deleteAggregateCacheEntries(scope)`（lib/storage/search-cache-store.ts，scope = 全部或某实例 id）：
- cacheKey = `makeSearchCacheKey(aggInstanceId, normalizedQuery)`（镜像 IU6 实例键先例；**不是**静态 `'aggregate'` 前缀）；
- slim 保住 `kind/instanceId/answers（每条 text≤2000、citations≤10）/results（≤20，snippet≤1000，含 sources provenance 与 score）/members/rerank`；
- 抽出共享 entry 写入核心（LRU touch/淘汰/同 key 替换与 `saveCachedSearchUnlocked` 共用，进同一 mutation queue）；
- `SearchCacheEntry.response` 类型扩为 `NormalizedSearchResponse | AggregateSearchResponse`；`SearchCacheSummary.providerId` 扩为 `ProviderId | 'aggregate'`（哨兵）+ `instanceId?` 扩 union 含 `AggregateInstanceId`；`buildSearchCacheSummary` agg 分支（Oracle F8）——`answerPreview` 取 `answers[0]` 文本截断（无 answers 则省略）。**无 cache schema bump**（index 形状不变、存量条目不受影响；v1→v2 先例佐证）；round-trip 测试锁定。

**KTD8. topN 5–20（默认 20），候选池 40。**
topN 随实例存储。缓存存储上限 `MAX_CACHED_RESULTS = 20` 是文档化不变量（CONCEPTS.md「Local Search Cache」：存储 cap ≥ 实时路径最大返回）。rerank `top_n = topN ≤ 20` 从根上满足。

**KTD9. 缓存池扩容与精确失效（拆分语义）。**
`SEARCH_CACHE_CAP` 50 → 100（运行时常量，无迁移）。触发矩阵：
- `setRerankConfig` 变更 → `deleteAggregateCacheEntries(all)`（设置不在键内 ⇒ 写时失效，per-provider-config 教训 :137）；
- 导入路径（mergeImport/applyPrefs 写 rerankConfig）检测 endpoint/model **实际变更** → `deleteAggregateCacheEntries(all)`（apiKey 仅填空不触发——不改变 reranker 身份；用户裁决，Oracle F5，两条写路径失效语义统一）；
- `updateAggregateInstance` 且 members/topN 变更 → `deleteAggregateCacheEntries(instanceId)`（改名不失效）；
- `deleteAggregateInstance` → 删该实例条目 + 剥离 order/hidden + activeSource 派生回退；
- `handleSetProviderMaxResults` 既有全池清空保持（聚合连带，一致性优先）。
**不做**「成员子缓存与聚合设置无关所以全保留」之外的全池清空。

**KTD10. 存储键（全部 Default-by-Getter，无 schema bump）。**
- `rerankConfig = { endpoint: string; model?: string; apiKey?: string }`（worker-only 读；apiKey 明文随导出文件，与 providerKeys 同设计）；
- `aggregateInstances: AggregateInstance[]`（空 = 未启用）。
**必须登记 `lib/schema.ts` CONFIG_KEYS**（教训 L1）+ config-io 接线（KTD13）+ 读写经 storage barrel/队列。⚠️ **v1「lock order 不涉及这两键」结论作废**：实例 CRUD 重写 sourceOrder 且集合被 `mergeImport` 整组覆盖 → create/update/delete 一律 `withSourceMutation(() => withAggregateInstancesMutation(...))` 双队列，锁序与 provider-instance-store 完全一致（instance-crud-cross-queue-lock-order.md:39, :74-77）。

**KTD11. 新内置组 `aggregate`（L4 完全适用——v1 结论反转）。**
- DEFAULT_GROUPS（source-groups.ts:59-65，现顺序 `engines → sites → ai-engines → ai-search → custom`）**在 ai-search 之后、custom 之前插入 `aggregate`**（组 label i18n「聚合搜索」）；
- `defaultGroupForSourceId`（:76-82）增加 `'agg' 前缀 → AGGREGATE_GROUP` 显式分支——否则静默落 `sites` 兜底；
- `normalizeGroupConfig` 的 groups 骨架重排 + **非空 layout 回填**（:234-237）对新组**自动生效**（L4 修复已是现网逻辑）。**就位语义（用户裁决，Oracle F1）**：老存量**非空 layout** 加载后 aggregate 组经 L4 回填**追加至 layout 末尾**（custom 与自建组之后，与 custom 组上线先例一致）；DEFAULT_GROUPS/groups 数组内位置为 ai-search 后、custom 前；空 layout 与新装用户按 DEFAULT_GROUPS 全序就位。**显式不改**回填规则为骨架序插入（敏感共享路径的计划外变更）。回归测试锁定上述三形态；assignments/groupOrders 剔除规则经 `allKnownSourceIds` 扩展自然受理 agg id；
- 自适应平铺阈值（4/6）与 aggregate 组的交互入测试矩阵（单聚合实例 + 少量源时组可能被平铺，属预期行为）。

**KTD12. endpoint 强制 loopback（127.0.0.1-only）。**
保存时（worker 侧 `handleSetRerankConfig` + config-io 导入复用同校验）校验并**规范化**：解析 URL → host 为 `localhost` 或 `[::1]` → 自动改写为 `127.0.0.1`（保留端口/路径，UI 提示已改写）；最终必须 `scheme === 'http' && hostname === '127.0.0.1'`，否则拒绝（i18n 校验文案）。理由：`http://127.0.0.1/*` 已声明且忽略端口；localhost/[::1]/https 不被覆盖；「本地」威胁模型（搜索内容 + apiKey 不出 loopback）从校验层硬约束。**manifest 零 host-permission 变更**。Firefox：host_permissions 不自动授予，v1 Chrome-first（文案提示授权/CORS，不在本计划内解决）。

**KTD13. config-io 规格。**
`buildExportPayload` 读取键清单加 `aggregateInstances`、`rerankConfig`；`ConfigExport` 字段 + `parseImportPayload` 校验：
- `aggregateInstances`：`isBoundedAggregateInstanceCollection` + normalize 长度等值（非法 → 拒收 `invalid_aggregate_instances`）；缺失 = 保留本地（legacy 语义）；
- `rerankConfig`：endpoint 复用 KTD12 校验；缺失保留本地；
- `applyPrefs`：实例**整数组替换**（同 providerInstances 先例）；`endpoint/model` 随 pref（实际变更时触发 KTD9 导入失效，apiKey 不触发）；`apiKey` **仅填空**（与 providerKeys 同）。
`previewImport` 的 diff **不显示 apiKey**；实例 summary 行 `id:name:成员数:topN`。`isKnownSource` 接受导入实例集中的 agg id（activeSource/sourceOrder/sourceHidden 校验共用）。ImportReport 相应扩展。导入接受连续版本区间（config-import-schema-version-range 惯例）。
**payload.aggregateInstances 缺失时的 preserve 语义（Oracle F3，镜像 site/custom 分支族）**：① preserveAggregate——保留本地 agg activeSource；② normalize 定义集并入本地 agg 实例，本地 sourceOrder/sourceHidden 中 agg id 不剥落（含 hiddenInput 合并分支扩展）；eligibility 输入此时用本地 rerankConfig。

**KTD14. 协议命名。**
实现与文档统一称「Cohere/Jina 风格 `/v1/rerank`」：请求 `{model?, query, documents: string[], top_n?}`，响应 `{results: [{index, relevance_score}]}`（vLLM/XInference/LiteLLM 兼容）。**不是** "OpenAI-compatible"——OpenAI 无 rerank API，勿按 OpenAI 规范实现。

**KTD15. Engine 门控决策（记录在案，判据升级）。**
UI 聚合的 engine 成员**不走** `engineSearchEnabled` 门控。判据：该门控语义是「外部进程代理加载第三方页」的 agent 门（CONCEPTS.md:126），且 default-off-capability-gating-for-cws-compliance.md **:83 明确豁免用户主动触发的可见 UI**；用户在设置页勾选 engine 成员即显式 opt-in。落地三条件：① docs/solutions 新增决策记录（engine-extraction-for-user-initiated-aggregate 类别）；② 聚合 engine 路径代码注释指向该记录；③ options engine 勾选清单附警示文案（R9）。

**KTD16. UI 接线清单（分支判据一律 `isAggregateInstanceId(source)`，不做字符串散比）。**
- `resolveSerpHandoff`（lib/serp-handoff.ts）：agg 实例 → `{kind:'openSearchPage', deepLink}`（provider-instance 同款分支；深链经 worker 中转——页面不能直跳 extension URL）；
- `parseSearchDeepLink`（lib/deep-link.ts:19-27）+ `isLinkSourceConfigured`（App.tsx:35-39）：受理 `agg:*`（判据 = 实例定义存在 && eligible，fresh snapshot 重解析 + stillDefined 消歧）；
- `App.tsx handleSelectSource`：agg 分支（**先串行写 activeSource 再以当前输入框查询发起 `aggregateSearch`**——provider-switch-current-query 教训；现有 `isProviderId(source)` 守卫前拦截）；
- `handleSearch`：`isAggregateInstanceId(source)` → `sendMessage('aggregateSearch', {instanceId, ...})`（回复写独立 state 或 union state + kind 判别渲染）；
- `handleSelectCached`（App.tsx:505）：`entry.instanceId` 为 agg → 实例仍定义 && eligible 分支（绕过 configured gate、active 回写 agg id、渲染聚合视图）；
- `providerLabel`（App.tsx:621）agg 分支 → 实例名查找（快照 instances）；
- `handleRefresh`：active 为 agg 实例 → 用实例 id 刷新；
- 聚合视图渲染：meta 条（R13，用户反馈调整在前）→ answers 区（AnswerCard 变体 + 来源徽标）→ ResultList（per-result 徽标[多源多徽标] + score 百分比）；
- context-menu `REBUILD_KEYS` += `aggregateInstances`、`rerankConfig`（lib/context-menu.ts:33-43；REBUILD_KEYS 是唯一注册点，漏登记 = 菜单与快切栏漂移，M1/M2 前科）。

**KTD17. 资源。**
新 `public/icons/aggregate.svg`（与既有 provider 图标同风格的单色品牌图形）；经 **favicon 管线**（type→factory→allSources）进投影，**登记进 wxt.config.ts 两处 `web_accessible_resources`**（SERP 匹配 + `<all_urls>` 划词弹窗——source-level-favicon-field-pipeline.md 指认的易漏步）；全部聚合实例共用。i18n：lib/i18n.ts + public/_locales/{zh_CN,en}/messages.json 同步加键（组 label、section 全部文案、meta 条、错误与警示等），parity 测试自动锁定。

**KTD18. 聚合实例实体三件套（新 `lib/aggregate-instances.ts`，机械镜像 provider/site 先例）。**
- guard：`AggregateInstanceId = agg:${token}`，token 正则 `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`，`isAggregateInstanceId` 前缀 + token 校验；**id 进入 SourceId union，绝不进 ProviderId**（成员可引用 provider 实例，agg id 本身永不到达 getAdapter/getKey）；
- `normalizeAggregateInstances`（trusted read）：逐条校验（id-token 一致、name trim ≤40 非空、members 仅做形状校验（id 形态合法 + 首现去重；语义有效性只在 eligibility 判定，**绝不因 registry 漂移回写存储**，Oracle F6）、topN 钳位 5-20）+ 集合去重截断 50 + **oversize 不当空**；`isBoundedAggregateInstanceCollection` 仅用于 untrusted import；mutation 拒绝 oversize（site-engine-third-source 安全持久化三不变量）；
- caps：`MAX_AGGREGATE_INSTANCES = 50`、`MAX_INSTANCE_NAME_LENGTH = 40`、`MAX_INSTANCES_SERIALIZED_BYTES = 128KiB`；
- store（新 lib/storage/aggregate-instance-store.ts）：CRUD 双队列（KTD10）；create 追加 id 进 sourceOrder 尾部；delete 剥离 order/hidden + activeSource 派生回退；
- **与 provider 实例的显式分歧（记录在案，引 provider-instance-multi-config-model.md:176-180 作对照）**：无独苗保护（允许删光）、无懒 backfill/自动创建、无隐式第一个默认实例——activeSource 恒为显式实例 id；
- `agg:` 前缀一旦发布即**永久值锚点**（site-instance 教训 :184「迁移花在名字上，绝不花在值上」）。

---

## Execution Plan

### Phase 1 — 实例实体 + rerank 客户端 + worker 聚合（provider 成员）+ 缓存

1. `lib/aggregate/types.ts`（KTD2）、`lib/aggregate/merge.ts`（URL 归一/去重/provenance 合并/候选池裁剪，纯函数）、`lib/aggregate/rerank-client.ts`（KTD6）、`lib/aggregate/eligibility.ts`（KTD5）。
2. `lib/aggregate-instances.ts` 三件套（KTD18）+ `lib/storage/aggregate-instance-store.ts`（双队列 CRUD、sourceOrder 追加/剥落）+ `lib/storage/keys.ts` 新键 + `lib/schema.ts` CONFIG_KEYS 登记。
3. `lib/search-cache.ts`/`search-cache-store.ts`：`SEARCH_CACHE_CAP=100`、aggregate entry build/slim/save/delete(scope)（KTD7/KTD9）、类型扩展。
4. `lib/gateway.ts`：`handleAggregateSearch`（实例解析 + provider/实例成员扇出）、`handleSetRerankConfig`（KTD12 校验+规范化 + 全聚合失效）、CRUD handlers（+精确失效）、`handleTestRerank`。
5. `lib/messaging.ts` 新消息族 + `entrypoints/background.ts` 接线。
6. `lib/config-io.ts` 导出/导入/预览（KTD13）。
7. 测试：aggregate-merge / rerank-client / eligibility / instances-normalize（含 oversize 不当空、import 拒收）/ cache round-trip / gateway 流程（全成功/部分失败/全员失败/rerank 失败报错/缓存命中不扇出/forceRefresh 传播/缓存键读写同源审计）。

### Phase 2 — source 图 + 新内置组 + 搜索页 UI + options 配置面

1. sources.ts / source-groups.ts（KTD4/KTD11：DEFAULT_GROUPS 插入、显式分支、投影参数穿透全部调用点）/ source-graph-store.ts / snapshot.ts（KTD5 脱敏 aggregate 字段）。
2. serp-handoff / deep-link / context-menu（REBUILD_KEYS）/ App.tsx 全分支（KTD16）。
3. 搜索页聚合视图（answers 徽标、meta 条 + 强制全新搜索、ResultList 徽标与 score、历史回放 R11）。
4. Options `AggregateSearchManager`（R12 全量契约：rerank 卡/实例列表/inline 编辑器两节平铺/空白起步/警示条不锁定）。
5. aggregate.svg + favicon 管线 + WAR 两处登记；i18n 双语键。
6. 测试：sources/source-groups 投影与 order/hidden 保留、**L4 非空 layout 回填回归**（三形态断言：老 groupConfig 非空 layout → 末尾追加；空 layout/新装 → DEFAULT_GROUPS 全序）、**四类共存矩阵**（agg × site × custom × provider-instance 互变更断言存活 + 反向，教训硬性要求）、平铺阈值矩阵、selectActiveSourceId 受理 agg、config-io roundtrip、search-page 聚合渲染（含 meta 条与回放）、options section、i18n parity。

### Phase 3 — engine 成员

1. 扇出编排接入 engine 成员（信号量 ≤3、`runEngineSearch` deps 构造、member.cached 恒 false、错误分型归入 member 状态）。
2. Options engine 勾选清单（**从 extractor registry 派生**）+ 警示文案（KTD15③）。
3. docs/solutions 决策记录（KTD15①）+ 代码注释（②）。
4. 测试：engine 成员成功/失败/并发上限（mock tabs，沿 engine-search.test.ts 模式）、部分失败聚合、AE4/AE10。

### Phase 4 — 回归打磨

SERP 栏/划词弹窗/右键菜单聚合 chip 回归测试；deep link 手动复核（含失效实例 stillDefined 回退）；meta 条明细展开交互；账单提示（成员多时「刷新将重新查询 N 个成员」文案）；删光→重建→再搜全链路（AE9）。

---

## Verification

**命令**：`npm run typecheck && npm run lint && npm test`（AGENTS.md 全量门禁）。

**手动复核清单**（dev 构建 `npm run build:dev` 加载）：
1. 本地起 rerank 服务（如 Xinference/vLLM serve 一个 bge-reranker），Options 配置 endpoint → 「测试」通过（含分型报错走查）。
2. AE1–AE10 逐条走查（重点：AE2 强制全新搜索后缓存计数归零、AE5 三种失效触发各归其位、AE7 历史回放保真、AE8 localhost 自动改写、AE9 删光重建、AE10 单成员实例）。
3. 聚合实例 pill 在快切栏/SERP 栏/划词弹窗/右键菜单四处一致出现与隐藏（改成员/删实例/清 endpoint 后回退；菜单与快切栏无漂移）。
4. 老用户模拟：预置 v1 时代 groupConfig（无 aggregate 组、非空 layout）加载后，「聚合」组经 L4 回填追加至末尾（custom/自建组之后）且可正常拖拽/收纳；新 profile（空 layout）下按 DEFAULT_GROUPS 出现在 ai-search 与 custom 之间。
5. Firefox 构建 lint 过（已知 host_permissions 授予限制仅记录，不修复）。

**风险备注**：一次聚合 = 每个成员 provider 各计一次费（子缓存优先缓解；meta 条明示成员；强制全新搜索前有 N 提示；空白起步降低误配面）；engine 反爬墙（yandex/douyin 有前科）按成员失败呈现不阻塞；本地服务仅绑 ::1 时需改监听 127.0.0.1（文档注明）；实例化修订已经 Oracle 复审（APPROVE-WITH-CHANGES，9 findings 全吸收；老用户组位置末尾追加与导入失效语义为用户裁决项）。
