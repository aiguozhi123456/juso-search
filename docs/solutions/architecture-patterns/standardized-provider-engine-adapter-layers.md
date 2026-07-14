---
title: "Standardize extension points, not shapes: parallel adapter layers (provider + engine)"
date: 2026-07-09
category: docs/solutions/architecture-patterns
module: provider-adapter / engines
problem_type: architecture_pattern
component: tooling
severity: low
applies_when:
  - Adding a new search provider (REST or MCP) without hand-writing the fetch/error boilerplate per adapter
  - Elevating a pure data-record type (e.g. an engine) into a behavioral interface so per-instance logic lives alongside its data rather than in scattered free functions and switches
  - Unifying two transport families (REST + MCP) behind a single ProviderTransport extension point while deliberately preserving their distinct error mappings
  - Deciding whether a factory (defineProvider) is warranted for one layer vs. leaving a parallel concept intentionally unfactored (engines)
  - Tempted to merge two parallel id types (ProviderId, EngineId); only the cross-cutting composition point (SourceId) should merge
tags: [provider-adapter, engine, transport, abstraction, define-provider, factory, byok, refactor]
related_components:
  - lib/providers/base.ts
  - lib/providers/http.ts
  - lib/providers/types.ts
  - lib/providers/tavily.ts
  - lib/providers/exa.ts
  - lib/providers/stepfun.ts
  - lib/providers/stepfun-plan.ts
  - lib/engines/types.ts
  - lib/engines/google.ts
  - lib/engines/bing.ts
  - lib/engines/registry.ts
  - lib/sources.ts
---

# Standardize extension points, not shapes: parallel adapter layers (provider + engine)

## Context

This codebase ships two parallel concepts that both need "add a new one
cheaply" ergonomics, but which were standardized at different times and had
drifted into opposite shapes:

- **Providers** (`lib/providers/`): AI search adapters — `tavily`, `exa`,
  `stepfun`, `stepfun-plan` — each behind a `ProviderAdapter.search(query,
  opts, key)` contract, BYOK keys, return `{ answer?, results }`.
- **Engines** (`lib/engines/`): navigation-only SERP targets — `google`,
  `bing` — no key, no `answer`, no `search()`. Only build SERP URLs and tell
  the SERP-injection content script where to mount.

By the time the SERP switch bar landed, the **provider** layer was already
self-contained (one file per adapter implementing `ProviderAdapter`), but the
**engine** layer had been left as the exact opposite: a pure data record
`{ id, label, favicon, serpUrlTemplate, queryParam }` with **no methods**, and
all behavior living in *free functions scattered across multiple files*.

Two specific pain points forced this refactor:

1. **REST provider boilerplate.** Each of the three REST adapters (tavily/exa/
   stepfun) hand-wrote the identical two lines after `postJson`:

   ```ts
   const err = mapStatus(status, t(LABEL), errorDetail);
   if (err) throw err;
   ```

   The MCP adapter (`stepfun-plan`) used a separate bespoke error path. There
   was no transport abstraction, so adding a provider meant copy-pasting the
   fetch + error-mapping skeleton — and it was easy to forget or apply
   inconsistently.

2. **Engine behavior scattered.** `SearchEngine` was a data record with no
   methods. Behavior lived in free functions in `lib/engines/registry.ts`
   (`buildSerpUrl(engine,q)`, `buildEngineHomeUrl(engine)`,
   `matchEngineByUrl(url)`, `extractQuery(url)`) plus a `switch` statement in
   `lib/engines/serp-anchor.ts` (`pickAnchorStrategy(engine)` keyed by
   `EngineId`). Adding an engine meant editing multiple `switch` statements in
   multiple files. This was the mirror image of the provider layer's
   self-contained adapter objects.

The goal: make each layer's extension point clean and self-contained — **one
file per adapter + minimal registration** — without forcing identical
abstraction shapes onto two genuinely different problems.

## Guidance

### 1. Lift repeated post-fetch boilerplate into a `Transport` interface

Define a transport contract that returns the raw response and throws on every
failure kind. Keep it to one method, three args. Put it next to the error
type so it travels together:

