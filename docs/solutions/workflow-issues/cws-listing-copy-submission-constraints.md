---
title: Chrome Web Store Listing Copy Submission Constraints (Keyword Enumeration and Character Limits)
date: 2026-08-01
last_updated: 2026-08-01
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
  - Fitting a permission justification into the 1000-character questionnaire limit
tags:
  - cws
  - chrome-web-store
  - store-listing
  - keyword-stuffing
  - privacy-questionnaire
  - character-limit
  - review-rejection
  - release-docs
---

# CWS 发版文案三防：不枚举品牌名、权限理由先量字数、商店文档单主版

## Context

v1.3.0 的发版申请把三个商店文案问题集中暴露在同一轮里，性质各不相同，却出自同一个根因：此前商店文案被当作「信息完整」的枚举清单来写，而不是「过审优先」的填表文案来写。

1. **CWS 审核拒绝（Yellow Argon 关键字垃圾）**：提交被拒，拒绝理由为「产品说明中有过多和/或不相关的关键字」，被点名的违规内容正是说明中枚举的引擎名 "Google, Bing, Baidu, Bilibili, Douyin, and Xiaohongshu"。此前 `cws-store-docs-must-sync-with-release-features.md` 要求「枚举每个受支持引擎」——这条纪律在隐私问卷和隐私政策里是必要的，但在商店说明这种同时面向审核机读与人工审读的字段上，反而触发了关键字垃圾判罚。
2. **storage 权限理由超字符上限**：隐私问卷里 storage 权限理由写了 1086 字符，超过 CWS 1000 字符上限，必须压缩重写才能提交。
3. **冗余双语说明副本**：`docs/assets/store/description.md`（中英双语说明）与 `cws-release.md`（中文填表主版）内容完全重复，仓库零引用，每次改说明都要双写，已出现漂移风险。

三个问题互相纠缠：枚举让说明变长也让它变「像垃圾」，长枚举又让权限理由撑爆字符上限，而副本的存在让每一处修改都要做两遍。修复后，商店文档收敛为一套可复用的填表纪律。

## Guidance

三条核心经验，对应三个问题：

### 1. 商店说明不枚举品牌名，用类别词概括（防 keyword spam）

- 商店说明字段里不写品牌/引擎名枚举。v1.3.0 修复时把 8 个引擎 + 7 个 provider 的枚举全部删除，改为概括表述。
- 用类别词概括功能：如「传统搜索引擎」「你已配置的 AI 搜索服务」，而不是逐个点名。**不枚举不算虚假描述**——扩展确实支持这些类别，概括并未夸大。
- 功能亮点写特性本身，不堆砌品牌名：例如 SERP 快切栏写「栏位可选『顶部 / 底部 / 自动』，自动模式在窄屏下改为固定底栏」，这是功能特性，不依赖任何品牌名。
- 以已过审版本（v1.2.0）的措辞结构为基线重写：【它解决什么问题】【核心功能】【为谁而做】【隐私与安全】【开源与免费】。已过审的措辞本身就是「什么样的文案能过审」的最佳样本。

### 2. 权限理由 ≤1000 字符，先量后写

- CWS 隐私问卷每个权限理由限 1000 字符，超限必须返工。当前仓库的安全实践是实测 ~981 字符（见 `privacy.md` §4 主机权限理由的标注）。
- 写前先量字符数（中英文都按字符计），不要凭感觉写。
- 压缩有明确优先级：**先砍品牌枚举、合并偏好列举，保留全部审核关键披露**。storage 理由从 1086 → 732 字符时，删除的是 provider 名枚举，偏好项合并为一行概括（保留来源分组 / maxResults / 栏位位置等关键项），而安全披露一条不砍：`chrome.storage.local` 仅本机、不同步、不记录；API key 仅由 worker 读取、页面与内容脚本不读；key 仅发往用户所选 provider。

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
- 修改隐私问卷任一权限理由时（先量字符数，再按「砍枚举、保披露」压缩）
- 在商店说明或问卷里写下任何品牌名/引擎名/服务名枚举之前
- 新增商店文档文件之前（先确认是否已有主版文件可改）
- 收到 CWS 任何文档相关拒绝理由时（对照本纪律逐条自查）

## Examples

### 1. 被拒的枚举文案 → 过审的概括文案

**Before（被拒）**：商店说明中枚举引擎名 "Google, Bing, Baidu, Bilibili, Douyin, and Xiaohongshu"，拒绝理由为「产品说明中有过多和/或不相关的关键字」。

**After（过审）**：删除全部引擎名枚举，改为概括表述并回退到 v1.2.0 已过审措辞结构，例如：

> 双面搜 / Juso 是一个开源的搜索聚合与切换工具：它把传统搜索引擎、站外搜索（Site Engine）和你已配置的 AI 搜索服务统一到同一个入口。

功能特性照写，但不靠品牌名支撑——「SERP 快切栏：栏位可选『顶部 / 底部 / 自动』，自动模式在窄屏（≤480px）下自动改为固定在页面底部的紧凑底栏」。

### 2. storage 权限理由 1086 字符 → 732 字符

**Before（1086 字符，超限）**：逐一点名所有 provider 名，偏好项完整展开列举。

**After（732 字符，现 `privacy.md` §2）**：删 provider 名枚举；偏好合并为一行概括「active source, source ordering and visibility, source groups, per-provider result counts, switch-bar position, UI language, theme, and style」；完整保留审核关键披露——「All data stays in `chrome.storage.local` (never synced) and is never logged. API keys are read exclusively by the background service worker and are never read by any extension page or content script; UI pages read only non-sensitive preferences. Keys are sent only to the user's selected search provider when fulfilling a search.」

### 3. 双写副本 → 单主版

**Before**：`description.md`（中英双语说明）与 `cws-release.md`（中文填表主版）内容完全重复、仓库零引用，改说明要双写。

**After**：删除 `description.md`，`docs/assets/store/` 只剩三个职责清晰的文件（填表文案 / 隐私问卷 / 公开政策），商店文案只有一个主版文件。

## Related

- [cws-store-docs-must-sync-with-release-features.md](./cws-store-docs-must-sync-with-release-features.md) — 商店三件套随版本同步的审计纪律；本经验补充了边界：引擎枚举发生在隐私问卷与隐私政策里，**不在商店说明里**
- [chrome-extension-release-process.md](./chrome-extension-release-process.md) — 双版本发布全流程，商店文档同步是其第 9 步
- [default-off-capability-gating-for-cws-compliance.md](../architecture-patterns/default-off-capability-gating-for-cws-compliance.md) — 隐私问卷文案背后的代码门控事实（审核员真机核对一致）
