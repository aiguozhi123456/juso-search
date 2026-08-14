---
title: "Instance CRUD must acquire the source queue before the instance queue to serialize against mergeImport"
date: 2026-08-07
category: logic-errors
module: lib/storage
problem_type: logic_error
component: service_object
symptoms:
  - "Concurrent config import and instance creation/edit could silently lose instance records"
  - "A provider instance created or edited while an import is merging could vanish from storage after the import completes"
  - "The default-instance backfill (handleGetProviderConfig) widened the exposure window because it triggers instance creation on every UI config load"
root_cause: thread_violation
resolution_type: code_fix
severity: medium
tags: [provider-instances, storage, lock-ordering, concurrency, lost-update, mergeimport, chrome-mv3]
---

# Instance CRUD must acquire the source queue before the instance queue to serialize against mergeImport

## Problem

Provider instance CRUD functions (`createProviderInstance`, `ensureDefaultInstance`, `updateProviderInstance`) read and write the `PROVIDER_INSTANCES_KEY` collection while also rewriting `SOURCE_ORDER_KEY` (a new instance must be appended to the source order). They were serialized only by `withProviderInstancesMutation` — the instance-collection queue. But `mergeImport` (`lib/config-io.ts`) holds the **source** queue (`withSourceMutation`) while whole-array-overwriting `PROVIDER_INSTANCES_KEY`. The two queues do not nest, so a concurrent import and instance write can interleave as last-writer-wins: the instance write's read happens before the import's write, and the instance write's write happens after — overwriting the imported instance array with a stale snapshot and silently dropping imported instances.

The default-instance backfill added in the same feature (`handleGetProviderConfig` lazily calling `ensureDefaultInstance`) widened this window: instance creation could now fire on any UI config load, not only on explicit key-save, making a collision with a concurrent import in another tab materially more likely.

## Symptoms

- Concurrent config import and instance creation/edit could silently lose instance records
- A provider instance created or edited while an import is merging could vanish from storage after the import completes
- The default-instance backfill (handleGetProviderConfig) widened the exposure window because it triggers instance creation on every UI config load

## What Didn't Work

- **Holding only the instance queue.** This serializes instance writes against each other but not against `mergeImport`, which writes the instance array from outside the instance queue. The instance queue guards the wrong boundary.
- **Treating it as an instance-only concern.** The lost update happens because two writers touch the *same storage key* (`PROVIDER_INSTANCES_KEY`) from *different queues*. Fixing only the instance side leaves the import side free to overwrite.

## Solution

Every instance CRUD that reads or rewrites the instance collection acquires the **source queue first, then the instance queue** — the same nesting order `deleteProviderInstance` and `clearKey` already established. This serializes instance writes against `mergeImport` (which holds the source queue), because both now contend on the source queue before either touches the instance array.

```ts
// lib/storage/provider-instance-store.ts — createProviderInstance / ensureDefaultInstance / updateProviderInstance
// BEFORE (lost-update window vs mergeImport):
export async function createProviderInstance(...): Promise<ProviderInstance> {
  return withProviderInstancesMutation(async () => {
    const got = await browser.storage.local.get([PROVIDER_INSTANCES_KEY, SOURCE_ORDER_KEY, ...]);
    // ... read-modify-write both keys ...
  });
}

// AFTER (serialized against mergeImport via source queue):
export async function createProviderInstance(...): Promise<ProviderInstance> {
  return withSourceMutation(() => withProviderInstancesMutation(async () => {
    const got = await browser.storage.local.get([PROVIDER_INSTANCES_KEY, SOURCE_ORDER_KEY, ...]);
    // ... read-modify-write both keys ...
  }));
}
```

`updateProviderInstance` only writes `PROVIDER_INSTANCES_KEY` (not `SOURCE_ORDER_KEY`), but it still needs the source queue: `mergeImport` whole-array-overwrites the instance collection from within the source queue, so any whole-array read-modify-write of instances — even one that does not touch source order — must serialize against the source queue to avoid being overwritten.

The lock order is consistent across all instance CRUD (`create` / `update` / `ensure` / `delete`) and matches `clearKey`: **source queue first, instance queue second**. There is no reverse-order acquisition anywhere in the codebase, so the nesting cannot deadlock.

## Why This Works

The lost update is a classic read-modify-write race on a shared key (`PROVIDER_INSTANCES_KEY`). Two operations write that key: instance CRUD (from the instance queue) and `mergeImport` (from the source queue). Without a shared serialization boundary, their read-modify-write windows can interleave.

The fix makes the source queue that shared boundary. `mergeImport` already holds it; making instance CRUD acquire it first means both operations are now mutually exclusive on the same lock before either writes the instance array. The instance queue is still acquired *inside* the source queue to serialize concurrent instance CRUD against each other — the nesting is load-bearing, not redundant.

The order (source → instance, not instance → source) is dictated by `mergeImport`, which cannot be changed to acquire the instance queue (import merges many domains and already holds the source queue for the whole source graph). So instance CRUD must conform to the order the import path already uses — this is the same reasoning `deleteProviderInstance` encoded first.

## Prevention

- **Any storage mutation that writes a key also written by `mergeImport` must acquire the source queue.** `mergeImport` whole-array-overwrites every config collection from within `withSourceMutation`. A per-collection queue alone is insufficient if the collection is part of the import payload. The source queue is the import-serialization boundary; nest the per-collection queue inside it.
- **When adding a new trigger for an existing write path, audit the concurrency surface.** The backfill added a new caller of `ensureDefaultInstance` (config-read path) — the lost-update window already existed for `createProviderInstance`, but the backfill made it fire on every UI load. A new caller of a write function is a concurrency review trigger, not just a behavior review trigger.
- **Lock order must be uniform across all writers of a key.** `deleteProviderInstance` and `clearKey` already used source→instance; `create`/`update`/`ensure` did not. The inconsistency was the bug. When one writer of a shared key establishes a lock order, every other writer of that key must follow it, or the serialization is broken.
- **Test the import-vs-direct-write race.** The existing `tests/storage.test.ts` concurrency tests cover `ensureDefaultInstance` self-serialization (BUG-3) but not the import-vs-CRUD cross-queue race. A regression test that runs `mergeImport` and `createProviderInstance` concurrently and asserts both writes survive would lock this down.

## Related

- `docs/solutions/architecture-patterns/provider-instance-multi-config-model.md` — the instance model design doc; its Storage CRUD bullet now documents the source→instance lock order as the contract
- `docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md` — the `withSourceMutation` / per-domain queue pattern
- `docs/solutions/architecture-patterns/config-preference-pipeline.md` — `mergeImport`'s queue nesting (`withSourceMutation(withProviderKeysMutation(...))`)
