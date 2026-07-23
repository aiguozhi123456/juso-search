# 聚搜 / Juso

[English](README.en.md)

> **一面为人，一面为智能体。**

Juso 是一个开源的双面搜索产品：它让人类用户在同一入口选择、切换传统搜索引擎与已配置的 AI 搜索服务；也让本地 AI 智能体通过同一台浏览器调用 AI 搜索 API，或检索传统搜索引擎。密钥由扩展在本地管理，搜索请求直接前往你选择的服务。

| 面向谁 | 现在能做什么 |
| --- | --- |
| 人类用户 | 聚合传统搜索引擎，并在独立搜索页与结果页中快速切换 |
| 人类用户 | 把 AI 搜索 API 变成可直接使用、可与传统引擎快切的搜索体验 |
| 本地 AI 智能体 | 通过统一入口调用已配置的 AI 搜索 API |
| 本地 AI 智能体 | 借助真实浏览器检索传统搜索引擎 |

## 当前能力与来源

Juso 将**搜索来源**作为统一的用户选择：它可以是传统**搜索引擎**，也可以是已配置的 AI 搜索服务；两者的执行方式不同。

- 传统搜索引擎：Google、Bing、Baidu。它们不使用 API 密钥；Juso 通过浏览器导航，供人直接使用，或为智能体提取普通搜索结果。
- AI 搜索服务：Tavily、Exa、Stepfun 按量 API、Stepfun Step Plan。服务经由统一的适配器接口访问，但各自的鉴权与计费由相应服务决定。
- 答案能力：Tavily 和 Exa 可返回综合答案及结果列表；两个 Stepfun 来源当前仅返回结果列表。

“聚合”在当前版本中指统一接入、选择与快速切换搜索来源，**不表示**一次查询默认并行请求多个来源，也不表示默认合并、去重或融合结果。

## 人类使用

独立搜索页提供搜索来源选择和切换；在 Google、Bing、Baidu 的受支持结果页上，SERP 切换栏可将当前查询直接切到其他搜索引擎，或跳转至 Juso 的 AI 搜索页。

成功的 AI 搜索会缓存在当前设备上，并形成可查看、可重放的本地搜索历史。缓存按“服务 + 规范化查询”区分，不在服务之间共享。需要最新结果时，请显式刷新；刷新会绕过缓存，并可能产生所选 AI 服务的费用。

## 快速开始

Juso 已发布 v1.0.0，适合愿意手动安装和配置的用户。先按“安装与更新”完成扩展安装，再按你的使用方式继续。

### 人类用户

1. 按“安装与更新”安装并启用扩展。
2. 打开 Juso 搜索页并选择搜索来源。Google、Bing、Baidu 无需配置；只有使用 AI 搜索服务时，才需要在扩展设置中配置对应服务的密钥。

完成后，你可以在一个入口搜索、切换 Google、Bing、Baidu 和已配置的 AI 搜索服务。

### 本地 AI 智能体

1. 按上面的步骤在 **装有 Juso 的 Chromium 系浏览器**（Chrome / Edge / Chromium 等）中安装并启用扩展。使用 `engine-search` 检索传统搜索引擎无需配置 AI 搜索服务；只有通过 `search --provider` 调用 AI 搜索 API 时，才需要先配置对应服务。
2. 将 `skills/juso-search/` 安装或复制到你的智能体技能目录，例如 `.agents/skills/juso-search/`。
3. 扩展 ID 已内置默认值，一般无需配置。仅在自行签名打包（或扩展 ID 与默认不一致）时，才设置 `JUSO_EXTENSION_ID` 或传入 `--extension-id`。
4. 若自动发现找不到浏览器，或扩展装在 Edge 等非默认二进制上，请把可执行文件路径指到**已安装 Juso 的那一份浏览器**（可同时指定 profile 目录名）：

```powershell
$env:JUSO_CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# 可选：$env:JUSO_CHROME_PROFILE = "Default"
# 可选：$env:JUSO_EXTENSION_ID = "你的扩展 ID"
```

```bash
export JUSO_CHROME_PATH="/path/to/msedge-or-chrome"
# optional: export JUSO_CHROME_PROFILE="Default"
# optional: export JUSO_EXTENSION_ID="YOUR_EXTENSION_ID"
```

5. 从技能目录运行命令，例如：

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

也可以临时覆盖：`python scripts/juso_search.py --chrome /path/to/browser --extension-id YOUR_EXTENSION_ID list-providers`。

完成后，本地智能体可列出已配置的服务、以**显式**服务参数进行 API 搜索，或通过浏览器检索 Google、Bing、Baidu，而不会取得已存储的密钥。

