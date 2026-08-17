---
title: "Custom Engine as Fourth Search Source: Arbitrary-URL Template with New-Tab SERP Handoff"
date: 2026-08-02
last_updated: 2026-08-17
category: architecture-patterns
module: "custom-engines / sources / storage / serp"
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Adding a new user-defined Search Source kind that navigates an arbitrary URL rather than wrapping a fixed engine"
  - "Supporting browser-style custom search engines defined by a URL template with a query placeholder"
  - "A source that must open in a new tab from the SERP bar but same-tab from the search page"
related_components: [lib/custom-engines.ts, lib/sources.ts, lib/storage/, lib/serp-handoff.ts, entrypoints/background.ts, entrypoints/serp-bar.content.ts, components/CustomEngineManager.tsx, wxt.config.ts]
tags: [custom-engine, search-source, url-template, percent-s-placeholder, chrome-storage, serp, new-tab, source-group]
---

# Custom Engine as Fourth Search Source: Arbitrary-URL Template with New-Tab SERP Handoff

## Context

Juso（Chrome MV3，WXT + React + TypeScript）此前已有三类 Search Source：

1. **BYOK AI provider**（tavily / exa / brave / stepfun / stepfun-plan / jina / doubao / doubao-global / parallel）——worker 内调用 API，归一化为统一结果模型；
2. **常规引擎**（Google / Bing / Baidu / Douyin / Xiaohongshu / Bilibili / Yandex / DuckDuckGo / 微信公众号（weixin））——engine registry 提供 `buildSerpUrl` / SERP 抽取器；
3. **Site Engine**（`site:<uuid>`）——在固定的底层引擎上注入 `site:` 作用域。

逐个适配每个搜索引擎既不现实，也有一些目标（ChatGPT、GitHub、StackOverflow……）根本不符合「engine registry + SERP 抽取」模型——它们没有可匹配/可抽取的标准 SERP URL。Custom Engine 因此引入**第四类** Source：用户定义的「名称 + URL 模板」，模板用 `%s` 作为查询占位符——与浏览器内置的「管理搜索引擎」完全同构。

关键模块：`lib/custom-engines.ts`、`lib/sources.ts`、`lib/storage/`、`lib/serp-handoff.ts`、`lib/source-groups.ts`、`lib/config-io.ts`、`entrypoints/background.ts`、`entrypoints/search/App.tsx`、`entrypoints/serp-bar.content.ts`、`components/CustomEngineManager.tsx`、`wxt.config.ts`。

## Guidance

### 1. 一等公民 Source：动态 id 与统一投影

- 动态 id：`custom:<uuid>`，与 `site:<uuid>` 平行；类型 `CustomEngineId = \`custom:${string}\``。
- `SourceKind` 增加 `'custom-engine'`，`SourceId` 并入 `CustomEngineId`（见 `lib/sources.ts:20-21`）。
- 持久化记录 `CustomEngineDefinition { id, name, urlTemplate }`。
- 通过 `allSources(...)` 投影：`favicon: '/icons/custom-engine.svg'`、`labelDescriptor: { kind: 'literal', value: name }`（用户名字面量，绕过 i18n）、`supportsAnswer: false`，并携带 `customEngine` 执行描述符（`lib/sources.ts:249-253`）。
- `allKnownSourceIds` / `normalizeSourceOrder` / `normalizeSourceHidden` 全部穿透 `customDefinitions` 参数——新增源类型必须贯穿所有 mutation 与规范化路径（参见 Related 的 source-graph 文档）。

### 2. URL 模板契约（`lib/custom-engines.ts`）

`normalizeCustomEngineUrlTemplate(value)` 校验并规范化：

- 仅 `http:` / `https:`；
- 恰好一个小写 `%s`（`input.match(/%s/g)` 长度必须为 1）；
- 拒绝凭据（`url.username || url.password`）；
- 拒绝内部空白（`/\s/.test(input)`）；
- 边界：`MAX_CUSTOM_ENGINES = 50`、`MAX_CUSTOM_ENGINE_NAME_LENGTH = 40`、`MAX_CUSTOM_ENGINE_URL_LENGTH = 2048`。

规范化借助 URL 序列化器（scheme + host 自动小写），但先用一个字母数字哨兵替换 `%s`，避免占位符被百分号编码，序列化后再换回：

