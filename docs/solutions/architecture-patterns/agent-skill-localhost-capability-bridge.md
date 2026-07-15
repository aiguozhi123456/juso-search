---
title: Bridge a General Agent Skill to Chrome MV3 Without Exposing BYOK Keys
date: 2026-07-15
category: architecture-patterns
module: agent-skill-localhost-bridge
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "A local Agent needs to invoke capabilities owned by a Chrome MV3 extension"
  - "Stored BYOK keys must remain readable only by the extension background worker"
  - "The integration should be portable across Agent Skills clients without a persistent daemon"
  - "Search-engine results require a real browser profile and rendered SERP DOM"
tags:
  - agent-skill
  - chrome-mv3
  - localhost-bridge
  - capability-security
  - byok
  - provider-search
  - serp-extraction
  - background-tabs
---

# Bridge a General Agent Skill to Chrome MV3 Without Exposing BYOK Keys

## Context

Juso stores provider keys in `chrome.storage.local` and permits only the background worker to read them. A local Agent also needs provider search, provider discovery, and Google/Bing/Baidu natural-result search without receiving those keys.

A Chrome MV3 extension cannot directly act as a general MCP stdio server: it has no Agent-controlled stdin/stdout, cannot listen on a local server socket, and its service worker lifecycle belongs to Chrome. A separate process also cannot safely or portably parse an extension profile to read `chrome.storage.local`; doing so would break the worker-only BYOK boundary.

The solution is a portable Agent Skill whose short-lived Python script creates a one-shot loopback capability channel. The script never receives a provider key.

## Guidance

### Use a short-lived capability bridge

The request path is:

```text
Agent
  -> Python Skill binds 127.0.0.1 on an OS-assigned port
  -> script generates a one-time token and requestId
  -> Chrome opens chrome-extension://<id>/bridge.html#v=1&p=<port>&t=<token>
  -> bridge.html clears the fragment and messages the background worker
  -> worker POSTs /v1/claim to obtain the request
  -> worker executes the action
  -> worker POSTs /v1/complete with the validated reply
  -> after successful argument parsing, the script prints one JSON result and exits
```

The Skill package lives in `skills/juso-search/`. Its frontmatter and relative `scripts/` layout use the common Agent Skills subset supported by Codex, Claude Code, and OpenCode. The Python 3.11 script uses only the standard library.

### Treat the token as a narrow, one-time capability

Each invocation:

- binds only `127.0.0.1`, never `0.0.0.0`, a LAN address, or hostname-based `localhost`;
- uses an OS-assigned random port, a high-entropy token, and a separate request ID;
- accepts only `POST /v1/claim` and `POST /v1/complete`;
- checks the exact `Host`, Bearer token, protocol version, request ID, action schema, and reply schema;
- makes claim idempotent and complete single-use;
- closes the server and destroys the capability after completion or timeout; daemonized request threads and per-connection timeouts prevent an incomplete local request from holding shutdown open.

The extension constructs `http://127.0.0.1:<validated-port>/v1/...` itself. It never accepts a callback URL, hostname, scheme, path, or redirect from the claim. The manifest therefore needs only `http://127.0.0.1/*`, not `<all_urls>`.

The token is passed in the extension-page fragment rather than the query string. `entrypoints/bridge/main.ts` saves and immediately clears the fragment before messaging the worker. This reduces incidental exposure but does not replace short lifetime, single use, and strict authentication.

### Keep the bridge page unprivileged

`bridge.html` only parses bridge credentials and calls the typed `agentBridgeClaim` message. It does not read storage, execute searches, or post results.

Before using the credentials, `entrypoints/background.ts` verifies that the sender ID is the current extension, the origin is the current extension origin, and the path is exactly `/bridge.html`. The worker then injects the existing provider gateway, a declassified provider-list handler, and the engine-search executor into `lib/agent-bridge.ts`.

`list-providers` returns only provider IDs, answer capability, and configured status. Provider search still flows through `lib/gateway.ts`, so key access, normalization, caching, and error mapping remain identical to extension UI searches.

### Define claim direction and deadlines precisely

The extension initiates claim with an authenticated, empty POST:

```http
POST /v1/claim
Authorization: Bearer <token>
```

The local script returns the claim JSON. Requiring a JSON body or `Content-Type` on this first request is a protocol mismatch: the worker is asking for the request, not sending it.

Action cancellation and completion delivery use separate abort controllers. If the action deadline expires, its signal is permanently aborted; reusing it for `/v1/complete` prevents even the timeout result from reaching the script. Juso gives the action its main deadline and completion a short independent deadline.

