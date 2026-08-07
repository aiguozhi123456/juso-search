---
title: "AI Engine as Fifth Search Source: Conversation-Navigation Target with Layered URL/Content-Script Injection"
date: 2026-08-03
last_updated: 2026-08-07
category: architecture-patterns
module: "ai-engines / sources / storage / serp / content-script"
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Adding a preset Search Source that hands the current query off to an AI chat site"
  - "A target that has no SERP URL / extractor contract and cannot join the engine registry"
  - "Some targets need a content script to fill and submit the query because they do not natively honor a URL query param"
related_components: [lib/ai-engines/types.ts, lib/ai-engines/registry.ts, lib/ai-engines/injectors, lib/sources.ts, lib/storage.ts, lib/serp-handoff.ts, lib/source-groups.ts, lib/config-io.ts, entrypoints/ai-engine-inject.content.ts, entrypoints/search/App.tsx, entrypoints/serp-bar.content.ts, wxt.config.ts]
tags: [ai-engine, search-source, content-script, injector, url-prefill, chat-handoff, source-group, default-hidden]
---

# AI Engine as Fifth Search Source: Conversation-Navigation Target with Layered URL/Content-Script Injection

## Context

Juso（Chrome MV3，WXT + React + TypeScript）此前已有四类 Search Source：BYOK AI provider、常规引擎、Site Engine（`site:<uuid>`）、Custom Engine（`custom:<uuid>`）。

用户经常想把当前查询「交给 AI 对话」继续追问——打开 chat.deepseek.com / chatgpt.com / gemini.google.com 等，把关键词填进输入框并提交。这些 AI 对话站既不是 BYOK provider（无 API key、无归一化搜索契约），也不符合「engine registry + SERP 抽取」模型（没有可匹配/可抽取的标准 SERP URL）。AI Engine 因此引入**第五类** Source：预置的「AI 对话导航目标」，把当前查询带到对话站。

与 Custom Engine 的关键区别：AI Engine 是**预置硬编码**（代码即定义，不进 storage），且部分站需要 **content script 注入**填充+提交——Custom Engine 只做纯 URL 导航。

关键模块：`lib/ai-engines/types.ts`、`lib/ai-engines/registry.ts`、`lib/ai-engines/injectors/`、`lib/sources.ts`、`lib/storage.ts`、`lib/serp-handoff.ts`、`lib/source-groups.ts`、`lib/config-io.ts`、`entrypoints/ai-engine-inject.content.ts`、`entrypoints/search/App.tsx`、`entrypoints/serp-bar.content.ts`、`wxt.config.ts`。

## Guidance

### 1. 一等公民 Source：预置 `ai:<slug>` id 与统一投影

- 预置 id：`ai:deepseek` / `ai:chatgpt` / `ai:gemini` / `ai:doubao` / `ai:grok`；类型 `AiEngineId = \`ai:${string}\``。
- `SourceKind` 增加 `'ai-engine'`，`SourceId` 并入 `AiEngineId`（`lib/sources.ts`）。
- **预置硬编码，不进 storage**：定义在 `lib/ai-engines/registry.ts` 的 `AI_ENGINES` 常量，与常规 engine 同模式（代码即定义）。因此无 CRUD、无 storage key、无 `CONFIG_KEYS` 登记——这是它与 Site/Custom Engine 最大的生命周期差异。
- 通过 `allSources(...)` 投影：`kind: 'ai-engine'`、`supportsAnswer: false`、i18n label、favicon，**不携带执行描述符字段**——`resolveSerpHandoff` 按 id 从 registry 查（同常规 engine 模式），而非像 site/custom 那样把定义嵌进 SearchSource。
- `allKnownSourceIds` / `normalizeSourceOrder` / `normalizeSourceHidden` / `resolveEffectiveActiveSource` / `visibleUsableSource` / `selectActiveSourceId` / `config-io.isKnownSource` 全部认 `ai:*`——新增源类型必须贯穿所有 mutation 与规范化路径（见 Related 的 source-graph 文档，本次穿透 19 处）。

### 2. 三种执行机制 + injectorKey 桥接（核心决策）

`AiEngine.execution` 是一个判别联合（两种 `kind`：`url-only` / `inject`），但语义上区分三种机制，统一在单一类型下（`inject` 内部按 `injectorKey` 再分机制 2/3）：

| 机制 | kind | 站 | injectorKey | 行为 |
|------|------|-----|-------------|------|
| 1 — url-only | `url-only` | Grok | — | 原生支持 `?q=` 预填+自动提交，零注入 |
| 2 — inject（补 Enter） | `inject` | ChatGPT | `generic-enter:chatgpt` | 原生已预填 `?q=` 但不自动提交，仅补合成 Enter（共享 generic 注入器） |
| 3 — inject（完整） | `inject` | DeepSeek / 豆包 / Gemini | `deepseek` / `doubao` / `gemini` | 等 SPA 输入框 → 按框架填充 → 提交（点击发送按钮或合成 Enter，取决于编辑器框架） |

