---
title: Engine-search misclassified tab failures as unsupported-layout and weak Baidu organic URLs
date: 2026-07-23
category: logic-errors
module: engine-search
problem_type: logic_error
component: assistant
symptoms:
  - "User closing the temporary SERP tab returned error unsupported-layout instead of tab-closed"
  - "Load timeouts, aborts, and extract failures were collapsed into unsupported-layout"
  - "Baidu organic URLs often remained baidu.com/link shells or nourl placeholders"
  - "Temporary SERP and bridge tabs could still steal focus on some Chromium builds"
  - "Google engine-search timeouts were mislabeled as unsupported-layout"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - engine-search
  - agent-bridge
  - baidu
  - serp
  - error-classification
  - tab-orchestration
  - url-extraction
  - unsupported-layout
---

# Engine-search misclassified tab failures as unsupported-layout and weak Baidu organic URLs

## Problem

The Agent `engine-search` path had two independent defects that both produced wrong or unusable outcomes for callers.

First, Baidu SERP extraction in `lib/engines/extractors/baidu.ts` resolved result URLs with a shallow fallback (`block.mu ?? anchor.href`). On real Baidu layouts that often left `baidu.com/link` redirect shells, missed mobile-only embedded destinations, or dropped scholar-style `sc_vurl` targets. Agents received either non-destination URLs or empty result sets when only shells were present.

Second, orchestration failures around temporary SERP tabs were collapsed into a single page-state error. Catch paths in engine-search / agent-bridge treated tab close, load timeout, abort, and generic extract failures as `unsupported-layout`. That token means “DOM shape we do not parse,” so Agents and the skill mis-routed recovery: they treated user-closed tabs or deadline aborts as layout bugs.

## Symptoms

- Baidu `engine-search` results pointed at `https://www.baidu.com/link?...` or `m.baidu.com/from/...` instead of the real site.
- Mobile or mixed blocks with real URLs only in `data-mdurl`, `data-log` JSON `mu`, or `sc_vurl` yielded no usable `url` (or were skipped).
- Blocks with `mu="nourl"` plus a link shell still looked like candidates until filtered; pure shell-only blocks polluted or emptied results.
- Closing the temporary SERP tab mid-run returned `error: "unsupported-layout"` instead of a lifecycle kind.
- Bridge deadline / AbortSignal cancellation and tab load timeouts also surfaced as `unsupported-layout`.
- Python skill validation only accepted page-state error tokens, so new orchestration kinds would have been rejected as invalid replies if the extension emitted them without a skill update.
- Background SERP tabs and `bridge.html` still stole focus on some Chromium builds despite `active: false` on create.

## What Didn't Work

- Keeping `mu ?? href` only: desktop `mu` is incomplete; many blocks expose destination only on the anchor (`data-mdurl`) or in mobile `data-log`.
- Treating every Baidu `href` as final: `/link` and `/from/` shells are not agent-usable destinations and must be skipped, not returned.
- Network redirect following (e.g. userscript-style `GM_xmlhttpRequest` to resolve `/link`): out of scope for the local content-script extractor, adds latency, and is unnecessary when the page already embeds real URLs.
- Mapping all `catch` outcomes to `unsupported-layout`: that kind is reserved for extractor page-state / layout decisions, not tab lifecycle or abort.
- Relying solely on `tabs.create({ active: false })` without a follow-up `tabs.update(..., { active: false })` and without deactivating `bridge.html` immediately: some Chromium builds still focus the new tab.

## Solution

### A. Local-only Baidu URL candidate chain

File: `lib/engines/extractors/baidu.ts`.

`baiduResultUrl(block, anchor, pageUrl)` walks candidates in fixed order and returns the first absolute `http(s)` URL that is not a nourl placeholder and not a Baidu redirect shell:

1. `block` attribute `mu` (desktop container)
2. `a[data-mdurl]` on the title anchor
3. `mu` from `data-log` JSON (`parseMuFromDataLog`), with single-quoted mobile JSON tolerated via `raw.replace(/'/g, '"')` before `JSON.parse`
4. `sc_vurl` query param from the anchor `href` (`scVurlFromHref`) for scholar-style links
5. bare external `href` as last resort

Helpers:

- `isBaiduRedirectShell(url)` — hostname is `*.baidu.com` and pathname matches `/link` or `/from/`.
- Skip any candidate containing `nourl`.
- Resolve with `absoluteHttpUrl(candidate, pageUrl)`; continue if resolution fails or shell filter hits.

`extract` still selects `#content_left` result containers, skips ads / op blocks, requires title + resolved URL, and builds snippet from abstract or fallback clone.

Fixture and tests:

- `tests/fixtures/engines/baidu-url-fallbacks.html` — mdurl, double- and single-quoted `data-log` mu, `sc_vurl`, direct external href, nourl+shell drop, shell-only drop, mu preferred over mdurl/href.
- `tests/engine-extractors.test.ts` asserts preferred URLs and that shell/nourl rows produce no results.

Design constraint (explicit): local DOM only; no network follow-redirect. Order mirrors common SERP fields and AC-baidu-style local shortcuts, not remote resolution.

