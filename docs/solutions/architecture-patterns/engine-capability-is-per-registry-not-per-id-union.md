---
title: "Engine capability is layered per registry, but the shared EngineId union hides the layers"
date: 2026-07-23
category: architecture-patterns
module: engines
problem_type: architecture_pattern
component: documentation
severity: low
applies_when:
  - Adding a new search engine to EngineId or widening an engine capability list
  - Claiming agent-facing result extraction support for an engine in docs or the skill CLI
  - Inferring engine capability from the EngineId union or the manifest content_scripts injection surface
  - Updating README, SKILL.md, or CONCEPTS.md engine support descriptions
  - Designing or auditing a new per-engine capability layer such as extraction or source visibility
root_cause: inadequate_documentation
resolution_type: documentation_update
tags: [search-engine, engine-registry, capability-layers, engine-id-union, agent-extraction, serp-switch-bar, source-visibility, documentation-accuracy]
related_components:
  - lib/engines/types.ts
  - lib/engines/registry.ts
  - lib/engines/extractors/registry.ts
  - lib/schema.ts
  - skills/juso-search/scripts/juso_search.py
  - skills/juso-search/SKILL.md
  - wxt.config.ts
---

# Engine capability is layered per registry, but the shared EngineId union hides the layers

## Context

During the v1.1.0 README update (commit `628242a`), Douyin and Xiaohongshu were added to every engine list in both README.md and README.en.md—including the agent-facing capability paragraph. The inference chain that produced the over-claim:

1. `wxt.config.ts` injects `engine-extractor.js` on all 5 SERP host groups via `ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS` (derived from `SERP_HOST_MATCH_PATTERNS` in `lib/engines/scopes.ts`, which includes `www.douyin.com` and `www.xiaohongshu.com`).
2. `lib/engines/registry.ts` registers all 5 engines in a `Record<EngineId, SearchEngine>` with no exclusions.
3. The `EngineId` union in `lib/engines/types.ts` lists all 6 identifiers: `'google' | 'bing' | 'baidu' | 'douyin' | 'xiaohongshu' | 'bilibili'`.

From these three signals the doc edit concluded: "all 5 engines support agent extraction" (later expanded to 6 with bilibili). The sentence "Juso 通过浏览器导航，供人直接使用，或为智能体提取普通搜索结果" (zh) / "Juso navigates a browser for people to use directly or for agents to extract ordinary search results" (en) was expanded to include Douyin and Xiaohongshu without qualification.

The user caught the error: Douyin and Xiaohongshu are login-walled SPAs whose results render through async APIs, not server-rendered DOM. The extractor registry (`lib/engines/extractors/registry.ts`) explicitly maps them to `UNSUPPORTED_EXTRACTOR`, and the CLI skill whitelist (`juso_search.py` line 30) only exposes `("google", "bing", "baidu")`. The fix commit `8f54fbf` restructured the engine-definition sentence to separate navigation (all 5, later 6 with bilibili) from agent extraction (3), and reverted the agent paragraph to list only Google, Bing, Baidu.

## Guidance

Search Engine capability in Juso is layered across four independent registries. The shared `EngineId` union is an identifier set, not a capability declaration. Verify any feature claim against the capability-specific registry:

### Layer 1 — Navigation / SERP-mount (all registered engines)

Source of truth: `lib/engines/registry.ts`

```ts
const engines: Record<EngineId, SearchEngine> = {
  google: googleEngine,
  bing: bingEngine,
  baidu: baiduEngine,
  douyin: douyinEngine,
  xiaohongshu: xiaohongshuEngine,
  bilibili: bilibiliEngine,
  yandex: yandexEngine,
  duckduckgo: duckduckgoEngine,
};
```

Every engine in this registry supports: `buildSerpUrl`, `buildHomeUrl`, `matches`, `extractQuery`, SERP bar mounting via `anchors`. This is the human-facing navigation layer.

### Layer 2 — Agent extraction (per-engine extractor registry)

Source of truth: `lib/engines/extractors/registry.ts`

```ts
const extractors: Record<EngineId, EngineExtractor> = {
  google: googleExtractor,
  bing: bingExtractor,
  baidu: baiduExtractor,
  douyin: douyinExtractor,
  xiaohongshu: xiaohongshuExtractor,
  bilibili: bilibiliExtractor,
  yandex: yandexExtractor,
  duckduckgo: duckduckgoExtractor,
};
```

