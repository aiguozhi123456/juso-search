---
title: Close bridge.html after Agent Bridge claim completes
date: 2026-07-23
category: ui-bugs
module: agent-bridge
problem_type: ui_bug
component: assistant
symptoms:
  - "Each juso_search.py invocation leaves a chrome-extension bridge.html tab open"
  - "Bridge page shows Request completed or connection failed and stays until closed manually"
root_cause: incomplete_setup
resolution_type: code_fix
severity: low
tags:
  - agent-bridge
  - bridge-html
  - window-close
  - chrome-extension-page
---

# Close bridge.html after Agent Bridge claim completes

## Problem

The Agent Bridge page finished messaging the worker and updated its status text, but the temporary `bridge.html` tab never closed. Repeated skill invocations stacked orphan extension tabs.

## Symptoms

- Successful engine-search left a visible "请求已完成 / Request completed" tab
- Failed claims left a visible "连接失败 / Connection failed" tab
- User had to close bridge tabs manually after each Python skill run

## What Didn't Work

- Expecting the Python skill to close Chrome tabs: the skill only launches the URL and waits on loopback complete
- Expecting Chrome to treat the bridge page as a popup that auto-dismisses: it is a normal extension page opened by an external process

## Solution

In `entrypoints/bridge/main.ts`, after every terminal status update (invalid fragment, claim success/failure, or thrown messaging error), schedule a short close:

```ts
function closeTab(): void {
  setTimeout(() => window.close(), 300);
}
```

Call `closeTab()` after `setStatus(...)` on all exit paths. The 300ms delay lets the status paint briefly before the tab disappears. Extension pages may call `window.close()` to close themselves.

## Why This Works

`bridge.html` is a one-shot capability UI, not a durable surface. Once the worker has claimed and completed (or failed), the page has no further role. Closing it keeps the browser clean without changing the claim/complete protocol.

## Prevention

- Treat temporary extension pages opened by external tools as fire-and-forget: always pair completion UI with close
- Smoke-test after bridge changes: one skill invocation should not leave a lasting bridge tab

## Related Issues

- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md`
- `docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md`
- `docs/solutions/logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md` — bridge and SERP tabs should stay inactive / not steal focus; orchestration failures are not page-state