```ts
const SENTINEL = 'JUSOQUERYPLACEHOLDER';
url = new URL(input.replace('%s', SENTINEL));
// ... 校验 protocol / credentials ...
const canonical = url.href.replace(SENTINEL, '%s');
```

于是 `HTTPS://X.COM/?q=%s` 与 `https://x.com/?q=%s` 归一为同一串，可一起去重（`normalizeCustomEngineDefinitions` 按 id 与 urlTemplate 双重去重）。导航时 `buildCustomEngineUrl(urlTemplate, query)` 用 `encodeURIComponent(query)` 替换 `%s`。

### 3. 导航分裂（核心决策）

同一个 Custom Engine，在两个界面上的导航行为不同：

| 界面 | 行为 | 原因 |
|------|------|------|
| **Juso 搜索页**（`entrypoints/search/App.tsx`） | 同 tab `location.assign(url)` | 已在扩展页上，与内置引擎一致 |
| **SERP 快切栏**（`entrypoints/serp-bar.content.ts`，第三方 SERP 上的 content script） | **新 tab**：`sendMessage('openNewTab', url)` → worker `browser.tabs.create` | 不能丢掉用户当前的 Google/Bing SERP |

两个界面共同点：**空查询不导航**。搜索页空查询仍 `setActiveSource` 持久化（与内置/站点引擎一致），只是不跳转；SERP 栏对「仍有效但空查询」的 chip 直接 `return`，连快照往返与重渲染都省掉。

SERP 栏**不为 Custom Engine 持久化 active source**（`serp-bar.content.ts:761-768` 显式注释：与内置引擎一致，不调用 `setActiveSource`）。

worker 侧 `openNewTab` 用 `sanitizeOpenNewTabUrl` 净化：仅 http/https、拒绝凭据、导航到解析后的 `url.href`（`entrypoints/background.ts:94-106`）。

### 4. 与 Site Engine 的对照

| 维度 | Site Engine | Custom Engine |
|------|-------------|---------------|
| 本质 | 固定底层引擎上的 `site:` 作用域 | 任意 URL 模板 |
| 底层引擎 | 有（google / bing / baidu） | **无** |
| SERP 抽取器 | 有 | **无** |
| 是否进 SERP Scope | 是 | **否**（快切栏从不注入到 custom-engine 页面） |
| SERP 栏导航 | 当前 tab `location.assign` | **新 tab** `openNewTab` |

**与 Site Engine 共享**（详见姊妹文档，不在此重复）：动态 id、安全持久化不变量（trusted-read 不因 oversize 清空、untrusted import 有界、拒绝超限写入）、写后重解析导航、配置导出/导入。

### 5. 存储与分组

- 存储键 `customEngines` 键常量（`lib/storage/keys.ts`），CRUD 在 `lib/storage/custom-engine-store.ts`，一律走 `withSourceMutation`；写入前 `customEnginesSerializedBytes(next) > MAX_CUSTOM_ENGINES_SERIALIZED_BYTES` 即抛 `invalid_custom_engine`。
- `getProviderConfigSnapshot()` 返回值含 `customEngines`；各 normalizer 均穿透 `customDefinitions`。
- 新增**第四个内置分组** `custom`（`lib/source-groups.ts`：`CUSTOM_GROUP = 'custom'`，标签 i18n `group_custom` = "自定义"/"Custom"），与 ai-search / engines / sites 并列。`defaultGroupForSourceId` 将 `custom:*` 映射到 `custom`；`normalizeGroupConfig` 会把缺失的内置分组追加到非空 layout 末尾，保证升级用户持久获得该分组。

### 6. SERP handoff 与图标可达性

- `resolveSerpHandoff(source, query)`：custom-engine 且有查询 → `{ kind: 'navigate', url }`；空查询 → `null`。`resolveCurrentCustomEngineHandoff(customId, query, customDefinitions)` 从最新定义重解析（防陈旧模板）。
- 图标 `/icons/custom-engine.svg` **必须**列入 `web_accessible_resources`（`wxt.config.ts:64`，`matches: SERP_HOST_MATCH_PATTERNS`）。否则第三方页面 SERP 栏的 shadow DOM 无法加载它（`onError` 会隐藏图标）；搜索页是扩展页，无需 WAR 也能加载。

### 7. 配置导出/导入与 i18n

- 导出含 `customEngines`；导入用 `isBoundedCustomEngineCollection` 严格有界检查（`lib/config-io.ts`）。
- active-source 保留对 custom engine 独立于 site engine（`preserveCustom`）。
- i18n：约 24 个 `opts_custom_engines_*` 键 + `group_custom`。

