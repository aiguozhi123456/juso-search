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
3. The `EngineId` union in `lib/engines/types.ts` lists all 5 identifiers: `'google' | 'bing' | 'baidu' | 'douyin' | 'xiaohongshu'`.

From these three signals the doc edit concluded: "all 5 engines support agent extraction." The sentence "Juso 通过浏览器导航，供人直接使用，或为智能体提取普通搜索结果" (zh) / "Juso navigates a browser for people to use directly or for agents to extract ordinary search results" (en) was expanded to include Douyin and Xiaohongshu without qualification.

The user caught the error: Douyin and Xiaohongshu are login-walled SPAs whose results render through async APIs, not server-rendered DOM. The extractor registry (`lib/engines/extractors/registry.ts`) explicitly maps them to `UNSUPPORTED_EXTRACTOR`, and the CLI skill whitelist (`juso_search.py` line 30) only exposes `("google", "bing", "baidu")`. The fix commit `8f54fbf` restructured the engine-definition sentence to separate navigation (all 5) from agent extraction (3), and reverted the agent paragraph to list only Google, Bing, Baidu.

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
  // 抖音 / 小红书暂不做 headless 结果抽取：登录态 SPA，结果经异步接口渲染。
  // 用占位 extractor 满足全映射，归一为 'unsupported-layout'。
  douyin: UNSUPPORTED_EXTRACTOR,
  xiaohongshu: UNSUPPORTED_EXTRACTOR,
};
```

The placeholder (`lib/engines/extractors/unsupported.ts`):

```ts
export const UNSUPPORTED_EXTRACTOR: EngineExtractor = {
  extract: () => [],
  pageState: () => null,
  hasNaturalResultsArea: () => false,
};
```

`hasNaturalResultsArea → false` causes the extraction pipeline to return an `unsupported-layout` error rather than results. The full `Record<EngineId, EngineExtractor>` mapping exists to satisfy TypeScript exhaustiveness, not to declare capability.

### Layer 3 — Skill CLI whitelist

Source of truth: `skills/juso-search/scripts/juso_search.py` line 30 + `SKILL.md` line 32.

```python
ENGINES = ("google", "bing", "baidu")
```

The CLI rejects `--engine douyin` or `--engine xiaohongshu` at argument-parse time. SKILL.md documents: "`engine-search` supports `google`, `bing`, and `baidu`."

### Layer 4 — Default visibility in quick-switch bar

Source of truth: `lib/schema.ts` line 31.

```ts
const DEFAULT_HIDDEN_ENGINE_IDS: readonly string[] = ['douyin', 'xiaohongshu'];
```

Douyin and Xiaohongshu are registered but hidden by default in the UI quick-switch bar (schema migration v2 merges them into `sourceHidden`). Users can un-hide them in settings.

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

| Layer | Source of truth | Current support | Evidence of absence |
|-------|----------------|-----------------|---------------------|
| 1 — Navigation / SERP bar | `lib/engines/registry.ts` | google, bing, baidu, douyin, xiaohongshu | — |
| 2 — Agent extraction | `lib/engines/extractors/registry.ts` | google, bing, baidu | `douyin: UNSUPPORTED_EXTRACTOR, xiaohongshu: UNSUPPORTED_EXTRACTOR` |
| 3 — Skill CLI whitelist | `juso_search.py` `ENGINES` + `SKILL.md` | google, bing, baidu | tuple excludes douyin/xiaohongshu |
| 4 — Default visibility | `lib/schema.ts` `DEFAULT_HIDDEN_ENGINE_IDS` | hidden: douyin, xiaohongshu | migration v2 merges into `sourceHidden` |

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
