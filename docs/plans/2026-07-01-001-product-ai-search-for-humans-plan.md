---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: "AI 搜索 API 转人类用 - Plan"
type: feat
date: 2026-07-01
---

# AI 搜索 API 转人类用 - Plan

## Goal Capsule

**目标**：把用户**已付费**的 AI 搜索 API 变成人类日常可用的干净搜索引擎——Chromium MV3 浏览器扩展，BYOK 自带 key，**答案优先**的干净结果页。覆盖 Tavily、Exa、Stepfun 按量、Stepfun Step Plan（订阅）四项 provider。

**权威层级**：产品行为与范围以 `## Product Contract` 为准（来自 `ce-brainstorm`）；技术决策、实现单元、验证以 `## Planning Contract` 起各节为准（`ce-plan` 补充）。实现期发现与产品契约冲突，记为显式假设或开放问题，不静默改写产品范围。

**停止条件**：四项适配器就绪（含 Stepfun 按量 REST + Step Plan MCP）并通过测试；搜索页对 Tavily/Exa 渲染答案、对 Stepfun 两面均降级为纯结果；BYOK key 仅本地、仅 worker 读取；`pnpm typecheck && pnpm test && pnpm build` 全绿并产出可加载的 MV3 解包扩展。

**执行画像**：无特殊测试优先要求；REST 适配器用录制的 API fixture 做契约测试，MCP 适配器用 mock MCP 端点，UI 用组件测试。

**Product Contract 保全**：产品契约范围未变。两处基于 API 研究的修正——(1) R5"答案能力降级"示例 provider 由 Exa 改为 Stepfun（研究确认：Tavily 与 Exa 均支持综合答案，Stepfun 两面均不支持）；(2) Stepfun 在 v1 拆为两个 provider（按量 REST + Step Plan MCP），因二者是不同计费面、服务不同用户群，拆分才能让订阅用户复用已付 Step Plan 额度（产品论点核心）。

---

## Product Contract

### 问题与用户

- **目标用户**：已经在为 AI 搜索 API（Tavily / Exa / Stepfun 等）付费的开发者 / AI 折腾者。他们买了 API key 或 Step Plan 订阅（通常是为做 AI 应用），但这笔预算只被程序调用消耗。
- **痛点**：人类日常搜索仍面对 Google/Bing 的广告与噪音；想用干净搜索又得再花钱买 Kagi / 订阅服务——**付了两份钱**。
- **价值主张**：复用你已在付费的 AI 搜索 API 预算，把它直接变成你自己的干净搜索引擎。不二次付费。

### 核心体验

浏览器扩展，**独立扩展页**（点工具栏图标 → 在标签页打开搜索页）。输入查询 → 调用当前激活 provider 的 API → 展示**答案优先**的干净结果页：

- 顶部：AI 综合答案（带引用来源）——仅当激活 provider 支持答案时显示
- 下方：干净、结构化的结果列表（去广告、去噪）

### Requirements

**搜索体验**
- R1. 点工具栏图标在标签页打开独立搜索页（非 popup）。
- R2. 搜索页提交查询，调用当前激活 provider，渲染答案优先的干净结果。
- R3. provider 单选切换：同一时间仅一家激活，切换只影响后续查询，不自动重查当前查询。

**Provider 与 BYOK**
- R4. v1 支持 Tavily、Exa、Stepfun 按量（REST）、Stepfun Step Plan（MCP）四项适配器，各自归一化为统一结果模型。
- R5. 答案能力降级：激活 provider 不支持综合答案时（Stepfun 两面），隐藏答案区、仅展示结果列表；支持时（Tavily/Exa）展示 AI 答案 + 引用。
- R6. BYOK：每项 provider 的 API key 本地存储，可在设置页配置与测试。

**信任底线**
- R7. API key 仅存 `chrome.storage.local`，仅由 background service worker 读取并发往对应 provider；搜索页/设置页不直接持有或发送明文 key；无遥测、不上传第三方。

### 关键决策

1. **差异化 = 复用已付费预算**，对标 Kagi/Brave——不是比索引质量，是"别让用户花两份钱"。
2. **provider 模型 = 单选切换**，明确不做多源融合 / 元搜索。
3. **位置 = 独立扩展页**：实现简、权限少、与现有搜索习惯零冲突；入口摩擦留待第二阶段。
4. **结果页 = 答案优先**（支持答案的 provider 才显示答案）。
5. **v1 provider = Tavily / Exa / Stepfun 按量 / Stepfun Step Plan**（Stepfun 拆按量与订阅两面，见 KTD7）。

