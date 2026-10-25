---
title: "Jev/SystemOne decision-model rerank: listwise wire format, char-budget chunking, noul score semantics"
date: 2026-10-25
last_updated: 2026-10-25
category: tooling-decisions
module: "Aggregate search rerank config / TypeSafe SystemOne (jev) protocol integration"
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - "Choosing the rerank protocol (cohere-style /v1/rerank vs jev/SystemOne) or interpreting jev noul scores"
  - "Debugging jev rerank failures: parse errors from answers validation, 30s timeout, max_tokens_exceeded split-retry"
  - "Extending the rerank endpoint whitelist to a new cloud host (api.typesafe.ai precedent)"
related_components:
  - "lib/aggregate/rerank-client.ts"
  - "lib/aggregate/types.ts"
  - "components/AggregateSearchManager.tsx"
  - "lib/gateway.ts"
  - "wxt.config.ts"
tags:
  - "aggregate-search"
  - "rerank"
  - "jev"
  - "systemone"
  - "typesafe"
  - "listwise"
  - "noul"
  - "endpoint-whitelist"
---

# Jev/SystemOne decision-model rerank: listwise wire format, char-budget chunking, noul score semantics

## Context

用户提出接入「jev 类模型」作为重排模型（"one system 模型"）。这个词在仓库里 grep 不到，语义也含混——调研后确认：Jev 是 TypeSafe.AI 的决策模型（实际模型名 SystemOne，默认模型 id `jev-latest`），不做文本生成——输入 passage + 类型化问题，输出类型化判断 + 校准到 0–1 的概率。社区把它当搜索/RAG reranker 用（hotchpotch/jev-reranker Python 库、Elastic Search Labs 基准），走云端 API `https://api.typesafe.ai/v1/systemone`，Bearer key 鉴权。

关键判断：现有 rerank 阶段只讲 Cohere/Jina 风格 `/v1/rerank`（见 [local-rerank-service-integration](local-rerank-service-integration.md)——loopback + api.siliconflow.cn 白名单、bge cross-encoder）。Jev 的 listwise 线格式与之根本不同：不是 `documents: string[]` 数组 + `results` 数组，而是共享 `state` + 逐文档 `questions` + `answers` 对象。所以这是**接入第二协议，不是加一个模型名**——判别必须落在配置结构上，而不是靠 endpoint 字符串猜测。本文记录五条接入要点与两类测试教训。

## Guidance

### ① 协议判别字段 `protocol`，全写语义 + 只认 `'jev'` 落盘

`RerankConfig`（`lib/aggregate/types.ts`）加判别字段：

```ts
export type RerankProtocol = 'cohere' | 'jev';
export interface RerankConfig {
  endpoint: string;
  model?: string;
  apiKey?: string;
  protocol?: RerankProtocol;  // 缺省即 cohere
}
```

`normalizeRerankConfig`（`lib/aggregate/rerank-client.ts`）**只把 `'jev'` 落盘**，缺省/其他值一律剥掉（= cohere 缺省）：

```ts
const protocol = candidate.protocol === 'jev' ? 'jev' as const : undefined;
```

旧存储、旧导出文件里没有这个键 → 读回来就是 cohere，**零迁移**。`rerankDocuments` 按它分发：`config.protocol === 'jev'` 走 jev 路径，否则 cohere。

协议字段与 `model` 一样是**全写（full-write）语义**——`handleSetRerankConfig`（`lib/gateway.ts`）整份覆写配置，不携带 = 回到缺省。这直接推导出 clearApiKey 的契约：清除 key 是对已存配置的**重发**（带 `apiKey: ''`），重发必须携带快照里的 protocol，否则清 key 这一下会顺手把 jev 静默重置回 cohere：

```ts
// components/AggregateSearchManager.tsx clearApiKey()
const reply = await sendMessage('setRerankConfig', {
  endpoint: validation.endpoint,
  ...(snapshotModel ? { model: snapshotModel } : {}),
  ...(snapshotProtocol === 'jev' ? { protocol: 'jev' as const } : {}),
  apiKey: '',
});
```

这是一类真实 bug 模式：**merge 形端点上的全写字段**——端点接受部分字段并整份落盘时，任何「只想改一个字段」的调用方都必须带上全部全写字段的快照值。以后再加全写字段（第三个协议、更多开关）时，clearApiKey 的重发清单要同步扩。

### ② listwise 线格式：共享 state + 逐文档 noul 问题

一次请求带 query + 全部候选文档（放共享 `state`，键为 `doc_N` 块内局部下标），每文档一条 noul 问题：

```json
{
  "model": "jev-latest",
  "state": { "query": "…", "documents": { "doc_0": "…", "doc_1": "…" } },
  "questions": {
    "doc_0": { "type": "noul", "instructions": "Does `documents.doc_0` help answer `query`? Prefer passages with the specific facts needed.", "criteria": { "true": "…", "false": "…" } }
  }
}
```

响应：`{ "answers": { "doc_0": { "type": "noul", "noul": 0.83 } } }`。

要点：

