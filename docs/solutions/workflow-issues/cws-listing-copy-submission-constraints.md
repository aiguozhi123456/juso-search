---
title: Chrome Web Store Listing Copy & Privacy Questionnaire Submission Constraints
date: 2026-08-01
last_updated: 2026-08-07
category: workflow-issues
module: release
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Submitting a new version to Chrome Web Store review
  - Writing store listing copy that enumerates search engines or services by brand name
  - Drafting privacy questionnaire justifications for permission grants
  - Responding to a CWS rejection for excessive or irrelevant keywords
  - Fitting a permission justification or single-purpose statement into the 1000-character questionnaire limit
  - Auditing privacy.md or store docs against actual code behavior (e.g. SERP bar position modes)
  - Editing GitHub Release notes for an already-published release
tags:
  - cws
  - chrome-web-store
  - store-listing
  - keyword-stuffing
  - privacy-questionnaire
  - character-limit
  - review-rejection
  - release-docs
  - documentation-audit
  - gh-release
  - provider-instances
---

# CWS 发版文案与隐私问卷纪律：品牌名阈值、四节字符上限、代码一致、Release 双产物分轨

> This is the canonical CWS-copy discipline doc. It consolidates the v1.3.0 keyword-spam lessons with the v1.4.0 release-prep code-accuracy audit (formerly a separate doc, now merged here).

## Context

v1.3.0 的发版申请把三个商店文案问题集中暴露在同一轮里，性质各不相同，却出自同一个根因：此前商店文案被当作「信息完整」的枚举清单来写，而不是「过审优先」的填表文案来写。

1. **CWS 审核拒绝（Yellow Argon 关键字垃圾）**：提交被拒，拒绝理由为「产品说明中有过多和/或不相关的关键字」，被点名的违规内容正是说明中枚举的引擎名 "Google, Bing, Baidu, Bilibili, Douyin, and Xiaohongshu"。此前 `cws-store-docs-must-sync-with-release-features.md` 要求「枚举每个受支持引擎」——这条纪律在隐私问卷和隐私政策里是必要的，但在商店说明这种同时面向审核机读与人工审读的字段上，反而触发了关键字垃圾判罚。
2. **storage 权限理由超字符上限**：隐私问卷里 storage 权限理由写了 1086 字符，超过 CWS 1000 字符上限，必须压缩重写才能提交。
3. **冗余双语说明副本**：`docs/assets/store/description.md`（中英双语说明）与 `cws-release.md`（中文填表主版）内容完全重复，仓库零引用，每次改说明都要双写，已出现漂移风险。

三个问题互相纠缠：枚举让说明变长也让它变「像垃圾」，长枚举又让权限理由撑爆字符上限，而副本的存在让每一处修改都要做两遍。修复后，商店文档收敛为一套可复用的填表纪律。

## Guidance

三条核心经验，对应三个问题：

### 1. 商店说明品牌名 ≤3+等，不堆砌（防 keyword spam）

- 商店说明字段里**不堆砌**品牌/引擎名（6+ 个触发关键字垃圾判罚）。但 **≤3 个品牌名 + "等"** 可接受且利于 SEO——v1.3.0 过审版本用了"聚合baidu、bing和Google等传统搜索引擎"（3 个 + 等），v1.4.0 沿用此模式分三类各列 3 个 + 等（"Google、Bing、百度等"、"ChatGPT、DeepSeek、Gemini 等"、"Tavily、Exa、Stepfun 等"）。
- 用类别词概括功能：如「传统搜索引擎」「你已配置的 AI 搜索服务」，而不是逐个点名。**概括不算虚假描述**——扩展确实支持这些类别，概括并未夸大。≤3+等 是概括与可发现性的平衡点。
- 功能亮点写特性本身，不靠品牌名堆砌支撑：例如 SERP 快切栏写「栏位可选『顶部 / 底部 / 自动』，自动模式在窄屏下改为固定底栏」，这是功能特性，不依赖任何品牌名。
- 以已过审版本（v1.2.0）的措辞结构为基线重写：【它解决什么问题】【核心功能】【为谁而做】【隐私与安全】【开源与免费】。已过审的措辞本身就是「什么样的文案能过审」的最佳样本。