### Scope Boundaries

**v1 范围内**：独立扩展页、BYOK 四项（Stepfun 拆按量 + 订阅两面）、单选切换、答案优先结果页、结果归一化、答案能力降级。

**v1 非目标**：
- 多源融合 / 元搜索（一次查多家合并）
- 成本控制（缓存 / 额度告警）——用户自付，后续再说
- 账号 / 登录、搜索历史、跨设备同步、托管 / 代理后端
- 接管默认搜索 / 新标签页 / 现有 SERP 叠加（留给第二阶段）
- 低成本入口（快捷键 / omnibox 关键字）
- Firefox、更多 vendor（Serper / SerpAPI / Linkup 等）、流式渲染
- Stepfun 综合答案（按量 REST 与 Step Plan MCP 两面均不提供，由 R5 降级覆盖）

### Acceptance Examples

- AE1. 用户在设置页填入 Tavily key 并设为激活 → 在搜索页查询 → 顶部出现 AI 答案 + 引用，下方结果列表。
- AE2. 用户切到 Stepfun（按量或 Step Plan）→ 查询 → 无答案区，仅结果列表（降级）。
- AE3. 用户切到 Exa → 查询 → AI 答案（基于 `output.content` + grounding 引用）+ 结果。
- AE4. 未配置某 provider 的 key 却切为激活 → 查询 → 友好的 `keyMissing` 提示并引导去设置页。

### 关键假设

- Chromium 系（Chrome / Edge）Manifest V3 优先，Firefox 后续。
- API key 仅本地存储，除发往当前激活 provider 的 API 外绝不上传；无遥测。
- 切换 provider 只影响后续查询，不自动重查当前查询。
- Stepfun 两面共享同一域名 `api.stepfun.com`，host_permissions 已覆盖。

### 路线图（v1 之后）

- **第二阶段：聚合搜索 / 快切搜索引擎模式**——和常规搜索引擎打通，在多家 provider + 常规引擎间快切，解决 v1"独立扩展页"的入口摩擦。

---

## Planning Contract

### High-Level Technical Design

技术栈：**WXT + React + TypeScript**（MV3）。WXT 把 `entrypoints/` 下的文件当作扩展入口，处理 manifest、多页面、HMR。

数据流：
1. 用户点工具栏图标 → `entrypoints/background.ts` 的 `chrome.action.onClicked` → `chrome.tabs.create` 打开搜索页（`/search.html`）。
2. 搜索页提交查询 → 通过消息（`@webext-core/messaging`）发 `{type:'search', query}` 给 background worker。
3. Worker 解析激活 provider → 从 `chrome.storage.local` 读 key → 调对应适配器 → 返回归一化 `NormalizedSearchResponse`（或类型化错误）。
4. 搜索页按 `answer` 是否存在渲染答案区 + 结果列表。

组件拓扑：

```
entrypoints/
  background.ts          # service worker：图标点击开页 + API 网关 + testKey
  search/index.html      # 搜索页入口
  search/main.tsx
  options/index.html     # 设置页入口
  options/main.tsx
components/              # SearchBox, ProviderSwitcher, AnswerCard, ResultCard, ResultList, States
lib/
  providers/
    types.ts             # 归一化模型 + ProviderAdapter 接口 + ProviderId 联合
    tavily.ts  exa.ts  stepfun.ts  stepfun-plan.ts
    registry.ts          # 四项注册表 + 激活解析
  mcp-client.ts          # 最小 MCP streamableHttp 客户端（initialize→tools/call，SSE/JSON 解析）
  storage.ts             # chrome.storage.local 封装（key、activeProviderId）
  messaging.ts           # 消息类型与处理器绑定
tests/                   # Vitest：适配器 fixture、MCP mock、storage、网关、组件
```

### Key Technical Decisions

**KTD1. Provider 适配器 + 归一化模型。** 定义 `ProviderAdapter` 接口与统一 `NormalizedSearchResponse`，把各家异构响应隔离在各自适配器内。归一化模型：

