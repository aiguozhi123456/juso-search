---
title: Adding REST Search Providers (Jina and Brave)
date: 2026-07-27
last_updated: 2026-07-28
category: tooling-decisions
module: providers
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - "Adding a new REST-based search provider to the WXT extension"
  - "Implementing provider adapters following the defineProvider + restTransport pattern"
tags:
  - jina
  - brave-search
  - search-provider
  - rest-adapter
  - get-request
  - chrome-extension
  - provider-registry
---

# Adding REST Search Providers (Jina and Brave)

## Context

Jina AI and Brave Search were added as REST providers to the extension's normalized BYOK provider system. Each addition required researching the provider API, implementing an adapter, wiring it into the registry, adding localized presentation assets and manifest permissions, and updating tests whose canonical source-order expectations shifted.

## Guidance

The extension uses a registry-driven provider system. Adding a REST provider touches the adapter, `ProviderId`, registry, i18n/locales, brand icon, and the manifest's host and web-accessible-resource declarations.

### 1. Adapter definition (`lib/providers/<id>.ts`)

Use `defineProvider` + `restTransport`. The adapter owns the endpoint, request shape, and normalization. It does not call `t()` itself — `restTransport` resolves the i18n label internally.

```ts
import type { NormalizedResult } from './types';
import { defineProvider, type NormalizedBody } from './base';
import { restTransport } from './http';

interface JinaResult {
  title?: string;
  description?: string;
  url: string;
  content?: string;
  usage?: { tokens?: number };
}
interface JinaResponse {
  code?: number;
  status?: number;
  data?: JinaResult[];
}

const ENDPOINT = 'https://s.jina.ai/';
const LABEL = 'provider_jina';

export const jinaAdapter = defineProvider<JinaResponse>({
  id: 'jina',
  label: LABEL,
  supportsAnswer: false,
  favicon: '/icons/jina.svg',
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Retain-Images': 'none',
          'X-Respond-With': 'no-content',
        },
        body: JSON.stringify({ q: query, num: opts.maxResults ?? 5 }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results: NormalizedResult[] = (data.data ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.description ?? r.content?.slice(0, 300) ?? '',
      content: r.content || undefined,
    }));
    return { results };
  },
});
```

Use the shared transport's GET path when the provider contract puts its input in query parameters. Brave Search uses a subscription-token header rather than Bearer authentication and returns web results below `web.results`:

```ts
export const braveAdapter = defineProvider<BraveResponse>({
  id: 'brave',
  label: 'provider_brave',
  supportsAnswer: false,
  favicon: '/icons/brave.svg',
  transport: restTransport({
    endpoint: 'https://api.search.brave.com/res/v1/web/search',
    label: 'provider_brave',
    method: 'GET',
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
        params: {
          q: query,
          count: String(Math.min(opts.maxResults ?? 8, 20)),
          result_filter: 'web',
          text_decorations: 'false',
        },
      };
    },
  }),
  normalize(_query, data) {
    return {
      results: (data.web?.results ?? []).map((result) => ({
        title: result.title ?? result.url,
        url: result.url,
        snippet: result.description || result.extra_snippets?.join(' … ') || '',
      })),
    };
  },
});
```

Keep a provider's request-specific details inside its adapter. Extend `restTransport` only at the HTTP boundary when the differing request shape is generally reusable; its GET support serializes `params` into the URL while preserving existing POST behavior.

### 2. `ProviderId` union (`lib/providers/types.ts`)

Append the new id to the union so the type system recognizes it everywhere:

```ts
export type ProviderId = 'tavily' | 'exa' | 'stepfun' | 'stepfun-plan' | 'jina' | 'brave' | 'doubao' | 'doubao-global';
```

### 3. Registry (`lib/providers/registry.ts`)

Import the adapter, add it to the `adapters` record, and append it to `allProviders()`. The order here determines the canonical default source order used by `normalizeSourceOrder` in `lib/sources.ts`.

```ts
import { jinaAdapter } from './jina';
import { braveAdapter } from './brave';

const adapters: Record<ProviderId, ProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  stepfun: stepfunAdapter,
  'stepfun-plan': stepfunPlanAdapter,
  jina: jinaAdapter,
  brave: braveAdapter,
  doubao: doubaoAdapter,
  'doubao-global': doubaoGlobalAdapter,
};

export function allProviders(): ProviderAdapter[] {
  return [
    adapters.tavily,
    adapters.exa,
    adapters.stepfun,
    adapters['stepfun-plan'],
    adapters.jina,
    adapters.brave,
    adapters.doubao,
    adapters['doubao-global'],
  ];
}
```