```ts
// lib/providers/types.ts
export interface ProviderTransport<TRaw> {
  send(query: string, opts: SearchOptions, apiKey: string): Promise<TRaw>;
}
```

The contract is explicit in a comment: "`send()` MUST throw `ProviderError` on
every failure kind (network/auth/parse/provider); `normalize` never sees
errors." That single invariant is what lets the factory (below) stay trivial.

Wrap each transport family as one function that bakes in the boilerplate:

```ts
// lib/providers/http.ts — the two lines that were duplicated 3×
export function restTransport<TRaw>(cfg: RestTransportConfig): ProviderTransport<TRaw> {
  return {
    async send(query, opts, apiKey) {
      const { status, data, errorDetail } =
        await postJson<TRaw>(cfg.endpoint, cfg.buildRequest(query, opts, apiKey));
      const err = mapStatus(status, t(cfg.label), errorDetail);
      if (err) throw err;
      return data;
    },
  };
}
```

```ts
// lib/mcp-client.ts
export function mcpTransport(cfg: McpTransportConfig): ProviderTransport<string> {
  return {
    async send(query, _opts: SearchOptions, apiKey) {
      return mcpWebSearch(cfg.endpoint, apiKey, query);
    },
  };
}
```

### 2. Add a `defineProvider<TRaw>()` factory that injects the invariant fields

The factory owns the one thing every adapter must do identically: assemble
`{ query, provider: def.id, ...normalize() }`. Adapters stop hardcoding
`provider: 'tavily'` and stop assembling the response envelope:

```ts
// lib/providers/base.ts (NEW file)
export type NormalizedBody = { answer?: NormalizedAnswer; results: NormalizedResult[] };

export function defineProvider<TRaw>(def: ProviderDefinition<TRaw>): ProviderAdapter {
  return {
    id: def.id,
    label: def.label,
    supportsAnswer: def.supportsAnswer,
    async search(query, opts, apiKey) {
      const raw = await def.transport.send(query, opts, apiKey);
      const body = def.normalize(query, raw);
      return { query, provider: def.id, ...body };
    },
  };
}
```

`normalize(query, raw)` now returns only `{ answer?, results }` — the
provider-private mapping from its raw shape to the normalized model. A real
adapter collapses to a declarative config:

```ts
// lib/providers/tavily.ts — the entire adapter
export const tavilyAdapter = defineProvider<TavilyResponse>({
  id: 'tavily',
  label: LABEL,
  supportsAnswer: true,
  transport: restTransport({
    endpoint: ENDPOINT,
    label: LABEL,
    buildRequest(query, opts, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, include_answer: true, max_results: opts.maxResults ?? 8 }),
      };
    },
  }),
  normalize(query, data): NormalizedBody {
    const results = (data.results ?? []).map((r) => ({ /* ... */ }));
    const answer = data.answer
      ? { text: data.answer, citations: results.map((r) => ({ url: r.url, title: r.title })) }
      : undefined;
    return { answer, results };
  },
});
```

### 3. Move behavior onto the data record — but keep registry-scope concerns in the registry

For engines, promote the data record to a behavioral interface and co-locate
one file per engine (`google.ts`, `bing.ts`). The private construction details
(`serpUrlTemplate`, `queryParam`) become module-local consts and leave the
public contract:

```ts
// lib/engines/types.ts
export interface SearchEngine {
  readonly id: EngineId;
  readonly label: string;
  readonly favicon: string;
  buildSerpUrl(query: string): string;
  buildHomeUrl(): string;
  matches(url: string): boolean;
  extractQuery(url: string): string | null;
  readonly anchor: AnchorStrategy;
}
```

```ts
// lib/engines/google.ts — entire engine
const SERP_URL_TEMPLATE = 'https://www.google.com/search?q={q}';
const SERP_URL = new URL(SERP_URL_TEMPLATE);
const QUERY_PARAM = 'q';
const ANCHOR: AnchorStrategy = { selector: '#rcnt', append: 'before', alignTo: '#center_col' };

export const googleEngine: SearchEngine = {
  id: 'google',
  label: 'engine_google',
  favicon: '/icons/google.svg',
  buildSerpUrl(query) { return SERP_URL_TEMPLATE.replace('{q}', encodeURIComponent(query)); },
  buildHomeUrl()      { return SERP_URL.origin + '/'; },
  matches(url)        { try { return new URL(url).host === SERP_URL.host; } catch { return false; } },
  extractQuery(url)   { try { return new URL(url).searchParams.get(QUERY_PARAM); } catch { return null; } },
  anchor: ANCHOR,
};
```

