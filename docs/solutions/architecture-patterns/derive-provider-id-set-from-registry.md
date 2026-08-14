---
title: Derive provider id sets from the registry, never hardcode a copy
date: 2026-08-13
category: architecture-patterns
module: lib/provider-instances.ts (provider registry / instance normalization)
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - A union type or constant set mirrors a registry that is the source of truth
  - Adding a new enum/union member requires touching more than the type and its registry
  - A comment says "keep in sync with" another file instead of deriving from it
  - Multiple call sites need the full set of provider ids for validation or normalization
root_cause: logic_error
resolution_type: code_fix
tags:
  - single-source-of-truth
  - drift
  - registry
  - provider-ids
  - typescript
  - chrome-extension
  - mv3
  - derive-dont-copy
---

# Derive closed-union id sets from the registry; do not hand-maintain a copy

## Context

This repository (WXT + React + TypeScript, Chrome MV3) maintains a closed
string-literal union `ProviderId` that names every BYOK AI search adapter the
extension ships (`tavily`, `exa`, `brave`, `stepfun`, `stepfun-plan`, `jina`,
`doubao`, `doubao-global`, `parallel`):

```ts
// lib/providers/types.ts:4
export type ProviderId =
  | 'tavily' | 'exa' | 'brave' | 'stepfun' | 'stepfun-plan'
  | 'jina' | 'doubao' | 'doubao-global' | 'parallel';
```

`ProviderId` is load-bearing. It is the BYOK boundary type: every worker-side
function that touches an adapter or an API key — `getAdapter(id)`, `getKey(id)`,
`getProviderMaxResults(id)`, the gateway's `resolveInstance` → `runProviderSearch`
chain — accepts `ProviderId` and only `ProviderId`. Several modules also need the
*set* of known provider ids at runtime, not just the type. They use it to build
type guards (`isProviderId`, `isKnownProvider`), to validate untrusted import
payloads, to filter stored maps, and to reject ids that no longer correspond to
a registered adapter.

The registry is the single source of truth for "which adapters exist":

```ts
// lib/providers/registry.ts:12-22
const adapters: Record<ProviderId, ProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  brave: braveAdapter,
  stepfun: stepfunAdapter,
  'stepfun-plan': stepfunPlanAdapter,
  jina: jinaAdapter,
  doubao: doubaoAdapter,
  'doubao-global': doubaoGlobalAdapter,
  parallel: parallelAdapter,
};

export function allProviders(): ProviderAdapter[] {
  return [
    adapters.tavily, adapters.exa, adapters.brave, adapters.stepfun,
    adapters['stepfun-plan'], adapters.jina, adapters.doubao,
    adapters['doubao-global'], adapters.parallel,
  ];
}
```

Three modules had already learned the right lesson and derive their id set from
`allProviders()`:

```ts
// lib/sources.ts:86-88
export function isProviderId(id: string): id is ProviderId {
  return allProviders().some((p) => p.id === id);
}

// lib/storage/shared.ts
function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}

// lib/config-io.ts:47
const KNOWN_PROVIDER_IDS = new Set<ProviderId>(allProviders().map((p) => p.id));
```

But `lib/provider-instances.ts` was missed when that refactor landed. It still
held a **hand-maintained copy** of the union, guarded only by a comment that
promised a sync the comment could not enforce:

```ts
// lib/provider-instances.ts (before the fix)
/** Known base providers — keep in sync with the `ProviderId` union in ./providers/types. */
const PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan',
  'jina', 'doubao', 'doubao-global',
  // 'parallel' was missing here — drift.
]);
```

The drift surfaced during the addition of the `parallel` (Parallel.ai) provider.
The implementer correctly added `'parallel'` to `ProviderId` and registered the
adapter in `registry.ts`, but the `provider-instances.ts` copy was not updated.
A fixer later patched the set by hand-appending `'parallel'` as a band-aid; an
independent Oracle code review then identified the root cause — the set should
not exist as a copy at all.

## Guidance

### Derive any set that must equal the closed union from the registry

When a module needs "the set of all known `ProviderId` values" at runtime,
derive it from `allProviders()` rather than re-listing the literals. The
registry already enumerates exactly the ids the `ProviderId` union names, so the
derived set is correct by construction and cannot drift when a new provider is
added or an old one is removed:

```ts
// lib/provider-instances.ts:18-19 (after the fix)
/** Known base providers — derived from the registry so it can never drift from the `ProviderId` union. */
const PROVIDER_IDS: ReadonlySet<ProviderId> = new Set(allProviders().map((p) => p.id));
```

