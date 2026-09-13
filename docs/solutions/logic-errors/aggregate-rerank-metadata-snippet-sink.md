---
title: "Aggregate rerank documents poisoned by display-metadata snippets: social-engine members sink to the bottom"
date: 2026-09-13
category: logic-errors
module: "Aggregate search rerank / social engine extractors"
problem_type: logic_error
component: service_object
severity: medium
symptoms:
  - "Aggregate-search rerank sinks xiaohongshu/bilibili/douyin engine-member results to the bottom with extremely low scores, even when the title matches the query"
  - "The richer the snippet metadata, the lower the score (bilibili's four-part snippet collapses hardest)"
  - "Web-member results in the same aggregate score normally (real semantic summaries reach 0.9+); the cliff appears only on social members"
  - "Member status shows social members ok:true with normal resultCount — the extraction pipeline is innocent; the fault is in the rerank scoring input"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - lib/aggregate/merge.ts
  - lib/engines/extractors/types.ts
  - lib/engines/extractors/xiaohongshu.ts
  - lib/engines/extractors/bilibili.ts
  - lib/engines/extractors/douyin.ts
  - lib/engine-search.ts
  - lib/providers/types.ts
tags: [aggregate-search, rerank, cross-encoder, snippet-kind, metadata-snippet, rerank-document, engine-extractors]
---

# Aggregate rerank documents poisoned by display-metadata snippets: social-engine members sink to the bottom

## Problem

聚合搜索实例的社媒引擎成员（小红书/哔哩哔哩/抖音）在 rerank 后相关度分数极低、系统性沉底——即使结果标题与 query 高度相关。用户视角：勾了 B站/小红书做聚合成员，搜索「三亚旅游攻略」，社媒结果全部压在列表尾部，分数比无关 web 结果还低。

## Symptoms

- 社媒成员结果 rerank 分数比同聚合的 web 成员低一个量级，标题命中也不救
- 元数据越丰富的结果分数越低（B站四段元数据 snippet 塌得比小红书两段狠）
- 成员状态（`AggregateMemberStatus`）显示社媒成员 `ok: true` 且 `resultCount` 正常——抽取管线无罪
- 只发生在带 rerank 的聚合视图；单独用引擎搜索（引擎直查视图）结果顺序正常（SERP 原序，无 cross-encoder 打分）

## What Didn't Work

1. **怀疑渲染/合并顺序 bug**：查 `mergeAggregateMembers`（首现序去重）与 `applyRerankOrdering`（分数降序稳定排序）——管线无罪，分数本身就是服务端返回的低值，问题在打分输入。
2. **读抽取器锁定嫌疑**：`lib/engines/extractors/{xiaohongshu,bilibili,douyin}.ts` 的 snippet 是**纯展示元数据拼接**（作者/点赞、UP主/播放/弹幕/时长、作者/点赞）——这三家社媒 SERP 卡片没有独立正文摘要可抽，抽取器只能拼元数据（如 `lib/engines/extractors/bilibili.ts` 的 `buildSnippet`）：

   ```ts
   function buildSnippet(item: Element): string {
     const parts: string[] = [];
     const author = clean(item.querySelector('.bili-video-card__info--author')?.textContent);
     if (author) parts.push(`UP主: ${author}`);
     const stats = statItems(item);
     if (stats[0]) parts.push(`播放: ${stats[0]}`);
     if (stats[1]) parts.push(`弹幕: ${stats[1]}`);
     const duration = clean(item.querySelector('.bili-video-card__stats__duration')?.textContent);
     if (duration) parts.push(`时长: ${duration}`);
     return parts.join(' · ');
   }
   ```

   而 `buildRerankDocument`（`lib/aggregate/merge.ts`）恒拼 `title + '\n' + snippet[:512]`，**不分语义**——展示元数据被当正文喂给了 cross-encoder。嫌疑成立但缺定量证据，靠猜改构造函数不可接受。

3. **定罪实验（真实模型定量对照）**：本地起 reranker-server（bge-reranker-v2-m3），query「三亚旅游攻略」7 文档对照：

   | 文档构造 | relevance_score |
   |---|---|
   | web 真实语义摘要 | 0.989 |
   | 小红书 仅标题 | 0.968 |
   | 小红书 标题+元数据 | 0.847 |
   | B站 仅标题 | 0.483 |
   | B站 标题+元数据 | **0.086**（塌 5.6 倍） |
   | 无标题笔记（'(无标题)'）+元数据 | 0.005 |
   | 无关对照 | 0.0002 |

   结论：元数据对 cross-encoder 是纯噪声——标题信号越弱，稀释越致命；无标题笔记 + 元数据几乎无文本信号（0.005）。定罪，动手修。

## Solution

语义标记 + 消费方剔除，7 个源文件（外加测试）：

1. **`lib/engines/extractors/types.ts`** — `EngineResult` 加可选语义标记（缺省 = 语义正文摘要）：

   ```ts
   export interface EngineResult {
     title: string;
     url: string;
     snippet: string;
     /**
      * snippet 语义标记（缺省 = 语义正文摘要）。'metadata' = 纯展示元数据拼接
      * （作者/点赞/播放等，无语义正文）——聚合重排把这类 snippet 剔除出重排文档
      * （buildRerankDocument，用户反馈修复：元数据稀释 cross-encoder 相关度）。
      */
     snippetKind?: 'metadata';
   }
   ```

