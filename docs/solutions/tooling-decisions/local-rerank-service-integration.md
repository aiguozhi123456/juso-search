---
title: "Local rerank service integration: full /v1/rerank URL, warm-up before first aggregate search, teacher model over mini for Chinese"
date: 2026-09-13
category: tooling-decisions
module: "Aggregate search rerank config / local reranker-server integration"
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - "Configuring rerankConfig endpoints against the local reranker-server (full URL including the /v1/rerank path; the client does not auto-complete it)"
  - "Running the first aggregate search after reranker-server startup with a 10s client timeout and a cold teacher model that loads in ~34s — send a warm-up request first"
  - "Choosing between teacher bge-reranker-v2-m3 and mini-reranker (9.7M student, millisecond latency but fails same-pattern distractors)"
  - "Deciding manifest host_permissions for loopback-only local services (zero changes required)"
related_components:
  - lib/aggregate/rerank-client.ts
  - components/AggregateSearchManager.tsx
  - lib/gateway.ts
tags: [aggregate-search, rerank, reranker-server, jina-compatible-api, cohere-api, warmup, cold-start, bge-reranker-v2-m3]
---

# Local rerank service integration: full /v1/rerank URL, warm-up before first aggregate search, teacher model over mini for Chinese

## Context

聚合搜索的外部重排依赖本地 reranker-server（Jina/Cohere 兼容 `/v1/rerank`，两个模型权重随目录打包、拷走即用）。接入过程踩了三类坑：endpoint 填法与 RAG 工具习惯相反、教师模型冷加载远超客户端超时、小模型在中文场景排序翻车。记录为接入清单，配套设置页已加 hint，但排查时仍需知道底因。

## Guidance

### ① endpoint 填全 URL，含 `/v1/rerank` 路径

`rerankDocuments`（`lib/aggregate/rerank-client.ts`）**直接 `postJson(config.endpoint, ...)`，没有任何 `/rerank` 自动补全**。设置页要填：

```
http://127.0.0.1:8090/v1/rerank
```

这与某些 RAG 工具的 base-url 行为不同：reranker-server README 教 RAG 工具填 `Base URL: http://127.0.0.1:8090/v1`（客户端自己拼 `/rerank`），**照抄进本扩展会 404**。已在设置页落地双保险：placeholder 即完整示例（`opts_aggregate_rerank_endpoint_placeholder`），下方常驻 hint（`opts_aggregate_rerank_endpoint_hint`，`components/AggregateSearchManager.tsx` 渲染）明示「需含 /v1/rerank 路径，不会自动补全」。另注意 host 只认 `127.0.0.1`：`localhost`/`[::1]` 会被自动改写，其他地址直接拒绝（loopback 强制）。

### ② 冷加载坑：先预热，否则首次聚合搜索必超时

客户端超时 `RERANK_TIMEOUT_MS = 10_000`（AbortController + setTimeout 与调用方 signal 组合），而 bge-reranker-v2-m3 是**懒加载**——服务进程启动不加载模型，首次请求才加载，实测约 34s。组合结果：服务刚起就发起聚合搜索 → rerank 10s 超时 → `RerankError('network', 'rerank request timed out after 10000ms')`。而设计上 rerank 失败是**硬败不降级**（不回退首现序，宁可让用户看到明确错误去修配置），所以整个聚合搜索直接失败。

服务启动后先发一发预热（顺带即 README 的冒烟测试）：

```bash
curl -X POST http://127.0.0.1:8090/v1/rerank -H "Content-Type: application/json" \
  -d '{"query":"法国的首都","documents":["巴黎是法国的首都","柏林在德国"]}'
```

等到响应回来（首次约 30s+，期间别关服务），后续请求即走热路径（热延迟毫秒级）。设置页的「测试连接」按钮同样会吃冷加载超时——预热后再测。

### ③ 模型选型：中文场景用教师模型

| | bge-reranker-v2-m3（教师） | mini-reranker（学生） |
|---|---|---|
| 体量 | 568M，fp16，CUDA 优先自动回退 CPU | 9.7M，int8 ONNX，纯 CPU |
| 热延迟 | 实测 82ms / 3 docs | 毫秒级 |
| 中文排序 | 正确 | 同句式干扰项翻车 |
| 冷加载 | ~34s（懒加载） | 秒级 |

mini-reranker 的翻车样本：query「法国的首都」，文档对「巴黎是法国的首都」vs「罗马是意大利的首都」——**把罗马排在巴黎前**，中英文皆然。这是同构句式干扰：学生模型学到的是句式级相关（「X 是 Y 的首都」都像答案），分辨不了实体绑定。README 的 NDCG@10 = 0.918 是**真实 SERP 测集**成绩——真实测集里同句式硬负例稀疏，不覆盖这种合成同构干扰，指标好看不等于对抗性场景可靠。聚合搜索的候选池恰是「多源同 query」的高同构环境（同一 query 下各引擎返回的标题句式高度相似），踩的正是这个盲区。**中文场景推荐教师**（`/v1/rerank` 不指定 `model` 时服务端默认也是教师）；mini 只适合纯英文、低延迟要求、候选差异大的场景。

