---
title: Dual-domain storage schema versioning and config export/import
module: lib/schema
date: 2026-07-08
last_updated: 2026-07-09
category: docs/solutions/architecture-patterns
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Adding or evolving a storage domain that needs forward-compatible migrations in a Chrome MV3 extension
  - Multiple storage domains must evolve independently without forcing full-store IO on unrelated changes
  - Exporting user secrets (API keys) across a worker/page boundary without leaking them into page memory
  - Gating all storage reads behind a lazy migration-completion promise before the gateway handles a request
related_components:
  - background_job
  - database
  - service_object
tags:
  - chrome-mv3
  - schema-versioning
  - migration
  - byok
  - chrome-storage
  - trust-boundary
  - export-import
  - dual-domain
---

# Dual-domain storage schema versioning and config export/import

## Context

This is a Chrome MV3 browser extension built on WXT + React + TypeScript. It is a BYOK (bring-your-own-key) AI search aggregator: users store their own API keys for providers (Tavily, Exa, Stepfun, Stepfun Plan) in `chrome.storage.local`, choose an active provider and default search source, set theme/locale preferences, and the extension caches recent search results (up to ~50 entries, ~1MB of data).

The extension's storage had grown organically and accumulated three latent problems:

1. **No schema versioning.** The stored data shape had no version stamp anywhere. Any future change to a key's shape (renames, new fields, structural moves) would silently corrupt old data on read, because code would assume the new shape against data written in the old shape. There was no migration story at all.
2. **No config export/import.** Users could not back up their keys and preferences, nor transfer a configured extension between machines. Re-entering keys on every device is friction, and losing keys (a crashed profile, a re-install) means losing access to paid provider accounts until the user digs them up again.
3. **`get(null)` performance debt.** Several storage read paths used `chrome.storage.local.get(null)`, which reads the *entire* store — including all ~50 cache entries (~1MB) — just to read a single small key. This is wasteful on every call, and especially bad because MV3 service workers are killed and restarted frequently, so these reads happen on essentially every worker wakeup.

On top of all this, the project maintains a strict trust boundary (called R7 in this codebase): API keys are BYOK, are stored in `chrome.storage.local`, and are *only ever read by the background worker*. Page code (search UI, options UI) never reads stored keys, and never reads the `providerKeys` map directly. Any feature that needs to surface configuration state does so through worker messages that return a *desensitized* view (e.g. "which providers are configured", not the keys themselves). This boundary had to be preserved across the new export/import feature.

The work happened in one cohesive change that introduced dual-domain schema versioning, a zero-cost steady-state migration check, worker-kill-safe migration semantics, a BYOK-respecting config export/import pipeline, and the `get(null)` performance fix. This document captures the resulting architecture pattern.

## Guidance

### Split storage into independent versioned domains, do not unify them

When storage holds heterogeneous data with different change rates, give each natural cluster its own schema version stamp and its own migration registry. In this codebase there are two domains:

- **Config domain** (`lib/schema.ts`): operates on six small keys — `providerKeys`, `activeProvider`, `activeSource`, `themePref`, `localePref`, `sourceOrder`. Stamped with `schemaVersion` and migrated by the `migrations` registry.
- **Cache pool domain** (`lib/search-cache.ts`): operates on `searchCacheIndex` plus the `searchCacheEntry:*` key pool (up to ~50 entries, ~1MB). Stamped with `cacheSchemaVersion` and migrated by the `cacheMigrations` registry.

```ts
// lib/schema.ts — config domain
export const CURRENT_SCHEMA_VERSION = 1;

export const migrations: Migration[] = [
  // { from: 0, to: 1, migrate: (data) => ({ ...data, /* shape change */ }) },
];

// lib/search-cache.ts — cache pool domain
export const CURRENT_CACHE_SCHEMA_VERSION = 1;

export const cacheMigrations: CacheMigration[] = [
  // cache pool shape changes here; evolves independently of config
];
```

The two version numbers move on their own schedules. A config-only change does *not* bump the cache version, and therefore does not pay the cost of reading and rewriting a ~1MB key pool. The reverse is also true.

### Make the steady-state check nearly free with a three-layer `ensure*`

`ensureSchema()` and `ensureCacheSchema()` each implement three layers, in order of expected frequency:

1. **Steady state (every worker wakeup):** read the single version-stamp key. If it already equals the current version, return immediately. This path does *not* read any config or cache data — it reads exactly one small key.
2. **First install (one-time):** the version key is missing entirely. Stamp the current version and return.
3. **Upgrade (one-time):** the stored version is behind. Read the domain's data, run the migration chain, write the diff back, and stamp the new version *last*.