This single line replaces nine hand-typed literals plus the comment that
promised (but could not enforce) their sync. The derived set feeds the
`isProviderId` local guard, which in turn backs `isProviderInstanceId`:

```ts
// lib/provider-instances.ts:42-52
function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.has(value as ProviderId);
}

export function isProviderInstanceId(id: string): id is ProviderInstanceId {
  const parts = id.split(':');
  return parts.length === 3
    && parts[0] === INSTANCE_ID_PREFIX.slice(0, -1)
    && isProviderId(parts[1])
    && INSTANCE_ID_TOKEN.test(parts[2]);
}
```

### Prefer a comment that names the mechanism, not the obligation

The old comment said "keep in sync with the `ProviderId` union." That phrasing
shifts the burden onto every future editor: it asks a human to remember an
obligation the code cannot verify. The new comment names the mechanism —
"derived from the registry so it can never drift" — and the code makes the
mechanism true. A reviewer reading the line can see, without leaving the file,
*why* the set is correct and *why* it will stay correct. This is the same
comment discipline `sources.ts` and `lib/storage/` already follow implicitly: they
derive without a sync obligation because there is nothing to sync.

### Confirm there is no circular dependency before deriving

Deriving `provider-instances.ts`'s set from `allProviders()` adds an import of
`lib/providers/registry.ts` into `lib/provider-instances.ts`. This is safe only
because the registry does not import back from `provider-instances.ts`. The
dependency arrow is one-way:

```
lib/provider-instances.ts  ──imports──▶  lib/providers/registry.ts  ──imports──▶  lib/providers/<name>.ts
```

`registry.ts` imports only adapter modules and `./types`; `provider-instances.ts`
imports `ProviderId` from `./providers/types` and `allProviders` from
`./providers/registry`. No cycle. If the registry ever grew a dependency on
`provider-instances.ts` (for example, to read instance options at adapter
resolution time), this derivation would have to move across the cycle boundary
or be re-derived at the call site. The absence of a cycle is a load-bearing
property and should be checked, not assumed, whenever a module starts deriving
from the registry.

### Apply the pattern everywhere a union is mirrored as a set or a switch

The fix is one instance of a general rule this codebase already follows in
three other places. The rule is: **a value-level enumeration of a closed union
must be derived from the single registration site, never hand-maintained.** The
registration site for providers is `allProviders()`; for engines it is
`allEngines()`; for AI engines it is `allAiEngines()`. `lib/sources.ts:47` even
derives the engine id set (`ENGINE_IDS`) from `allEngines()` for the same
reason. Any new module that needs "all provider ids" or "all engine ids" as a
set, a map, a `switch`, or a `Record<…>` should derive from the registry rather
than re-listing literals — and a review of an existing module that re-lists them
is a candidate for the same refactor.

## Why This Matters

### A drifted set silently corrupts the trust boundary

`PROVIDER_IDS` in `provider-instances.ts` is not a display list. It backs
`isProviderId`, which backs `isProviderInstanceId`, which is the guard at the
`ProviderInstanceId → { providerId, options }` boundary documented in
`provider-instance-multi-config-model.md`. If the set is missing an id, that
guard returns `false` for every instance id whose base provider is the missing
one:

```
isProviderInstanceId('inst:parallel:abc')  →  false   (because isProviderId('parallel') is false)
```

`normalizeProviderInstance` then returns `null` for any `parallel`-based
instance record. `normalizeProviderInstances` drops those records from its
output array. From that point the corruption is silent and spreads: instances
vanish from storage reads, from `sourceOrder`, from `sourceHidden`, from
`groupConfig` (all of which call `normalizeProviderInstances` or
`isProviderInstanceId`), from config import validation, and from agent-bridge
`search-instance` / `list-instances` request handling. The user configures a
Parallel instance, the worker writes it, and the next read returns an empty
array. There is no error, no log, no type error — the set was `Set<ProviderId>`
so the missing literal type-checked fine. The only signal is missing data.

### The bug class is "manual sync," and it is never caught by the type system

The `ProviderId` union is a compile-time fact. The `PROVIDER_IDS` set was a
runtime fact. TypeScript cannot prove the two are equal — a `Set<ProviderId>`
constructed from a subset of the literals is perfectly well-typed. This is why a
comment that says "keep in sync" is a smell, not a safeguard: the type checker
enforces nothing about the relationship, and the comment is read only by the
person who happens to be editing that file at that moment. The reviewer of an
unrelated change, the implementer focused on the adapter, and the test that
mocks `allProviders()` all bypass the comment entirely.