As of 2026-07-31, all eight registered engines have real extractors (the three Chinese sites were added after this doc was written — see _Status change_ below). The placeholder `UNSUPPORTED_EXTRACTOR` (`lib/engines/extractors/unsupported.ts`) is retained as a fallback mechanism for future engines not yet implementing DOM extraction:

```ts
export const UNSUPPORTED_EXTRACTOR: EngineExtractor = {
  extract: () => [],
  pageState: () => null,
  hasNaturalResultsArea: () => false,
};
```

`hasNaturalResultsArea → false` causes the extraction pipeline to return an `unsupported-layout` error rather than results. The full `Record<EngineId, EngineExtractor>` mapping exists to satisfy TypeScript exhaustiveness, not to declare capability.

#### Status change — the three Chinese sites now have real extractors

This doc was written (2026-07-23) when douyin/xiaohongshu/bilibili mapped to `UNSUPPORTED_EXTRACTOR` because they were login-walled SPAs rendering results via async APIs. They now ship real extractors (2026-07-31), each with site-specific DOM scraping:

- **bilibili** — `.bili-video-card` cards; rich snippet metadata (`UP主 · 播放 · 弹幕 · 时长`).
- **xiaohongshu** — `.note-item` cards; `/explore/{id}` links; untitled notes carry placeholder.
- **douyin** — heavily obfuscated: cards have no `<a>` links, so URL is synthesized from `waterfall_item_{id}` as `/video/{id}` or `/note/{id}`; `title` is the caption text.

The four-layer rule below still holds — it is now satisfied (all layers list all engines) rather than violated.

### Layer 3 — Skill CLI whitelist

Source of truth: `skills/juso-search/scripts/juso_search.py` line 30 + `SKILL.md` line 32.

```python
ENGINES = ("google", "bing", "baidu", "yandex", "duckduckgo", "bilibili", "xiaohongshu", "douyin")
```

As of 2026-07-31 the CLI whitelist covers all eight engines (mirroring the extractor registry). SKILL.md documents the full list plus per-engine notes on `snippet` content and URL handling.

### Layer 4 — Default visibility in quick-switch bar

Source of truth: `lib/schema.ts` versioned migrations.

```ts
// 版本化迁移：v2 添加 douyin/xiaohongshu，v3 添加 bilibili
const DEFAULT_HIDDEN_ENGINE_IDS_V2: readonly string[] = ['douyin', 'xiaohongshu'];
const DEFAULT_HIDDEN_ENGINE_IDS_V3: readonly string[] = ['bilibili'];
```

Douyin、Xiaohongshu 和 Bilibili 注册但默认隐藏在 UI 快切栏中（通过 schema 迁移 v2/v3 合并到 `sourceHidden`）。用户可在设置中取消隐藏。

### The rule

**Injection surface ≠ capability. Identifier union ≠ capability. Verify claims against the capability-specific registry.**

When adding a new engine:
- It enters Layer 1 automatically (register in `lib/engines/registry.ts`).
- Layer 2 requires an explicit decision: write a real extractor or map to `UNSUPPORTED_EXTRACTOR`.
- Layer 3 requires an explicit decision: add to `ENGINES` tuple in `juso_search.py` and update `SKILL.md`.
- Layer 4 requires an explicit decision: add to `DEFAULT_HIDDEN_ENGINE_IDS` or leave visible.
- Document each layer's support list where users/agents see it (README agent paragraph, SKILL.md, engine-definition sentence).

## Why This Matters

- A shared identifier union (`EngineId`) implies uniform capability to anyone reading the type. The asymmetry is intentional and code-commented but invisible at the type level—TypeScript cannot distinguish "registered for navigation" from "supports extraction."
- Doc over-claims promise agents capabilities that return `unsupported-layout` errors at runtime. An agent following the README would call `engine-search --engine douyin`, get a parse error from the CLI whitelist, or (if the whitelist were bypassed) an `unsupported-layout` from the extractor stub.
- The three registries (extractor registry, CLI whitelist, default-hidden list) can drift independently. Adding an engine to Layer 1 without updating Layers 2–4 creates silent mismatches. The v1.1.0 incident was exactly this drift surfacing in documentation.
- The manifest injection surface (`ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS` covering all 5 hosts) is a necessary condition for extraction but not a sufficient one—it exists so the content script can receive messages on challenge/consent redirect pages, not because extraction is implemented.

## When to Apply