## Why This Matters

- **任意 URL 目标塞不进 engine registry**：它们没有可匹配、可抽取的标准 SERP URL，硬套引擎模型会得到空结果或错误结果。
- **SERP 新 tab 保留研究上下文**：用户在 Google/Bing SERP 上切到 GitHub 搜索时，原 SERP 不应被覆盖。
- **建模为一等 Source 而非特例**：复用既有的排序 / 可见性 / 分组 / active-source 机制，避免第二套 id 方案与第二套规范化器漂移。

## When to Apply

- 新增「用户定义、带查询模板的导航目标」。
- Source 不符合 SERP 抽取模型（无标准 SERP URL）。
- 同一 Source 在不同界面需要不同的导航行为（同 tab vs 新 tab）。

## Examples

### URL 构造

```ts
buildCustomEngineUrl('https://github.com/search?q=%s', 'react hooks');
// → 'https://github.com/search?q=react%20hooks'
```

### 导航分裂：搜索页同 tab vs SERP 栏新 tab

```ts
// 搜索页（entrypoints/search/App.tsx）——已在扩展页，同 tab 导航
const postWriteHandoff = resolveCurrentCustomEngineHandoff(source.id, nextQuery, config.customEngines ?? []);
if (nextQuery && postWriteHandoff?.kind === 'navigate') location.assign(postWriteHandoff.url);
// 空查询：仍 setActiveSource 持久化，但不导航
```

```ts
// SERP 快切栏（entrypoints/serp-bar.content.ts）——第三方 SERP，新 tab 导航
const handoff = resolveCurrentCustomEngineHandoff(source.id, query, config.customEngines ?? []);
const stillDefined = (config.customEngines ?? []).some((d) => d.id === source.id);
if (!handoff || handoff.kind !== 'navigate') {
  if (stillDefined) return;          // 空查询 + 有效 chip：不导航、不重渲染
  onUnresolvedSource?.(config);       // 已删除/失效：丢弃陈旧 chip
  return;
}
// 故意不 setActiveSource：与内置引擎一致，SERP 栏不持久化 custom engine 的 active source
void sendMessage('openNewTab', handoff.url); // → worker browser.tabs.create
```

## Related

- [./site-engine-third-source-and-safe-persistence.md](./site-engine-third-source-and-safe-persistence.md) — 最接近的姊妹文档；共享的安全持久化不变量在此（trusted-read 不 oversize 清空、写后重解析、schema v4）。
- [./serp-switch-bar-and-unified-source-model.md](./serp-switch-bar-and-unified-source-model.md) — 统一 Search Source 模型与 SERP 快切栏。
- [./persistent-source-order-and-visible-projection.md](./persistent-source-order-and-visible-projection.md) — normalizeSourceOrder/normalizeSourceHidden 不变量。
- [./source-group-layout-layer.md](./source-group-layout-layer.md) — groupConfig 布局层与内置分组。
- [./dual-domain-storage-schema-versioning.md](./dual-domain-storage-schema-versioning.md) — config/cache schema 版本化与导出导入信任边界。
- [./separate-active-search-source-from-active-byok-provider.md](./separate-active-search-source-from-active-byok-provider.md) — Active Source 与 Active Provider 边界。
- [./testable-content-script-helpers-via-lib-extraction.md](./testable-content-script-helpers-via-lib-extraction.md) — content script 逻辑抽到 lib 以便测试。
- [../logic-errors/source-graph-new-type-threading-data-loss.md](../logic-errors/source-graph-new-type-threading-data-loss.md) — 新增源类型须穿透所有 mutation 路径（本次 H1/L4）。
- [../security-issues/content-script-url-open-sanitization.md](../security-issues/content-script-url-open-sanitization.md) — openNewTab 的 URL 净化。
- [../design-patterns/dynamic-source-stale-navigation-guard.md](../design-patterns/dynamic-source-stale-navigation-guard.md) — 动态源导航前重解析。
- [../conventions/config-import-schema-version-range.md](../conventions/config-import-schema-version-range.md) — 导入 schema 版本区间约定。
- [../design-patterns/source-level-favicon-field-pipeline.md](../design-patterns/source-level-favicon-field-pipeline.md) — 每源 favicon + web_accessible_resources 管线。
- CONCEPTS.md — 项目领域词汇（Search Source / Custom Engine）。
