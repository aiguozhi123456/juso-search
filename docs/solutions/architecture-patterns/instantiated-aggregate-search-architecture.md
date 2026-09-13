---
title: "Instantiated aggregate search: dynamic agg: instances, worker-only rerank config, and source-graph threading"
date: 2026-09-13
category: architecture-patterns
module: "Aggregate search / instance entity + source graph + gateway fan-out"
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "Introducing a new dynamic source kind (the 4th/5th/6th instance pipeline) and deciding entity shape and storage boundaries"
  - "A new source needs machine-level global config (keys, endpoints) while holding the BYOK line that keys are worker-only"
  - "A dynamic source must enter the order/hidden persistence layer and quick-switch projection — designing the definition-set vs eligibility split"
  - "Splitting parallel implementation lanes and identifying shared boundary-function signatures as the fragile seam"
related_components:
  - lib/aggregate-instances.ts
  - lib/aggregate/types.ts
  - lib/aggregate/eligibility.ts
  - lib/aggregate/rerank-client.ts
  - lib/gateway.ts
  - lib/sources.ts
  - lib/storage/aggregate-instance-store.ts
tags: [aggregate-search, instance-pipeline, aggregate-instance, rerank-config, loopback, source-graph, eligibility, byok]
---

# Instantiated aggregate search: dynamic agg: instances, worker-only rerank config, and source-graph threading

## Context

聚合搜索（plan `docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md`）需要一个用户可定义实体：命名一组搜索成员（provider 裸 id / provider 实例 / 传统引擎）+ topN，搜索时扇出 → URL 归一去重合并 → 本地 rerank 重排 → 取 topN。第一个架构选择就决定了后面所有接缝的形状：**聚合做成「实例」（动态 id 的一等实体，快切栏目标），而不是一张静态源清单**。本文记录落地时的五个关键决策及其理由，供第 5、6 次实例管线复制时对照。

## Guidance

### ① 实体是实例，密钥配置全局一份

聚合实例是动态 id 实体，与 `inst:`（provider 实例）/`site:`（站点实例）同族，机械镜像 `lib/provider-instances.ts` / `lib/site-instances.ts` 的成熟管线（第 4 次复制）：

```ts
// lib/aggregate/types.ts
/** 聚合实例 id：`agg:<token>`（token 规则与 inst:/site: 同族，guard 见 lib/aggregate-instances.ts）。
 *  只进 SourceId 语义域，绝不进 ProviderId（聚合成员可引用 provider 实例，agg id 本身永不到达 getAdapter/getKey）。 */
export type AggregateInstanceId = `agg:${string}`;

// lib/aggregate-instances.ts
export interface AggregateInstance {
  id: AggregateInstanceId;
  /** 显示名：trim 后非空且 ≤ MAX_AGGREGATE_INSTANCE_NAME_LENGTH。 */
  name: string;
  /** 成员清单（AggregateMemberId[]）：存储序即扇出与答案展示序。 */
  members: AggregateMemberId[];
  /** 重排后保留条数，钳位 [MIN, MAX]；缺省由 clampAggregateTopN 物化为默认值。 */
  topN: number;
}
```

模板字面量类型 `` `agg:${string}` `` 让 agg id 在类型层就与 `ProviderId` 不相交——它只进 `SourceId` 语义域。实体 `{name, members, topN}` **不持密钥**：rerank 的 endpoint/model/apiKey 是全局一份 `RerankConfig`（`lib/aggregate/types.ts`），因为 rerank 服务是机器级事实（一个本地服务），不是 per-instance 变量。快照侧（`AggregateConfigSnapshot.rerank`）只出 `configured` / `hasApiKey` / `endpoint` / `model` 四个脱敏字段——`hasApiKey` 是布尔标志，**永不回显值**（沿 provider-instance 快照脱敏先例），守住 BYOK 红线：key 仅存 `chrome.storage.local`、仅 worker 读。

### ② eligibility = ≥1 有效成员 且 rerank 已配置；无独苗保护

```ts
// lib/aggregate/eligibility.ts
return {
  eligible: isRerankConfigured(input.rerankConfig) && validMembers.length > 0,
  validMembers,
};
```