### 2. 隐私问卷四节全部 ≤1000 字符，先量后写

- CWS 隐私问卷**四节都限 1000 字符**，不只权限理由：§1 Single Purpose、§2 storage、§3 downloads、§4 host permissions 各限 1000。v1.4.0 在 §1 加入 AI 对话引擎 + 自定义引擎后，单一用途声明从 1227 字符压到 988（见 `privacy.md` §1）。
- 写前先量**全部四节**字符数（中英文都按字符计），不要凭感觉写，也不要只量 §4。
- 压缩有明确优先级：**先砍冗余限定词、合并偏好列举，保留全部审核关键披露与品牌/宿主枚举**。§1 从 1227 → 988 时，删除的是 "Provides a"、"user-defined"、"user-saved"、"of their own" 等冗余限定词；storage 理由从 1086 → 732 时，删除的是 provider 名枚举，偏好项合并为一行概括。安全披露一条不砍：`chrome.storage.local` 仅本机、不同步、不记录；API key 仅由 worker 读取、页面与内容脚本不读；key 仅发往用户所选 provider。

### 3. 商店文档单主版，无副本

- `docs/assets/store/` 收敛为三个职责清晰的文件，每块内容只出现一次：
  - `cws-release.md`：商店详情填表文案（**中文为填表主版**）
  - `privacy.md`：隐私问卷填表文案（**英文为填表主版**）
  - `privacy-policy.md`：公开隐私政策（双语，用作商店 Privacy Policy URL）
- 删除零引用的 `description.md` 副本。英文说明若有需要，应放进正式的 `privacy-policy.md` 双语政策里，而不是另立无人引用的副本文件。
- 改文案只改主版，不双写；任何新增的商店文档文件，落盘前先确认是否已有主版可改。

## Why This Matters

不遵守的代价是直接、可量化的：

- **审核被拒返工**：CWS 审核有排队周期，被拒后重新修改、重新提交、重新排队，一次黄氩拒绝直接拖慢整个发版进度。v1.3.0 正是因此多走了一轮。
- **交叉核对判虚假**：CWS 审核员和用户会交叉核对商店说明、隐私问卷与公开隐私政策。三处不一致会被判 misleading description / undeclared capability——`privacy.md` 附 B 记录的 ora-1 审查修正（3 处「必须修正」）正是这类不对称的实例：声明「不修改页面内容」而实际注入了 `<style>`、声明「all traffic stays on device」而 engine-search 会开标签页。品牌枚举是同样的把柄。
- **双写漂移**：无引用的副本没有任何约束机制，改一版忘一版，漂移后无法判断哪份是真的，最终审核员看到的与你以为提交的内容可能根本不是同一份。

## When to Apply

- 每次向 Chrome Web Store 提交新版本或修改商店详情文案时
- 修改隐私问卷任一节（§1 单一用途 / §2-§4 权限理由）时（先量全部四节字符数，再按「砍冗余限定词、保披露与枚举」压缩）
- 在商店说明里写品牌名枚举之前（≤3+等 可接受且利于 SEO，6+ 是 spam）
- 新增商店文档文件之前（先确认是否已有主版文件可改）
- 收到 CWS 任何文档相关拒绝理由时（对照本纪律逐条自查）
- 任何描述 SERP 快切栏栏位行为（inline/top/bottom）的商店文档或隐私文档落笔时（对照 `serp-bar.content.ts` `applyPositionChrome` 校准，见 §6）
- 用 `gh release edit` 修改已发布 Release 的 notes 时（edit 后必补 `gh release upload --clobber`，见 §7）
- 写或审涉及 provider 实例的文档/文案时（实例 = 调参变体、共享 key、仅 Exa 与豆包支持，见 §8）
- 同一轮发版既改 GitHub Release notes 又改 CWS 商店说明时（分轨编辑，见 §9）

