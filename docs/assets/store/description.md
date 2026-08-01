# Chrome Web Store 商店说明 / Store Description

> 最后更新 / Last updated: 2026-08-01

## 中文

**双面搜 / Juso** 是一个开源的搜索聚合与切换工具：它把传统搜索引擎、站外搜索（Site Engine）和你已配置的 AI 搜索服务统一到同一个入口，让人类用户和本地 AI 智能体都能在一个地方搜索、比较和快速切换。

### 它解决什么问题

日常搜索常需要在各种搜索引擎之间来回切换，或想用 AI 搜索拿到带引用的综合答案。双面搜把这些来源放进同一个搜索页，并在各搜索引擎的结果页上（顶部或底部）加一个「切换栏」，一键把当前查询转到其他引擎、站外搜索或 AI 搜索，无需重新输入。

### 核心功能

- **统一搜索入口**：聚合传统搜索引擎，以及 Tavily、Exa、Stepfun 等 AI 搜索服务。
- **SERP 快切栏**：在受支持的搜索引擎结果页上，一键把当前搜索词切换到其他引擎、站外搜索，或跳转到双面搜的 AI 搜索页；栏位可选顶部/底部/自动（窄屏自动改用页面底部的紧凑底栏）。
- **AI 搜索接口**：支持 Tavily、Exa 和 Stepfun，将 AI 搜索能力以人类可用的搜索页形式提供。
- **站外搜索（Site Engine）**：在扩展设置中保存多个站点，用搜索引擎原生高级搜索语法（`site:`）把搜索范围限定到该站点。创建后会出现在搜索页与 SERP 切换栏，与其他来源一样可切换。
- **本地搜索历史**：成功的 AI 搜索会缓存在本机，可随时查看与重放，避免对同一查询重复计费。
- **即装即用**：传统搜索引擎无需任何配置；只有使用 AI 搜索服务时，才需要在设置里填入对应服务的 API Key。
- **本地 AI 智能体搜索入口（可选，默认关闭）**：作为双面搜的另一面，本功能让本地 AI 智能体通过同一台浏览器调用你已配置的搜索能力。智能体可以调用 AI 搜索 API，也可以通过真实浏览器检索传统搜索引擎的公开结果。该功能采用两层门控：先开启 Agent Bridge 总开关，再单独开启「读取传统搜索引擎公开结果」子开关。每次调用使用独立的临时端口与令牌，完成后通道自动关闭；智能体不会获得你的 API Key，也不会持久驻留。

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

**Juso (双面搜)** is an open-source search aggregator and switcher: it unifies conventional search engines, site-scoped searches (Site Engine), and your own configured AI search services into one entry point, so both human users and local AI agents can search, compare, and switch sources from a single place.

### What it solves

Daily search often means jumping between different search engines, or wanting AI search to return synthesized answers with citations. Juso puts these sources into one search page and adds a switch bar to supported search-engine result pages (top or bottom), letting you move the current query to another engine, a site-scoped search, or AI search without retyping.

### Core features

- **Unified search entry**: Aggregates conventional search engines and AI search services such as Tavily, Exa, and Stepfun.
- **SERP switch bar**: On supported search-engine result pages, switch the current query to another engine, a site-scoped search, or Juso's AI search page in one click; the bar position is selectable (top / bottom / auto — auto uses a compact bottom bar on narrow screens).
- **AI search interface**: Supports Tavily, Exa, and Stepfun, presenting AI search capability as a human-usable search page.
- **Site Engine**: Save multiple sites in the extension settings and scope each search to a site with the engine's native advanced syntax (`site:`). Created entries appear in the search page and the SERP switch bar, switchable like any other source.
- **Local search history**: Successful AI searches are cached locally so you can review or replay them without being billed twice for the same query.
- **Works out of the box**: Conventional engines need no setup; only when using AI search services do you need to enter the corresponding API key in settings.
- **Local AI agent search entry (optional, off by default)**: As the other side of Juso, this lets a local AI agent invoke your configured search capabilities through the same browser. The agent can call AI search APIs or retrieve public results from conventional search engines through a real browser. Two-layer gating: first enable the Agent Bridge master switch, then separately enable the "read conventional search-engine public results" sub-switch. Each call uses an independent temporary port and token, and the channel closes automatically when done; the agent never receives your API key and does not persist.

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
