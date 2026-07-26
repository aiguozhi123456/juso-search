---
title: "SERP bar SPA remount budget and last-resort-only anchor upgrade"
date: 2026-07-23
category: ui-bugs
module: "serp-bar / content-script"
problem_type: ui_bug
component: tooling
severity: high
symptoms:
  - "Xiaohongshu SERP bar disappears a few seconds after load (SPA rebuild detaches host)"
  - "Xiaohongshu bar jumps from under the search box to under category chips when preferred anchors appear later"
  - "Douyin bar mounts but is covered by fixed header/toolbar or misaligned when using parent-relative offsets under position fixed"
  - "Engine match fails on Xiaohongshu URLs with trailing slash (/search_result/)"
root_cause: async_timing
resolution_type: code_fix
tags:
  - serp-bar
  - content-script
  - mutation-observer
  - spa
  - remount
  - pick-anchor
  - xiaohongshu
  - douyin
  - schema-migration
  - source-hidden
related_components:
  - entrypoints/serp-bar.content.ts
  - entrypoints/shared/serp-bar-styles.ts
  - lib/serp-bar-mount.ts
  - lib/engines/douyin.ts
  - lib/engines/xiaohongshu.ts
  - lib/engines/scopes.ts
  - lib/schema.ts
  - tests/serp-bar-mount.test.ts
  - tests/engines.test.ts
---

# SERP bar SPA remount budget and last-resort-only anchor upgrade

## Problem

Adding Douyin and Xiaohongshu as conventional engines required SERP Switch Bar injection on slow SPA result pages. Naïve anchor pick-once + mount left the bar missing after DOM rebuilds; aggressive “always upgrade to preferred anchor” fixed missing-bar cases but made Xiaohongshu **deterministically jump** from under the search box to under the category row. Layout for Douyin also needed fixed positioning between header and toolbar, with viewport-absolute alignment rather than parent-relative offsets.

## Symptoms

- Xiaohongshu: bar present briefly, then gone after SPA subtree rebuild (host detached; old code never remounted).
- Xiaohongshu after remount work: bar stays under search input, then jumps under category/filter UI when `.feeds-container` appears.
- Douyin: `mounted: true` but invisible (covered by fixed `#search-toolbar-container` / header) or not aligned with the search column when using `margin-left` under `position: fixed`.
- Xiaohongshu: content script logs `matched engine null` on `/search_result/?keyword=…` (trailing slash).

## What Didn't Work

- **Static anchors only** (e.g. `#search-content` / `#explore-feeds-container`): real pages do not expose those ids; diagnosis showed different hosts (Douyin `#search-result-container`, XHS `.feeds-container` / `#search-input`).
- **Pick anchor once at content-script start**: SPA may not have preferred nodes yet; waiting forever on the last candidate from a one-time pick, or mounting then losing the host with no detach handler.
- **Upgrade to any higher-priority anchor whenever it appears**: fixes `#app` lock-in but remounts from `#search-input` → `.feeds-container`, which is the user-visible position jump.
- **`position: fixed` with `--juso-serp-offset-left` (parent-relative)**: containing block is the viewport; bar does not share the search box column.
- **Exact pathname `=== '/search_result'`**: real Xiaohongshu URLs use `/search_result/`.

## Solution

### 1. Remount lifecycle (`entrypoints/serp-bar.content.ts`)

- Resolve WXT `anchor` / `append` via **functions** so each `ui.mount()` re-runs `pickAnchor`.
- `before`/`after` append **throws** if `parentElement` is null (fail closed vs silent no-op desyncing `ui.mounted`).
- Document-level MutationObserver waits for anchors; **always** `stopWaitingForAnchor()` before creating a new wait observer.
- Detach observer: if shadow host leaves `document`, **debounce (~80ms)** then `safeRemove` + remount; per-`locationRevision` **remount budget** (default 8).
- On invalidate: disconnect observers, clear timers, `safeRemove`.

### 2. Pure remount policy (`lib/serp-bar-mount.ts`)