```
NormalizedSearchResponse { query, provider, answer?: { text, citations: Citation[] }, results: NormalizedResult[] }
NormalizedResult { title, url, snippet, content?, score?, publishedDate?, favicon? }
Citation { url, title? }
ProviderAdapter { id: ProviderId, label, supportsAnswer: boolean, search(query, opts, key): Promise<NormalizedSearchResponse> }
ProviderId = 'tavily' | 'exa' | 'stepfun' | 'stepfun-plan'
```

**KTD2. Background service worker 作为 API 网关。** 所有 provider 调用只发生在 worker，不发生在页面。理由：(a) key 永不进入页面 DOM/内容脚本，只有 worker 读 key；(b) host_permissions 集中管理；(c) 统一错误与额度映射。MV3 worker 对 `host_permissions` 内的域名 fetch 无 CORS 限制。

**KTD3. BYOK 仅存 `chrome.storage.local`（非 sync）。** key 与 `activeProviderId` 都在本地，永不同步、永不记录日志。实现 R7 信任底线。

**KTD4. 答案能力按 provider 声明 + 降级。** 适配器声明 `supportsAnswer`。Tavily 用 `include_answer`、Exa 用 `outputSchema:{type:"text"}`；Stepfun 两面均无答案能力，`supportsAnswer=false`，UI 自动隐藏答案区（实现 R5）。研究依据见 Sources。

**KTD5. 独立全页入口，action.onClicked 开标签页。** 工具栏图标不挂 popup，点击由 worker 打开搜索页。规避 popup 的失焦与狭窄空间问题，实现 R1。

**KTD6. 最小 host_permissions。** 仅声明 `api.tavily.com`、`api.exa.ai`、`api.stepfun.com`（Stepfun 按量与 Step Plan 共用此域），缩小 Chrome Web Store 审查面。

**KTD7. Stepfun 拆两个 provider，Step Plan 走 MCP tool-call。** Stepfun 有两套计费面：按量 REST `POST /v1/search`（独立 meter）与 Step Plan 订阅 MCP `web_search`（消耗月度 Credit 池）。拆成 `stepfun` 与 `stepfun-plan` 两个可切换 provider，分别服务按量用户与订阅用户，让订阅用户复用已付额度（产品论点核心）。`stepfun-plan` 的搜索能力仅经 MCP streamableHttp 暴露（`/step_plan/v1/mcp/web_search/mcp`），由 `lib/mcp-client.ts` 实现最小客户端：`initialize` → `tools/call {name:'web_search', arguments:{query}}`，解析 `result.content[].text` 为 `NormalizedResult[]`，`supportsAnswer=false`。注意 `web_search` 工具返回结构文档未给出，映射需在实现期探查（见 Risks）。

### Assumptions

- 包管理器用 pnpm（npm/yarn 等价）。
- v1 不做流式渲染，答案在完整响应返回后一次性渲染。
- WXT 的 `@webext-core/messaging` 用于页↔worker 通信；如不可用则回退 `chrome.runtime.sendMessage`。
- Tavily/Exa/Stepfun REST schema 以 Sources 文档版本为准；schema 漂移由 fixture 测试捕获。
- MCP `web_search` 工具结果文本的精确 schema 文档未给出，U10 实现期用真实 key 探查后定映射。

### Sequencing

U1（脚手架）→ U2（存储）→ U3（适配器契约+注册表）→ U4/U5/U6/U10（四项适配器，可并行）→ U7（worker 网关）→ U8（搜索页 UI）→ U9（设置页）。U8、U9 依赖 U2/U3/U7。

### Risks & Dependencies

- **Provider 异构性**：Tavily/Exa 是"结果列表型 + 可选答案"，Stepfun 两面是"纯结果型"。由 `supportsAnswer` + 降级覆盖；归一化模型吸收差异。
- **API schema 漂移**：REST 适配器绑定到文档化结构，fixture 测试捕获破坏性变更；需长期监控。
- **Stepfun 无答案**：按量 REST 与 Step Plan MCP 两面均仅返回 results，降级路径已覆盖。
- **Stepfun Step Plan MCP 协议复杂度**：streamableHttp 需 `initialize`/`tools/call` 握手与 SSE 解析；由 `lib/mcp-client.ts` 最小实现隔离，不污染其他适配器。
- **`web_search` 返回结构未文档化**：MCP 工具结果文本的精确 schema 文档未给出；U10 映射需在实现期用真实 key 探查后确定（非阻塞，U10 估时含此探查）。
- **成本累积**：v1 非目标（见 Scope Boundaries），每次查询 = 1 次计费调用（Stepfun 按量按次、Step Plan 消耗订阅 Credit）。
- **Chrome Web Store 审核**：最小 host_permissions；BYOK 需提供隐私政策 URL（key 仅本地、仅发往所选 provider）。
- **MV3 CSP / 远程代码**：所有 provider 调用均为 fetch，无 eval/远程脚本，合规。