## Guidance — v1.4.0 release-prep additions

The v1.4.0 release-prep pass exposed four further lessons (a code-accuracy audit of the privacy questionnaire, a `gh release edit` asset-drop gotcha, a provider-instance terminology fix, and a dual-product separation rule). They are consolidated here as sections 6–9 so the whole CWS-copy discipline lives in one place.

### 6. CWS 文档准确度审计：样式注入模式描述必须与代码一致

隐私问卷 `privacy.md` §4(3) 原写 "top: repositions Baidu/Douyin toolbars"，但代码（`entrypoints/serp-bar.content.ts:96-119` `applyPositionChrome`）的实际行为是：

- `inline` 模式 → `injectPageStyles(state.engine)` → 注入百度/抖音的 `PAGE_STYLES`（位移引擎自身工具栏）；移除覆盖层垫高
- `top` 模式 → `removePageStyles()` + `injectTopPadStyles()` → 移除引擎样式，页面顶部垫高
- `bottom` 模式 → `removePageStyles()` + `injectBottomPadStyles()` → 移除引擎样式，页面底部垫高

即工具栏位移发生在 **inline 模式**，不是 top 模式。修正为 "(inline: repositions Baidu/Douyin toolbars; top/bottom: pads page)"（`privacy.md:27` 现状）。中文公开政策 `privacy-policy.md` §6 本就写对（"内联模式……位移……覆盖层模式……内边距"），英文版也已正确。

另发现 §1 provider 枚举漏了 2 个变体（stepfun-plan、doubao-global）——风险低（宿主共享且已披露），但技术上不完整。修正把 "Stepfun, Jina, Doubao" 改为 "Stepfun (REST + MCP), Jina, Doubao (web + global)"。

### 7. `gh release edit` 静默丢弃已附资产

`gh release edit v1.4.0 --notes-file <file>` 会静默丢弃该 Release 已附的资产（dev ZIP）。资产在 edit 后从 Release 页面消失。本轮连撞两次（一次更新为双语 notes、一次精修 notes）。修复纪律：**`gh release edit` 之后必须补跑 `gh release upload v1.4.0 <dev-zip> --clobber`** 把资产重新挂回。

### 8. provider 实例 = 调好参数的变体，不是账号

provider 实例（见 `provider-instance-multi-config-model.md`）是同一 provider 的调参变体——例如 Exa "AI 研究"（category=publication, includeDomains=[arxiv.org]）对 "创业资讯"（category=news）。它们**共享同一把 API key**（R7：API key 仍 per-provider-type 共享），不是不同账号（不同账号需不同 key）。术语修正：把 "如不同账号或参数" 改为 "如不同搜索场景或过滤方向"。

且只有 Exa 与豆包支持 per-instance options（`lib/provider-instances.ts` `PROVIDERS_WITH_INSTANCE_OPTIONS = new Set(['exa', 'doubao'])`）。商店说明原写 "每个服务" 是 overclaim，修正为 "支持的服务（如 Exa、豆包）"。

### 9. GitHub Release notes 与 CWS 商店说明是两份产物

GitHub Release notes（双语、经用户审定、附在 GitHub Release 上）与 CWS 商店说明（`docs/assets/store/cws-release.md`，CWS Developer Dashboard 填表文档）是**两份独立产物**。`chrome-extension-release-process.md` 已把它们分为两步（步骤 7 = GitHub Release，步骤 9 = CWS），但本轮一度把改给 CWS 说明的文案误贴进 Release notes、反之亦然。纪律：**两份产物分轨编辑，不要把一方的改动落到另一方**。

## Examples

### 1. 被拒的堆砌枚举 → 过审的 ≤3+等 概括

**Before（被拒）**：商店说明中枚举引擎名 "Google, Bing, Baidu, Bilibili, Douyin, and Xiaohongshu"（6 个），拒绝理由为「产品说明中有过多和/或不相关的关键字」。

**After（v1.3.0 过审）**：改为 ≤3+等 概括表述并回退到 v1.2.0 已过审措辞结构：

