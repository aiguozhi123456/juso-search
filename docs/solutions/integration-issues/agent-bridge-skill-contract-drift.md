---
title: "Agent Bridge skill contract drift (fragment version, provider whitelist, abort signaling, process cleanup, Windows encoding)"
date: 2026-08-03
last_updated: 2026-08-17
category: integration-issues
module: agent-bridge
problem_type: integration_issue
component: tooling
symptoms:
  - "Every skill invocation failed silently: bridge.html closed itself without claiming, Python hung until 40s timeout then returned extension_did_not_claim"
  - "list-providers always failed with extension_did_not_complete — worker returned 8 providers but Python rejected the reply as invalid_reply (HTTP 400)"
  - "On fragment version mismatch the bridge tab closed without notifying Python, leaving the script to wait the full 40s timeout with no classified error"
  - "On timeout the launched browser subprocess was never terminated (Popen return value discarded), accumulating orphan processes"
  - "search --provider exa succeeded end-to-end but Python crashed at print() with UnicodeEncodeError on non-GBK characters (€) in Windows GBK console"
root_cause: logic_error
resolution_type: code_fix
severity: critical
tags: [agent-bridge, juso-skill, contract-drift, fragment-version, provider-whitelist, process-cleanup, windows-encoding]
---

# Agent Bridge skill contract drift (fragment version, provider whitelist, abort signaling, process cleanup, Windows encoding)

## Problem

The Juso Search Agent Bridge — a local loopback HTTP protocol between the Python skill script (single source `public/agent-skill/scripts/juso_search.py` + `juso_bridge.py`, generated into `skills/juso-search/` and `skills/juso-search-dev/`) and the extension's background worker (`lib/agent-bridge.ts`, `entrypoints/bridge/main.ts`) — carried five independent alignment defects that together made every skill invocation fail, hang, or crash. An end-to-end review against the live dev extension (Vivaldi) surfaced all five; each was fixed and verified by `npm run typecheck`, `npm run lint`, `npm test` (1058 tests), the Python suite (22 tests), and a live E2E run.

## Symptoms

- **Bug 1 (fatal):** Every skill invocation failed. The bridge page opened, flashed "Connection failed", and closed; the Python script hung for the full 40s timeout and returned `extension_did_not_claim`.
- **Bug 2:** `list-providers` always failed with `extension_did_not_complete`. The worker returned a valid 8-provider reply, but Python rejected it as `invalid_reply` (HTTP 400).
- **Bug 3:** On any fragment version mismatch the bridge tab silently closed without notifying the Python server; Python waited the full 40s with zero feedback.
- **Bug 4:** On timeout, the browser process launched by `subprocess.Popen` was left running. Repeated failed invocations accumulated orphan `chrome`/`vivaldi` processes.
- **Bug 5:** `search --provider exa` succeeded end-to-end, but Python crashed at `print(json.dumps(result, ensure_ascii=False))` with `UnicodeEncodeError: 'gbk' codec can't encode character '\u20ac'` (€ in results). The Agent received no JSON.

## What Didn't Work

Both sides' test suites bypassed the real cross-end fragment flow, so none of the five bugs were caught before the review:

- **TS side** (`tests/agent-bridge.test.ts`) constructed `v=1` fragments by hand and mocked `fetch`. It never exercised a fragment produced by the Python script, so the `v=2` bump in Python was invisible to it. `parseBridgeFragment`'s strict `v=1` check was therefore never stressed from the other end.
- **Python side** (`tests/scripts/test_juso_search.py`) mocked `subprocess.Popen` and drove its own loopback server directly. It asserted on the JSON protocol field (`protocol=2`) but reused a stale `v=1` fragment in its own fixtures — so the production `v=2` line in `run()` was never actually under test.
- **Provider whitelist** was checked only on each side independently: TS tests asserted `allProviders()` returned 8 ids; Python tests asserted `PROVIDERS` had 7. No test asserted the two sets were equal.
- **Failure back-channel** had no test because it did not exist; the bridge's "close tab on parse failure" path was considered terminal UI, not a protocol concern.
- **Process cleanup** was untested because `Popen` was mocked; the mock never simulated a lingering process.
- **Encoding** was untested because the test suite captured stdout via a mock, never the real Windows GBK console.

A deeper cause ran through bugs 1 and 2: the fragment `v` (credential format version, the `v/p/t` structure) and the JSON `protocol` field (claim/complete message schema version) were treated as a single axis. Commit `5d27315` bumped both together under the impression they were the same version, when in fact the fragment structure never changed — only the JSON message schema did.

