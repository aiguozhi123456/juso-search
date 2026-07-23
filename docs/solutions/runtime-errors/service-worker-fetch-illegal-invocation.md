---
title: Service Worker fetch Illegal invocation when passing global fetch as a dependency
date: 2026-07-23
category: runtime-errors
module: agent-bridge
problem_type: runtime_error
component: assistant
symptoms:
  - "Agent Bridge claim returns timeout while bridge.html shows connection failed"
  - "Service Worker console logs isTrustedBridgeSender true then TypeError Failed to execute fetch on WorkerGlobalScope Illegal invocation"
  - "Network tab shows no request to http://127.0.0.1 claim endpoint"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - agent-bridge
  - service-worker
  - fetch
  - illegal-invocation
  - chrome-mv3
  - this-binding
---

# Service Worker fetch Illegal invocation when passing global fetch as a dependency

## Problem

The Agent Bridge opened `bridge.html`, trusted the sender, and still failed every claim. The Python skill timed out with `extension did not complete the request`, and the bridge page reported connection failure even though the background handler ran.

## Symptoms

- `juso_search.py` exits with `{"ok":false,"error":{"kind":"timeout",...}}`
- bridge page shows "连接失败 / Connection failed"
- Service Worker log path: handler called → `isTrustedBridgeSender: true` → `runAgentBridge start` → fetch throws
- Exact error: `TypeError: Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation`
- No loopback claim request appears in the Service Worker Network panel when the throw happens before `fetch` is invoked correctly

## What Didn't Work

- Blaming Vivaldi-only protocol differences: the same failure reproduced in Chrome with a valid extension id
- Assuming `isTrustedBridgeSender` rejected the sender: diagnostic logs proved it returned `true`
- Assuming host permissions for `http://127.0.0.1/*` were missing: the built manifest already declared them
- Searching only the Python loopback server: unit tests for claim/complete passed; the worker never completed the claim

## Solution

Do not pass the global `fetch` function as a bare object property into deps and call it as `deps.fetch(...)`. In a Service Worker, that loses the required `WorkerGlobalScope` receiver.

Before:

```ts
return runAgentBridge(data, {
  fetch,
  handleSearch,
  listProviders: handleListAgentProviders,
  handleEngineSearch: (request, signal) =>
    runEngineSearch(request, signal, { tabs: browser.tabs }),
});
```

After:

```ts
return runAgentBridge(data, {
  fetch: (...args) => fetch(...args),
  handleSearch,
  listProviders: handleListAgentProviders,
  handleEngineSearch: (request, signal) =>
    runEngineSearch(request, signal, { tabs: browser.tabs }),
});
```

Equivalent alternatives: `fetch.bind(globalThis)` or an explicit wrapper that calls the free function form.

## Why This Works

`fetch` in a Service Worker is a method-like host function on `WorkerGlobalScope`. Extracting it as a free property and invoking it as `deps.fetch(url, init)` rebinds `this` to `deps`, which the host rejects as an illegal invocation. An arrow wrapper restores the free-call form so the correct global receiver is used, and the claim/complete loopback POSTs succeed.

## Prevention

- When injecting browser host APIs into dependency objects, wrap method-like globals (`fetch`, sometimes `crypto.subtle` helpers) instead of passing the bare function reference
- For bridge failures, log through the handler path in order: sender trust → endpoint construction → claim fetch status → complete status; silent `catch { return { ok: false } }` hides the real error
- Keep a focused Vitest path for `runAgentBridge` with a mock `fetch`, plus one real Chrome E2E smoke with `juso_search.py engine-search`

## Related Issues

- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — intended bridge architecture
- `docs/solutions/logic-errors/google-serp-extractor-nested-wrapper.md` — separate post-bridge extractor bug found in the same E2E pass
- `docs/solutions/logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md` — SERP `timeout` / `tab-closed` / `aborted` are tab orchestration kinds; do not conflate with SW `fetch` Illegal invocation timeouts
