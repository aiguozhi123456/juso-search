---
title: Single-source product versioning with a drift gate
date: 2026-08-10
category: docs/solutions/best-practices
module: release
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - A project ships multiple artifacts (extension, pip package) whose version numbers must stay consistent across config files
  - A version bump left a generated lockfile or test fixture behind
  - The same version line is hardcoded in more than one place
tags:
  - versioning
  - single-source
  - drift-gate
  - wxt
  - setuptools
  - package-lock
---

# Single-source product versioning with a drift gate

## Context

This project ships two independent product lines from one repo: a Chrome MV3 extension (WXT + React, versioned `1.4.0`) and a Python MCP pip package `juso-search` (versioned `0.2.0`). A version audit found that the same version line was hardcoded in multiple places, and one of those copies had silently drifted:

- `package.json` said `1.4.0` but `package-lock.json` still said `1.3.0` — the v1.4.0 bump never re-ran `npm install`, so the generated lockfile fell behind.
- `wxt.config.ts` hardcoded `version: '1.4.0'` separately from `package.json` — two independent sources that happened to agree, structurally guaranteed to drift on the next bump.
- `mcp-server/pyproject.toml` hardcoded `version = "0.2.0"` separately from `juso_search/__init__.py`'s `__version__` — same structural duplication.
- A test fixture hardcoded `VERSION = '1.3.0'` — stale, but the test passed because it was self-contained and never cross-checked the real manifest.

The drift was invisible: typecheck, lint, and the full test suite all passed. The only signal was reading the files and noticing the numbers disagreed.

## Guidance

### Treat "same version line, multiple hardcoded sources" as the root cause

Every individual drift instance (lockfile behind, fixture stale, config disagreeing) is a symptom. The root cause is structural: the version number exists as independent hardcoded values in more than one file. Fixing the symptoms one by one chases drift forever; collapsing to a single source per line makes drift impossible by construction.

### Make each version line have exactly one authoritative source

For each product line, pick one file as the single source and make every other reference derive from it mechanically.

**Extension line — `package.json` is the source.** WXT reads `version` from `package.json` into the generated `manifest.json` by default (verified against WXT source `manifest.ts` `generateManifest` at tag `wxt-v0.20.27`; precedence is `manifest.version_name` → `manifest.version` → `pkg.version` → `'0.0.0'`). So the explicit `version` in `wxt.config.ts` is an *override* of default behavior, not a requirement. Remove it:

```ts
// wxt.config.ts — before
manifest: ({ mode }) => ({
  // ...
  version: '1.4.0',   // second hardcoded source — drifts from package.json
  // ...
})

// wxt.config.ts — after
manifest: ({ mode }) => ({
  // ...
  // version 由 WXT 自动从 package.json 读取（单一源），勿在此硬编码。
  // ...
})
```

The generated `.output/chrome-mv3/manifest.json` still contains `"version":"1.4.0"` with no `version_name` — identical output, one fewer source.

**MCP line — `__init__.py.__version__` is the source.** Use PEP 621 dynamic versioning so `pyproject.toml` derives from the package attribute instead of hardcoding it:

```toml
# pyproject.toml — before
[project]
name = "juso-search"
version = "0.2.0"   # second hardcoded source — drifts from __init__.py

# pyproject.toml — after
[project]
name = "juso-search"
dynamic = ["version"]

[tool.setuptools.dynamic]
version = { attr = "juso_search.__version__" }
```

Now `__version__` in `juso_search/__init__.py` is the only place the MCP version is written; `pyproject.toml`, `__main__.py --version`, `server.py`'s MCP handshake, and the dualera test all read it.

### Add a drift gate so the next forgotten re-lock fails loudly

A single-source structure prevents *structural* drift, but generated artifacts (like `package-lock.json`) still need a re-run after a bump. Add a test that asserts the generated copy matches the source:

```ts
// tests/version-drift.test.ts
import { describe, it, expect } from 'vitest';
import packageJson from '../package.json';
import packageLock from '../package-lock.json';

describe('version single-source gate', () => {
  it('package-lock.json version matches package.json version', () => {
    expect(packageLock.version).toBe(packageJson.version);
  });

  it('package-lock.json root package entry version matches package.json version', () => {
    expect(packageLock.packages[''].version).toBe(packageJson.version);
  });
});
```