---

## Implementation Units

依赖关系：U1 → U2 → U3 → {U4, U5, U6, U10} → U7 → {U8, U9}。

### U1. 项目脚手架（WXT + React + TS + MV3）

- **Goal**：可构建、可加载的 MV3 解包扩展骨架，含 typecheck/lint/test 工具链。
- **Requirements**：R1（图标开页的基础）。
- **Files**：`package.json`, `wxt.config.ts`, `tsconfig.json`, `.gitignore`, `entrypoints/background.ts`（`action.onClicked` 占位开 `/search.html`）, `README.md`（最小）。
- **Approach**：`pnpm create wxt@latest` 初始化 React+TS 模板；在 `wxt.config.ts` 声明 `manifest.action.default_title`（不设 `default_popup`）、`host_permissions: [api.tavily.com, api.exa.ai, api.stepfun.com]`、`permissions: [storage]`。
- **Test scenarios**：`pnpm build` 产出 `.output/chrome-mv3/` 且 manifest 含正确 host_permissions 与无 `default_popup`；`pnpm typecheck` 通过。
- **Dependencies**：无。

### U2. 存储层（BYOK key + 激活 provider）

- **Goal**：类型安全的 `chrome.storage.local` 封装；仅暴露 key 给 worker。
- **Requirements**：R6、R7。
- **Files**：`lib/storage.ts`, `tests/storage.test.ts`。
- **Approach**：导出 `getKey(providerId)`、`setKey(providerId, key)`、`getActiveProviderId()`、`setActiveProviderId(id)`；key 读取函数仅供 worker 模块调用（导出注释 + lint 约定）。默认 `activeProviderId` 为首项已配置 key 的 provider，否则 `null`。
- **Test scenarios**：存取 key 往返；未存 key → `getKey` 返回 `null`；`activeProviderId` 默认与切换；`chrome.storage.local` mock 注入。
- **Dependencies**：U1。

### U3. 适配器契约 + 注册表

- **Goal**：归一化模型与 `ProviderAdapter` 接口落地，注册四项（先桩实现）。
- **Requirements**：R4、R5。
- **Files**：`lib/providers/types.ts`, `lib/providers/registry.ts`, `tests/providers.test.ts`。
- **Approach**：定义 KTD1 的类型与 `ProviderId = 'tavily'|'exa'|'stepfun'|'stepfun-plan'`；`registry.ts` 暴露 `getAdapter(id)`、`allProviders()`；各项先桩，U4/U5/U6/U10 填实。
- **Test scenarios**：注册表含四项；`supportsAnswer`：tavily=true、exa=true、stepfun=false、stepfun-plan=false；未知 id → 类型化错误。
- **Dependencies**：U1。

### U4. Tavily 适配器

- **Goal**：把 `POST https://api.tavily.com/search`（Bearer）映射为归一化响应。
- **Requirements**：R4、R5。
- **Files**：`lib/providers/tavily.ts`, `tests/tavily.test.ts`（录制 fixture）。
- **Approach**：请求带 `include_answer: 'basic'`、`max_results`；映射 `answer`（字符串）→ `answer.text`，引用取自 `results`；`results[].content→snippet`、`score`、`favicon`。
- **Test scenarios**：带 answer 的 fixture → `answer.text` 有值、引用非空；不带 answer → `answer` 为 `undefined`；`results` 字段映射正确；`Authorization: Bearer` 头；401 → `providerError('unauthorized')`。
- **Dependencies**：U3。

### U5. Exa 适配器