**registry 保持纯数据、且是 injectorKey 的唯一真相源**：`execution.injectorKey` 类型为 `InjectorKey` 字面量联合（定义在 types.ts，拼错即编译错），registry 不引用任何 DOM API（被 worker/UI/content 共享）。content script 按 host → 单一表 `INJECT_HOST_TABLE`（host → engineId，并吸收 matches 覆盖）→ `getAiEngine(engineId).execution.injectorKey` → `INJECTORS`（key → injector 函数）解析，在 `entrypoints/ai-engine-inject.content.ts` 汇合。这样 DOM 触碰代码永不进入 worker/UI 共享层。结构不变量（inject engine ↔ host 表一一对应、injectorKey 必在 `INJECTORS`、matches 条目数 === host 表条目数）由测试锁住——新增站点不会因漏同步某处而静默死功能。

### 3. 注入器实现约定（`lib/ai-engines/injectors/`）

- **按框架选填充路径**：React 受控 textarea 用 native value setter + `InputEvent`（直接设 `.value` 不同步）；ProseMirror/Lexical/Slate 等 contenteditable 富文本编辑器用 `document.execCommand('insertText')` 填充（改 innerHTML 无效）；提交时 ProseMirror 需点击发送按钮或派发 `insertParagraph` beforeinput 事件（合成 keydown 不触发提交）；MutationObserver 同步型编辑器（Gemini）直接设 `innerText` + input 事件。
- **失败静默降级**：所有 `fillAndSubmit` 路径 `return` 而非 `throw`，content script 入口再套一层 `try/catch`。选择器超时 / 未登录 / 页面改版时不打扰用户，让用户看到带 `?q=` 的页面手动操作。例外：机制 3 站点若 SPA 已客户端清参（如豆包），降级时 query 在地址栏不可恢复，需回 Juso 重搜。
- **幂等性 = 提交后清 URL 参数**：`clearUrlQuery()` 在成功提交后 `history.replaceState` 仅删 `q`/`prompt`/`enter`（保留其余参数与 hash），防用户手动刷新重跑。MV3 静态 content script 不会在 pushState 时重跑，所以幂等性不依赖"只跑一次"，而依赖清参。机制 3 站点提交前会校验填充成功，校验失败静默降级且不清参，保留刷新重试。
- **SPA 清参兜底**：`extractQueryWithNavFallback` 先读当前 URL，取不到时回退 `performance.getEntriesByType('navigation')[0].name`（原始导航 URL），处理豆包这类在 document_idle 前客户端清参的站。
- **选择器宁缺毋滥**：不用裸 `textarea` 兜底——非聊天页（登录页）若恰好带 `?q=`，裸兜底会往任意 textarea 填词，违背静默降级契约。
- **发送按钮延迟激活**：Gemini 的发送按钮要等输入被识别后才 enabled，用 `pollUntil` 轮询且**在 predicate 内重查按钮**（不持有初始节点引用，防 React 重渲染后对 detached 节点 click 静默无效）。

### 4. 导航分裂（与 Custom Engine 同 precedent）

| 界面 | 行为 | 原因 |
|------|------|------|
| **Juso 搜索页**（`App.tsx`） | 同 tab `location.assign` + `setActiveSource` | 与常规 engine 合并分支（`source.kind === 'engine' \|\| 'ai-engine'`） |
| **SERP 快切栏**（`serp-bar.content.ts`） | **新 tab** `openNewTab`，**不** `setActiveSource` | 不丢用户当前 SERP；与 custom-engine 一致 |

### 5. 默认隐藏 + 独立分组

- **全部默认隐藏**：每个 AI 对话站都要求已登录会话，开箱不该出现在快切栏。schema v6→v7 迁移把 5 个 `ai:*` id 并入 `sourceHidden`（`mergeHiddenFactory`），用户在管理面板手动显示。
- **新增第五个内置分组** `ai-engines`（`lib/source-groups.ts`：`AI_ENGINES_GROUP`，i18n `group_ai_engines`），与 `ai-search`（BYOK provider，显示名 "API 搜索"）/ engines / sites / custom 并列。`defaultGroupForSourceId` 把 `ai:*` 映射到 `ai-engines`；`normalizeGroupConfig` 把缺失内置组追加到非空 layout 末尾。

### 6. 权限最小化