> 双面搜 / Juso 是一个开源的搜索聚合与切换工具：它把传统搜索引擎、站外搜索（Site Engine）和你已配置的 AI 搜索服务统一到同一个入口。

**After（v1.4.0 沿用 ≤3+等）**：分三类各列 3 个品牌名 + 等，利于 SEO 且过审：

> 聚合 Google、Bing、百度等传统搜索引擎……
> ChatGPT、DeepSeek、Gemini 等 AI 对话站点……
> Tavily、Exa、Stepfun 等 AI 搜索能力……

功能特性照写，但不靠品牌名堆砌支撑——「SERP 快切栏：栏位可选『顶部 / 底部 / 自动』，自动模式在窄屏（≤480px）下自动改为固定在页面底部的紧凑底栏」。

### 2. storage 权限理由 1086 字符 → 732 字符

**Before（1086 字符，超限）**：逐一点名所有 provider 名，偏好项完整展开列举。

**After（732 字符，现 `privacy.md` §2）**：删 provider 名枚举；偏好合并为一行概括「active source, source ordering and visibility, source groups, per-provider result counts, switch-bar position, UI language, theme, and style」；完整保留审核关键披露——「All data stays in `chrome.storage.local` (never synced) and is never logged. API keys are read exclusively by the background service worker and are never read by any extension page or content script; UI pages read only non-sensitive preferences. Keys are sent only to the user's selected search provider when fulfilling a search.」

### 3. 双写副本 → 单主版

**Before**：`description.md`（中英双语说明）与 `cws-release.md`（中文填表主版）内容完全重复、仓库零引用，改说明要双写。

**After**：删除 `description.md`，`docs/assets/store/` 只剩三个职责清晰的文件（填表文案 / 隐私问卷 / 公开政策），商店文案只有一个主版文件。

### 4. 模式描述：top 位移（错）→ inline 位移（对）

**Before（错）**：`privacy.md` §4(3) 写 "top: repositions Baidu/Douyin toolbars"。

**代码事实（`entrypoints/serp-bar.content.ts` `applyPositionChrome`）**：

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

中文 `privacy-policy.md` 本就正确："内联模式在百度与抖音上仅位移引擎自身工具栏,覆盖层模式(顶部/底部)则为页面添加对应方向的内边距"。

### 5. `gh release edit` 丢资产 → 补 `--clobber`

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

### 6. 实例术语与 overclaim 修正

**Before（错）**：文档称实例为 "如不同账号或参数"；商店说明称 "每个服务"可建实例。

**After（对）**：实例为 "如不同搜索场景或过滤方向"（共享同一 key，R7）；商店说明改为 "支持的服务（如 Exa、豆包）"。代码门控事实（`lib/provider-instances.ts`）：

```ts
export const PROVIDERS_WITH_INSTANCE_OPTIONS: ReadonlySet<ProviderId> =
  new Set<ProviderId>(['exa', 'doubao']);
```

## Related

- [cws-store-docs-must-sync-with-release-features.md](./cws-store-docs-must-sync-with-release-features.md) — 商店三件套随版本同步的审计纪律；本经验补充了边界：引擎枚举发生在隐私问卷与隐私政策里，**不在商店说明里**；§6 模式描述对齐是其代码落地准确度的具体实例
- [chrome-extension-release-process.md](./chrome-extension-release-process.md) — 双版本发布全流程；§7（`gh release edit` 丢资产）与 §9（双产物分轨）分别补充其步骤 7（GitHub Release）与步骤 9（CWS）
- [provider-instance-multi-config-model.md](../architecture-patterns/provider-instance-multi-config-model.md) — provider 实例模型权威；§8 术语（实例=调参变体、共享 key、`PROVIDERS_WITH_INSTANCE_OPTIONS`）以此为准
- [default-off-capability-gating-for-cws-compliance.md](../architecture-patterns/default-off-capability-gating-for-cws-compliance.md) — 隐私问卷文案背后的代码门控事实（审核员真机核对一致）
