# Chrome Web Store 商店说明 / Store Description

> 最后更新 / Last updated: 2026-07-28

## 中文

**双面搜 / Juso** 是一个开源的搜索聚合与切换工具：它把传统搜索引擎和你已配置的 AI 搜索服务统一到同一个入口，让人类用户和本地 AI 智能体都能在一个地方搜索、比较和快速切换。

### 它解决什么问题

日常搜索常需要在 Google、Bing、百度之间来回切换，还想对照抖音、小红书的内容，或想用 AI 搜索拿到带引用的综合答案。双面搜把这些来源放进同一个搜索页，并在各搜索引擎的结果页顶部加一个「切换栏」，一键把当前查询转到其他引擎或 AI 搜索，无需重新输入。

### 核心功能

- **统一搜索入口**：聚合 Google、Bing、百度、抖音、小红书等传统搜索引擎，以及 Tavily、Exa、Stepfun、Jina、Doubao 等 AI 搜索服务。
- **SERP 快切栏**：在受支持的搜索引擎结果页顶部，一键把当前搜索词切换到其他引擎，或跳转到双面搜的 AI 搜索页。
- **AI 搜索体验**：Tavily 和 Exa 可返回带引用的综合答案与结果列表；Stepfun、Jina、Doubao 提供结果列表。
- **本地搜索历史**：成功的 AI 搜索会缓存在本机，可随时查看与重放，避免对同一查询重复计费。
- **即装即用**：传统搜索引擎无需任何配置；只有使用 AI 搜索服务时，才需要在设置里填入对应服务的 API Key。
- **本地 AI 智能体搜索入口（可选，默认关闭）**：进阶用户可在设置中开启 Agent Bridge，让本地 AI 智能体通过本机回环（loopback）调用你已配置的搜索能力；其中「读取传统搜索引擎公开结果」还需二次开启，且智能体不会获得你的 API Key。

### 为谁而做

- 希望在一个入口对照、切换多个搜索引擎的日常用户。
- 想把付费 AI 搜索 API 变成好用搜索页的开发者与重度用户。
- 需要为本地 AI 智能体提供统一搜索入口的进阶用户。

### 隐私与安全

- 你的 API Key 仅保存在本机（chrome.storage.local），只由后台脚本读取并发往你选择的服务，不经过双面搜的中转服务器，UI 页面与本地智能体都不会读取已存储的密钥。
- Agent Bridge 和「读取传统搜索引擎公开结果」功能默认关闭，需你在设置中显式开启。
- 当前版本不运营请求代理，也不发送遥测。
- 需要说明的是：查询会直达你选择的搜索引擎或 AI 服务，这些第三方及网络可能记录请求，双面搜无法保证匿名或控制其记录行为。

### 开源与免费

本扩展基于 MPL-2.0 协议开源，源码可审查。当前为早期版本，功能完整可用，欢迎反馈与建议。

**权限说明**：storage 用于保存本地配置与搜索缓存；downloads 用于导出你的配置备份；网络权限用于连接你选择的 AI 搜索服务，以及可选的本地智能体桥接（仅限本机回环地址）。

---

## English

**Juso (双面搜)** is an open-source search aggregator and switcher: it unifies conventional search engines and your own AI search services into one entry point, so both human users and local AI agents can search, compare, and switch sources from a single place.

### What it solves

Daily search often means jumping between Google, Bing, and Baidu, checking Douyin or Xiaohongshu, or using AI search for cited answers. Juso puts these sources in one search page and adds a switch bar at the top of supported search-engine result pages, letting you move the current query to another engine or AI search without retyping.

### Core features

- **Unified search entry**: Aggregates conventional engines (Google, Bing, Baidu, Douyin, Xiaohongshu) and AI search services (Tavily, Exa, Stepfun, Jina, Doubao).
- **SERP switch bar**: On supported search-engine result pages, switch the current query to another engine or jump to Juso's AI search page.
- **AI search experience**: Tavily and Exa return cited synthesized answers plus result lists; Stepfun, Jina, and Doubao return result lists.
- **Local search cache**: Successful AI searches are cached locally so you can review or replay them without being billed twice for the same query.
- **Works out of the box**: Conventional engines need no setup; AI search services only require you to enter your own API key in settings.
- **Local AI agent search entry (optional, off by default)**: Advanced users can enable Agent Bridge in settings, letting a local AI agent invoke your configured search sources over loopback; the "read conventional search-engine public results" feature needs a second opt-in, and the agent never receives your API key.

### Who it's for

- Everyday users who want to compare and switch between multiple search engines in one place.
- Developers and power users who want to turn paid AI search APIs into a usable search page.
- Advanced users who need a unified search entry for local AI agents.

### Privacy & security

- Your API keys are stored only on your device (`chrome.storage.local`), read only by the background script, and sent only to the service you choose; they never pass through Juso servers, and neither UI pages nor local agents read stored keys.
- Agent Bridge and "read conventional search-engine public results" are off by default and must be explicitly enabled in settings.
- No request proxy and no telemetry in this version.
- Note: queries go directly to the search engine or AI service you choose; those third parties and their networks may log requests, which Juso cannot guarantee or control.

### Open source & free

Juso is open-sourced under MPL-2.0; the source code is open for review. This is an early release with full functionality; feedback is welcome.

**Permissions**: `storage` saves local settings and search cache; `downloads` exports your config backup; network permissions connect to your chosen AI search services and the optional local agent bridge (loopback only).
