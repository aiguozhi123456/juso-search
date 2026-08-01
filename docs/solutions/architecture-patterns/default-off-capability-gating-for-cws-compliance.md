---
title: Default-off capability gating for Agent Bridge and engine-search (CWS compliance)
date: 2026-07-25
last_updated: 2026-08-01
category: docs/solutions/architecture-patterns
module: Agent Bridge / background worker
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - "An extension capability can drive the browser to silently load third-party pages or extract results"
  - "Preparing a Chrome Web Store submission where a capability resembles automated scraping"
  - "A feature is powerful but optional, and its default-on state creates policy review risk"
tags: [agent-bridge, engine-search, cws-compliance, default-off, feature-flag, gating, scraping]
---

# Default-off capability gating for Agent Bridge and engine-search (CWS compliance)

## Context

Juso's Agent Bridge exposes the extension's search capability to a local AI assistant over loopback (`127.0.0.1`). One of its three actions, `engine-search`, lets the agent ask the worker to open a **background** tab (`tabs.create({ active: false })`) to Google/Bing/Baidu, read only the publicly-rendered result metadata (title/url/snippet) via the engine-extractor content script, close the tab, and return the data to the agent.

This is useful, but it is also the textbook shape of a **scraping tool**: an external process drives the browser to silently load search-engine pages and extract their results. A Chrome Web Store policy review (ora-1, code-grounded) flagged it as the single highest rejection risk — not because the capability is forbidden, but because it was **on by default with no rate limit and no user-facing signal**. Competing extensions (Kimi WebBridge, OpenCLI) ship similar local-agent bridges and pass review, which confirms the category is not a red line; the risk is in the *default-on, silent, undisclosed* posture, not the feature itself.

The same review flagged two related but lower-risk issues: the SERP switch-bar injects a `<style>` that repositions Baidu/Douyin's own toolbar (a transparency concern), and the single-purpose statement did not mention the Agent Bridge at all (an asymmetry between the permissions justification and the purpose declaration).

## Guidance

Any capability that can drive the browser to load third-party pages or extract their content **must ship off by default**, behind a two-layer opt-in:

1. **A total switch** gating the entire capability surface (here: `agentBridgeEnabled`, default `false`). Checked at the message-handler entry, before any work begins. When off, the handler returns `{ ok: false }` immediately and the bridge page closes itself — the capability is invisible to the outside world.
2. **A sub-switch** gating only the highest-risk sub-action (here: `engineSearchEnabled`, default `false`). Checked inside the executor wrapper, not the handler entry, so the lower-risk actions (provider search, list-providers) still work once the total switch is on. When off, the sub-action returns a typed error (`{ error: 'extract-failed' }`) rather than executing.

The sub-switch must be **UI-disabled when the total switch is off** (`disabled={!bridgeEnabled}`), so the user cannot enable the high-risk path without first enabling the surface that governs it.

### Implementation shape