## 安装与更新

### 安装 v1.0.0

1. 从 [GitHub Release v1.0.0](https://github.com/aiguozhi123456/juso-search/releases/tag/v1.0.0) 下载 `juso-search-1.0.0-chrome.zip`。
2. 解压 ZIP。
3. 打开 Chromium 的 `chrome://extensions`，开启“开发者模式”，选择“加载已解压的扩展程序”，并选择解压后直接包含 `manifest.json` 的目录。

### 从源码安装

1. 克隆仓库并安装依赖：`npm install`。
2. 构建生产版本：`npm run build`。
3. 按上述“加载已解压的扩展程序”流程，选择 `.output/chrome-mv3/`。

开发者模式安装会显示浏览器警告。在浏览器商店分发前，更新需要手动下载新的 ZIP（或重新构建）、替换已加载目录，并在扩展管理页重新加载扩展。

## 安全与数据边界

- AI 搜索服务密钥由扩展本地管理，保存在 `chrome.storage.local`；仅后台 service worker 读取。UI 页面不会读取已存储的密钥，本地 AI 智能体也不会获得这些密钥。
- 需要鉴权时，密钥会发送给你选择的 AI 搜索服务；查询会到达你选择的 AI 搜索服务或传统搜索引擎。
- Juso 当前本地模式不运营请求中转服务，也不发送遥测。但浏览器、网络、传统搜索引擎及 AI 搜索服务可能记录请求；Juso 无法保证匿名或控制这些第三方的记录实践。
- 配置导出由用户主动触发，包含未加密的密钥和偏好设置。导出文件敏感且由你自行保管；Juso 不运营配置备份或凭据同步服务。

## 智能体接口与边界

智能体通过短生命周期、仅回环地址的 Agent Bridge 调用扩展后台的一次受限操作，而不是连接一个常驻本地 API。每次调用使用新的本地端口、令牌与请求标识，完成或超时后即失效。

`search` 必须提供 `--provider`，不会悄悄跟随扩展当前服务。`engine-search` 仅提取普通结果链接，不承诺 AI 摘要、知识面板或其他页面内容；取得 URL 后，页面抓取应由智能体宿主自己的 `web_fetch` 等能力完成。启动或桥接失败时，标准输出中的 JSON 会带结构化 `error.kind`（例如 `chrome_not_found`、`chrome_launch_failed`、`extension_did_not_claim`、`extension_did_not_complete`）；请按提示检查浏览器路径、profile、扩展 ID，以及打开的浏览器里是否已启用 Juso，不要通过暴露密钥来重试。`engine-search` 在验证页、同意页、布局不支持或无结果时也会失败。完整 kind 表见 `skills/juso-search/SKILL.md`。

## 开发与当前架构

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm test
npm run test:python
npm run lint
```

- `entrypoints/search/`：独立人类搜索页、搜索来源切换、缓存与历史。
- `entrypoints/options/`：本地密钥与来源偏好配置。
- `entrypoints/background.ts`、`lib/gateway.ts`：后台服务、消息网关与 Agent Bridge 的受限执行入口。
- `lib/providers/`：Tavily、Exa、Stepfun 按量与 Step Plan 的适配器及统一响应模型。
- 搜索引擎与 SERP Switch Bar：真实浏览器导航、结果页切换和普通结果提取；其执行契约不同于 API 服务。
- `lib/storage.ts`：本地配置、来源偏好、缓存与用户发起的配置导出。

## 可能的未来

这不是路线图或承诺。我们可能根据需求、接口可用性与服务稳定性，适配更多 AI 搜索服务和传统搜索引擎；也可能探索可选的多来源并行检索、去重、排序和保留来源的结果融合。任何这类能力都应让用户明确控制成本、范围和等待时间。

## 鸣谢

本扩展在 Google / Bing / Baidu 结果页注入切换栏的部分思路——“作为结果容器首子元素插入以继承宽度、简化对齐”，以及“向宿主页注入 CSS shim 给切换栏腾出空间”——参考自 [searchEngineJump 搜索引擎快捷跳转](https://greasyfork.org/zh-CN/scripts/27752-searchenginejump)（作者：NLF、锐经、[qxin i](https://github.com/qxinGitHub/searchEngineJump)，MIT 许可）。本扩展的实现独立编写，与原脚本不共享代码。

## 许可证

Juso 的完整本地搜索闭环——当前扩展、来源集成、智能体访问、本地配置与缓存——以 [MPL-2.0](LICENSE) 开放。该承诺不表示未来可能出现的托管或运营服务必然开源或免费。