## Solution

### Bug 1 — Fragment version mismatch

The bridge fragment carries `v` (credential format version), `p` (port), `t` (token). The worker's `parseBridgeFragment` (`lib/agent-bridge.ts:57-74`) strictly requires `v=1`. Commit `5d27315` bumped the Python fragment from `v=1` to `v=2` alongside a `PROTOCOL=2` bump for the claim/complete JSON protocol — but the fragment `v` and JSON `protocol` are independent axes. The fragment structure (`v/p/t`) never changed; only the JSON schema did (to add `search-instance`/`list-instances`).

**Before** (pre-split `juso_search.py:418`, both scripts):
```python
url = f"chrome-extension://{args.extension_id}/bridge.html#v=2&p={server.server_port}&t={token}"
```

**After**（now `juso_bridge.py:580-581`; since Firefox support the base may be a stamped `moz-extension://` `--bridge-url` / `__JUSO_BRIDGE_URL__` value）:
```python
base_url = bridge_url or f"chrome-extension://{extension_id}/bridge.html"
url = f"{base_url}#v=1&p={server.server_port}&t={token}"
```

The JSON `PROTOCOL = 2` constant is unchanged — it correctly reflects the claim/complete message schema.

### Bug 2 — Provider whitelist drift (`brave` missing)

`lib/providers/types.ts` defined `ProviderId` as 8 providers including `brave` (it has since grown to 9 with `parallel`). `handleListAgentProviders` (`lib/gateway.ts:155`) maps `allProviders()` — all of them. But Python's `PROVIDERS` tuple had only 7, missing `brave`. Python's `is_provider_list_reply` validator requires every `provider["id"] in PROVIDERS`, so `brave` failed → `invalid_reply` → HTTP 400.

This violates `docs/solutions/architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md`: the engine whitelist must mirror the worker's registry. The engine side was already aligned at 8=8; the provider side was missed.

**Before** (`juso_search.py:29`, both scripts):
```python
PROVIDERS = ("tavily", "exa", "stepfun", "stepfun-plan", "jina", "doubao", "doubao-global")
```

**After**:
```python
PROVIDERS = ("tavily", "exa", "brave", "stepfun", "stepfun-plan", "jina", "doubao", "doubao-global")
```

> **Note (2026-08-10):** The `PROVIDERS` tuple no longer exists. This drift class is eliminated at the root by runtime discovery: `juso_bridge.py` no longer carries any vocabulary list, the reply validators check shape (non-empty string) instead of vocabulary membership, and `juso_search.py` dropped the `choices=PROVIDERS` argparse constraint. The before/after above is preserved as the historical record of the concrete `brave` incident. See `skill-mcp-vocabulary-decoupling.md` for the structural fix.

### Bug 3 — Version mismatch hangs instead of erroring

When `parseBridgeFragment` failed, `entrypoints/bridge/main.ts` showed "Connection failed" and closed the tab — but never contacted the Python server. Python waited the full 40s with no signal.

The fix introduces a back-channel: a best-effort abort notification from bridge to skill.

**`lib/agent-bridge.ts`** — new loose credential extractor that ignores the version check:
```ts
export function extractLooseBridgeCredentials(fragment: string): BridgeCredentials | null {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const portStr = params.get('p');
  const token = params.get('t');
  if (!portStr || !token) return null;
  const port = parsePort(portStr);
  if (port === null || !isBase64UrlToken(token)) return null;
  return { port, token };
}
```

**`entrypoints/bridge/main.ts`** — on parse failure, notify the skill:
```ts
async function notifyAbort(fragment: string): Promise<void> {
  const loose = extractLooseBridgeCredentials(fragment);
  if (!loose) return;
  try {
    await fetch(`http://127.0.0.1:${loose.port}/v1/abort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loose.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'invalid_fragment' }),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    // Python server may be gone — skill will time out
  }
}
```

**`juso_bridge.py`** (the single-source bridge core, extracted from the former monolithic `juso_search.py`; see CONCEPTS.md → Juso Bridge) — new `aborted` state and `/v1/abort` endpoint:
```python
class BridgeState:
    def __init__(self, token, request_id):
        # ... existing fields ...
        self.aborted = False           # NEW
        self.abort_reason = ""         # NEW