Gate at the **caller**, not inside the library. The library (`lib/agent-bridge.ts`'s `runAgentBridge`) keeps its signature unchanged; the background handler wraps the executor dependency and checks the switches before delegating:

```ts
// entrypoints/background.ts
onMessage('agentBridgeClaim', async ({ data, sender }) => {
  if (!isTrustedBridgeSender(sender, browser.runtime.id)) return { ok: false };
  // Total switch: gates the entire bridge (search / list-providers / engine-search).
  if (!(await getAgentBridgeEnabled())) return { ok: false };
  return runAgentBridge(data, {
    fetch: (...args) => fetch(...args),
    handleSearch,
    listProviders: handleListAgentProviders,
    // Sub-switch: gates only engine-search. Wraps the executor dependency,
    // so runAgentBridge's signature stays clean and the gate is testable in isolation.
    handleEngineSearch: async (request, signal) => {
      if (!(await getEngineSearchEnabled())) {
        return { engine: request.engineId, query: request.query, error: 'extract-failed' };
      }
      return runEngineSearch(request, signal, { tabs: browser.tabs });
    },
  });
});
```

The preferences follow the project's standard config-preference pipeline (`storage.ts` getter/setter with `=== true` strict-boolean default `false`, `schema.ts` `CONFIG_KEYS` whitelist entry, no schema-version bump because the default is safe and the getter falls back). The options UI (`AgentBridgeSettings.tsx`) renders two checkboxes and loads the persisted state once on mount.

### Do not bump the schema version for a new default-`false` key

A new preference whose default is `false` (or otherwise safe) does **not** require a schema migration: existing users get the default through the getter's fallback, and there is no data to transform. Add the key to `CONFIG_KEYS` so the migration machinery is aware of it for future migrations, but leave `CURRENT_SCHEMA_VERSION` alone. Bump the version only when a migration must rewrite existing data.

## Why This Matters

The default-on posture made a compliant product *look* non-compliant. The capability itself — a local agent reading public search results through the user's own browser — is defensible and has review precedent. But a reviewer who loads the extension and discovers that an external process can silently drive Google/Bing/Baidu tabs **without any user opt-in** will read it as undeclared scraping capability, and the rejection will be for *misleading description* / *undeclared capability*, not for the feature being forbidden.

Default-off reframes the same capability from "the extension scrapes by default" to "the user explicitly chose to expose this." That is the difference between a scraping tool and a user-assistant feature. The cost is one checkbox; the user who wants it opts in once and loses nothing.

The two-layer split matters because not all sub-actions carry the same risk. `list-providers` returns no keys and no page content; gating it behind the engine-search switch would punish low-risk usage. Putting the total switch at the handler entry and the sub-switch at the executor wrapper gives a clean risk gradient: off → bridge-invisible, total-on → agent can search/list, sub-on → agent can scrape engines.

## When to Apply

- Any extension capability where an external process (local agent, native messaging host, loopback bridge) can cause the browser to load third-party pages or read their content.
- Any feature that is powerful but optional, where the default-on state would expand the store-review surface even if the feature is policy-compliant when used.
- When a capability has a clear risk gradient internally (e.g., read-config vs. drive-browser), split the gate rather than gating everything behind the strictest switch.
- When documenting the extension for store review: the single-purpose statement and the permissions justification must mention the capability *and* state that it is off by default — an asymmetry between "what the permissions request" and "what the purpose declares" is itself a rejection signal.

This does **not** apply to capabilities the user invokes directly through visible UI (toolbar click, SERP switch bar) — those are already user-initiated and visible, which is the property the gate restores for the programmatic path.

## Examples

### Verified behavior matrix (real Vivaldi + real Exa API)

The gating was verified end-to-end against a loaded unpacked extension in Vivaldi, using the project's built-in `skills/juso-search/scripts/juso_search.py` client:

| Switches | Action | Result | What it proves |
|---|---|---|---|
| on + on | `list-providers` | 4 providers returned | total switch passes |
| on + on | `engine-search` Google | 3 results extracted | sub switch passes, full scrape chain works |
| on + off | `search` (no key) | `{ ok:false, error:{ kind:'keyMissing' } }` | total switch passes — reached `handleSearch`, **not** a gate timeout |
| on + off | `engine-search` | `{ engine, query, error:'extract-failed' }` | sub switch blocks engine-search only |
| on + off | `search` Exa (key configured) | `{ ok:true, response:{ answer, citations, results } }` | total switch passes + real provider call + BYOK boundary holds |

The critical distinction: when the total switch is on but the sub-switch is off, `search` returns a **business error** (`keyMissing` or a real result), not a gate rejection. That proves the gate is scoped to engine-search, not over-broad. A gate that returned `{ ok:false }` for *every* action when the sub-switch was off would be a bug, not a feature.

### What the gate does NOT do (deferred)

This learning covers only the default-off gate. Three adjacent risks surfaced by the same review are deliberately deferred ("等被打回来再说"):

- **Rate limiting** on engine-search (min interval, daily cap, concurrency=1) — not implemented; the gate removes the default-on risk but a determined agent can still hammer Google once opted in.
- **Tab visibility** — engine-search still opens `active:false` background tabs. Making the tab visible (`active:true`) or surfacing a notification would further reduce the "silent scraping" appearance.
- **SERP bar provenance** — the switch bar still has no visible "Juso" wordmark, so a user on Baidu SERP may not recognize the injected bar as extension-provided.

These are reduction-in-risk optimizations, not blockers; the default-off gate is the minimum viable compliance fix.

## Related

- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — the Agent Bridge architecture this gate plugs into. It already describes the same two-layer gating (the total-switch check precedes injection, and the executor is wrapped by the sub-switch) and cross-references this doc.
- `docs/solutions/architecture-patterns/google-bing-serp-scope-minimization.md` — the other half of the CWS-compliance story: static injection-scope minimization. This doc is the runtime-capability counterpart.
- `docs/solutions/architecture-patterns/config-preference-pipeline.md` — the end-to-end preference pipeline the two new switches follow (storage / schema / i18n / options UI).
- `docs/assets/store/privacy.md` — the store-listing copy that discloses the default-off posture to reviewers; the code and the copy must stay in sync.
- `docs/solutions/workflow-issues/cws-listing-copy-submission-constraints.md` — the copy-writing constraints behind that store-listing disclosure (no brand enumeration in listing copy, 1000-char questionnaire justifications, single source-of-truth store docs); the v1.3.0 keyword-spam rejection and its fix are recorded there.