```ts
export async function ensureSchema(): Promise<void> {
  const stored = await readSchemaVersion(); // reads only 'schemaVersion' key

  // Layer 1: steady state — already current, do nothing.
  if (stored === CURRENT_SCHEMA_VERSION) return;

  // Layer 2: first install — no version yet, just stamp.
  // Layer 3: upgrade — read, migrate, write, stamp.
  if (stored > CURRENT_SCHEMA_VERSION) return; // downgrade tolerance
  const configGot = await browser.storage.local.get([...CONFIG_KEYS]);
  const migrated = migrateConfig(configGot, stored, CURRENT_SCHEMA_VERSION);
  const { set, remove } = diffKeys(before, after); // symmetric diff
  if (remove.length > 0) await browser.storage.local.remove(remove);
  await browser.storage.local.set({ ...set, schemaVersion: CURRENT_SCHEMA_VERSION });
}
```

This matters because MV3 service workers are killed and restarted aggressively by the browser. Every wakeup must be cheap. A naive "read everything, check, write everything" on every wakeup would re-introduce the `get(null)` problem at the schema layer.

### Make migrations idempotent and stamp the version last

Each migration is a pure function over the domain data and **must be idempotent** — running it twice must produce the same result as running it once. The reason is worker-kill safety: a service worker can be killed at any point during a migration. The commit ordering rule is:

1. Remove any orphan keys first (cleanup that is safe to redo).
2. Write the new entries and the updated index.
3. **Write the version stamp last.** This is the commit point. Until the stamp is written, the stored version is still the old one.

```ts
async function runCacheMigration(from: number, to: number): Promise<void> {
  // ... read index + entries, run migrateCachePool ...

  // 1. Remove orphaned keys first (safe to redo if worker is killed).
  await browser.storage.local.remove(removeKeys);

  // 2 + 3. Write new state AND the version stamp together as the commit.
  await browser.storage.local.set({
    searchCacheIndex: next.index,
    ...next.entriesToSet,
    cacheSchemaVersion: to, // commit point — written last
  });
}
```

If the worker is killed *before* step 3 completes, the stored version is unchanged, so the next wakeup re-reads the old version and re-runs the migration. Because migrations are idempotent, re-running is safe.

For recovery when a migration throws, `ensureCacheSchema` catches the error and clears the *entire* cache pool, then stamps the current version. This is acceptable because cached search results are regenerable (the user can re-search); losing the cache is strictly better than leaving the worker bricked.

```ts
export async function ensureCacheSchema(): Promise<void> {
  // ... layers 1 and 2 ...
  try {
    await runCacheMigration(v, CURRENT_CACHE_SCHEMA_VERSION);
  } catch {
    await recoverCacheSchemaByClear(); // clear pool + stamp version
  }
}
```

**Note the asymmetry:** config data is *not* regenerable (it contains user-entered keys and preferences), so a failed config migration must not be "solved" by clearing config. The cache domain's clear-on-failure recovery is only safe *because* the cache is derivable.

### Gate every storage-touching handler behind a lazy memoized readiness check

Add a single function — `getSchemaReady()` — that returns a memoized promise. The first call triggers both `ensureSchema()` and `ensureCacheSchema()` and memoizes the resulting promise; every subsequent call returns the same (already-settled) promise.

```ts
let readyPromise: Promise<void> | null = null;

export function getSchemaReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureSchema();
      await ensureCacheSchema();
    })().catch(() => {
      // A migration failure must not permanently brick the worker.
    });
  }
  return readyPromise;
}
```

Every gateway handler awaits it before touching storage. And the background worker preheats it at startup so the work happens off the critical path of the first user message.

This gives two desirable properties at once: the first message during a migration window *blocks* until migrations finish (so it sees consistent data), and the steady-state cost is a single settled-promise `await` (effectively free). The trailing `.catch(() => {})` guarantees that even a throwing migration never permanently bricks the worker.

### Preserve the BYOK trust boundary in export/import

The codebase's R7 rule is: keys live in `chrome.storage.local`, and only the worker reads them. Page code never sees stored plaintext keys. Export/import must respect this.

**Export.** The worker assembles the payload (reading the config keys precisely with `get([...])`, never `get(null)`), builds the JSON, and then triggers the download *itself* via `browser.downloads.download()` with a `data:` URL. The plaintext key never enters page memory at all. This required adding the `downloads` permission to the manifest — a small, worthwhile cost for R7 preservation.

**Import.** The page (options UI) reads the user-selected file via `FileReader`, then sends the parsed JSON to the worker over messaging. The worker does the validation and merge — page code never decides merge policy.