- **`model` 必填**（cohere 侧可选）——`config.model ?? JEV_DEFAULT_MODEL`，缺省 `jev-latest`（对齐 jev-reranker 缺省）。设置页 model 留空即用默认。
- instructions preset 照搬 jev-reranker 的 `RERANK_INSTRUCTION`，其中 `{document}` 占位替换为 `` `documents.doc_N` `` 引用。**必须用函数形态 `String.replace`**：

  ```ts
  JEV_RERANK_INSTRUCTIONS.replace('{document}', () => `\`documents.${jevDocKey(localIndex)}\``)
  ```

  字符串替换第二个参数若含 `$` 序列（`$&`、`$1`…）会被 replace 重解释；函数形态原样返回。
- **排序用途不要用库里的 relevance preset**——它是带数字锚点的过滤型 prompt（判断「是否相关」的阈值筛选），排序分辨力差于 RERANK_INSTRUCTION。
- **SystemOne 没有 `top_n`**。topN 截断保持在调用方 `applyRerankOrdering`（`lib/gateway.ts`），对两协议统一处理——不要在 jev 请求体里造这个参数。
- 响应收紧到 parse 分型（`validateJevAnswers`）：`answers` 键必须与 `doc_0..doc_N-1` 一一对应（越界键、缺失条目都算 parse）、每条 `type === 'noul'`、`noul` 是 [0,1] 内的有限数。

### ③ 分块上限 + `max_tokens_exceeded` 拆分重试 + 30s 超时

单请求防御性上限：**≤20 篇文档、文档总字符 ≤20k**（`JEV_CHUNK_MAX_DOCS` / `JEV_CHUNK_MAX_DOC_CHARS`）。候选池 40 篇 × ~550 字符摘要 ≈ 22k 字符，通常一个请求就装得下——上限纯防御，防的是候选池/文档上限日后调整后超大请求拖垮费用与延迟。

云端对超限请求返回 400/422 + `detail.error_type === "max_tokens_exceeded"`，这是**拆分重试信号，不是终态**。识别必须看**原始响应体**：`lib/providers/http.ts` 的脱敏 `errorDetail` 只保留 message 型键值，带不可靠 `error_type`。所以 jev 路径不走 `postJson`，自建 `postJev` fetch（脱敏/映射仍复用 http.ts 链：`extractProviderErrorDetail` + `mapStatus`，前者为此从 http.ts 导出）：

```ts
function isJevMaxTokensExceeded(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { detail?: { error_type?: unknown } } | null;
    return parsed?.detail?.error_type === 'max_tokens_exceeded';
  } catch { return false; }
}
```

命中后对半拆分递归重试（两半 `Promise.all` 并行）；单文档仍超限 → 按状态码抛 provider 错，不无限递归。

整体超时 `RERANK_JEV_TIMEOUT_MS = 30_000`，cohere 保持 10s（`RERANK_TIMEOUT_MS`）——云端生成式逐文档判断对整个候选池，远慢于本地 cross-encoder 热路径；AbortController + 外部 signal 组合语义两协议一致。

### ④ 分数语义：noul 即 relevance_score，复用整条排序管线

noul 是 (0,1) 内的**绝对相关概率**，与 bge cross-encoder 的 sigmoid 分数同语义。现有 `applyRerankOrdering` 管线（降序稳定排序、写 `result.score`、UI 渲染百分比）**原样复用，一行不改**——这正是把 jev 响应归一成 `RerankResultItem[]`（documents 下标 + 分数）的回报：协议差异被吸收在客户端内，下游全协议共享。

一个行为差异要知道：jev 分数来自逐文档独立判断的概率，**并列分比 ranking logits 更常见**。稳定排序保证并列时保持候选原序，不抖动。

### ⑤ endpoint 白名单第三分支 + 显式协议下拉（不做 host 推断）

`validateRerankEndpoint`（`lib/aggregate/rerank-client.ts`）扩为三分支白名单，`wxt.config.ts` 的 manifest `host_permissions` 同步声明 `https://api.typesafe.ai/*`：

- `http + 127.0.0.1`（loopback，本地威胁模型）
- `https + api.siliconflow.cn`（host 精确匹配）
- `https + api.typesafe.ai`（host 精确匹配，jev 官方云端）

设置页用**显式协议下拉**（cohere/jev `<select>`），不做基于 host 的自动探测。原因：loopback host 无法声明自己讲什么协议——`http://127.0.0.1:8090` 既可以是大模型 host 的 cross-encoder 服务，也可以是 SystemOne 兼容服务，host 相同协议不同；自动探测会让本地 SystemOne 服务**静默走错协议**（表象是 parse 错误，指向性为零）。协议是用户声明的事实，不是可推断的属性。

## Why This Matters

