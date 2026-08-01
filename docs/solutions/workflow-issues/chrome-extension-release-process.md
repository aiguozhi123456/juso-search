---
title: Chrome Extension Dual-Version Release Process
date: 2026-07-26
last_updated: 2026-08-01
category: workflow-issues
module: release
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Publishing a new version of the WXT Chrome MV3 extension"
  - "Submitting to Chrome Web Store and creating a GitHub Release"
  - "Maintaining README accuracy across CWS and GitHub versions"
tags:
  - release
  - build
  - chrome-mv3
  - wxt
  - cws
  - github-release
  - extension-id
---

# Chrome Extension Dual-Version Release Process

## Context

juso-search（双面搜）是一个基于 WXT + React + TypeScript 构建的 Chrome MV3 扩展。项目需要同时面向两类分发渠道：

1. **Chrome Web Store (CWS)**：通过商店安装，依赖 CWS 签名机制
2. **GitHub Release（自托管）**：通过 ZIP 包加载解包扩展，需要稳定的扩展 ID

在 v1.2.0 发布过程中，团队发现对两个构建变体的差异理解不够清晰——生产 ZIP 不含 `key` 字段，加载为解包扩展时 ID 不稳定，不能作为自托管分发包。此外 README 中 CWS 版本号与 GitHub 版本号容易混淆。

此指引记录了完整的发布流程和双版本差异，防止未来再次出错。

## Guidance

### 完整发布流程

发布新版本时，按以下顺序执行：

1. **版本号升级**：同步修改 `package.json` 中的 `version` 字段与 `wxt.config.ts` 中 `manifest.version`
2. **提交**：将版本变更作为独立 commit 提交（如 `chore(release): bump version to 1.2.0`）
3. **构建生产 ZIP**：`npm run zip` → 生成 `juso-search-{version}-chrome.zip`
4. **构建开发 ZIP**：`npx wxt zip --mode development` → 重命名为 `juso-search-{version}-chrome-dev.zip`
5. **打标签**：创建 annotated tag（`git tag -a v1.2.0 -m "release: v1.2.0 ..."`）
6. **推送标签**：`git push origin v1.2.0`
7. **GitHub Release**：创建 Release，**仅附加 dev ZIP**
8. **CWS 提交**：将生产 ZIP 上传至 Chrome Web Store Developer Dashboard
9. **CWS 商店文档同步**：同步更新商店文案、隐私问卷与隐私政策（见 [cws-store-docs-must-sync-with-release-features.md](cws-store-docs-must-sync-with-release-features.md)）；提交被拒（如关键字垃圾、字符超限）时按 [cws-listing-copy-submission-constraints.md](cws-listing-copy-submission-constraints.md) 的文案纪律重写后重新提交

### 两个构建变体的差异

| 维度 | 生产构建 (`npm run build`) | 开发构建 (`npm run build:dev`) |
|------|--------------------------|-------------------------------|
| 输出目录 | `.output/chrome-mv3/` | `.output/chrome-mv3-dev/` |
| 文件名 | `juso-search-{v}-chrome.zip` | `juso-search-{v}-chrome-dev.zip` |
| manifest `key` | ❌ 不包含（CWS 审核要求） | ✅ 包含（`DEV_EXTENSION_KEY`） |
| 扩展 ID | 不稳定（CWS 签名后才固定） | 稳定（由 `key` 派生） |
| 用途 | 仅供 CWS 上传 | 自托管/开发分发 |
| 能否直接加载 | ❌ 不建议（ID 不稳定） | ✅ 可作为解包扩展加载 |

### 扩展 ID 稳定性规则

- **含 `key` 的 manifest** → Chrome 从公钥派生扩展 ID，只要 `key` 不变，ID 就稳定
- **不含 `key` 的 manifest** → Chrome 基于路径生成临时 ID，每次重装或不同机器加载时 ID 可能变化
- **CWS 签名后** → CWS 会为扩展分配稳定的永久 ID，与本地 `key` 无关