Extracted and unit-tested:

| Helper | Role |
|--------|------|
| `preferredAnchorCandidates` | Multi-candidate lists drop last entry as last-resort |
| `canAttemptMount` | Prefer non-last-resort; only allow last-resort when budget ≤ 1 |
| `shouldUpgradeFromLastResort` | Upgrade **only** if currently on last-resort index |
| `consumeRemountBudget` / `DEFAULT_REMOUNT_BUDGET` | Bounded remounts per URL lifecycle |

Content script calls these instead of inlining policy.

### 3. Xiaohongshu anchors (stable position)

Priority order (stable UX first):

1. `#search-input` + `after` — under search box (correct product position)
2. `.feeds-container` + `before` — fallback only
3. `#app` + `first` — last-resort so the bar can still appear if preferred nodes lag

Upgrade observer only runs when mounted on **last-resort**; never remount solely because a higher non-last-resort sibling appeared later.

### 4. Douyin layout

- Engine match: single path segment `/search/<q>` (reject nested `/search/a/b`); content match pattern remains broad.
- Bar: `position: fixed; top: 56px` under `#douyin-header`; `pageStyles` push `#search-toolbar-container` (filters live inside) down.
- Alignment: set `--juso-serp-left` from align target’s **viewport** content left; `alignTo: #search-content-area` (column width), not narrower result shell.

### 5. Default-hidden engines（schema v2→v4）

- 新引擎 `douyin` / `xiaohongshu` 注册方式与 Google/Bing/Baidu 相同。
- `CURRENT_SCHEMA_VERSION = 4`（v2 迁移合并 douyin/xiaohongshu 到 `sourceHidden`，v3 添加 bilibili 默认隐藏，v4 添加 siteEngines 迁移）。每次迁移幂等；取消隐藏后不会重新合并。
- `ensureSchema` **先设置**迁移后的键（包括版本），**再**移除过时键。

## Why This Works

- Detach + budget remount addresses SPA host loss without infinite observer thrash.
- Last-resort-only upgrade keeps “always can mount eventually” without position thrash when intermediate anchors appear in the wrong order.
- Putting `#search-input` first matches where Xiaohongshu users expect the bar and matches pre-upgrade behavior.
- Viewport left for fixed hosts matches CSS containing-block rules; toolbar `pageStyles` puts filters below the bar rather than covering it.
- Trailing-slash and single-segment path rules match real SERP URLs without over-matching nested product routes.

## Prevention

- Keep remount / upgrade policy in `lib/serp-bar-mount.ts` with unit tests (`tests/serp-bar-mount.test.ts`); do not re-embed policy only inside the content-script IIFE.
- When adding engines with delayed SPA shells: declare ordered `anchors` with an intentional last-resort; never “upgrade between non-last-resort” for position-sensitive UIs.
- For `position: fixed` SERP hosts, store viewport coordinates (`--juso-serp-left`), not parent-relative offsets alone.
- Schema 迁移引入默认隐藏来源时必须用版本门控，用户取消隐藏后不得重新合并。当前 schema 版本为 4（v2: douyin/xiaohongshu, v3: bilibili, v4: siteEngines）。
- Content-script match patterns may be broader than `engine.matches`; keep `matches`/`extractQuery` strict and tested (including negative nested paths).

## Related Issues

- [Engine-specific SERP bar anchors (Google/Bing/Baidu)](./serp-bar-engine-specific-anchors.md) — anchor cascade, pageStyles, no autoMount
- [Testable content-script helpers via lib extraction](../architecture-patterns/testable-content-script-helpers-via-lib-extraction.md) — extract pure helpers for tests
- [Dual-domain storage schema versioning](../architecture-patterns/dual-domain-storage-schema-versioning.md) — ensureSchema / migrations
- [Google/Bing SERP scope minimization](../architecture-patterns/google-bing-serp-scope-minimization.md) — scope vs injection patterns
- [SERP switch bar and unified source model](../architecture-patterns/serp-switch-bar-and-unified-source-model.md) — sourceHidden projection
