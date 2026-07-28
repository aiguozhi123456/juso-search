---
title: "Doubao search provider integration: dual API versions and HTTP 200 business-error mapping"
date: 2026-07-28
category: tooling-decisions
module: providers
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - Adding a new REST-based search provider adapter under lib/providers/
  - A provider returns HTTP 200 with a null payload plus error metadata instead of a non-2xx status code, so errors must be mapped inside the adapter's normalize function rather than by restTransport
  - Integrating two API versions of the same provider brand as dual adapters sharing one icon (the stepfun/stepfun-plan pattern)
  - Auditing host_permissions, web_accessible_resources, CSS, and store docs for provider coverage after adding a provider
tags: [doubao, search-provider, business-error, adapter, provider-error, wxt, byok]
---

# Doubao search provider integration: dual API versions and HTTP 200 business-error mapping

## Context

A user requested Doubao (豆包搜索) search provider support for a WXT Chrome extension BYOK search aggregator. The extension uses a registry-driven provider system where each provider is a self-contained adapter built from `defineProvider` + `restTransport`. Two API versions were integrated as dual providers — a Custom版 (`doubao`) and a Global版 (`doubao-global`) — following the existing `stepfun` / `stepfun-plan` dual-provider precedent.

The novel challenge specific to Doubao: both API versions return HTTP `200` with `Result: null` and `ResponseMetadata.Error` on business errors (auth failures, rate limits, quota exhaustion). The existing `restTransport` only maps non-2xx HTTP status codes to `ProviderError` kinds, so these `200`-with-business-error responses would slip through as "successful" empty results, surfacing as silent failures rather than actionable user-facing errors. This gap required a new shared business-error mapping pattern layered on top of the standard provider scaffold.

## Guidance

**1. The standard 6-touchpoint provider addition**

Adding a REST provider to this codebase is a mechanical six-touchpoint process, identical to the one documented for jina (`docs/solutions/tooling-decisions/jina-search-provider.md`). Reference that doc for the canonical checklist rather than repeating it here — the touchpoints are:

1. **Adapter** — `lib/providers/<name>.ts` exporting a `ProviderAdapter` built with `defineProvider({ ... restTransport({ ... }) })`.
2. **Types union** — add the provider id literal to the `ProviderId` union in `lib/providers/types.ts`.
3. **Registry** — register the adapter in `lib/providers/registry.ts` (the `adapters` record and `allProviders()` function drive the UI list and worker dispatch).
4. **i18n MSG** — add `provider_<name>` to the `MSG` enum in `lib/i18n.ts`.
5. **Locale files** — add zh / en entries under `public/_locales/`.
6. **Icon** — drop a brand SVG into `public/icons/` and declare it in `wxt.config.ts` `web_accessible_resources`.

Doubao follows this scaffold unchanged. What differs — and what this document is about — is the error-handling layer inside the adapter, because Doubao's API does not signal failure through HTTP status codes.

**2. The novel pattern: shared business-error mapping for HTTP 200 APIs**

The key learning. When an API returns `200 OK` with a business-error envelope, `restTransport` cannot classify the failure because its error map keys on HTTP status. The fix is a thin shared mapper that the adapter's `normalize` function calls when it detects the `Result: null` sentinel.

For Doubao, both API versions share the same Volcengine error envelope (`ResponseMetadata.Error` with `CodeN` numeric and `Code` string fields), so the mapper lives in a single `doubao-shared.ts` module consumed by both adapters:

```ts
import { ProviderError } from './types';
import { appendProviderErrorDetail } from './http';
import { t, MSG } from '@/lib/i18n';

export interface DoubaoError {
  CodeN?: number;
  Code?: string;
  Message?: string;
}

export interface DoubaoResponseMetadata {
  RequestId?: string;
  Error?: DoubaoError;
}

export function mapDoubaoError(error: DoubaoError | undefined, label: string): ProviderError {
  const code = error?.CodeN ?? parseInt(error?.Code ?? '', 10);
  const message = error?.Message;
  if (code === 10401 || code === 10403 || code === 700901) {
    return new ProviderError('unauthorized', appendProviderErrorDetail(t(MSG.error_http_unauthorized, label), message));
  }
  if (code === 700429 || code === 10406 || code === 10412) {
    return new ProviderError('rateLimit', appendProviderErrorDetail(t(MSG.error_http_rate_limit, label), message));
  }
  return new ProviderError('provider', appendProviderErrorDetail(t(MSG.error_http_generic, [label, String(code ?? 'unknown')]), message));
}
```

The mapper:

- Coerces both numeric (`CodeN`) and string (`Code`) code forms to a single number, so adapters across API versions that populate different fields still hit the same branches.
- Clusters known Volcengine business codes into the existing `ProviderError` kinds (`unauthorized`, `rateLimit`, `provider`) so the UI and worker retry logic treat them identically to HTTP-level failures.
- Uses `appendProviderErrorDetail` to attach the provider's own `Message` to the localized user-facing string, preserving diagnosability without leaking raw provider text as the primary message.

**3. How normalize calls it**

The `normalize` function is the single point where a `200`-with-business-error response becomes a thrown `ProviderError`. The sentinel is `!data.Result` — both Doubao versions populate `Result` only on success, so its absence is the reliable failure signal regardless of which business code the envelope carries:

