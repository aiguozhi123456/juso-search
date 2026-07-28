---
title: Adding Jina AI as a Search Provider
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
  - search-provider
  - rest-adapter
  - chrome-extension
  - provider-registry
---

# Adding Jina AI as a Search Provider

## Context

A user requested Jina AI search support. The work required adding a new provider end-to-end: researching the API, implementing the adapter, wiring it into the registry, adding i18n labels and locale entries, providing a brand icon, and updating tests whose canonical source-order expectations shifted.

## Guidance

The extension uses a registry-driven provider system. Adding a REST provider touches six places:

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

### 2. `ProviderId` union (`lib/providers/types.ts`)

Append the new id to the union so the type system recognizes it everywhere:

```ts
export type ProviderId = 'tavily' | 'exa' | 'stepfun' | 'stepfun-plan' | 'jina' | 'doubao' | 'doubao-global';
```

### 3. Registry (`lib/providers/registry.ts`)

Import the adapter, add it to the `adapters` record, and append it to `allProviders()`. The order here determines the canonical default source order used by `normalizeSourceOrder` in `lib/sources.ts`.

```ts
import { jinaAdapter } from './jina';

const adapters: Record<ProviderId, ProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  stepfun: stepfunAdapter,
  'stepfun-plan': stepfunPlanAdapter,
  jina: jinaAdapter,
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

Place a minimal SVG in `public/icons/`. The icon is referenced by the adapter's `favicon` field and must be declared in `wxt.config.ts` `web_acceptable_resources` so it can be loaded inside the SERP shadow root.

## Why This Matters

The provider system is registry-driven, not convention-driven. Adding a provider is mechanical but touches union types, the registry record, i18n message constants, both locale message files, the icon directory, `web_acceptable_resources`, and any test that hard-codes the canonical source order. The canonical default source order is derived directly from `allProviders()` in `lib/providers/registry.ts`, which feeds `DEFAULT_SOURCE_ORDER` in `lib/sources.ts`. Adding a new entry shifts that order and causes hard-coded expectations in pre-existing tests to diverge.

## When to Apply

- Adding any new REST-based search provider to this extension.
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

**Test ripple:** After adding Jina, four pre-existing test files required updates to their hard-coded `sourceOrder` expectations:

- `tests/config-io.test.ts` — `buildExportPayload`, `parseImportPayload`, `mergeImport`, and `previewImport` cases all reference the canonical normalized order.
- `tests/sources.test.ts` — `normalizeSourceOrder` fallback expectations and `DEFAULT_SOURCE_ORDER` comments.
- `tests/providers.test.ts` — `allProviders()` id list and `supportsAnswer`/`favicon` parameterized cases.
- `tests/gateway.test.ts` — `allProviders` mock list and any source-order assertion.

## Related

- `docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md` — the general pattern for adding a new provider (REST or MCP) via `defineProvider` + transport.
- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` — normalizing heterogeneous provider responses into `NormalizedSearchResponse` and the BYOK key flow.
- `docs/solutions/design-patterns/source-level-favicon-field-pipeline.md` — the icon asset pipeline, including `web_acceptable_resources` registration for shadow-DOM loading.
- `docs/solutions/workflow-issues/cws-store-docs-must-sync-with-release-features.md` — CWS listing, privacy questionnaire, and privacy policy must be updated when a new network endpoint is added.
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — i18n parity requirements when adding new provider message keys.

## References

- https://docs.jina.ai — Jina AI official docs (Search API, Reader API, headers, rate limits)
- https://jina.ai/reader/ — Reader API rate-limit/pricing table and live endpoint behavior
- https://github.com/jina-ai/reader — Jina Reader GitHub README (GET/POST usage, header semantics, JSON mode)