Delete the `serp-anchor.ts` switch file entirely; the per-engine strategy now
lives as `engine.anchor`, with `anchorFor(engine|null)` + `DEFAULT_ANCHOR`
preserving the "google is the safe default" project knowledge.

`allEngines()` becomes `Object.values(engines)`:

```ts
// lib/engines/registry.ts
const engines: Record<EngineId, SearchEngine> = { google: googleEngine, bing: bingEngine };

export function allEngines(): SearchEngine[] { return Object.values(engines); }
```

**Keep** `matchEngineByUrl` / `extractQuery` in the registry as thin
delegators — they are inherently registry-scope because they need the *full
engine set* to pick one:

```ts
export function matchEngineByUrl(url: string): SearchEngine | null {
  return allEngines().find((e) => e.matches(url)) ?? null;
}
export function extractQuery(url: string): string | null {
  return matchEngineByUrl(url)?.extractQuery(url) ?? null;
}
```

External call sites don't change; behavior moved onto the object without
breaking the registry's public API.

## Why This Matters

**Factory over base class.** This codebase is uniformly functional — the only
class anywhere is `ProviderError`, and that is justified solely because it
subclasses `Error` (you need the prototype chain for `instanceof` and stack
traces). A factory's generic `<TRaw>` flows type-safely into `normalize`; a
base class cannot carry per-subclass raw types without awkward abstract
generics, and would add more boilerplate than it removed.

**The deliberate asymmetry: `defineProvider` yes, `defineEngine` no.** Engines
have nothing to factor out — no transport, no normalize, no `query`/`provider`
injection. A `defineEngine()` factory would be cargo-culting symmetry. The
asymmetry (factory for providers, plain object literal for engines) is the
*correct* design, not a gap. Standardization is about making each layer's
extension point clean and self-contained — **not** about forcing identical
shapes onto different problems.

**`ProviderTransport` is justified at only two transports.** It makes
`defineProvider` transport-agnostic and gives one standardized extension
point for future providers. Hold the line: do **not** add speculative
transport variants (`graphqlTransport`, etc.) until a real third transport
appears — YAGNI on *variants*, not on the *interface*. Keep `send()` to one
method / three args; transport-specific config (retry, timeout) belongs on
each transport's own config object, never on the interface.

**MCP keeps its own error strings.** The MCP transport deliberately keeps its
bespoke `error_mcp_*` i18n mapping and is **not** routed through `mapStatus`
(which emits `error_http_*`). The shared abstraction is `ProviderError` +
the `kind` taxonomy (`unauthorized | rateLimit | network | parse | provider`)
— **not** the message layer. Unifying messages would be a user-visible
behavior change for zero structural benefit.

**`ProviderId` and `EngineId` stay un-merged.** This preserves a documented v2
decision. `ProviderId` is bound to the BYOK key read-path (`storage.getKey`)
and the `search(query, opts, key)` contract; engines satisfy neither.
`lib/sources.ts`'s `SourceId = ProviderId | EngineId` is the **only**
composition point. Resist any urge to make `defineProvider` / an
engine-factory return a common base type "for symmetry."

**Behavior preserved exactly.** This was a pure structural refactor: 274/274
tests pass, typecheck + eslint clean. One regression *was* caught in review —
a fixer had rewritten `ProviderError`'s `super(message)` into
`super(kind, message)`, which would have silently replaced every user-facing
error string with the error kind. The `ProviderError` constructor signature
must stay `constructor(kind, message, status?)` with `super(message)`:

```ts
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);          // <- message, NOT (kind, message)
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}
```

## When to Apply

Apply this when **any** of these are true:

- A codebase has multiple external-service adapters and adding a new one
  requires touching scattered `switch` statements or copy-pasting
  fetch/error boilerplate.