### GitHub Release 附件规则

**只上传 dev ZIP，不上传生产 ZIP。**

原因：
- 生产 ZIP 缺少 `key`，用户加载为解包扩展时 ID 不稳定，导致数据隔离问题（重装后丢失设置）
- 生产 ZIP 的唯一合法去向是 CWS，CWS 会重新签名并分配 ID
- 需要自托管分发的用户使用 dev ZIP，其稳定 ID 保证了数据持久性

### README 准确性维护

README 中涉及版本号时需区分两个来源：
- **GitHub 版本**：对应 Release tag 和 dev ZIP（通常是最新版本）
- **CWS 版本**：商店显示的版本（通常落后于 GitHub，因为审核需要时间）

示例措辞（v1.2.0 发布时）：
> Juso v1.2.0 已在 GitHub Release 发布（Chrome Web Store 目前为 v1.1.0，v1.2.0 审核中）。

## Why This Matters

混淆两个构建变体会导致以下问题：

1. **用户数据丢失**：使用不含 `key` 的生产 ZIP 加载后，每次重装或换机器加载都会生成新 ID，`chrome.storage.local` 中的配置（如 API key、provider 选择）会全部丢失
2. **CWS 审核被拒**：如果误将含 `key` 的 dev 构建上传到 CWS，可能因 manifest 差异导致审核问题
3. **开发者困惑**：团队成员不清楚何时使用哪个命令构建，可能用错命令浪费时间
4. **版本号误导**：README 未区分 CWS 和 GitHub 版本号，用户可能误以为商店版本就是最新版

明确的双版本流程确保了：
- CWS 用户获得经过审核的稳定版本
- 自托管/开发用户获得 ID 稳定的版本
- 发布操作可重复、不出错

## When to Apply

此指引适用于以下场景：

- 为 WXT 构建的 Chrome MV3 扩展准备新版本发布
- 需要同时分发到 CWS 和 GitHub Releases
- manifest 中包含 `web_accessible_resources`（如搜索 Provider 的 SVG 图标）需要稳定 ID 匹配
- 使用 `chrome.storage.local` 存储用户配置，且配置需要在重装后保留
- 团队成员需要理解为什么存在两个构建命令

不适用于：
- Firefox MV2/MV3 扩展（WXT 的 Firefox 构建有不同的 ID 管理策略）
- 纯 npm 包发布（无浏览器扩展场景）

## Examples

### v1.2.0 发布实例

1. **版本升级**：
   ```json
   // package.json
   { "version": "1.2.0" }
   ```
   ```ts
   // wxt.config.ts
   manifest: {
     version: '1.2.0',
   }
   ```

2. **构建执行**：
   ```bash
   npm run zip                       # → juso-search-1.2.0-chrome.zip
   npx wxt zip --mode development    # → juso-search-1.2.0-chrome.zip（需重命名为 -dev.zip）
   ```

3. **manifest 条件 key**：
   ```ts
   // wxt.config.ts
   manifest: ({ mode }) => ({
     ...(mode === 'development' ? { key: DEV_EXTENSION_KEY } : {}),
     // ...
   })
   ```

4. **Release 创建**：
   ```bash
   git tag -a v1.2.0 -m "release: v1.2.0 ..."
   git push origin v1.2.0
   gh release create v1.2.0 --title "Juso v1.2.0" --notes "..." juso-search-1.2.0-chrome-dev.zip
   ```

5. **README 更新**：
   - 合并"安装与更新"→"快速开始"
   - 标注：CWS 当前 v1.1.0，v1.2.0 pending review

## Related

- [WXT Self-Contained Development Build with Stable Extension ID](../tooling-decisions/wxt-self-contained-dev-build.md) — 构建变体的技术背景（三层层级、key 门控、ID 稳定性机制）
- [DEVELOPMENT.md](../../DEVELOPMENT.md) — 构建命令与扩展 ID 差异