- **Goal**：把 `POST https://api.exa.ai/search`（`x-api-key`）映射为归一化响应。
- **Requirements**：R4、R5。
- **Files**：`lib/providers/exa.ts`, `tests/exa.test.ts`。
- **Approach**：请求带 `outputSchema:{type:'text', description:...}` 求答案、`contents:{text:true, highlights:true}` 取富内容；映射 `output.content` + `output.grounding[].citations` → `answer`；`results[].text/highlights→snippet/content`、`publishedDate`、`favicon`。
- **Test scenarios**：带 `output.content`+`grounding` 的 fixture → 答案与引用映射；无 `output`（纯结果）→ `answer` 为 `undefined`；`x-api-key` 头；结果字段映射。
- **Dependencies**：U3。

### U6. Stepfun 按量（REST）适配器

- **Goal**：把 `POST https://api.stepfun.com/v1/search`（Bearer，按量计费）映射为纯结果响应。
- **Requirements**：R4、R5。
- **Files**：`lib/providers/stepfun.ts`, `tests/stepfun.test.ts`。
- **Approach**：请求带 `query`、`n`、可选 `category`；映射 `results[].snippet→snippet`、`content→content`、`time→publishedDate`；`supportsAnswer=false`，`answer` 恒为 `undefined`。
- **Test scenarios**：fixture 结果字段映射；`answer` 恒 `undefined`；`Authorization: Bearer` 头；`supportsAnswer===false`。
- **Dependencies**：U3。

### U7. Background 网关 + 消息

- **Goal**：图标开页 + 处理 search/testKey 消息，集中读 key、调适配器、返回归一化结果或类型化错误。
- **Requirements**：R2、R3、R7。
- **Files**：`entrypoints/background.ts`, `lib/messaging.ts`, `tests/gateway.test.ts`。
- **Approach**：`action.onClicked` → `chrome.tabs.create({url: chrome.runtime.getURL('/search.html')})`；`search` 处理器：读 `activeProviderId` → `getAdapter` → `getKey`（仅此处）→ `adapter.search` → 返回结果；缺 key 返回 `keyMissing`、适配器异常返回 `providerError`；`testKey` 用一次最小查询验证。
- **Test scenarios**：路由到激活适配器；缺 key → `keyMissing`；适配器抛错 → `providerError`；`testKey` 成功/失败；mock storage + 适配器。
- **Dependencies**：U2、U3、U4、U5、U6、U10。

### U8. 搜索页 UI

- **Goal**：搜索框 + provider 切换 + 条件答案区 + 结果列表 + 状态机。
- **Requirements**：R1、R2、R3、R5。
- **Files**：`entrypoints/search/{index.html,main.tsx,App.tsx}`, `components/{SearchBox,ProviderSwitcher,AnswerCard,ResultCard,ResultList,States}.tsx`, `tests/search-page.test.tsx`。
- **Approach**：提交查询走 messaging → worker；`ProviderSwitcher` 列出四项（Stepfun 两项分别标注"按量"/"Step Plan 订阅"），切换写 `activeProviderId`；`AnswerCard` 仅在 `response.answer` 存在时渲染（实现 R5 降级）；结果卡展示 title/url/favicon/snippet，`content` 可展开；loading/error(keyMissing/providerError)/empty 三态。
- **Test scenarios**：有 answer → 渲染答案区；`supportsAnswer=false` 的 provider → 不渲染答案区；切换 provider 更新激活态；`keyMissing` → 引导设置页；`providerError` → 错误态；空结果 → empty 态。
- **Dependencies**：U2、U3、U7。

### U9. 设置页（Options）

- **Goal**：每项 key 输入（掩码）+ 激活 provider 选择 + test key。
- **Requirements**：R6、R7。
- **Files**：`entrypoints/options/{index.html,main.tsx,App.tsx}`, `components/KeyInput.tsx`, `tests/options-page.test.tsx`。
- **Approach**：key 输入掩码、保存到 storage；激活选择写 `activeProviderId`；"测试"按钮走 `testKey` 消息并显示成功/失败反馈；页面本身不持有明文 key 超出输入态。Stepfun 两项分别标注计费面。
- **Test scenarios**：保存每项 key；选激活 provider；testKey 成功/失败反馈；输入掩码。
- **Dependencies**：U2、U7。

### U10. Stepfun Step Plan（MCP）适配器