### ④ 分数语义：`relevance_score = sigmoid(logit) ∈ (0,1)`

服务端返回的 `relevance_score` 是 sigmoid 压到 (0,1) 的概率型分数，越高越相关；客户端按服务端顺序取 `results`，调用方（`applyRerankOrdering`）按分数降序稳定排序后写入 `result.score`，UI 渲染为百分比。解读要点：这是**绝对相关度**不是排名分——0.9+ = 语义强匹配（web 摘要常客），0.4–0.6 = 弱匹配（标题较泛），0.00x = 无文本信号（如 '(无标题)' 笔记，见 [aggregate-rerank-metadata-snippet-sink](../logic-errors/aggregate-rerank-metadata-snippet-sink.md)）；跨 query 比较分数无意义，同 query 内看相对高低。另注意 sigmoid 两端饱和：无关对照不是 0 而是 0.0002 这类极小正数。

### ⑤ 云端白名单：硅基流动 rerank 端口

KTD12 校验已从 loopback-only 扩为双分支白名单（`validateRerankEndpoint`，`lib/aggregate/rerank-client.ts`）：除 `http://127.0.0.1` 外，还接受 `https://api.siliconflow.cn`（host 精确匹配，其他 https host 一律拒绝 not_loopback）。硅基流动的 `/v1/rerank` 与本客户端的 Cohere/Jina 风格协议完全兼容，配置要点：

- endpoint 填全 URL：`https://api.siliconflow.cn/v1/rerank`（同样不会自动补全路径，见 ①）；
- apiKey 必填（云端 BYOK，Bearer 鉴权；本地服务才可留空）；
- `model` 用户自行填写（如 BAAI 系 reranker），客户端不预设也不在 UI 提示；
- manifest `host_permissions` 已声明 `https://api.siliconflow.cn/*`（wxt.config.ts）。



- **endpoint 填法是第一大接入失败源**：404 的表象（`provider` 错误分型）不会指向「少填了路径」，hint 挡新用户，底因记录挡排查者。
- **冷加载 × 硬败设计的交互是隐性定时炸弹**：10s 客户端超时 vs 34s 懒加载，单看两边都合理，组合起来保证首次必败且错误文案（timeout）误导向「服务没起」。预热一步是运维契约，写进文档才算完整。
- **模型选型错会静默伤排序质量**：mini 快且指标好看，但聚合场景的同构干扰恰在其盲区——不点破 NDCG 测集的覆盖边界，下一个接入者还会选错。
- **分数语义统一团队解读**：sigmoid 分数不是百分比置信度也不是排名分，UI 渲染为百分比时尤其要全员知道它的绝对语义与饱和特性。

## When to Apply

- 配置/排查 rerank endpoint 或「测试连接」失败时（① + ②）
- 本地部署 reranker-server、选 `model` 或解释为何默认教师时（③）
- 解读聚合结果卡百分比、写消费 `result.score` 的代码时（④）
- 给其他 Cohere/Jina 风格 rerank 端点写新客户端、决定「全 URL vs base-url」契约时（① 的反面教材）

## Examples

- **正确配置**：endpoint `http://127.0.0.1:8090/v1/rerank`，model 留空（服务端默认教师）或 `bge-reranker-v2-m3`，apiKey 留空（本地服务无鉴权；有代理鉴权时才填）。
- **错误配置与症状**：endpoint 填 `http://127.0.0.1:8090/v1`（照抄 RAG 工具 base URL）→ 404，错误分型 `provider`；endpoint 填 `http://localhost:8090/v1/rerank` → 可用，保存后提示已自动改写为 127.0.0.1；服务刚起立即聚合搜索 → `rerank request timed out after 10000ms`，预热后自愈。
- **同构干扰复现**：`{"query":"法国的首都","documents":["罗马是意大利的首都","巴黎是法国的首都"]}` 交给 mini-reranker → index 0（罗马）分数更高；交给教师 → 巴黎显著更高。一行 curl 即可复验选型结论。

## Related

- Plan：`docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md`（超时 / loopback / 协议 / 不降级设计）
- [Aggregate rerank documents poisoned by display-metadata snippets](../logic-errors/aggregate-rerank-metadata-snippet-sink.md) — 分数解读（④）的下游故事
- [Agent skill localhost capability bridge](../architecture-patterns/agent-skill-localhost-capability-bridge.md) — 另一条 loopback 边界设计的先例
- [Per-provider config worker injection](../architecture-patterns/per-provider-config-worker-injection.md) — rerankConfig 的 worker-only 读写先例