单成员实例合法可用（单源 + rerank 也是聚合）；**删光成员也合法**——与 `provider-instance-multi-config-model.md` 的「独苗保护 + 懒 backfill + 自动创建」三件套显式分歧（分歧记录在 `lib/aggregate-instances.ts` 头注释）：聚合没有 base provider、没有「裸 pill 回退」语义，空集合/未配置 rerank = 实例 ineligible = 功能整体隐藏（快切栏不投影），而不是造一个兜底实体出来。eligibility 只作用于**投影与可用性解析**；持久层（order/hidden 归一）的定义集 = 全部已定义实例，与 eligibility 无关——这是分层铁律：eligibility 抖动（如 rerank 短暂未配置）期间重写 order/hidden 绝不剥落 agg id，否则配置来回切换会静默丢用户排序。

### ③ endpoint 强制 loopback，双写路径同校验

```ts
// lib/aggregate/rerank-client.ts
export function validateRerankEndpoint(raw: string): RerankEndpointValidation {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, reason: 'invalid_url' }; }
  let rewritten = false;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1')) {
    url.hostname = '127.0.0.1';
    rewritten = true;
  }
  if (url.protocol !== 'http:') return { ok: false, reason: 'not_http' };
  if (url.hostname !== '127.0.0.1') return { ok: false, reason: 'not_loopback' };
  return { ok: true, endpoint: url.href, rewritten };
}
```

`localhost` / `[::1]` 自动改写为 `127.0.0.1`（保留端口/路径，reply 提示已改写），最终必须 `http` + `127.0.0.1`。关键接缝：worker 侧 `handleSetRerankConfig` 与 `config-io` 导入**共用这一个校验函数**——两条写路径语义恒一致，导入无法绕过 loopback 约束。理由：manifest `host_permissions` 已含 `http://127.0.0.1/*`（Chrome match pattern 忽略端口），「本地」威胁模型（搜索内容 + apiKey 不出 loopback）在校验层硬约束，**manifest 零 host-permission 变更**。

### ④ engine 成员 = 用户发起的临时 SERP 抽取，借位 provider 字段只进 merge

engine 成员（extractor-capable 的 `EngineId`）经 `runEngineSearch` 执行：并发信号量 ≤3、总预算 20s、**恒实时抽取、无成员级缓存**（临时 SERP tab 抽取没有稳定内容可缓存）。贡献结果借位归一响应的 provider 字段：

```ts
// lib/gateway.ts runEngineAggregateMember
// EngineId ≠ ProviderId（两个不相交 id 域）：engine 的临时归一响应借位 provider 字段——该响应
// 只进聚合 merge（merge 只读 answer/results），绝不触 getAdapter/getKey，绝不单独入子缓存。
const response: NormalizedSearchResponse = { query, provider: member as unknown as ProviderId, results: result.results };
```

`as unknown as ProviderId` 是显式的、注释护栏的借位：`AggregateMemberId = ProviderId | ProviderInstanceId | EngineId` 三域并集，merge 管道只读 `answer`/`results`（`sourceId` 走独立的 provenance 字段），这个借位响应永远到不了 `getAdapter`/`getKey`。若让 EngineId 进 ProviderId 类型域，这个保证就没了。门控子决策（engine 成员不走 `engineSearchEnabled`，靠 Options 勾选的显式用户同意）单独记录在 [engine-extraction-for-user-initiated-aggregate](./engine-extraction-for-user-initiated-aggregate.md)。

### ⑤ source 图穿透：边界函数多带一个聚合定义集参数

聚合实例要能与静态源同屏排序/隐藏，意味着 source 图的每处 order/hidden 读写都要认识 agg id。做法：`normalizeSourceOrder` / `normalizeSourceHidden` / `ensureVisibleUsable`（`lib/sources.ts`）尾部统一加聚合定义集参数，全部重写方（`lib/config-io.ts` 的快照读与导入合并、`lib/storage/source-graph-store.ts`、`lib/storage/snapshot.ts`、site/custom/provider/aggregate 各 instance store 的级联重写）逐一传入。参数类型收窄为 `{ id }` 最小形状——归一化只关心 id 存在性，不依赖实体全文。历史教训见 [source-graph-new-type-threading-data-loss](../logic-errors/source-graph-new-type-threading-data-loss.md)：漏穿一个重写方 = 静默剥落聚合 id。