After this gate, a bump that forgets `npm install` turns into a failing `npm test` instead of silent lockfile drift.

### Keep independent product lines independently versioned

The extension (`1.4.0`, Chrome Web Store) and the MCP package (`0.2.0`, PyPI) release on different schedules for different artifacts. Do not couple them into one shared version number — that creates artificial release coordination overhead. Two independent single-source lines is correct; the principle is "one source *per line*," not "one source for the whole repo."

## Why This Matters

**Drift is silent under a green test suite.** The original lockfile drift (1.3.0 vs 1.4.0) passed typecheck, lint, and 1223 tests. Without a gate, the only way to catch it is a human reading both files — which means it gets caught when something downstream breaks, not when it happens.

**Multiple hardcoded sources guarantee eventual drift.** Two files that must be edited together on every bump will eventually be edited separately. The question is not *whether* they drift, but *when* — and "when" is "the first bump done in a hurry." Collapsing to one source makes the failure mode impossible rather than merely unlikely.

**A drift gate turns a structural risk into a CI signal.** The single-source collapse removes the *structural* drift (two hardcoded values disagreeing); the gate catches the *operational* drift (a generated artifact not regenerated after a bump). Together they cover both failure modes.

**First-principles framing:** a version number's job is to uniquely identify a software snapshot so users, machines, and developers point at the same thing. That job requires one authoritative value per line. Every additional hardcoded copy is a load-bearing assumption that someone will remember to keep in sync — and memory is not a reliability mechanism.

## When to Apply

- A project ships artifacts whose version appears in more than one config file (manifest, lockfile, build config, package metadata).
- A version bump has ever left a lockfile, fixture, or generated file behind.
- The same version string is hardcoded in two places that "should always agree."
- You are setting up a new product line and want to avoid accumulating version sources from day one.

You may **not** need this when:
- The artifact has exactly one version source already (e.g., a single `package.json` with no lockfile and no build-config override).
- The version is genuinely independent per-deploy (e.g., per-environment tags) and there is no "canonical" line to collapse.

## Examples

### Before: two hardcoded sources, lockfile drifted

```
package.json        → "version": "1.4.0"   ← source
wxt.config.ts       → version: '1.4.0'     ← independent copy (agreed today)
package-lock.json   → "version": "1.3.0"   ← generated, stale (drifted)
tests/...test.ts    → VERSION = '1.3.0'    ← fixture, stale (drifted, tests still green)
```

### After: one source per line, generated copies gated

```
package.json        → "version": "1.4.0"   ← single source (extension line)
wxt.config.ts       → (removed; WXT auto-reads package.json)
package-lock.json   → "version": "1.4.0"   ← regenerated by npm install, gated by test
tests/version-drift.test.ts → asserts lock === source

__init__.py         → __version__ = "0.2.0"  ← single source (MCP line)
pyproject.toml      → dynamic = ["version"]  ← derives from __init__.py
```

### Verification

After collapsing sources and adding the gate:
- `npm run build` → `.output/chrome-mv3/manifest.json` still has `"version":"1.4.0"` (WXT auto-read works).
- `npm test` → all green, including the new `version-drift` gate.
- `npm run test:mcp` → all green, including the dualera handshake that reads `__version__`.
- `npm run test:python` → all green.

## Related

- [dual-domain-storage-schema-versioning](../architecture-patterns/dual-domain-storage-schema-versioning.md) — covers *storage data schema* versioning (migration chains, domain stamps); this doc covers *product release* versioning. Same word, different domain — the two are complementary, not overlapping.
- `package.json` — extension-line single source
- `wxt.config.ts` — removed explicit `version`; WXT derives from package.json
- `mcp-server/pyproject.toml` + `mcp-server/juso_search/__init__.py` — MCP-line single source via PEP 621 dynamic versioning
- `tests/version-drift.test.ts` — drift gate
