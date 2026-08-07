---
title: v1.4.0 发版预备的六条 CWS 文案与工作流经验
date: 2026-08-07
last_updated: 2026-08-07
category: workflow-issues
module: cws-release-submission
problem_type: workflow_issue
component: documentation
severity: medium
applies_when:
  - "Preparing a Chrome Web Store release submission"
  - "Writing or editing CWS privacy questionnaire or store listing copy"
  - "Editing GitHub Release notes for an already-published release"
  - "Auditing privacy.md or provider docs against actual code behavior"
symptoms:
  - "Existing doc said brand-name enumeration is always rejected; v1.3.0 proved <=3 names plus 等 passes CWS keyword-spam review"
  - "Privacy questionnaire section 1 (single purpose) exceeded the 1000-char limit after adding AI/custom engine descriptions"
  - "privacy.md section 4(3) described toolbar repositioning under top mode; code shows repositioning happens in inline mode only"
  - "Provider list in docs omitted stepfun-plan and doubao-global variants and misdescribed instances as separate accounts"
  - "gh release edit --notes-file silently dropped the release's attached ZIP asset"
root_cause: inadequate_documentation
resolution_type: documentation_update
related_components:
  - development_workflow
  - tooling
tags:
  - cws
  - chrome-web-store
  - release-notes
  - privacy-questionnaire
  - store-listing
  - gh-release
  - provider-instances
  - documentation-audit
---

# v1.4.0 发版预备：六条 CWS 文案与工作流经验

## Context

v1.4.0 发版预备是一次"以已过审版本为基线、用代码事实校准商店文档"的集中修整。v1.3.0 曾因商店说明枚举 6+ 引擎名（"Google, Bing, Baidu, Bilibili, Douyin, and Xiaohongshu"）被 CWS 以关键字垃圾（Yellow Argon）拒绝，此后 `cws-listing-copy-submission-constraints.md` 立下「商店说明不枚举品牌名」的纪律。但本次预备暴露出这条纪律过于绝对——v1.3.0 过审版本实际用了"聚合baidu、bing和Google等传统搜索引擎"（3 个品牌名 + "等"），而 v1.4.0 又新增了 AI 对话引擎、自定义引擎、provider 实例等能力，使单一用途声明撑爆 1000 字符上限，并把隐私问卷与商店说明两套文案搅在一起。

同时，一次 oracle 驱动的代码落地准确度审计发现隐私问卷与公开政策里对 SERP 快切栏样式注入模式的描述与代码相反——审核员真机切换到 top 模式会看到工具栏并未被位移，与文档矛盾。发版过程中还撞到 `gh release edit` 静默丢弃已附资产的问题，且 provider 实例的术语在文档里被误述为"不同账号"。六条经验彼此独立但同出一轮发版，记录如下以防再次踩坑。

## Guidance

### 1. 商店说明的品牌枚举阈值是「≤3 个 + 等」，不是「零枚举」

`cws-listing-copy-submission-constraints.md` 现有第 1 条说「商店说明字段里不写品牌/引擎名枚举」，这是 v1.3.0 被拒后的矫枉过正。实测阈值是：

- **≤3 个品牌名 + "等"** → 过审，且利于 SEO（用户按品牌名搜索时命中商店说明）。
- **6+ 个品牌名** → 触发关键字垃圾判罚，被拒。

v1.4.0 商店说明（`docs/assets/store/cws-release.md`）按此阈值分三类各列 3 个 + 等：

> AI 对话引擎：把 ChatGPT、DeepSeek、Gemini 等 AI 对话站点当作搜索引擎……
> 统一搜索入口：聚合 Google、Bing、百度等传统搜索引擎……
> AI 搜索接口：把 Tavily、Exa、Stepfun 等 AI 搜索能力变成可直接使用的搜索页……

应把现有纪律的「不枚举」修正为「≤3 + 等可接受且利于 SEO；6+ 是 spam」。

### 2. 隐私问卷四节全部 1000 字符上限，不只 §4