- Two "parallel" concepts share a registry, but one is data-only while the
  other is behavioral — and you want both extension points to be clean.
- You're standardizing extension points and feel the pull to force identical
  shapes onto different problems.

Specifically **avoid** these anti-patterns (they are the inverse of this
guidance):

- **Forcing identical abstraction shapes onto different problems.** If one
  layer has nothing to factor (engines), do not invent a factory for it.
- **Unifying error-message layers at the cost of behavior changes.** Share
  the `kind` taxonomy, not the i18n strings, when two transports genuinely
  address different failure audiences (REST vs MCP here).
- **Speculative transport variants.** Do not pre-build `graphqlTransport`
  until a real third transport exists. The interface stays; the variants wait.
- **Merging `ProviderId` / `EngineId`** into a common base type "for symmetry"
  when one is bound to a key/contract and the other is not.

## Examples

### Provider: before (boilerplate scattered per adapter)

Every REST adapter used to inline the transport + error mapping, and
hardcoded its own `provider` field:

```ts
// before — hand-written fetch + error map + envelope assembly, per adapter
export const tavilyAdapter: ProviderAdapter = {
  id: 'tavily',
  label: LABEL,
  supportsAnswer: true,
  async search(query, opts, apiKey) {
    const { status, data, errorDetail } = await postJson(ENDPOINT, { /* ... */ });
    const err = mapStatus(status, t(LABEL), errorDetail);
    if (err) throw err;
    const results = (data.results ?? []).map(/* ... */);
    const answer = data.answer ? { /* ... */ } : undefined;
    return { query, provider: 'tavily', answer, results };   // <- hardcoded
  },
};
```

### Provider: after (declarative config; transport + envelope owned by factory)

See the `tavilyAdapter` in **Guidance §2** — the adapter body is now
declarative: `transport` + `normalize`. The two-line boilerplate, the
`provider` injection, and the envelope assembly all disappeared into
`restTransport` + `defineProvider`.

### Engine: before (data record + scattered switches)

```ts
// before — SearchEngine was data-only
interface SearchEngine {
  id: EngineId; label: string; favicon: string;
  serpUrlTemplate: string; queryParam: string;
}

// before — behavior in free functions (registry.ts) + a switch (serp-anchor.ts)
function buildSerpUrl(engine: SearchEngine, q: string) { /* ... */ }
function pickAnchorStrategy(engine: EngineId): AnchorStrategy {
  switch (engine) { case 'google': return {...}; case 'bing': return {...}; }
}
```

### Engine: after (self-contained behavioral object)

See `googleEngine` / `bingEngine` in **Guidance §3**. Each engine owns its
URL building, host matching, query extraction, and anchor strategy. Adding
Baidu or DuckDuckGo is now: create `lib/engines/baidu.ts`, add one line to
the `engines` record. No switch to edit.

### Adding a new REST provider (full checklist)

1. Write `lib/providers/<name>.ts` exporting `defineProvider<RawType>({
   id, label, supportsAnswer, transport: restTransport({...}), normalize })`.
2. Append the new id to `ProviderId` in `lib/providers/types.ts`.
3. Register it in the providers registry.

That's it — no fetch skeleton, no error mapping, no envelope assembly.

## Related

- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md`
  — documents the original `ProviderAdapter` interface that this learning
  extends with the transport layer + `defineProvider` factory. (Its example
  code predates this refactor — see refresh candidate below.)
- `docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md`
  — documents the provider/engine separation and the "do not merge
  `ProviderId`/`EngineId`" v2 decision this learning preserves and refines.
- `docs/solutions/ui-bugs/serp-bar-engine-specific-anchors.md`
  — the engine anchor rationale, now relocated from the deleted
  `lib/engines/serp-anchor.ts` into per-engine `anchor` fields.

**Refresh candidates surfaced by this learning** (run `/ce-compound-refresh`):
- `provider-api-integration-patterns.md` — example code shows the pre-refactor
  flat `ProviderAdapter` + inline `TavilyAdapter` error mapping this learning
  extracts into `restTransport`/`defineProvider`.