# New endpoint, same auth + Host validation as claim/complete:
def _abort(self, payload):
    reason = payload.get("reason")
    with state.lock:
        if state.completed.is_set():
            self._error(HTTPStatus.CONFLICT, "already_completed")
            return
        state.aborted = True
        state.abort_reason = reason if isinstance(reason, str) and reason else "unknown"
        state.completed.set()  # unblock completed.wait()
    self._empty(HTTPStatus.NO_CONTENT)

# In run(), after completed.wait():
if state.aborted:
    kind = "extension_did_not_complete" if state.claimed.is_set() else "extension_did_not_claim"
    return 1, {"ok": False, "error": {"kind": kind, "message": f"bridge aborted: {state.abort_reason}; {RECOVERY_HINT}"}}
```

> **Note (2026-08-10):** The `/v1/abort` back-channel is no longer reserved for fragment parse failures — `entrypoints/bridge/main.ts` now also calls it on **claim-side rejection**. When the worker returns `{ ok: false }` (invalid provider/engine id, bridge disabled, untrusted sender), the bridge calls `abortBridge(credentials, 'claim_rejected')`; on a thrown send error it calls `abortBridge(credentials, 'send_failed')`. An invalid id therefore fails in seconds with `bridge aborted: ...`, not a 40s timeout. See `skill-mcp-vocabulary-decoupling.md` change F.

### Bug 4 — No browser process cleanup on timeout

`subprocess.Popen(command, ...)` return value was discarded; the `finally` block only shut down the HTTP server.

**Before**:
```python
subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    completed = state.completed.wait(args.timeout)
finally:
    server.shutdown()
    server.server_close()