现有 `cws-listing-copy-submission-constraints.md` 只提到 §4 主机权限理由限 1000 字符（标注 ~981）。实际四节都限 1000：

- §1 Single Purpose — 1000 字符
- §2 storage 权限 — 1000 字符
- §3 downloads 权限 — 1000 字符
- §4 host permissions — 1000 字符

v1.4.0 在 §1 加入 AI 对话引擎 + 自定义引擎 + provider 实例 + provider 变体后，单一用途声明从 ~1227 字符一路压到 988（1227→1113→988）。压缩纪律：**量全部四节，不只 §4**；压缩靠砍冗余限定词与合并并列（如 "Provides a"→"Unified"、"user-defined"→""、"user-saved"→""、"of their own"→""），**绝不砍审核关键披露与品牌/宿主枚举**——后者在隐私问卷里是必须披露项，与商店说明（鼓励概括）相反。

### 3. CWS 文档准确度审计：样式注入模式描述必须与代码一致

隐私问卷 `privacy.md` §4(3) 原写 "top: repositions Baidu/Douyin toolbars"，但代码（`entrypoints/serp-bar.content.ts:96-119` `applyPositionChrome`）的实际行为是：

- `inline` 模式 → `injectPageStyles(state.engine)` → 注入百度/抖音的 `PAGE_STYLES`（位移引擎自身工具栏）；移除覆盖层垫高
- `top` 模式 → `removePageStyles()` + `injectTopPadStyles()` → 移除引擎样式，页面顶部垫高
- `bottom` 模式 → `removePageStyles()` + `injectBottomPadStyles()` → 移除引擎样式，页面底部垫高

即工具栏位移发生在 **inline 模式**，不是 top 模式。修正为 "(inline: repositions Baidu/Douyin toolbars; top/bottom: pads page)"（`privacy.md:27` 现状）。中文公开政策 `privacy-policy.md` §6 本就写对（"内联模式……位移……覆盖层模式……内边距"，`privacy-policy.md:134`），英文版 `privacy-policy.md:59` 也已正确。

另发现 §1 provider 枚举漏了 2 个变体（stepfun-plan、doubao-global）——风险低（宿主共享且已披露），但技术上不完整。修正把 "Stepfun, Jina, Doubao" 改为 "Stepfun (REST + MCP), Jina, Doubao (web + global)"。

### 4. `gh release edit` 静默丢弃已附资产

`gh release edit v1.4.0 --notes-file <file>` 会静默丢弃该 Release 已附的资产（dev ZIP）。资产在 edit 后从 Release 页面消失。本轮连撞两次（一次更新为双语 notes、一次精修 notes）。修复纪律：**`gh release edit` 之后必须补跑 `gh release upload v1.4.0 <dev-zip> --clobber`** 把资产重新挂回。

### 5. provider 实例 = 调好参数的变体，不是账号

provider 实例（见 `docs/plans/2026-08-02-001-provider-instances-plan.md` 与 `provider-instance-multi-config-model.md`）是同一 provider 的调参变体——例如 Exa "AI 研究"（category=publication, includeDomains=[arxiv.org]）对 "创业资讯"（category=news）。它们**共享同一把 API key**（计划 R7：「API key 仍 per-provider-type 共享」），不是不同账号（不同账号需不同 key）。术语修正：把 "如不同账号或参数" 改为 "如不同搜索场景或过滤方向"。

且只有 Exa 与豆包支持 per-instance options（`lib/provider-instances.ts:32-35` `PROVIDERS_WITH_INSTANCE_OPTIONS = new Set(['exa', 'doubao'])`）。商店说明原写 "每个服务" 是 overclaim，修正为 "支持的服务（如 Exa、豆包）"。

### 6. GitHub Release notes 与 CWS 商店说明是两份产物