```ts
normalize(query, data): NormalizedBody {
  if (!data.Result) throw mapDoubaoError(data.ResponseMetadata?.Error, t(LABEL));
  const results: NormalizedResult[] = (data.Result.WebResults ?? []).map((r) => ({
    title: r.Title ?? r.Url ?? '',
    url: r.Url ?? '',
    snippet: r.Snippet ?? r.Summary?.slice(0, 300) ?? '',
    content: r.Content || r.Summary || undefined,
    score: r.RankScore,
    publishedDate: r.PublishTime || undefined,
    favicon: r.LogoUrl || undefined,
  }));
  return { results };
}
```

Throwing from `normalize` (rather than returning an empty result set) is what lets the worker's existing error-handling pipeline classify, message, and retry the failure — the same path non-2xx HTTP errors take through `restTransport`.

**4. Dual-provider pattern**

Doubao ships as two adapters — `doubao` (Custom版) and `doubao-global` (Global版) — mirroring the `stepfun` / `stepfun-plan` precedent. The pattern: two adapters that share a brand identity differ only in endpoint, auth header shape, request body, and result-shape normalization, while reusing:

- one brand icon (`doubao.svg`, the way `stepfun.svg` backs both stepfun adapters),
- one error mapper (`doubao-shared.ts`'s `mapDoubaoError`),
- one `LABEL` / i18n message key family.

The `doubao-global` adapter's additional wrinkle is that its `Result` is a list of `Document` objects, each carrying a `Snippet` array whose entries can be text or image typed. Its normalize joins the text-typed snippets to produce the unified `snippet` / `content` fields, while the Custom版 reads `WebResults` directly. Both converge on the same `NormalizedResult` shape, so the rest of the pipeline (ranking, rendering, dedup) is agnostic to which Doubao API version answered.

**5. Pre-existing gap fixes**

Adding a new provider is the right moment to audit whether existing providers have accumulated the same gaps the new one would otherwise expose. While wiring Doubao, the audit found and fixed gaps in the existing jina provider that predated this work:

- `jina` missing from `host_permissions` in the manifest — `s.jina.ai` requests would fail at runtime on the network permission check.
- `jina.svg` missing from `web_accessible_resources` — the icon could not be rendered in contexts that require resource listing.
- Missing CSS rules in the provider-color stylesheets — jina's brand color was not applied to provider chips.
- `PROVIDERS` tuple in `skills/` referencing a stale provider set — jina was absent.
- Chrome Web Store store-listing docs referencing a stale provider roster.

The principle: the new-provider scaffold is also a regression test for the registry. If the new provider needs a host permission, an icon entry, a CSS rule, and a docs mention, the existing providers almost certainly need the same audit at the same time.

## Why This Matters

- **The shared error-mapping pattern is reusable.** Any future provider whose API returns HTTP `200` with business errors — a convention common among Chinese API providers (Volcengine, ByteDance, and similar stacks that wrap RPC-style semantics behind REST transport) — can follow the `doubao-shared.ts` approach: detect the `Result: null` (or equivalent business-failure sentinel) in `normalize`, then map business error codes to `ProviderError` kinds. The worker's retry, messaging, and UI classification paths then work without changes, because they only ever see `ProviderError`.
- **The dual-provider pattern extends the stepfun/stepfun-plan precedent.** Two API versions of the same brand share an icon, a label family, and an error mapper, differing only in transport and normalization. This keeps the provider list coherent to users (one brand, two entries) while avoiding duplicated error-handling code.
- **The pre-existing gap audit matters as a process habit.** Provider scaffolding drifts: manifest permissions, CSS rules, docs, and skills tuples all lag behind adapter additions. Treating "add a provider" as the trigger to audit the whole registry — not just the new entry — is what keeps the registry internally consistent. The jina gaps found during the Doubao work would otherwise have remained latent runtime bugs.

## When to Apply

- Adding a REST-based search provider whose API returns HTTP `200` with business errors (not just non-2xx HTTP status codes). Detect the failure sentinel in `normalize` and throw a mapped `ProviderError` — do not let it surface as an empty result set.
- Adding a dual-provider variant of an existing provider (same brand, different API version or endpoint). Reuse the brand icon, error mapper, and label family; isolate the differences to transport and result normalization.
- When adding any new provider — audit the existing providers in the registry for the same gaps (host permissions, web-accessible resources, CSS color rules, skills tuples, docs). The new-provider scaffold doubles as a registry-wide regression check.

## Examples

The two Doubao API versions differ in request body shape. Custom版 takes a `SearchType` and a `Filter` object; Global版 takes `DocCount` and a `MaxSnippetLength`:

Custom版 (`doubao`):

```ts
body: JSON.stringify({
  Query: query,
  SearchType: 'web',
  Count: opts.maxResults ?? 10,
  Filter: { NeedUrl: true },
}),
```

Global版 (`doubao-global`):

```ts
body: JSON.stringify({
  Query: query,
  DocCount: opts.maxResults ?? 10,
  MaxSnippetLength: 1000,
}),
```

Both share the same `Query` field and the same `ResponseMetadata.Error` envelope on failure, which is why the shared `mapDoubaoError` works for both. The body-shape divergence is exactly the kind of API-version difference the dual-provider pattern is designed to isolate: each adapter owns its own request body, while everything downstream (error mapping, brand identity, normalized result shape) is shared.

## Related

- `docs/solutions/tooling-decisions/jina-search-provider.md` — the 6-touchpoint process for adding a REST provider (this doc extends it with the shared error-mapping pattern).
- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` — normalizing heterogeneous provider responses.
- `docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md` — the `defineProvider` + transport pattern.