```

**After**:
```python
process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    completed = state.completed.wait(args.timeout)
finally:
    server.shutdown()
    server.server_close()
    if process is not None and process.poll() is None:  # still running
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
```

Already-exited processes (e.g. when the command was forwarded to an already-running browser instance and the launcher returned immediately) are not touched — `poll()` returns a non-None exit code and the block is skipped.

### Bug 5 — Windows GBK console encoding crash

Windows consoles default to GBK. `json.dumps(..., ensure_ascii=False)` produces Unicode strings; `print()` writing non-GBK characters to a GBK stdout crashes.

**Fix** (CLI wrapper only — `public/agent-skill/scripts/juso_search.py:23-25`, generated into both published variants; the `juso_bridge.py` core never prints and needs no reconfigure):
```python
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8')
```

`reconfigure()` is available on Python 3.7+ (the skill requires 3.11+). The `hasattr` guard is defensive — some test harnesses replace stdout with objects that lack `reconfigure`.

## Why This Works

**Bug 1 — independent version axes.** The fragment `v` versions the *credential format* (`v/p/t` structure). The JSON `protocol` versions the *claim/complete message schema*. They are independent: the fragment structure has not changed since v1, while the JSON schema gained `search-instance`/`list-instances` at protocol 2. Conflating them produced a fatal mismatch. Keeping `v=1` and `protocol=2` reflects reality: the credential envelope is stable, the message schema evolved.

**Bug 2 — registry is the source of truth.** `ProviderId` in `lib/providers/types.ts` is the canonical provider set; `allProviders()` reads the registry. Any downstream whitelist (Python's `PROVIDERS`, the engine capability map) must mirror it exactly. The engine side was already aligned at 8=8; the provider side was a manual copy that drifted when `brave` was added. This is the same principle documented in `engine-capability-is-per-registry-not-per-id-union.md`: the registry is authoritative, mirrors must be tested for equality, not maintained by hand. (Since 2026-08-10 this mirroring rule is superseded for the skill: runtime discovery removes the copy entirely — see `skill-mcp-vocabulary-decoupling.md`.)

**Bug 3 — back-channel for unprocessable requests.** The bridge is the only party that knows "I cannot parse this fragment." Without a back-channel, that knowledge died with the tab close, and the skill burned its full timeout. The `/v1/abort` endpoint gives the bridge a way to say "I can't process this" the same way it already says "I'm done" (`/v1/complete`). `extractLooseBridgeCredentials` is intentionally lax — it ignores `v` because the whole point is "the version check failed but I still know where the server is." It returns null only when port/token are themselves missing, since in that case there is genuinely no way to reach the server and a timeout is unavoidable.

**Bug 4 — launcher owns the launched.** The skill launches the browser process; therefore the skill must reap it. This is basic process-parent responsibility. The `poll() is None` guard ensures we only terminate processes we actually own and that are still running — forwarding launchers (which exit immediately after handing off to an existing browser instance) are left alone. `terminate` → `wait(2)` → `kill` is the standard graceful-then-forced shutdown sequence.

**Bug 5 — force UTF-8 at the boundary.** The skill's contract is "emit JSON to stdout." JSON is Unicode by definition; `ensure_ascii=False` is correct for readability and downstream parsing. The bug is not in the JSON emission — it's in the stdout encoding, which on Windows defaults to a legacy code page. `reconfigure(encoding="utf-8")` fixes the boundary once, at startup, so every subsequent `print` is safe. This is the right layer: don't sprinkle `ensure_ascii=True` or `.encode("gbk", "replace")` at every call site; fix the stream.

## Prevention

Five concrete guards, one per bug:

1. **Cross-end fragment contract test.** A test (in either suite, but ideally the Python suite since it produces the fragment) that asserts the fragment emitted by `juso_search.py` carries the exact `v` value that `parseBridgeFragment` accepts. The cleanest form: a shared constant or a test that imports/reads both sides' accepted version and compares. This would have caught bug 1 immediately at commit `5d27315`.

2. **Provider set equality test — obsolete since 2026-08-10.** This item prescribed a test asserting `set(PROVIDERS) == set(all_providers_ids)`. The `PROVIDERS` tuple no longer exists, so there is nothing to test for equality: `skill-mcp-vocabulary-decoupling.md` removes the mirror entirely — the Python bridge discovers ids at runtime via `list-providers`/`list-engines`, and the validators check shape rather than membership. (Retained here as the historical prevention for the pre-decoupling design; it would have caught bug 2 the moment `brave` was added to the registry.)

3. **Abort back-channel pattern.** The `/v1/abort` endpoint is a first-class part of the Agent Bridge protocol — not an error path but a normal signal for "I cannot process this request." Any future bridge entrypoint that can fail to parse its input must wire `notifyAbort`. Test it: simulate a bad fragment, assert the skill receives `extension_did_not_claim` with `bridge aborted: invalid_fragment` within seconds, not 40s.

4. **Process lifecycle in `finally`.** Make "save `Popen` return value; terminate in `finally`" a code-review checklist item for any subprocess-launching code. Test by mocking `Popen` to return a process whose `poll()` returns `None` (still running) and asserting `terminate()`/`kill()` are called; also test the `poll()`-returns-exit-code branch to ensure already-exited processes are not touched.

5. **UTF-8 reconfigure at startup.** Add the `reconfigure` block to a shared skill bootstrap (or a `skills/juso-search/scripts/_bootstrap.py` imported by both scripts) so it cannot be forgotten in a new script. Add a test that sets stdout to a GBK-coded `io.TextIOWrapper` over a `BytesIO`, runs the bootstrap, and asserts the wrapper's encoding is now UTF-8 and that printing `\u20ac` does not raise.

All five prevention items share a theme: **cross-end contracts must be tested across the ends, not within them.** Each side's isolated tests passed because each side was internally consistent. The defects lived in the gaps between sides — the fragment version, the provider set, the abort signal, the process handle, the encoding boundary. A cross-end contract test for each gap is what makes the alignment durable.

## Related Issues

- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — intended bridge architecture; documents the `#v=1` fragment format, the claim/complete protocol, and the `/v1/abort` back-channel (now wired for both fragment parse failure and claim-side rejection).
- `docs/solutions/architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md` — the registry-mirroring principle for the engine whitelist. Bug 2 extends the same principle to the provider whitelist. (Layer 3 is now auto-discovered via `list-engines`, so the mirroring rule no longer applies to the skill.)
- `docs/solutions/architecture-patterns/skill-mcp-vocabulary-decoupling.md` — the structural fix that eliminates this drift class: the `PROVIDERS`/`ENGINES` tuples, `choices=` constraints, and MCP enums are removed; vocabulary is discovered at runtime via `list-providers`/`list-engines`, and `/v1/abort` now fires on claim-side rejection.
- `docs/solutions/logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md` — bridge tab focus hygiene and orchestration error classification; adjacent to bug 3's abort back-channel.
- `docs/solutions/ui-bugs/bridge-page-auto-close-after-claim.md` — bridge.html fire-and-forget close behavior; adjacent to bug 3's notifyAbort-on-parse-failure path.
- `docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md` — a prior bridge claim timeout root cause (fetch illegal invocation); different root cause, same symptom class.