### B. Orchestration error kinds and focus hygiene

**Type surface** — `lib/engines/extractors/types.ts`

`EngineExtractionErrorKind` keeps page-state kinds (`challenge`, `consent`, `unsupported-layout`, `no-results`) and adds orchestration kinds:

| Kind | Meaning |
|------|---------|
| `tab-closed` | Temporary SERP tab removed before extraction finished |
| `timeout` | Tab load / handshake wait timed out |
| `aborted` | Bridge deadline or cancellation (`AbortError`) |
| `extract-failed` | Create/message/malformed reply / other orchestration failure |

**Orchestrator** — `lib/engine-search.ts`

- `PAGE_STATE_ERRORS` vs `ORCHESTRATION_ERRORS` sets; `isExtractionReply` accepts both when validating worker↔content replies.
- `tabs.create({ url, active: false })`; if `tab.id` missing → `extract-failed`.
- Immediate `tabs.update?.(tabId, { active: false })` (best-effort) because some builds still focus background creates.
- `tabs.onRemoved` listener sets `closedByUser` when the SERP tab id is removed; finally removes listener and closes the tab only if not already user-closed.
- `waitForComplete`:
  - resolves on `status === 'complete'` (listener + `tabs.get` race)
  - rejects `AbortError` on signal abort
  - rejects `Error('tab did not finish loading')` on timer → classified as `timeout` via `isTimeoutError` (`/did not finish loading|timeout/i`)
  - rejects `Error('tab closed')` on `onRemoved` or failed `tabs.get` → outer path prefers `closedByUser` → `tab-closed`
- Outer `catch` order: `tab-closed` → `aborted` → `timeout` → `extract-failed`.
- Malformed / non-matching extract replies → `extract-failed`, not layout error.

**Agent bridge catch** — `lib/agent-bridge.ts`

On `engine-search` action failure inside claim handling, reply is structured as `{ engine, query, error }` with `aborted` for `DOMException` `AbortError`, else `extract-failed` (no longer a generic search error blob for this action).

**Bridge tab focus** — `entrypoints/bridge/main.ts`

Right after parse setup, `browser.tabs.getCurrent()` then `tabs.update(id, { active: false })` so the external process’s focused `bridge.html` open does not leave the user on the bridge tab.

**Skill acceptance and docs**

- `skills/juso-search/scripts/juso_search.py` — `is_engine_search_reply` accepts `tab-closed`, `timeout`, `aborted`, `extract-failed` alongside page-state kinds (all still nonzero exit via existing result status).
- `skills/juso-search/SKILL.md` — documents page-state vs orchestration error groups for Agents.

**Tests**

- `tests/engine-search.test.ts` — background create + update inactive; `aborted` vs malformed → `extract-failed`; early `onRemoved` → `tab-closed`; create failure → `extract-failed`.
- `tests/agent-bridge.test.ts` — aborted engine search completes with `error: 'aborted'`.
- `tests/scripts/test_juso_search.py` — validation accepts new kinds; status nonzero for e.g. `tab-closed`.

## Why This Works

Baidu embeds destination URLs in several DOM slots; an ordered local chain recovers real `http(s)` targets without following redirect shells. Shell and `nourl` filters prevent returning non-destinations that look like URLs. Keeping extraction network-free matches the content-script trust boundary and avoids GM-style remote resolve.

Separating orchestration kinds from page-state kinds restores correct Agent branching: close the tab → do not rewrite extractors; timeout → retry or raise wait; abort → respect cancellation; extract-failed → infrastructure. `onRemoved` plus distinct reject messages in `waitForComplete` make those cases observable instead of a single catch-all string. Skill validation and SKILL.md keep the loopback contract aligned so classified replies are accepted and documented. Force-inactive create/update and immediate bridge deactivation reduce focus theft without changing the one-shot capability model.

## Prevention

- Prefer page-embedded destination fields over SERP host redirect URLs; add fixture rows for every new Baidu URL slot before changing candidate order.
- Never map lifecycle failures to `unsupported-layout`; extend `EngineExtractionErrorKind` and both TS validation sets and Python `is_engine_search_reply` in the same change.
- When adding tab orchestration paths, always distinguish abort vs timeout vs tab removal in tests (`tests/engine-search.test.ts`).
- For any tab opened for Agent work (`engine-search` SERP or `bridge.html`), create inactive and re-assert `active: false` if the host may still focus the tab.
- Do not introduce network redirect resolution in extractors without an explicit design decision; local shortcuts first.
- Keep SKILL.md orchestration vs page-state lists in sync with `types.ts` and `juso_search.py`.

## Related Issues

- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — engine-search temporary tabs, page-state errors, Baidu natural-result contract
- `docs/solutions/logic-errors/google-serp-extractor-nested-wrapper.md` — parallel extractor DOM fragility on the same path
- `docs/solutions/ui-bugs/bridge-page-auto-close-after-claim.md` — bridge.html fire-and-forget close (adjacent focus hygiene)
- `docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md` — different timeout class (SW `fetch` this-binding), do not conflate with SERP `tab-closed` / load `timeout`