Deriving from the registry collapses the two facts into one. There is no second
copy to keep in sync, so there is no sync to forget. Adding a provider becomes a
two-step mechanical change — extend the `ProviderId` union in `types.ts` and
register the adapter in `registry.ts` — and every derived set, guard, and
projection follows automatically. The `standardized-provider-engine-adapter-layers.md`
checklist for "adding a new REST provider" already lists exactly those two
steps ("Append the new id to `ProviderId`; register it in the providers
registry") and says "That's it." That promise is only true because the derived
sets exist; a hand-maintained copy would add a third, forgettable step to the
checklist and silently break the promise when missed.

### The impact of the unfixed bug is data loss across the source graph

Because instance ids flow through `SourceId` and are threaded into
`normalizeSourceOrder`, `normalizeSourceHidden`, `allKnownSourceIds`,
`resolveEffectiveActiveSource`, `visibleUsableSource`, and the config-IO import
path (all documented in `provider-instance-multi-config-model.md`), a guard that
rejects them does not just hide one pill — it strips the ids out of every
normalizer that touches them. This is the same "threading-data-loss" failure
class recorded as cautionary lesson 2 in `provider-instance-multi-config-model.md`
(the `storage.ts` instance-id stripping bug), except here the missing argument is
not a forgotten parameter but a missing literal in a set. The symptom is
identical: the instance appears in the bar (because the storage write path
persists it raw), but moving, hiding, grouping, or reordering it silently fails,
because the read path normalizes the id out of existence before the write
commits.

## When to Apply

Apply this pattern when **any** of these are true:

- A module needs the runtime *set* of values named by a closed string-literal
  union, and that union has a single registration site (a registry function
  like `allProviders()`, a `Record<Union, …>` map, or a factory list).
- A comment in the code says "keep in sync with …" or "must match the union in
  …" — that comment is the signal that a derived form should replace the copy.
- A new member is being added to a closed union and the addition touches more
  than two files. If adding a provider requires editing the union, the
  registry, *and* one or more hand-maintained id sets, the sets are candidates
  for derivation.
- A code review of a completed feature finds a hand-maintained enumeration that
  has already drifted (missing the new member) or has been patched by
  hand-appending the new member. The patch is correct but the copy is the
  root cause; derive instead.

Do **not** apply the derivation pattern when:

- The set is intentionally narrower than the union. `PROVIDERS_WITH_INSTANCE_OPTIONS`
  in `lib/provider-instances.ts:31-34` is a hand-maintained set of *two*
  providers (`exa`, `doubao`) — it gates which providers ship a per-instance
  options form. It is deliberately not the full `ProviderId` set; deriving it
  from the registry would be wrong. Each addition to it must also ship an
  adapter options schema and a UI form, so the three-step contract is
  documented inline. Derivation is for sets that must *equal* the union, not for
  sets that *select from* it.
- There is no single registration site to derive from. If adapters are
  registered ad-hoc across multiple files with no central enumeration,
  derivation is impossible until a registry exists. In that case the registry
  is the missing abstraction; derive after introducing it.
- Deriving would introduce a circular dependency. Confirm the dependency arrow
  is one-way before deriving (see Guidance §3). If it would cycle, move the
  derived set to a module that sits after the registry in the import order, or
  derive at the call site instead of at module scope.

## Examples

### Example 1 — The drift, before and after

Before the fix, `lib/provider-instances.ts` held a hand-maintained copy of the
`ProviderId` union. The comment promised sync; the set had drifted and was
missing `'parallel'`:

```ts
// lib/provider-instances.ts (before)
/** Known base providers — keep in sync with the `ProviderId` union in ./providers/types. */
const PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan',
  'jina', 'doubao', 'doubao-global', 'parallel',  // <- band-aid append
]);
```

The band-aid made the set correct, but the root cause — a second copy of the
union that must be hand-synced — remained. After the fix, the set is derived
from the registry and the literals are gone:

```ts
// lib/provider-instances.ts:18-19 (after)
/** Known base providers — derived from the registry so it can never drift from the `ProviderId` union. */
const PROVIDER_IDS: ReadonlySet<ProviderId> = new Set(allProviders().map((p) => p.id));
```

### Example 2 — The correct pattern already in use elsewhere

`lib/sources.ts` derives both its engine id set and its `isProviderId` guard
from the respective registries, with no hand-maintained literals:

```ts
// lib/sources.ts:47
const ENGINE_IDS: ReadonlySet<string> = new Set(allEngines().map((e) => e.id));

// lib/sources.ts:86-88
export function isProviderId(id: string): id is ProviderId {
  return allProviders().some((p) => p.id === id);
}
```

`lib/storage/shared.ts` does the same for its trusted-storage guard:

```ts
function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}
```

`lib/config-io.ts:47` derives the set used to validate untrusted import
payloads:

```ts
const KNOWN_PROVIDER_IDS = new Set<ProviderId>(allProviders().map((p) => p.id));
```

The `provider-instances.ts` fix brings the fourth call site into line with the
other three. The codebase now has zero hand-maintained copies of the
`ProviderId` union as a runtime set.

### Example 3 — A deliberately hand-maintained set (the anti-example)

`PROVIDERS_WITH_INSTANCE_OPTIONS` is a set that must *not* be derived. It names
only the providers that ship a per-instance options form, which is a strict
subset of `ProviderId`:

```ts
// lib/provider-instances.ts:31-34
export const PROVIDERS_WITH_INSTANCE_OPTIONS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'exa',
  'doubao',
]);
```

Deriving this from `allProviders()` would be a bug: it would enable instance
creation for every provider, including those with no options schema and no UI
form. The set is intentionally hand-maintained, and the inline comment
(`:22-31`) documents the three-step extension contract (adapter schema + UI form
+ set entry). This is the boundary between "sets that must equal the union"
(derive) and "sets that select from the union" (hand-maintain with a documented
contract).

### Example 4 — The two-step provider addition after the fix

Adding the `parallel` provider, with the derivation in place, is now exactly the
two-step mechanical change the `standardized-provider-engine-adapter-layers.md`
checklist promises:

1. Add the id to the `ProviderId` union in `lib/providers/types.ts:4`.
2. Register the adapter in `lib/providers/registry.ts` (both the
   `adapters: Record<ProviderId, ProviderAdapter>` map and the `allProviders()`
   return array).

No third step in `provider-instances.ts`, `sources.ts`, `lib/storage/`, or
`config-io.ts`. The derived sets in all four modules pick up the new id
automatically, `isProviderId` / `isKnownProvider` / `isProviderInstanceId`
accept `inst:parallel:<uuid>` immediately, and the entire source-graph
normalization path (order, hidden, group, active, config IO) recognizes the
new provider's instances without a per-module edit.

## Related

- **`docs/solutions/architecture-patterns/provider-instance-multi-config-model.md`** — Direct sibling doc for the same module (`lib/provider-instances.ts`). Documents the closed `ProviderId` boundary, the `isProviderInstanceId` parallel guard, and the `PROVIDERS_WITH_INSTANCE_OPTIONS` hand-maintained set. This learning is the same drift class one layer down: a hardcoded `PROVIDER_IDS` set that should have been derived. Note: `PROVIDERS_WITH_INSTANCE_OPTIONS` is deliberately hand-maintained (each entry requires an adapter schema + UI form) — the "derive from registry" principle applies to `PROVIDER_IDS`, not to it.
- **`docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md`** — Bug 2 is the canonical "hardcoded provider whitelist drifted from registry" incident in this codebase: Python's `PROVIDERS` tuple missed `'brave'` after it was added to the TS `ProviderId` union. Same root cause (manual copy of the provider set), same symptom class (silent — only surfaces when the missing id is exercised). This learning is the in-extension recurrence of the same failure mode that Bug 2 documented at the cross-language boundary.
- **`docs/solutions/architecture-patterns/skill-mcp-vocabulary-decoupling.md`** — Generalizes the drift root cause and fixes it structurally: "the downstream surface should not hold a copy of the vocabulary at all." This learning is the same principle applied inside the TS extension itself — the codebase already had this pattern fixed at the Python/MCP boundary, and the `PROVIDER_IDS` drift is one more intra-TS instance of the same "derive from registry, do not hardcode the union" rule.
- **`docs/solutions/architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md`** — Establishes the foundational "registry is the source of truth; mirrors must be tested for equality, not maintained by hand" principle. This learning operationalizes that principle.
- **`docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md`** — Documents the provider adapter layer and the registry-driven model (`defineProvider` + `allProviders()`). Provides the structural backdrop: providers are registry-driven, which is why a hardcoded `PROVIDER_IDS` copy is an anomaly in this codebase rather than the norm.