- **Goal**：通过 MCP `web_search` tool-call 复用 Step Plan 订阅 Credit，归一化为纯结果响应。
- **Requirements**：R4、R5。
- **Files**：`lib/providers/stepfun-plan.ts`, `lib/mcp-client.ts`（最小 streamableHttp 客户端：`initialize`→`tools/call`，SSE/JSON 解析）, `tests/stepfun-plan.test.ts`。
- **Approach**：worker 持 Bearer key 调 `https://api.stepfun.com/step_plan/v1/mcp/web_search/mcp`；`tools/call` `web_search`，解析 `result.content[].text` 为 `NormalizedResult[]`；`supportsAnswer=false`。`web_search` 返回结构未文档化，实现期先用真实 key 探查输出再定映射（见 Risks）。MCP 握手与 SSE 解析封装在 `lib/mcp-client.ts`，不渗入其他适配器。
- **Test scenarios**：mock MCP 端点返回 initialize + tools/call 响应 → 结果归一化；`answer` 恒 `undefined`；Bearer 头；session 初始化失败 → `providerError`；`supportsAnswer===false`。
- **Dependencies**：U3、U7。

---

## Verification Contract

- **类型检查**：`pnpm typecheck`（`tsc --noEmit`）必须通过。
- **Lint**：`pnpm lint`（WXT/ESLint）必须通过。
- **单元/组件测试**：`pnpm test`（Vitest）。覆盖：四项适配器（Tavily/Exa/Stepfun 按量用录制 fixture；MCP `stepfun-plan` 用 mock MCP 端点）、storage 往返、网关消息处理器（mock storage + 适配器）、搜索页/设置页组件渲染（含 R5 降级分支）。
- **构建**：`pnpm build` 产出 `.output/chrome-mv3/`，可在 Chrome/Edge `chrome://extensions` 以解包方式加载。
- **手工冒烟（验收对齐 AE1-AE4）**：加载扩展 → 设置一项 key → 查询 → 验证答案（Tavily/Exa）与降级（Stepfun 两面）→ 切换 provider → 未配 key 的 `keyMissing` 提示。

证明本计划成立的核心测试：U4/U5/U6 的 fixture 契约测试 + U10 的 mock MCP 测试证明归一化正确；U8 的"answer 存在才渲染答案区"测试证明 R5 降级；U7 的"key 仅在 worker 读取"由代码结构 + `tests/gateway.test.ts` 保证。

---

## Definition of Done

- 四项适配器（Tavily / Exa / Stepfun 按量 / Stepfun Step Plan）实现并通过测试；归一化模型吸收 provider 异构性。
- 搜索页对 Tavily/Exa 渲染答案优先、对 Stepfun 两面均降级为纯结果（AE1-AE3）。
- BYOK key 仅 `chrome.storage.local`、仅 worker 读取；设置页可配置、可测试、可激活（R6、R7）。
- provider 切换只影响后续查询（R3）；Stepfun 按量与 Step Plan 订阅两面各自独立计费、可切。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全绿；产出可加载的 MV3 解包扩展。
- 清理：实现期产生的废弃/实验代码不得留在 diff。

---

## Sources / Research

- Tavily Search API — `POST /search`、`include_answer`、`results[].content/score/favicon`、Bearer 鉴权：https://docs.tavily.com/documentation/api-reference/endpoint/search
- Exa Search API — `POST /search`、`outputSchema:{type:'text'}` → `output.content` + `output.grounding`、`contents.text/highlights`、`x-api-key` 鉴权：https://docs.exa.ai/reference/search
- Stepfun 网页搜索（按量 REST）— `POST /v1/search`、`results[].snippet/content/time`、Bearer 鉴权、无综合答案：https://platform.stepfun.com/docs/zh/api-reference/search/search.md （索引：https://platform.stepfun.com/docs/llms.txt ）
- Stepfun StepSearch（Step Plan 订阅，MCP `web_search`/`web_fetch`，消耗月度 Credit 池）——与按量 REST 是两套计费、两类用户：https://platform.stepfun.com/docs/zh/step-plan/integrations/search-mcp
- WXT（MV3 框架，entrypoints/manifest/HMR）：https://wxt.dev
- `@webext-core/messaging`（页↔worker 类型化消息）；MCP 协议：https://modelcontextprotocol.io/

外部研究是 load-bearing：它确认了 (1) provider 答案能力真实分布（Tavily/Exa 支持、Stepfun 两面不支持），直接决定 KTD4、R5 示例修正；(2) Stepfun 存在两套计费面（按量 REST vs Step Plan MCP），直接决定 KTD7、R4 拆为四项 provider。