### 教训：并行车道因签名竞态改串行

实施时 source 图穿透与 eligibility/storage 车道并行开工，`normalizeSourceOrder`/`normalizeSourceHidden` 是两条车道都要动的共享边界函数——两边同时给它加参数直接冲突，改串行后合拢。**边界函数签名是并行车道最脆弱的接缝**：车道切分先盘点共享边界函数，谁要改谁的签名，撞了就并车道，别并行改。

## Why This Matters

- **实例化买来的是组合自由度**：`agg:` 动态 id 让「搜索源」从固定清单变成用户可编辑实体，快切栏/隐藏/排序/深链/历史回放对第 4 种实例管线全部免费复用（机械镜像的回报）。
- **密钥边界清晰才敢做全局配置**：实体不持密钥 + 快照只出布尔 + endpoint 校验单源，三条一起守住 BYOK 红线；任何一条松动，rerank apiKey 就会步 provider key 被页面读取的后尘。
- **定义集 vs eligibility 分层防止配置抖动丢数据**：不带这层铁律，rerank 暂时未配置的窗口期里任何 order/hidden 重写都会剥落 agg id，用户排序静默蒸发。
- **借位 + 注释护栏优于类型域污染**：三域 id 并集不可避免时，用显式 `as unknown as` + 双注释（为什么安全、边界在哪）把不变式钉在代码里，而不是放宽类型让编译器闭嘴。

## When to Apply

- 引入新动态来源类型（第 5/6 次实例管线复制）：照 ①②⑤ 三件套起步（实体形状 / 无保护删除 / source 图穿透）
- 新能力需要机器级全局配置（密钥、endpoint）：照 ③ 单源校验 + 双写路径复用 + 快照脱敏布尔
- 跨 id 语义域的数据要进既有管道：照 ④ 借位 + 管道消费面收窄 + 注释护栏
- 切并行车道前：盘点共享边界函数签名（教训段）

## Examples

- **实例合法形状**：`{ id: 'agg:3f2b...', name: '全能聚合', members: ['tavily', 'inst:stepfun:plan-a', 'bilibili', 'xiaohongshu'], topN: 20 }`——provider 裸 id、provider 实例、engine 混列，存储序即扇出序。
- **endpoint 校验**：输入 `http://localhost:8090/v1/rerank` → 改写为 `http://127.0.0.1:8090/v1/rerank`（rewritten=true，保存后提示「已将 localhost/[::1] 自动改写为 127.0.0.1」）；输入 `https://127.0.0.1:8090/v1/rerank` → 拒绝（not_http）；导入携带 `http://10.0.0.5:8090/v1/rerank` → 拒绝（not_loopback），与手输同判。
- **order 归一穿透**：快切栏把 `agg:3f2b...` 拖到 google 前并隐藏 bing → `setSourceOrder`/`setSourceHidden` 经 source-graph-store 归一时带聚合定义集，agg id 存活；即便 rerank endpoint 随后被清空（eligibility 翻 false），重写也不剥落它——恢复配置后排序如初。

## Related

- Plan：`docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md`（完整规格：R1–R13 / KTD1–KTD18 / AE1–AE10）
- [Aggregate engine members run without the agent-only engineSearchEnabled gate](./engine-extraction-for-user-initiated-aggregate.md) — ④ 的门控子决策（engine 成员不走 engineSearchEnabled）
- [Provider instance multi-config model](./provider-instance-multi-config-model.md) — ② 显式分歧的对照面（独苗保护三件套，聚合全不采用）
- [Persistent source order and visible projection](./persistent-source-order-and-visible-projection.md) / [Source group layout layer](./source-group-layout-layer.md) — ⑤ 所穿透的 source 图分层
- [Site-engine-third-source and safe persistence](./site-engine-third-source-and-safe-persistence.md) — 实例管线安全持久化三不变量的先例
- [Aggregate rerank documents poisoned by display-metadata snippets](../logic-errors/aggregate-rerank-metadata-snippet-sink.md) — 扇出之后的 merge/rerank 阶段质量 bug