### 4. i18n message constants (`lib/i18n.ts`)

Add a `provider_<id>` entry to the `MSG` constant so `t(MSG.provider_jina)` resolves:

```ts
export const MSG = {
  // …
  provider_jina: 'provider_jina',
} as const;
```

### 5. Locale messages (`public/_locales/zh_CN/messages.json` and `…/en/messages.json`)

Add the display name for both locales:

```json
"provider_jina": { "message": "Jina" }
```

### 6. Brand icon (`public/icons/<id>.svg`)

Place a brand SVG in `public/icons/`. The icon is referenced by the adapter's `favicon` field and must be declared in `wxt.config.ts` `web_accessible_resources` so it can be loaded inside the SERP shadow root. Add the provider API origin to `host_permissions` as well.

## Why This Matters

The provider system is registry-driven, not convention-driven. Adding a provider is mechanical but touches union types, the registry record, i18n message constants, both locale message files, the icon directory, `web_accessible_resources`, host permissions, and any test that hard-codes the canonical source order. The canonical default source order is derived directly from `allProviders()` in `lib/providers/registry.ts`, which feeds `DEFAULT_SOURCE_ORDER` in `lib/sources.ts`. Adding a new entry shifts that order and causes hard-coded expectations in pre-existing tests to diverge.

The BYOK trust boundary is unchanged for every adapter: API keys are stored in `chrome.storage.local` and read only by background-worker helpers. Configuration and search pages receive sanitized status through worker messaging, never the stored key map.

## When to Apply

- Adding any new REST-based search provider to this extension.
- Adding a provider whose HTTP API uses URL query parameters rather than the existing JSON POST request shape.
- Also applies when adding an MCP-based provider, except the transport wiring uses `mcpClientTransport` instead of `restTransport`.

## Examples

**Icon iteration lesson:** The first two icon attempts (a generic "J" monogram and an abstract geometric mark) were rejected by the user. The accepted version used the official Jina brand SVG path with brand colors (`#EB6161` red dot, `#009191` teal body):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" role="img" aria-label="Jina">
  <path fill="#EB6161" fill-rule="evenodd" d="M6.608 21.416a4.608 4.608 0 100-9.217 4.608 4.608 0 000 9.217z"/>
  <path fill="#009191" fill-rule="evenodd" d="M20.894 2.015c.614 0 1.106.492 1.106 1.106v9.002c0 5.13-4.148 9.309-9.217 9.37v-9.355l-.03-9.032c0-.614.491-1.106 1.106-1.106h7.158l-.123.015z"/>
</svg>
```

When adding a provider icon, use the official brand SVG rather than inventing a monogram.

**Test ripple:** Adding a provider changes hard-coded canonical provider or source-order expectations. Check at least:

- `tests/config-io.test.ts` — `buildExportPayload`, `parseImportPayload`, `mergeImport`, and `previewImport` cases all reference the canonical normalized order.
- `tests/sources.test.ts` — `normalizeSourceOrder` fallback expectations and `DEFAULT_SOURCE_ORDER` comments.
- `tests/providers.test.ts` — `allProviders()` id list and `supportsAnswer`/`favicon` parameterized cases.
- `tests/gateway.test.ts` — `allProviders` mock list and any source-order assertion.
- `tests/storage.test.ts` and `tests/options-page.test.tsx` — provider list or fallback order assertions.

For a GET provider, add focused adapter coverage for the request method, URL query encoding, authentication header, result normalization, and network/HTTP error mapping. Brave's adapter test verifies its `count` is capped at the API maximum of 20.

## Related

- `docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md` — the general pattern for adding a new provider (REST or MCP) via `defineProvider` + transport.
- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` — normalizing heterogeneous provider responses into `NormalizedSearchResponse` and the BYOK key flow.
- `docs/solutions/design-patterns/source-level-favicon-field-pipeline.md` — the icon asset pipeline, including `web_accessible_resources` registration for shadow-DOM loading.
- `docs/solutions/workflow-issues/cws-store-docs-must-sync-with-release-features.md` — CWS listing, privacy questionnaire, and privacy policy must be updated when a new network endpoint is added.
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — i18n parity requirements when adding new provider message keys.

## References

- https://docs.jina.ai — Jina AI official docs (Search API, Reader API, headers, rate limits)
- https://jina.ai/reader/ — Reader API rate-limit/pricing table and live endpoint behavior
- https://github.com/jina-ai/reader — Jina Reader GitHub README (GET/POST usage, header semantics, JSON mode)
- https://api-dashboard.search.brave.com/api-reference/web/search/get — Brave Web Search API reference (endpoint, query parameters, and authentication)
