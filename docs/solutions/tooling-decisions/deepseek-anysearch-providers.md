---
title: Adding REST Search Providers (DeepSeek Search and AnySearch)
date: 2026-10-25
category: tooling-decisions
module: providers
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - "Adding a new REST-based search provider to the WXT extension"
  - "Integrating a provider with a business-code envelope (HTTP 200 + code!==0)"
  - "Reusing a brand icon across an ai-engine and a provider"
tags:
  - deepseek
  - anysearch
  - search-provider
  - rest-adapter
  - business-code-envelope
  - chrome-extension
  - provider-registry
---

# Adding REST Search Providers (DeepSeek Search and AnySearch)

## Context

DeepSeek's official Search API (`POST https://api.deepseek.com/v1/tools/search`, Bearer) and
AnySearch (`POST https://api.anysearch.com/v1/search`, Bearer) were added as the tenth and
eleventh REST providers. Both are answer-less (`supportsAnswer: false`) and follow the
6-touchpoint checklist documented in `jina-search-provider.md`; this record focuses on what
differs from the earlier additions.

## Guidance

### DeepSeek Search specifics

- Response `results[]` carries `snippet` (UI, ~200 chars) **and** `summary` (model-facing,
  ~800 chars). Map `snippet ← snippet || summary` and `content ← summary` so the SERP card
  shows the short text while agent-side consumers keep the longer one.
- `count` accepts 1–50; the storage-side maxResults clamp is 1–20, so the adapter clamps
  again (`Math.min(Math.max(opts.maxResults ?? 10, 1), 50)`) — same pattern as Brave's cap.
- `need_content` stays off: billing is per successful request regardless of `count`, but
  pulling full page content adds latency; snippet+summary covers both surfaces.
- Rich per-result fields map directly: `rerank_score → score`, `date → publishedDate`,
  `site_icon → favicon`.
- Errors are OpenAI-compatible (`{error: {message, ...}}`); `readProviderErrorDetail`
  already extracts the nested `message`, so no custom error mapping was needed.
- The brand icon is shared with the `ai:deepseek` chat engine
  (`favicon: '/icons/ai-deepseek.svg'`) — same sharing precedent as stepfun-plan/doubao-global.
  The provider id `deepseek` cannot collide with the ai-engine id `ai:deepseek` because
  `AiEngineId` is namespaced with the `ai:` prefix.

### AnySearch specifics

- The response is a business-code envelope `{code, message, request_id, data}`. Errors are
  delivered via HTTP status codes, but HTTP 200 + `code !== 0` is defensively mapped to
  `ProviderError('provider')` with a dedicated `error_anysearch_business` i18n template —
  the same reasoning as `error_doubao_business`: the business code is not an HTTP status, so
  `error_http_generic` ("$1: HTTP $2") would mislead.
- `title` may be an empty string (fallback to `url`, using `||` not `??`).
- `max_results` has a hard upstream cap of 10 — below the storage-side 1–20 clamp — so the
  adapter clamps to 10 and users cannot get more regardless of the stored setting.
- The upstream anonymous tier (IP rate limits; a 402 auto-registration flow that returns
  generated credentials) is intentionally **not** wired in: the gateway has a hard keyMissing
  gate for every provider (`lib/gateway.ts` runProviderSearch). Supporting keyless operation
  would need a per-provider "key optional" concept, which is out of scope; BYOK parity with
  the other providers is the chosen behavior. The whole anonymous 402 response is also
  sensitive (credentials in the body), another reason to keep it out of adapter paths that
  surface `errorDetail`.
- The brand icon (`public/icons/anysearch.svg`) reproduces the official mark pixel-sampled from
  the website logo: a 4×4 block grid in two blues (`#2D5DED` dark / `#3587FC` light) —
  full-height dark left bar, top row dark|light|light|dark, light cell below the dark
  top-right corner, bottom row dark|light|·|dark — following the house SVG style
  (1em/24-viewBox, `<title>`, flat rects). It must also be copied to `website/static/icons/`
  (the `test_check_website_assets` drift test fails otherwise).

### Shared checklist

For both providers the standard ripple applied: `ProviderId` union, registry record and
`allProviders()` tail, `MSG` keys, both locale files, `host_permissions`, `FAVICON_RESOURCES`
(anysearch only — ai-deepseek.svg was already listed), colorful-mode color entries in
`entrypoints/shared/serp-bar-styles.ts` (deepseek=blue, anysearch=cyan), and the canonical
source-order assertions in `tests/providers.test.ts`, `tests/sources.test.ts`,
`tests/storage.test.ts`, and `tests/config-io.test.ts`.

The Python skill / MCP server needed **no** changes: both surfaces discover the provider
vocabulary at runtime via the `list-providers` bridge action (see
`skill-mcp-vocabulary-decoupling.md`).

## Why This Matters

Both providers exercised corners the earlier REST additions had not: a business-code
envelope layered over HTTP status codes, a per-result field pair (`snippet`/`summary`) that
maps to two different `NormalizedResult` fields, an upstream result cap (10) below the
storage clamp (20), and brand-icon sharing across the ai-engine and provider id spaces.
Recording them keeps the next provider addition mechanical.

## When to Apply

- Adding a REST provider whose errors use a business-code envelope inside HTTP 200.
- Adding a provider whose brand already ships as an ai-engine icon.
- Adding a provider with an anonymous/keyless tier (decide explicitly whether to require the
  key; the gateway currently requires one for every provider).

## Related

- `docs/solutions/tooling-decisions/jina-search-provider.md` — the canonical 6-touchpoint
  checklist for REST provider additions.
- `docs/solutions/tooling-decisions/doubao-search-provider.md` — the business-code error
  mapping precedent (`error_doubao_business`).
- `docs/solutions/architecture-patterns/skill-mcp-vocabulary-decoupling.md` — why the
  Python/MCP side needs no provider-list edits.
- `docs/solutions/architecture-patterns/derive-provider-id-set-from-registry.md` — why only
  `types.ts` + `registry.ts` need touching for id sets.

## References

- https://api-docs.deepseek.com/api/search — DeepSeek Search API reference
- https://api-docs.deepseek.com/guides/search — Search & Fetch guide (errors, billing, operators)
- https://anysearch.com/docs/api-endpoints/v1-search — AnySearch /v1/search reference