- **host_permissions 零新增**：MV3 下 `content_scripts.matches` 本身就是注入授权，无需进 `host_permissions`。
- content script 只匹配需要注入的 4 个 host（Grok 是 url-only，不在 matches 里），且豆包收窄到 `https://www.doubao.com/chat/*`（经 `INJECT_HOST_TABLE` 该 host 条目的 `match` 字段）；`INJECT_MATCH_PATTERNS` 从同一张表派生。
- 注入器只从本页 URL 读 `q`/`prompt`，不碰 `browser.*`、不碰 storage、无消息通道——BYOK key 路径完全不受影响。
- 5 个 favicon 列入 `web_accessible_resources`（`matches: SERP_HOST_MATCH_PATTERNS`），否则第三方 SERP 栏 shadow DOM 加载不到。

## 可见性门控与残余风险：`?q=<prompt>` 链接诱导自动提交

**同意权缺口已修（可见性门控）**：注入层曾对任意 `?q=` 链接都触发，无视「该 engine 是否被用户启用」——这与本功能「5 站默认隐藏、用户手动显示才进快切栏」的 opt-in 语义断链，是**正确性/同意权缺陷而非风险取舍**，与攻击面无关都该修。现已加**可见性门控**：content script 在 `fillAndSubmit` 前向 worker 发 `aiInjectAllowed(engineId)`，worker **只读 `sourceHidden`**（不碰 BYOK key），返回「已注册且未被隐藏」；查询失败 fail-closed（静默不注入）。先例 = serp-bar 的 `shouldMountForEngine`（对隐藏 engine 不挂栏），同构复用。**注入器本身（deepseek/chatgpt/gemini/doubao 的填充+提交逻辑）零改动，门控纯增量**；Grok 是 url-only 无注入、不受门控影响。

**门控后的残余风险（已接受）**：攻击面收窄为「**主动显示过该 engine 的用户** + 点击了**指向该站的构造链接** + 已登录」。评估：

- DeepSeek/豆包/Gemini 的 `?q=` 并非这些站点的原生约定——野外不存在这种链接，只有 Juso 自己生成；攻击者须先知道 Juso 的私有约定。
- ChatGPT 的 `?q=` 是原生的（预填是站点自己做的），但 2025-07 后 ChatGPT 自身的 auto-submit 被 sec-fetch-site 门控（web-initiated 跨站导航不触发），注入器需自行点击发送按钮或派发完整 Enter 链提交；危害 = 用户自己会话里多一条已显示在地址栏的 prompt。
- **只去不回**：query 唯一来源是本页 URL，注入器不读 storage、不读其他源、无跨源数据流——无数据泄露面。
- **缓解已内置**：提交后 `clearUrlQuery()` 清参防刷新重放；失败静默降级，用户可见输入框内容。

**方案 1（内部通讯 / 一次性握手）暂缓**：content script 不信任 URL 的 `?q=`、改为只响应扩展自己发起的导航（发起方写一次性 nonce→query 到 `chrome.storage.session`，worker resolve-and-consume）。已验证技术成立、无致命 MV3 坑，但：content script 默认不能直读 session storage（须 worker 中转）、App.tsx 有 5 处 `location.assign` 需收敛、doubao nonce 需 navEntry 兜底、ChatGPT 须同时保留 `?q=`——成本 ~200–300 行，为收窄后的残余风险付费不划算。**重启触发条件**：(a) 出现实际滥用报告；或 (b) 这些站点中任一家把 `?q=` 变成原生约定（野外链接变真实）。届时按上述设计直接执行。

**已拒绝的替代**：注入前 toast 确认（在第三方站新增可见 UI 面、反射性点确认即失效）。

> **后续更新（2026-08-05）**：「仅填充不提交」开关后来以不同设计实现——见 [./ai-engine-enter-param-auto-submit-contract.md](./ai-engine-enter-param-auto-submit-contract.md)。新设计通过 `enter=1` URL 参数契约解耦自动提交与原生预填：开关默认 ON（不砍功能价值），关闭时 URL 不带 `enter=1`、content script 仅预填不提交（ChatGPT 注入器仍聚焦 + 清参，非 no-op）。同意权缺口仍由可见性门控修复，开关是额外的行为控制层。

## 社区来源与协议（注入器技术出处）

注入器的选择器与填充/提交技巧，来自 @librarian 规格表整理的社区油猴脚本与技术文章（了结 `shared.ts` 的「待记录」）。按站点：