2. **`lib/providers/types.ts`** — `NormalizedResult` 加同名字段（engine 成员结果经 gateway 直通赋值进聚合响应，字段随 merge 展开透传到重排入口）。

3. **三个抽取器置位** — `lib/engines/extractors/xiaohongshu.ts` / `bilibili.ts` / `douyin.ts` 的返回值带上标记：

   ```ts
   return [{ title, url, snippet, snippetKind: 'metadata' }];
   ```

4. **`lib/engine-search.ts` 消息守卫放宽** — `isResult` 反序列化守卫从「恰好 3 键」放宽为「3 键，或 4 键且第 4 键 `snippetKind === 'metadata'`」，其余（非法 snippetKind 值、5 键）仍整体拒绝：

   ```ts
   function isResult(value: unknown): boolean {
     if (!isRecord(value) || typeof value.title !== 'string' || typeof value.url !== 'string' || typeof value.snippet !== 'string') return false;
     const keys = Object.keys(value);
     // 3 键 = 基础形状（snippet 为语义正文）；4 键 = 基础形状 + snippetKind:'metadata'
     // （纯展示元数据标记，三个社媒抽取器置位，聚合重排据此剔除 snippet——buildRerankDocument）。
     // 其余键数或非法 snippetKind 值一律拒绝（反序列化守卫，畸形不进 worker）。
     if (keys.length === 3) return true;
     return keys.length === 4 && value.snippetKind === 'metadata';
   }
   ```

   不放宽则内容脚本回传的 4 键结果会被判 `extract-failed`，社媒成员全灭。

5. **`lib/aggregate/merge.ts` 消费方剔除** — `buildRerankDocument` 见标记只回 title：

   ```ts
   export function buildRerankDocument(result: Pick<NormalizedResult, 'title' | 'snippet' | 'snippetKind'>): string {
     if (result.snippetKind === 'metadata') return result.title;
     return `${result.title}\n${result.snippet.slice(0, RERANK_DOCUMENT_SNIPPET_MAX)}`;
   }
   ```

6. **测试 +5** — `tests/aggregate-merge.test.ts`（标记剔除为仅 title / 无标记照常拼接 / 旧形状无字段不变）+ `tests/engine-search.test.ts`（4 键合法形状通过 / 非法值与多余键拒绝）。

边界决策：

- **UI 展示保留**：`ResultCard` 照常渲染元数据 snippet（「作者: X · 点赞: Y」对人选卡片有用），修复只作用于重排文档构造，展示与排序解耦。
- **无标题笔记沉底是诚实行为**：小红书无标题笔记以 `'(无标题)'` 占位（`titleText(...) || '(无标题)'`），标记修复后文档 = 仅占位串，无文本信号、分数趋零——不伪造信号救它，不做特殊处理。

## Why This Works

cross-encoder 对 (query, document) 文本对做语义匹配打分。「作者: X · 点赞: 1.2万 · 播放: 952.7万」对 query「三亚旅游攻略」是零语义 token，拼进文档唯一效果是把标题的匹配信号稀释掉（实验：B站 0.483 → 0.086）。根因不是抽取器拼了元数据（SERP 卡片无正文可抽，拼元数据是唯一诚实选择），而是**跨子系统传递的字段没带语义标记，下游消费方（重排文档构造）无从区分「展示用」与「语义正文」**，只能按约定一视同仁地拼接。`snippetKind` 把这个隐式约定显式化：抽取器声明 snippet 的语义类别，消费方按类别构造文档——cross-encoder 只吃语义部分，UI 两部分都吃。守卫放宽是消息协议的配套一致性：字段加了、协议校验不认，等于没加。

## Prevention

- **跨子系统传递的字段要带语义标记，而非靠下游「知道约定」**：同一字段（snippet）在不同消费方（UI 展示 vs cross-encoder 输入）语义不同时，让生产方显式声明（`snippetKind`），消费方按标记分流。
- **为 cross-encoder/嵌入类消费方构造文档时，显式区分展示元数据 vs 语义正文**：展示元数据（计数、作者名、时长）对语义匹配是纯噪声，宁缺勿混。
- **排序质量类 bug 用真实模型做定量对照实验定罪**：7 文档、一次 rerank 调用就产出完整证据链（哪个字段贡献多少、塌几倍），比读代码猜因果快且不可辩驳。本地起配套 rerank 服务成本分钟级。
- **给数据形状加可选字段时，同步审计所有反序列化守卫**：`isExtractionReply`/`isResult` 这类键数精确校验是最容易漏的接缝（本次是 `lib/engine-search.ts`，键数从 3 放宽到「3 或 4 且第 4 键合法」并配了双向测试）。

## Related Issues

- Plan：`docs/plans/2026-09-09-001-aggregate-search-rerank-plan.md`（KTD2 rerank 文档构造）
- [Aggregate engine members run without the agent-only engineSearchEnabled gate](../architecture-patterns/engine-extraction-for-user-initiated-aggregate.md) — engine 成员抽取路径的来龙去脉
- [Engine-search orchestration errors and Baidu URL extraction](./engine-search-orchestration-errors-and-baidu-url-extraction.md) — 同一消息守卫所在管线的错误分型先例
- [Local rerank service integration](../tooling-decisions/local-rerank-service-integration.md) — 分数语义（sigmoid 绝对相关度）与配套服务的运维坑
