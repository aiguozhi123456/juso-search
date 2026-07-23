---
title: "Fixing Dependabot alerts for transitive npm dependencies: overrides vs update"
date: 2026-07-23
category: tooling-decisions
module: dependencies
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - Dependabot alerts reference transitive dependencies not directly listed in package.json
  - Parent packages pin vulnerable transitive deps with exact versions or narrow semver ranges
  - Multiple versions of the same package coexist in the dependency tree
  - npm audit bulk endpoint is unreachable but registry queries (npm view/ping) still work
  - Forced version bumps need pre-verification against consumer peer dependency ranges
resolution_type: dependency_update
tags: [npm-overrides, dependabot, transitive-dependencies, security, package-json, lockfile, wxt, dev-dependencies]
related_components:
  - package.json
  - package-lock.json
---

# Fixing Dependabot alerts for transitive npm dependencies: overrides vs update

## Context

Dependabot alerts fire on transitive dependencies whose parents exact-pin or narrow-range the vulnerable version. In a WXT Chrome MV3 extension (Juso / 双面搜), all 7 alerts were transitive — none were direct deps. The dependency chain runs through `wxt → web-ext-run → firefox-profile / fx-runner / node-notifier`, with parents like `fx-runner@1.4.0` pinning `"shell-quote": "1.7.3"` exactly.

Naive `npm audit fix` cannot move exact-pinned transitives: the parent's declared range admits only the vulnerable version, so npm refuses to upgrade without breaking the contract. Additionally, the `npm audit` bulk endpoint can be network-blocked (connect ETIMEDOUT) while the registry itself works fine (npm ping PONG), making the standard audit workflow unusable.

## Guidance

### Step 1 — Triage with authoritative sources

When `npm audit` is unreachable, use the GitHub API as the source of truth:

```bash
gh api repos/<owner>/<repo>/dependabot/alerts --paginate
```

This returns severity, package name, vulnerable version range, and `first_patched_version` for each alert. Then map each vulnerable copy to its parent chain:

```bash
npm ls shell-quote adm-zip tmp uuid esbuild brace-expansion --all
```

This reveals the full dependency path and each parent's declared range — the critical input for the next decision.

### Step 2 — Classify: update vs override

**Decision rule:**

| Parent's declared range | Action |
|---|---|
| Admits the patched version (e.g. `^1.1.7` admits 1.1.16) | `npm update <pkg>` — lockfile-only, no manifest change |
| Exact-pins or range excludes patched (e.g. `"1.7.3"`, `~0.5.x` excluding 0.6.0) | Add an `overrides` entry in package.json, then `npm install` |

### Step 3 — Watch for the dual-version trap

Before applying any fix, check whether the package exists at multiple major versions in the tree. Example: `brace-expansion` existed at both 1.1.15 (vulnerable, via minimatch@3 ← web-ext-run) and 5.0.7 (safe, via minimatch@10 ← eslint). A blanket override `"brace-expansion": "1.1.16"` would downgrade the 5.x copy and break minimatch@10.

**Resolution:** `npm update brace-expansion` moves only the stale in-range copy. If an override were unavoidable, use a version-selector key (`"brace-expansion@<1.1.16": "1.1.16"`) to scope it.

### Step 4 — Peer-range pre-verification before forcing

Before overriding a build-critical package, inspect the most capability-sensitive consumer's declared peer range:

```bash
# Check vite's esbuild peer range
node -e "console.log(JSON.parse(require('fs').readFileSync('node_modules/vite/package.json','utf8')).peerDependencies.esbuild)"
# → "^0.27.0 || ^0.28.0"
```

vite 8 officially supports esbuild 0.28, so overriding wxt's `^0.27.1` to `^0.28.1` is low-risk. General rule: read the consumer's declared range; the production build succeeding is the final proof.

### Step 5 — Apply overrides

Final verified overrides block in package.json:

```json
"overrides": {
  "shell-quote": "^1.9.0",
  "adm-zip": "^0.6.0",
  "tmp": "^0.2.6",
  "uuid": "^11.1.1",
  "esbuild": "^0.28.1"
}
```

Then run `npm install` followed by `npm update brace-expansion` for the in-range copy.

### Step 6 — Handle allow-scripts interaction