- **DeepSeek**：[DeepSeek Prompt Automation](https://gist.github.com/orca131/7f4dd7f2ec377c09cdb8b0ad5cd10e68)（orca131，`textarea[name="search"]` + 合成 Enter + MutationObserver，未标注许可）、[AI 助手选择器](https://greasyfork.org/zh-CN/scripts/528300)（`#chat-input` + input 事件 + Enter + replaceState 清参，许可未确认）、大橘「AI 网页版 Query 参数问答填充」（仅填充不提交）、[给 AI 搜索网站添加 q 查询参数](https://greasyfork.org/zh-CN/scripts/550940)（smilingpoplar，MIT）。
- **ChatGPT**：原生 `?q=` 预填（站点行为），注入器只补 Enter。行为记录见 [OpenAI 帮助中心《ChatGPT Search》](https://help.openai.com/en/articles/9237897-chatgpt-search)（官方，描述经浏览器地址栏 / URL 带查询开启 ChatGPT 对话，但未点名 `?q=` 参数本身）、[Tenable TRA-2025-22](https://www.tenable.com/security/research/tra-2025-22)（OpenAI 2025-07 以 sec-fetch-site 修补自动提交）与 [Zenn《どこでもワンステップでAI呼び出し》](https://zenn.dev/finatext/articles/283442255930fe)（finatext，2025-09）。
- **Gemini**：[AI 助手选择器](https://greasyfork.org/zh-CN/scripts/528300)（rich-textarea / contenteditable 选择器）；填充用 innerText + input 事件，发送按钮延迟激活需 pollUntil。
- **豆包**：boommanpro《[豆包 URL 参数调用](https://boommanpro.cn/post/doubao-plugin)》（「必须 `execCommand('insertText')` 触发真实 InputEvent 才能同步 React state」的结论最关键，未标注许可）、[豆包自动发送助手](https://greasyfork.org/zh-CN/scripts/541111)（CathyElla，MIT）、AI搜索引擎增强😈（huahuacat / CathyElla，豆包专项）。SPA 清参用 navEntry 兜底。

**协议结论**：本扩展注入器独立编写，未复制上述任何代码，仅取用选择器（各站 DOM 事实，不受版权保护）与标准 Web API 技巧（React native value setter、execCommand、contenteditable 同步、PerformanceNavigationTiming），不构成代码复制，无许可义务。已确认 MIT：550940（smilingpoplar，原规格表记录、脚本身份二次确认）、541111（CathyElla，脚本头 `@license MIT` 二次确认）。未标注许可：orca131、boommanpro（二次确认无 `@license`）。许可未确认：528300（Greasy Fork 屏蔽许可字段直读）。因未复制代码，鸣谢为致谢性质。

## Why This Matters

- **AI 对话站塞不进 engine registry**：没有可匹配/可抽取的标准 SERP URL，硬套引擎模型会失败。
- **三种机制统一在一个类型下**：上层（排序/可见性/分组/快切栏/handoff）只看 `kind: 'ai-engine'`，不感知底层是 url-only 还是 inject——新增站只是加一个 registry 条目 + （如需）一个 injector。
- **injectorKey 桥接隔离 DOM 代码**：registry 纯数据可被 worker/UI 共享，DOM 注入只在 content script 上下文。
- **预置 ≠ 用户存储**：硬编码定义免去 CRUD/持久化/导入导出/序列化预算的全套复杂度。

## When to Apply

- 新增「把查询交给 AI 对话站」的预置导航目标。
- 目标无 SERP 契约、不能进 engine registry。
- 部分目标需 content script 填充+提交（不原生支持 URL 预填）。

## Related

- [./custom-engine-arbitrary-url-source-type.md](./custom-engine-arbitrary-url-source-type.md) — 最接近的姊妹文档（第四类 Source，纯 URL 导航）；AI Engine 的导航分裂沿用其 precedent。
- [./serp-switch-bar-and-unified-source-model.md](./serp-switch-bar-and-unified-source-model.md) — 统一 Search Source 模型与 SERP 快切栏。
- [./persistent-source-order-and-visible-projection.md](./persistent-source-order-and-visible-projection.md) — normalizeSourceOrder/normalizeSourceHidden 不变量。
- [./source-group-layout-layer.md](./source-group-layout-layer.md) — groupConfig 布局层与内置分组（本次新增 ai-engines）。
- [./separate-active-search-source-from-active-byok-provider.md](./separate-active-search-source-from-active-byok-provider.md) — Active Source 与 Active Provider 边界（AI engine 只写 ACTIVE_SOURCE_KEY，不写 ACTIVE_KEY）。
- [./testable-content-script-helpers-via-lib-extraction.md](./testable-content-script-helpers-via-lib-extraction.md) — content script 逻辑抽到 lib 以便测试（injector extractQuery 可纯函数测试）。
- [../logic-errors/source-graph-new-type-threading-data-loss.md](../logic-errors/source-graph-new-type-threading-data-loss.md) — 新增源类型须穿透所有 mutation 路径（本次穿透 19 处）。
- [../security-issues/content-script-url-open-sanitization.md](../security-issues/content-script-url-open-sanitization.md) — openNewTab 的 URL 净化。
- [../design-patterns/source-level-favicon-field-pipeline.md](../design-patterns/source-level-favicon-field-pipeline.md) — 每源 favicon + web_accessible_resources 管线。
- CONCEPTS.md — 项目领域词汇（Search Source / AI Engine）。