Cancellation propagates through `lib/gateway.ts`, `lib/providers/http.ts`, and `lib/mcp-client.ts` as a best-effort client-side abort. A provider may already have received and billed the request, so cancellation cannot promise billing avoidance. The gateway rechecks the signal after the adapter returns and before cache writes, preventing a response that lost the timeout race from being cached.

### Use real tabs for conventional search engines

Provider APIs are appropriate for worker `fetch`. Search-engine SERPs are not: their content depends on the real Chrome profile, locale, cookies, challenge state, navigation, and rendered DOM.

`lib/engine-search.ts` therefore creates an inactive temporary tab from a registered engine's URL builder. It waits for the created tab—not any tab—to finish loading, retries briefly until the dedicated content script is ready, validates the response's request ID, engine, query, and shape, and makes a best-effort removal of only that temporary tab in `finally`.

The load wait registers `tabs.onUpdated` and then rechecks `tabs.get` to avoid missing a completion event that fires between tab creation and listener registration.

`entrypoints/engine-extractor.content.ts` is separate from the SERP switch-bar UI. It runs only on approved engine hosts, accepts the internal extraction message, verifies the expected engine and query, waits briefly for results or a challenge state, and calls the engine-specific pure extractor.

### Extract natural results conservatively

The engine result contract is deliberately small:

```json
{
  "engine": "google",
  "query": "example",
  "results": [
    {"title": "Example", "url": "https://example.com/", "snippet": "..."}
  ]
}
```

Juso does not fetch result pages; the Agent uses its own `web_fetch` after selecting a URL. The extractor also does not claim support for AI Overview, knowledge panels, advertisements, or featured cards.

Each engine owns its natural-result DOM contract:

- Google limits candidates to natural-result blocks under `#rso` and excludes AI, knowledge, answer, PAA, and advertisement blocks. Scanning every `h3` under the whole search page incorrectly captures special cards.
- Bing accepts natural `#b_results li.b_algo` blocks and excludes answer, advertisement, pagination, and message modules.
- Baidu accepts ordinary result containers under `#content_left`, excludes `.result-op` and advertisements, and prefers the block's `mu` target when available.

Redirect decoding requires both the expected path and engine hostname. An external site may legitimately have `/url?q=...` or `/ck/a?u=...`; path-only decoding would silently rewrite its URL.

Challenge, consent, unsupported-layout, and no-results are explicit errors with nonzero CLI exit status. They are not successful empty result sets.

## Why This Matters

This pattern separates four concerns that should not share one trust boundary:

- the Agent gets a normal, short-lived CLI process;
- loopback authentication grants one narrow action rather than a persistent local API;
- stored provider keys are never exposed to the Skill, bridge page, content script, URL output, or Agent context; only the worker reads them and sends authentication to fixed provider endpoints;
- conventional engines use a real rendered browser tab while provider APIs continue using worker network transports.

The strict action and reply schemas also prevent a valid response from one action or invocation being accepted for another.

## When to Apply

- A browser extension owns local secrets, browser permissions, profile state, or rendered DOM that a local Agent needs for one action.
- Installing and maintaining a native messaging host or persistent daemon would be disproportionate.
- Chrome being installed, running when invoked, and having the extension enabled in the selected profile is acceptable.
- The action can finish within a bounded request lifetime.

Do not use this pattern for a long-lived multi-client local service, CAPTCHA bypass, arbitrary page scraping, or workloads requiring strong protection from another malicious process running as the same OS user. Those cases need a managed daemon, OS IPC controls, or Native Messaging.

## Examples

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

The implementation is guarded by:

- `tests/agent-bridge.test.ts` and `tests/scripts/test_juso_search.py` for both sides of claim/complete;
- `tests/engine-search.test.ts` for temporary-tab orchestration, races, cancellation, validation, and cleanup;
- `tests/engine-extractors.test.ts` plus minimal fixtures for natural-result extraction, special-card exclusion, URL decoding, deduplication, and page states;
- `tests/http.test.ts` and `tests/mcp-client.test.ts` for abort propagation;
- manual inspection of the generated manifest after build to ensure the bridge remains loopback-only and engine extraction remains limited to approved engine hosts.

The verified checks included the full Vitest suite, Python bridge tests, `npm run typecheck`, `npm run lint`, and `npm run build`. This is not a substitute for a real-browser smoke test using an installed extension, configured provider keys, and live Google/Bing/Baidu pages.

## Related

- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md`
- `docs/solutions/architecture-patterns/standardized-provider-engine-adapter-layers.md`
- `docs/solutions/architecture-patterns/google-bing-serp-scope-minimization.md`
- `docs/solutions/runtime-errors/serp-to-extension-page-blocked-by-client.md`
- `skills/juso-search/SKILL.md`
- `lib/agent-bridge.ts`
- `lib/engine-search.ts`
- `lib/engines/extractors/`