GitHub Release notes（双语、经用户审定、附在 GitHub Release 上）与 CWS 商店说明（`docs/assets/store/cws-release.md`，CWS Developer Dashboard 填表文档）是**两份独立产物**。`chrome-extension-release-process.md` 已把它们分为两步（步骤 7 = GitHub Release，步骤 9 = CWS），但本轮一度把改给 CWS 说明的文案误贴进 Release notes、反之亦然。纪律：**两份产物分轨编辑，不要把一方的改动落到另一方**。

## Why This Matters

- **审核被拒是可量化代价**：CWS 排队有周期，一次被拒就要改写、重提、重排，v1.3.0 正因此多走一轮。品牌枚举阈值若被记成「零枚举」，会让本可利于 SEO 的 ≤3+等 写法被误删，文案变干瘪又无收益；若记成「随便枚举」又会重蹈 6+ spam 被拒。精确阈值才能既过审又利于发现。
- **四节字符上限漏量 = 现场返工**：只量 §4 会在 §1 写到 1227 字符时才撞限，发版夜现场压缩既慢又易砍错（砍掉披露或枚举反而埋下 misleading-description 隐患）。
- **模式描述与代码相反会过不了真机核对**：CWS 审核员会真机切换栏位核对。若文档说 top 位移工具栏、代码却在 inline 位移，审核员切到 top 看到工具栏纹丝不动，即判文档不实——与 v1.3.0 的 keyword-spam 同属可直接致拒的文档类问题。
- **`gh release edit` 丢资产是静默故障**：不补跑 `--clobber` 上传，自托管用户拉到的 Release 会缺 dev ZIP，且无报错，靠用户反馈才发现。
- **实例术语误述会误导实现**：若文档把实例当账号，实现者会去给实例配独立 key，破坏 BYOK 单一 key 共享模型与 `ProviderId`/`ProviderInstanceId` 边界纪律（R8）。
- **双产物混淆造成漂移**：Release notes 与商店说明各服务不同读者（GitHub 用户对 CWS 审核员），混编会让审核员看到不该出现在商店的措辞，或让 GitHub 用户看到面向审核的填表语言。

## When to Apply

- 每次向 Chrome Web Store 提交新版本或修改商店说明文案时（套用品牌枚举阈值 §1）
- 写或改隐私问卷任一节权限理由时（量全部四节字符数，按「砍冗余限定词、保披露与枚举」压缩 §2）
- 任何描述 SERP 快切栏栏位行为（inline/top/bottom）的商店文档或隐私文档落笔时（对照 `serp-bar.content.ts` `applyPositionChrome` 校准 §3）
- 用 `gh release edit` 修改已发布 Release 的 notes 时（edit 后必补 `gh release upload --clobber` §4）
- 写或审涉及 provider 实例的文档/文案时（实例 = 调参变体、共享 key、仅 Exa 与豆包支持 §5）
- 同一轮发版既改 GitHub Release notes 又改 CWS 商店说明时（分轨编辑 §6）

## Examples

### 1. 品牌枚举：6+ 被拒 → ≤3+等 过审

**Before（v1.3.0 被拒）**：商店说明枚举 "Google, Bing, Baidu, Bilibili, Douyin, and Xiaohongshu"（6 个），CWS 判「关键字垃圾」。

**After（v1.4.0 过审基线，`docs/assets/store/cws-release.md:17,19,21`）**：每类 3 个 + 等：

> 聚合 Google、Bing、百度等传统搜索引擎……
> ChatGPT、DeepSeek、Gemini 等 AI 对话站点……
> Tavily、Exa、Stepfun 等 AI 搜索能力……

### 2. §1 Single Purpose 压缩 1227 → 988

**Before（1227 字符，超限）**：加入 AI 对话引擎 + 自定义引擎 + provider 实例 + 变体后，限定词堆叠（"Provides a"、"user-defined"、"user-saved"、"of their own"）。