- Writing or reviewing README/SKILL.md sentences about what agents can do with search engines.
- Adding a new engine to the extension (DuckDuckGo, Yandex, etc.)—decide each layer explicitly.
- Debugging an agent `unsupported-layout` error for an engine the UI shows in the quick-switch bar.
- Reviewing PRs that touch engine lists in documentation—check which layer the sentence refers to.
- Evaluating whether `wxt.config.ts` match patterns or `EngineId` membership implies a feature.

## Examples

### Before/After: engine-definition sentence

**Before (commit `628242a`, over-claim):**

> 传统搜索引擎：Google、Bing、Baidu、抖音、小红书。它们不使用 API 密钥；Juso 通过浏览器导航，供人直接使用，或为智能体提取普通搜索结果。

> Conventional Search Engines: Google, Bing, Baidu, Douyin, and Xiaohongshu. They use no API key; Juso navigates a browser for people to use directly or for agents to extract ordinary search results.

**After (commit `8f54fbf`, fix):**

> 传统搜索引擎：Google、Bing、Baidu、抖音、小红书。它们不使用 API 密钥；Juso 通过浏览器导航，供人直接使用；其中 Google、Bing、Baidu 还支持智能体提取普通搜索结果。

> Conventional Search Engines: Google, Bing, Baidu, Douyin, and Xiaohongshu. They use no API key; Juso navigates a browser for people to use directly; Google, Bing, and Baidu also let agents extract ordinary search results.

### Before/After: agent paragraph

**Before:**

> 完成后，本地智能体可列出已配置的服务、以**显式**服务参数进行 API 搜索，或通过浏览器检索 Google、Bing、Baidu、抖音、小红书，而不会取得已存储的密钥。

> The local agent can now list configured services, perform API searches with an **explicit** provider, or search Google, Bing, Baidu, Douyin, and Xiaohongshu through the browser—without receiving stored credentials.

**After:**

> 完成后，本地智能体可列出已配置的服务、以**显式**服务参数进行 API 搜索，或通过浏览器检索 Google、Bing、Baidu，而不会取得已存储的密钥。

> The local agent can now list configured services, perform API searches with an **explicit** provider, or search Google, Bing, and Baidu through the browser—without receiving stored credentials.

### Layer checklist

| Layer | Source of truth | Current support (2026-07-31) | Evidence of absence |
|-------|----------------|------------------------------|---------------------|
| 1 — Navigation / SERP bar | `lib/engines/registry.ts` | all 8 engines | — |
| 2 — Agent extraction | `lib/engines/extractors/registry.ts` | all 8 engines (Chinese sites added 2026-07-31) | `UNSUPPORTED_EXTRACTOR` retained but unused — fallback for future engines |
| 3 — Skill CLI whitelist | `juso_search.py` `ENGINES` + `SKILL.md` | all 8 engines | — |
| 4 — Default visibility | `lib/schema.ts` `DEFAULT_HIDDEN_ENGINE_IDS` | hidden: douyin, xiaohongshu (v2), bilibili (v3) | yandex/duckduckgo default-visible |

### Misleading signal that caused the incident

`wxt.config.ts` + `lib/engines/scopes.ts`:

```ts
export const ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS = SERP_HOST_MATCH_PATTERNS;
// SERP_HOST_MATCH_PATTERNS includes https://www.douyin.com/* and https://www.xiaohongshu.com/*
```

This injection surface exists so the extractor content script can receive messages on challenge/consent redirect pages for all engines. It does not mean extraction is implemented for every injected host.

## Related

- [Standardized provider/engine adapter layers](./standardized-provider-engine-adapter-layers.md) — adapter structure and "add an engine" checklist; does not yet cover the extraction-subset distinction or the skill whitelist steps
- [Agent skill localhost capability bridge](./agent-skill-localhost-capability-bridge.md) — engine-search architecture; implicitly relies on the 3-engine extraction subset
- [Engine-search orchestration errors and Baidu URL extraction](../logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md) — error taxonomy within the supported extraction boundary
- [Google SERP extractor nested wrapper](../logic-errors/google-serp-extractor-nested-wrapper.md) — extraction fragility within a supported engine
- [SERP bar SPA remount and last-resort upgrade](../ui-bugs/serp-bar-spa-remount-and-last-resort-upgrade.md) — douyin/xiaohongshu SERP bar and the schema v2 default-hidden migration
- [Source-level favicon field pipeline](../design-patterns/source-level-favicon-field-pipeline.md) — unified source model across all 5 engines
- [Hidden source still active across hosts](../ui-bugs/hidden-source-still-active-across-hosts.md) — runtime hiding of default-hidden engines