npm's allow-scripts feature may block esbuild@0.28.1's postinstall (and spawn-sync). This is harmless: esbuild ships platform binaries through optionalDependencies (`@esbuild/win32-x64`); postinstall is fallback verification only. Don't chase the warning unless a build actually fails.

### Step 7 — Verify everything

```bash
npm audit                          # → "found 0 vulnerabilities"
npm ls shell-quote adm-zip tmp uuid esbuild brace-expansion --all  # confirm versions
npx tsc --noEmit                   # typecheck
npx eslint .                       # lint
npx vitest run                     # tests (460 pass)
npx wxt build                      # production build
```

### Step 8 — Confirm alert closure

```bash
gh api repos/<owner>/<repo>/dependabot/alerts --paginate | jq '.[].state'
# → all "fixed"
```

Alerts close asynchronously after the fixed lockfile lands on the default branch. The `git push` remote message still prints the STALE alert count — ignore it. The API state is the truth. Commit should touch only package.json + package-lock.json.

## Why This Matters

- **Exact-pinned transitives never self-heal.** `npm audit fix` and `npm update` both respect the parent's declared range. If the parent pins `"1.7.3"`, no amount of auditing will move it without an override.
- **Blanket overrides can break unrelated same-name copies.** brace-expansion 1.x (vulnerable) and 5.x (safe) coexist in the same tree. A naive override downgrades the safe copy and breaks its consumer.
- **Forcing versions without checking consumer peer ranges risks the build chain.** esbuild/vite/wxt form a tight coupling; overriding esbuild without verifying vite's peer range could produce a broken build.
- **Trusting the push-hook vuln count leads to confusion.** GitHub prints the stale count on push; alerts close asynchronously. Only the API reflects actual state.
- **A first `npm update` in a chained PowerShell command can silently not apply.** Always re-verify with `npm ls <pkg> --all` and `npm audit` after any fix.

## When to Apply

- Any batch of Dependabot alerts on transitive npm dependencies, especially when parents exact-pin or use narrow ranges.
- Windows environments where the npm audit bulk endpoint is network-blocked but the registry works.
- Projects using WXT / web-ext-run or similar toolchains with deep transitive dependency chains.
- Any situation where `npm audit fix` reports vulnerabilities it cannot fix.
- When multiple major versions of the same package coexist in the dependency tree.

## Examples

### Alert → chain → range table

| Package | Vuln version | Parent chain | Parent range | Patched | Fix method |
|---|---|---|---|---|---|
| shell-quote | 1.7.3 | fx-runner@1.4.0 ← web-ext-run ← wxt | `"1.7.3"` (exact) | ≥1.9.0 | override |
| adm-zip | 0.5.18 | firefox-profile@4.7.0 ← web-ext-run ← wxt | `~0.5.x` | 0.6.0 | override |
| tmp | 0.2.5 | web-ext-run ← wxt | `"0.2.5"` (exact) | 0.2.6 | override |
| uuid | 8.3.2 | node-notifier@10.0.1 ← web-ext-run ← wxt | `^8.3.2` | 11.1.1 | override |
| esbuild | 0.27.7 | wxt + vite (via @vitejs/plugin-react) | `^0.27.1` | 0.28.1 | override |
| brace-expansion | 1.1.15 | minimatch@3.1.5 ← multimatch ← web-ext-run ← wxt | `^1.1.7` | 1.1.16 | npm update |

### Before/after package.json

Before (no overrides):
```json
{
  "devDependencies": {
    "wxt": "^0.20.27"
  }
}
```

After:
```json
{
  "devDependencies": {
    "wxt": "^0.20.27"
  },
  "overrides": {
    "shell-quote": "^1.9.0",
    "adm-zip": "^0.6.0",
    "tmp": "^0.2.6",
    "uuid": "^11.1.1",
    "esbuild": "^0.28.1"
  }
}
```

### Verification sequence

```bash
npm install
npm update brace-expansion
npm audit                                    # 0 vulnerabilities
npm ls shell-quote adm-zip tmp uuid esbuild brace-expansion --all
npx tsc --noEmit && npx eslint . && npx vitest run && npx wxt build
gh api repos/<owner>/<repo>/dependabot/alerts --paginate | jq '.[].state'  # all "fixed"
```

Resolved versions: shell-quote 1.10.0, adm-zip 0.6.0, tmp 0.2.7, uuid 11.1.1, esbuild 0.28.1, brace-expansion 1.1.16.