**After（988 字符，`docs/assets/store/privacy.md:11`）**：砍冗余限定词与合并并列，保留全部审核关键披露与品牌/宿主枚举。例如 "Provides a Unified search interface…" → "Unified search interface…"，保留 "conventional web search engines (Google, Bing, Baidu, …)"、"AI conversation engines (ChatGPT, DeepSeek, Gemini, …)"、"AI search APIs (Tavily, Exa, …, user's own keys)" 等枚举，并保留 "All data stays in `chrome.storage.local`" 类安全披露。

### 3. 模式描述：top 位移（错）→ inline 位移（对）

**Before（错）**：`privacy.md` §4(3) 写 "top: repositions Baidu/Douyin toolbars"。

**代码事实（`entrypoints/serp-bar.content.ts:99-115`）**：

```ts
if (pos === 'inline') {
  removeBottomPadStyles(); removeTopPadStyles();
  injectPageStyles(state.engine);   // ← 位移百度/抖音工具栏
} else {
  removePageStyles();                // ← 移除引擎样式
  if (pos === 'bottom') { injectBottomPadStyles(); }   // ← 底部垫高
  else { injectTopPadStyles(); }                        // ← 顶部垫高
}
```

**After（对，`privacy.md:27`）**：

> (inline: repositions Baidu/Douyin toolbars; top/bottom: pads page)

中文 `privacy-policy.md:134` 本就正确："内联模式在百度与抖音上仅位移引擎自身工具栏,覆盖层模式(顶部/底部)则为页面添加对应方向的内边距"。

### 4. `gh release edit` 丢资产 → 补 `--clobber`

**Before（丢资产）**：

```bash
gh release edit v1.4.0 --notes-file release-notes.md
# Release 页面的 dev ZIP 消失，无报错
```

**After（补传）**：

```bash
gh release edit v1.4.0 --notes-file release-notes.md
gh release upload v1.4.0 juso-search-1.4.0-chrome-dev.zip --clobber
```

### 5. 实例术语与 overclaim 修正

**Before（错）**：文档称实例为 "如不同账号或参数"；商店说明称 "每个服务"可建实例。

**After（对）**：实例为 "如不同搜索场景或过滤方向"（共享同一 key，R7）；商店说明改为 "支持的服务（如 Exa、豆包）"。代码门控事实（`lib/provider-instances.ts:32-35`）：

```ts
export const PROVIDERS_WITH_INSTANCE_OPTIONS: ReadonlySet<ProviderId> =
  new Set<ProviderId>(['exa', 'doubao']);
```

### 6. 双产物分轨

**Before（混）**：本欲改 CWS 商店说明，却把改动落到 GitHub Release notes；反之亦然。

**After（分轨）**：GitHub Release notes（双语、用户审定、附 Release）与 `docs/assets/store/cws-release.md`（CWS 填表主版）分开编辑，各服务各读者，不交叉落盘。

## Related

- [cws-listing-copy-submission-constraints.md](./cws-listing-copy-submission-constraints.md) — 本经验第 1、2 条直接修正/补充其「不枚举品牌名」（应改 ≤3+等 可接受）与「§4 1000 字符」（应扩为四节皆限）；建议 refresh 时并入
- [chrome-extension-release-process.md](./chrome-extension-release-process.md) — 双版本发布全流程；本经验第 4、6 条补充其步骤 7（GitHub Release，`gh release edit` 丢资产）与步骤 9（CWS，双产物分轨）
- [cws-store-docs-must-sync-with-release-features.md](./cws-store-docs-must-sync-with-release-features.md) — 商店三件套随版本同步审计；本经验第 3 条是其代码落地准确度的具体实例（模式描述与 `serp-bar.content.ts` 对齐）
- [provider-instance-multi-config-model.md](../architecture-patterns/provider-instance-multi-config-model.md) — provider 实例模型权威；本经验第 5 条术语（实例=调参变体、共享 key、`PROVIDERS_WITH_INSTANCE_OPTIONS`）以此为准
- [default-off-capability-gating-for-cws-compliance.md](../architecture-patterns/default-off-capability-gating-for-cws-compliance.md) — 隐私问卷文案背后的代码门控事实（审核员真机核对一致）