The validation is a strict whitelist via `parseImportPayload`: only known provider IDs for provider preferences, only known source IDs for the default source preference, only expected types, only the supported schema version range. Unknown fields are dropped, not preserved.

Merge semantics are deliberately conservative on both axes:

- **Keys are non-destructive (fill-empty-slots only).** An imported key only fills a slot that is currently empty. An existing configured key is *never* overwritten by an import, even if they differ. This prevents an accidentally-imported stale file from clobbering a freshly-rotated key.
- **Preferences are opt-in via `applyPrefs`, gated by a preview-confirm dialog.** The page first calls `previewImport`, the worker returns a computed diff (what *would* change), the UI shows it to the user, and only if the user confirms does the subsequent `importConfig` call include `applyPrefs: true`. Preferences include both provider-only state (`activeProvider`) and user-facing source state (`activeSource`, `sourceOrder`). Older export files without `sourceOrder` preserve the current quick-switch order.

For read-modify-write sequences on `providerKeys` (where two concurrent messages could race), wrap the mutation in a serialization queue (`withProviderKeysMutation` in `lib/storage.ts`) so that read-modify-write is atomic with respect to itself. Imports also use the shared `withSourceOrderMutation` boundary with `setSourceOrder`, so an older import cannot overwrite a later quick-switch move.

### Never use `get(null)` when you know the keys you need

The schema work surfaced an existing smell: `readKeys()` used `get(null)` (reads the *entire* store, including ~1MB of cache entries) just to read `providerKeys`. `getActiveProviderId()` did the same to read two small keys. Both were fixed to read exactly the keys they need:

```ts
// Before: read entire store (~1MB) to get one small key.
async function readKeys() {
  const all = await browser.storage.local.get(null);
  return all.providerKeys;
}

// After: read exactly one key.
async function readKeys() {
  const { providerKeys } = await browser.storage.local.get('providerKeys');
  return providerKeys;
}

// After: batch-read exactly the two keys needed.
async function getActiveProviderId() {
  const got = await browser.storage.local.get(['activeProvider', 'providerKeys']);
  // ... validate activeProvider against providerKeys ...
}
```

## Why This Matters

The pattern solves four problems that each look different on the surface but share a root cause: **storage is shared, persistent, heterogeneous, and read on a hot path by a process the browser kills at will.**

**Schema versioning is non-negotiable for any persistent data.** Without a version stamp, every future shape change becomes a silent corruption bug waiting for the right combination of "old install + new code + code path that reads the changed key." The cost of adding a version stamp and an empty migration registry *now* is trivial; the cost of retrofitting it *after* you've shipped an un-versioned shape change that breaks user data is enormous, and in a BYOK context "broken user data" can mean losing paid provider credentials.

**Dual-domain versioning respects change-rate asymmetry.** Config keys change shape roughly as often as product direction shifts. Cache structure changes rarely. Coupling them into one version number forces every config migration to also read and rewrite the cache pool — a ~1MB IO tax on every minor schema bump.

**The three-layer `ensure*` makes versioning affordable in MV3.** Because the steady-state layer reads *only* the version stamp key (one small read, ~0.1ms), the amortized cost of versioning over the worker's lifetime is essentially zero. Without this layer, versioning would re-introduce exactly the `get(null)` problem it was meant to solve.

**Idempotent migrations + stamp-last ordering are what make the system correct under MV3's kill-anywhere semantics.** If the version stamp were written *before* the data, a kill between stamp and data would leave the store stamped as "migrated" with un-migrated data — a silent, permanent corruption. Stamping last means "stamped" and "actually migrated" are the same observable state.

**Export/import preserves the trust boundary by keeping plaintext keys inside the worker.** The R7 rule exists so that a compromised or buggy page can never exfiltrate stored keys. Routing the download through `browser.downloads.download()` from the worker means the page is never the trust boundary for key material. The conservative merge semantics (fill-empty for keys, opt-in for prefs) acknowledge that an imported file is itself an untrusted input.

## When to Apply

Apply this pattern when **any** of these are true:

- You store persistent structured data in `chrome.storage.local` (or any persistent store without its own migration system) and the data shape may evolve.
- Your extension is MV3 (service worker) — the kill-anywhere semantics make the idempotent-migrations-plus-stamp-last rule load-bearing, not just nice-to-have.
- Your storage mixes data with very different change rates or sizes (small hot config vs. large cold cache) — split into domains.
- You need export/import of sensitive (BYOK) data and have a worker/page trust boundary — keep plaintext inside the worker.
- You have `get(null)` calls in read paths that only need a few keys — replace with explicit key lists or batch reads.

You may **not** need the full pattern when:

- Your storage is single-purpose and tiny (one key, one shape) — a version stamp alone is enough.
- Your data is fully regenerable and ephemeral — you can skip versioning entirely and just clear-on-mismatch.
- You are not on MV3 — the steady-state-cost argument weakens, though idempotent migrations are still good hygiene.

The lazy-memoized `getSchemaReady()` gate is worth adopting *whenever* you have any async "must have happened before first use" setup, regardless of whether it's schema migration — it generalizes to index preheating, feature-flag hydration, etc.

## Examples

### Before: un-versioned, `get(null)`-based storage

```ts
// lib/storage.ts — no version stamp anywhere
export async function readKeys() {
  const all = await browser.storage.local.get(null); // reads ~1MB incl. cache
  return all.providerKeys ?? {};
}

export async function getActiveProviderId() {
  const all = await browser.storage.local.get(null); // reads ~1MB again
  return all.activeProvider ?? null;
}

// Any future change to providerKeys' shape silently breaks old installs:
// code reads it as the new shape, data was written in the old shape.
```

### After: versioned, domain-split, gated

```ts
// lib/schema.ts
export const CURRENT_SCHEMA_VERSION = 1;

export async function ensureSchema(): Promise<void> {
  const { schemaVersion: v } = await browser.storage.local.get('schemaVersion');
  if (v === CURRENT_SCHEMA_VERSION) return;               // layer 1: steady state
  if (v === undefined) {                                   // layer 2: first install
    await browser.storage.local.set({ schemaVersion: CURRENT_SCHEMA_VERSION });
    return;
  }
  const data = await readConfigKeys();                     // layer 3: upgrade
  const migrated = migrateConfig(data, v, CURRENT_SCHEMA_VERSION);
  await browser.storage.local.set({
    ...diffKeys(data, migrated),
    schemaVersion: CURRENT_SCHEMA_VERSION,                 // stamp LAST
  });
}

// lib/gateway.ts
export function getSchemaReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureSchema();
      await ensureCacheSchema();
    })().catch(() => {}); // never permanently brick the worker
  }
  return readyPromise;
}

async function handleSearch(req: SearchRequest) {
  await getSchemaReady(); // blocks first msg during migration, free thereafter
  // ... safe to read/write storage ...
}
```

### Before: page-driven export (would leak plaintext key into page memory)

```ts
// DON'T — page reads stored key, builds file, downloads
const keys = await readStoredKeysSomehow(); // R7 violation
const blob = new Blob([JSON.stringify({ keys })]);
const url = URL.createObjectURL(blob);
// ... anchor click ...
```

### After: worker-owned export, key never leaves the worker

```ts
// lib/gateway.ts
async function handleExportConfig() {
  await getSchemaReady();
  const payload = await buildExportPayload(); // worker reads keys via get([...])
  const dataUrl =
    'data:application/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(payload));
  await browser.downloads.download({ url: dataUrl, filename: 'juso-config-YYYYMMDD-HHmm.json', saveAs: true });
  // plaintext key never entered page memory
}
```

## Related

- [theme-persistence-i18n-key-hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) — origin of the BYOK key-hygiene / `get(null)` rules that this doc extends to worker-side reads and the export/import path
- [local-search-cache-mv3](./local-search-cache-mv3.md) — documents the cache structure (searchCacheIndex / searchCacheEntry) that the cache-pool domain versioning governs; its `withSearchCacheMutation` queue is the precedent for worker-kill-safe migration ordering
- [provider-api-integration-patterns](./provider-api-integration-patterns.md) — defines the BYOK + worker-only-key-read invariant that config export/import preserves
- `lib/schema.ts` — config-domain versioning: `CURRENT_SCHEMA_VERSION`, `migrations`, `migrateConfig`, `ensureSchema`, `diffKeys`
- `lib/search-cache.ts` — cache-domain versioning: `CURRENT_CACHE_SCHEMA_VERSION`, `cacheMigrations`, `migrateCachePool`, `ensureCacheSchema`, `runCacheMigration`, `recoverCacheSchemaByClear`
- `lib/config-io.ts` — export/import: `buildExportPayload`, `parseImportPayload`, `previewImport`, `mergeImport`
- `lib/gateway.ts` — worker handlers and the readiness gate: `getSchemaReady`, `handleExportConfig`, `handlePreviewImport`, `handleImportConfig`
- `lib/storage.ts` — `withProviderKeysMutation` and `withSourceOrderMutation` (serialization queues for atomic config mutations)
- [separate-active-search-source-from-active-byok-provider](./separate-active-search-source-from-active-byok-provider.md) — documents why `activeSource` belongs in the config domain while `activeProvider` remains provider-only
- `CONCEPTS.md` — project vocabulary for the BYOK trust boundary (R7)