- **判别字段 vs host 猜测**：把协议落在 `RerankConfig.protocol` 上，旧数据零迁移、UI 显式可控、错误分型可归因。若按 endpoint 字符串猜协议，每加一个 host 就要改推断逻辑，且 loopback 场景根本无从猜起。
- **全写语义漏带 = 静默配置损坏**：clearApiKey 不带 protocol，用户清一次 key，jev 就静默变 cohere——下次搜索直接 parse 失败（SystemOne 返回 `answers`，cohere 校验找 `results` 数组），错误指向「协议不兼容」而真实根因是「清 key 重置了协议」。全写字段是契约，不是可选优化。
- **拆分重试信号藏在原始体里**：脱敏 errorDetail 的设计初衷是不把服务端任意字段透给上层，代价是结构化错误信号（`error_type`）丢失。若在脱敏层判断，要么扩大脱敏白名单（安全回退），要么永远把超限当终态错误（功能残废）。jev 专路 fetch + 复用脱敏链是两边都成立的折中。
- **超时是协议属性不是全局常数**：30s vs 10s 不是拍脑袋——本地 cross-encoder 毫秒级热路径与云端生成式逐池判断差两个数量级，共用 10s 会让 jev 首次使用必超时（与本地 reranker 冷加载坑同构，见 local-rerank-service-integration ②）。
- **排序管线复用 = 语义一致**：noul 与 sigmoid 同为绝对概率，UI 百分比、分数解读、跨文档相对比较的既有文档全部继续成立，不产生第二套分数语义的认知负担。

## When to Apply

- 给 RerankConfig 排障：jev 配置下搜索报 parse「missing a results array」→ 大概率协议被重置回 cohere 或协议选错（① + ⑤）
- 给 clearApiKey / 配置导入等「部分更新」路径加字段时：先盘点全写字段清单（①）
- 对接 SystemOne 兼容端点（云端或本地）时：线格式、model 必填、占位替换、无 top_n（②）
- 调 jev 超大候选池失败/费用问题时：分块上限、拆分重试、原始体信号（③）
- 解读聚合卡百分比、对比 jev 与 bge 分数时（④）
- 新增白名单 host 或新的 rerank 云端服务时（⑤）

## Examples

**云端配置**（jev 协议官方端点）：endpoint `https://api.typesafe.ai/v1/systemone`（全 URL 含路径，不自动补全——与 cohere 侧同一契约），apiKey 填 TypeSafe key，model 留空 → `jev-latest`，protocol 选 jev。

**本地配置**：endpoint `http://127.0.0.1:8090/v1/systemone`（SystemOne 兼容服务的实际路径），protocol 选 jev，apiKey 留空。

**错误配置与症状**：

- endpoint 按 base-url 习惯填 `https://api.typesafe.ai/v1` → 404，错误分型 `provider`（rerank 客户端不拼路径）。
- protocol 留 cohere 但 endpoint 指向 SystemOne 服务 → 响应无 `results` 数组，parse 错误 `rerank response is missing a results array`。
- jev 配置下报同款 parse 错 → 检查协议是否被 clearApiKey 重置（见 ①）。

**拆分重试的真实形状**（`tests/jev-rerank-client.test.ts`）：3 篇文档对半 = `[0]`（1 篇）+ `[1,2]`（2 篇）——`Math.floor(3/2)=1`，**mock 必须按这个切分期望两个请求**（首请求 400 + `max_tokens_exceeded`，随后两半并行）；期望 `[0,1] + [2]` 会测错实现。

**UI 测试教训**：聚合卡新增协议 `<select>` 后，`screen.getByRole('combobox')` 出现歧义（页面上同 role 元素从 1 变 2，10 个既有测试爆「Found multiple elements」）。修法是把 role 查询圈定到所属 section：`within(document.querySelector('[data-section="search-source"]')).getByRole('combobox')`（`tests/options-page.test.tsx` 的 `sourceSelectScope`）。同类教训：往设置页加任何同 role 控件前，先给既有 screen 级 role 查询加 scope。

**上架文案同步**：`docs/assets/store/privacy.md` §4 的 provider-API host 清单加了 `api.typesafe.ai`——该字段限 1000 字符，加入前实测 ~997，同步压缩了措辞（`www.doubao.com`→`doubao.com`、`MCP calls only 'web_search'`→`(MCP: web_search)` 等）后回到限内（\n 连接口径实测 ~994）。改 host 清单时先量字符再落笔。

## Related

- [Local rerank service integration](local-rerank-service-integration.md) — cohere 协议侧的接入清单（endpoint 全 URL、预热、模型选型、sigmoid 分数语义），本文的协议姊妹篇
- [Aggregate rerank documents poisoned by display-metadata snippets](../logic-errors/aggregate-rerank-metadata-snippet-sink.md) — `result.score` 解读的下游故事（协议无关：jev 的 listwise 问题问的是同一批合并文档）
- Plan：`docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md`（超时 / 白名单 / 不降级设计）
- 上游参考：hotchpotch/jev-reranker（线格式与 preset 单源）；Elastic Search Labs《Using Jev as a search reranker》
- `tests/jev-rerank-client.test.ts` — 分块/拆分重试/线格式的行为锁
- 文档同步注记：CONCEPTS.md 的 Rerank Config 条目本次重写——旧文滞留「loopback-only」，甚至早于硅基流动分支就过时了；接第二协议时顺带完成了这轮领域词汇的陈旧度清扫
