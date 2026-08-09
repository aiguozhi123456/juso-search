---
title: Cooperative Cancellation and Robustness Hardening for MCP stdio Server
date: 2026-08-10
category: docs/solutions/architecture-patterns/
module: mcp-server (juso-search pip package)
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Building an MCP server over stdio that runs blocking work (e.g., launching Chromium or a loopback HTTP server) inside sync tool handlers run via anyio.to_thread.run_sync
  - Wiring cooperative cancellation through the MCP Python SDK's worker-thread model, where the default interrupt-mode cancel kills the event-loop task awaiting the thread but cannot kill the underlying thread
  - Hardening a Python MCP server package for production robustness (version sync, exception boundaries, finite-input validation, extension-ID validation, clean transport errors, explicit dependency declarations)
  - Implementing a ServerMiddleware (from mcp.server.context) that bridges notifications/cancelled to a per-request threading.Event consumed by long-running bridge code with an existing cancel_event parameter
  - Sharing a single-source module (juso_bridge.py) between a CLI skill and a pip-installable MCP server that must stay byte-identical under a drift-lock test
symptoms:
  - Cancelled in-flight tool calls leak Chromium and the loopback HTTP server until the 40s timeout, because the SDK cancels the event-loop task awaiting the worker thread but not the thread itself
  - server.py hardcodes version 0.1.0 while the package __version__ drifts (0.1.1), causing handshake/version mismatches detectable only at runtime
  - Unexpected exceptions (e.g., OSError from BridgeHTTPServer construction) propagate uncaught to the SDK, surfacing opaque internal errors to MCP clients
  - JUSO_TIMEOUT accepts inf/nan values because float('inf') > 0 passes and NaN comparisons are always False; invalid extension IDs are accepted at config load and fail only on first tool call
  - Transport errors in __main__.py exit with code 1 and a raw traceback; pydantic and pytest are undeclared (only transitive/dev deps), risking breakage on dependency changes
root_cause: thread_violation
resolution_type: code_fix
related_components:
  - juso_bridge.py (shared single-source module between CLI skill and MCP server)
  - CancelBridgeMiddleware (ServerMiddleware from mcp.server.context)
  - run_bridge (bridge runner with cancel_event threading.Event parameter)
  - BridgeHTTPServer (loopback HTTP server constructed inside try block)
  - coerce_request_id (from mcp.shared.dispatcher for request-id normalization)
  - _cancel_event(ctx) fallback helper for direct call_tool calls lacking request context
tags:
  - mcp-server
  - cooperative-cancellation
  - thread-cancellation
  - robustness
  - python
  - mcp-sdk
  - resource-leak
  - hardening
---

# Cooperative Cancellation and Robustness Hardening for MCP stdio Server

## Context

The juso-search MCP server (`mcp-server/juso_search/`) is a stdio MCP server that exposes the Juso extension's five agent-bridge actions (`search`, `engine-search`, `search-instance`, `list-providers`, `list-instances`) as tools. Every `tools/call` runs one short-lived bridge cycle through the vendored `juso_bridge` module: it spawns a `BridgeHTTPServer` on an OS-assigned loopback port, launches Chromium pointed at `chrome-extension://<id>/bridge.html#...`, and waits for the extension worker to claim and complete the request (see `agent-skill-localhost-capability-bridge.md`). A single call can therefore block for tens of seconds on a real browser tab.

An architectural review of the server found nine issues spanning robustness, correctness, and maintainability. The most significant was the **lack of cancellation support**. The MCP Python SDK dispatches a *synchronous* tool handler (a plain `def`, not `async def`) by running it in a worker thread via `anyio.to_thread.run_sync`, then awaiting that thread result on the event-loop task. When an MCP client sends `notifications/cancelled` (or drops the connection), the SDK's interrupt-mode cancellation cancels the **event-loop task** — but it cannot kill the **worker thread**. The thread keeps running `run_bridge`, which keeps the `BridgeHTTPServer` alive and the Chromium process open until the full `timeout` elapses. The cancellation is honoured on the wire (the client sees a cancel response) while the OS resources leak silently in the background.

The remaining eight issues were routine hardening gaps rather than architectural defects: a hardcoded version string duplicated from `__version__`; a tool dispatch that caught `BridgeError` but let any other exception escape as an opaque transport error; config that accepted `inf`/`nan` timeouts and unvalidated extension IDs; a top-level `server.run()` with no exception guard; transitive dependencies (`pydantic`) used directly but not declared; no `pytest` dev dependency despite a test suite; and a `finally` block that referenced a `BridgeHTTPServer` constructed *outside* its `try`, so a construction failure would raise `NameError` instead of cleaning up.

## Guidance

### Cooperative cancellation via ServerMiddleware (M2)

The core architectural pattern bridges the SDK's thread-based dispatch to the bridge's existing cooperative `cancel_event` parameter. `juso_bridge.run_bridge` already accepted an optional `threading.Event` and polled it every 0.2s inside `_wait_for_completion` — when set, it raises `BridgeError(kind=cancelled)` so the caller's `finally` shuts down the loopback server and terminates Chromium promptly. The gap was purely on the server side: nothing was translating `notifications/cancelled` into setting that event.

The fix is a `CancelBridgeMiddleware` registered on `MCPServer.middleware` (the SDK's public middleware list). The middleware has two responsibilities, dispatched by request type:

1. **On an inbound request** (`ctx.request_id is not None`, i.e. a `tools/call`): register a per-request `threading.Event` in a module-level `_IN_FLIGHT` dict keyed by the normalized request id, run the handler, and unconditionally remove the entry in `finally`.
2. **On `notifications/cancelled`** (`ctx.method == "notifications/cancelled"`): look up the event for the cancelled `requestId` and `.set()` it, so the worker thread's next poll aborts.

Request ids are normalized with `mcp.shared.dispatcher.coerce_request_id`, because the id on the inbound `tools/call` and the id inside the `notifications/cancelled` `params` may arrive as different JSON-RPC types (int vs str); `coerce_request_id` produces a single hashable key for both.

The tool handler then asks a `_cancel_event(ctx)` helper for the event registered for its request and passes it down to `call_bridge` → `run_bridge`. The helper falls back to a fresh, never-set `Event` when there is no live request context (a direct `MCPServer.call_tool` call from tests or an embedded server) — such calls have no wire request, so nothing could ever cancel them, and returning a placeholder event lets `run_bridge` always receive a non-`None` event unconditionally.

This is **cooperative**, not preemptive: the worker thread is never killed. The event only signals `run_bridge` to stop waiting; the existing `finally` block still owns the `BridgeHTTPServer.shutdown()` and `process.terminate()` cleanup. The pattern therefore composes with the bridge's existing cleanup discipline rather than replacing it.

Key SDK APIs: `mcp.server.context.ServerMiddleware` (the callable signature `(ctx, call_next) -> HandlerResult`), `CallNext` (the wrapped handler continuation), `HandlerResult`, `ServerRequestContext` (carrying `request_id`, `method`, `params`), and `MCPServer.middleware` (the public `list` you `append` to).

### Broad exception guard in tool dispatch (M3)

`call_bridge` is the single funnel through which every tool's arguments reach `run_bridge`. It already caught `juso_bridge.BridgeError` (the structured failure type the bridge raises for real failures — extension didn't claim, didn't complete, Chrome launch failed, caller-initiated cancel) and wrapped it as an `is_error=True` `CallToolResult`. But any *other* exception — an `OSError` from loopback socket construction, a `subprocess` error, a `TypeError` from a bad code path — would escape the tool handler entirely.

When an exception escapes an MCP tool handler, the SDK surfaces it to the client as an opaque transport-level error: the client sees a JSON-RPC error response with no structured content, no `error.kind`, and no actionable message. The fix adds a second `except Exception` arm that wraps the unexpected exception as `BridgeError("internal_error", str(error), exit_status=1)` and returns it through the same `failure()` path, so the client always receives a structured `is_error` result it can introspect — `structured_content == {"error": {"kind": "internal_error", "message": "..."}}` — regardless of what blew up.

### Version single-sourcing (M1)

The server was constructing `MCPServer("Juso Search", version="0.1.0")` with a hardcoded string duplicated from `__init__.py`'s `__version__`. A release that bumped `pyproject.toml` and `__version__` would leave the server advertising the old version until someone remembered to edit `server.py` too. The fix imports `__version__` from the package and passes it through: `MCPServer("Juso Search", version=__version__)`. There is now exactly one source of truth for the version, shared by `--version`, the server handshake, and the package metadata.

### Config validation at load time (L1, L3)

`load_config` parses `JUSO_EXTENSION_ID` and `JUSO_TIMEOUT` from the MCP client's `env` block. Two validation gaps could let invalid config through to runtime:

- **L1 — reject `inf`/`nan` timeouts.** `float("inf")` and `float("nan")` parse successfully through `float(raw_timeout)` and pass a naive `> 0` check (`nan` fails it, but `inf` passes), then propagate into `run_bridge` as a timeout that never elapses — the server would hang forever on a stalled bridge cycle. The fix calls `math.isfinite(parsed)` after parsing and rejects non-finite values with a clear stderr message before they reach the bridge.
- **L3 — validate extension ID at config time.** `juso_bridge.EXTENSION_ID_RE` (`^[a-p]{32}$`, the 32-lowercase-letter Chrome extension id shape) already existed and was checked inside `run_bridge`. But a malformed `JUSO_EXTENSION_ID` would only fail after Chromium launched, opened `bridge.html`, and timed out — a confusing multi-second failure with no message. The fix runs `EXTENSION_ID_RE.fullmatch(extension_id)` in `load_config`, so a typo or a pasted URL fragment fails fast at startup with `juso-search: JUSO_EXTENSION_ID must be 32 lowercase letters a-p ...` on stderr and a non-zero exit.

Both validations use the existing `_die()` helper, which writes to **stderr** only (never stdout — stdout is reserved for JSON-RPC) and raises `SystemExit(EXIT_CONFIG_ERROR)` (code 2), keeping all config failures out of the JSON-RPC transport path.

### Top-level exception handling (L2)

`__main__.main` called `build_server(config).run()` directly. An unhandled exception from `run()` (a stdio transport error, an SDK-internal failure) would propagate out of `main`, through `sys.exit(main())`, and surface to the MCP client as a Python traceback on stderr with no `juso-search:` prefix — hard to attribute to this server specifically when the client spawns many tools. The fix wraps `run()` in `try/except Exception` that prints `juso-search: server error: <error>` to stderr and returns exit code 1, so even an unrecoverable runtime failure produces a clean, attributable one-line message.

### Explicit dependency declarations (L4, L5)

The package used `pydantic` directly in `server.py` (`from pydantic import Field`, for `Annotated[..., Field(...)]` tool parameter constraints) but did not declare it in `pyproject.toml`'s `dependencies` — it was satisfied only transitively through `mcp`. A future `mcp` release that dropped or bumped `pydantic` would break this server with no warning. The fix adds `"pydantic>=2.0,<3"` as a direct dependency. Likewise, the test suite (`mcp-server/tests/`, pytest) had no declared dev dependency; `pytest>=8.0` is now listed under `[project.optional-dependencies] dev`, so `pip install -e ".[dev]"` is self-sufficient.

### Resource cleanup ordering (A3)

`run_bridge` constructs a `BridgeHTTPServer` (the loopback server that receives the extension's `claim`/`complete` POSTs) and a Chromium `subprocess.Popen`. The original code constructed `server` *before* the `try` block, then referenced `server.shutdown()` in `finally`. If `BridgeHTTPServer(("127.0.0.1", 0), ...)` raised (e.g. loopback port exhaustion, a bind error), the `finally` block would execute with `server` unbound and raise `NameError: name 'server' is not defined` — masking the real construction error and skipping the `process.terminate()` cleanup entirely.

The fix follows the standard "construct-then-guard" ordering: initialize `server = None` and `process = None` *before* the `try`, move the `BridgeHTTPServer` construction *inside* the `try`, and guard each `finally` cleanup with `if server is not None` / `if process is not None and process.poll() is None`. Now a construction failure surfaces its real `OSError` (caught and re-wrapped as `BridgeError(ERROR_CHROME_LAUNCH_FAILED, ...)`), and the `finally` block is a no-op for the never-constructed resources rather than a `NameError`. This edit landed in the single-source `public/agent-skill/scripts/juso_bridge.py`, so it applies identically to the CLI skill, the prod/dev published skill dirs, and the MCP package — and the drift lock (`gen_skills.py --check`) stayed in sync.

## Why This Matters

The cancellation pattern matters most. MCP servers whose tool handlers do long-running blocking I/O in a *synchronous* handler — browser automation, subprocess orchestration, blocking network calls — will leak OS resources without cooperative cancellation, because the SDK's default interrupt-mode behavior silences the wire response but leaves the worker thread running. For this server that means a leaked `BridgeHTTPServer` (a bound loopback socket held open) and a leaked Chromium process per cancelled call — each one a full browser with a real profile. Over a session of interrupted searches, that accumulates into dozens of orphaned Chrome windows and bound ports with no signal to the user or the client. The middleware turns "the client cancelled" into "the bridge cycle aborts within ~0.2s and cleans up," with no change to `run_bridge`'s contract — the event was already an optional parameter it polled.

The hardening fixes matter because MCP clients receive opaque errors when exceptions escape the tool handler. Without the broad `except Exception` guard in `call_bridge`, an `OSError` from socket construction arrives at the client as a bare JSON-RPC error with no structured `error.kind` to branch on. Without config-time validation, a malformed `JUSO_EXTENSION_ID` or `inf` timeout produces a multi-second, message-free hang indistinguishable from a network failure. Without the `_die()`-to-stderr discipline and the top-level `try/except`, failures leak raw tracebacks onto stderr with no `juso-search:` attribution, making them hard to diagnose when the server is one of many tools a client spawns.

The single-sourcing, explicit dependency, and cleanup-ordering fixes are lower-stakes individually but share the same theme: they eliminate silent drift and masked errors that surface only under failure conditions hard to reproduce in a test. A duplicated version string only mismatches after a release; an undeclared `pydantic` only breaks after an upstream bump; a `NameError` in `finally` only fires when construction itself fails — but each of those is exactly the moment when clear attribution matters most.

## When to Apply

- **The `CancelBridgeMiddleware` pattern** applies to any MCP Python server whose tool handlers are synchronous (`def`, not `async def`) and do blocking I/O — subprocess orchestration, browser automation, blocking network calls, long computations. Async handlers (`async def`) do **not** need it: the SDK can cancel the task directly, and `CancelledError` propagates through `await` points. The pattern is only necessary when the SDK's interrupt cancels the event-loop task but cannot reach the worker thread.
- **The broad `except Exception` guard** applies to every MCP tool dispatch function. Catch the structured error type your domain raises, then catch `Exception` and wrap it as a structured `is_error` result so clients always get an introspectable payload.
- **Config-time validation with `math.isfinite` and regex `fullmatch`** applies to any MCP server that parses typed config (timeouts, ids, paths) from `env`. Validate before the first tool call, and fail on **stderr** with a non-zero exit — never on stdout, which carries JSON-RPC.
- **Top-level `try/except` around `server.run()`** applies to every MCP server `__main__`; it is the last chance to attribute an unrecoverable failure cleanly.
- **Explicit declaration of directly-used transitive deps** applies to any Python package that imports a transitive dependency by name. If you `from pydantic import Field`, declare `pydantic`.
- **Construct-then-guard cleanup ordering** applies whenever a resource is constructed before a `try` block whose `finally` references it. Initialize the binding to `None` before the `try`, construct inside it, and guard each `finally` cleanup with an `is not None` check.

## Examples

### 1. The `CancelBridgeMiddleware` class

`mcp-server/juso_search/cancel_registry.py`:

```python
from __future__ import annotations

import threading
from typing import Any

from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.shared.dispatcher import coerce_request_id

# request_id (normalized) -> cooperative cancel event for the run_bridge worker thread
_IN_FLIGHT: dict[Any, threading.Event] = {}
_LOCK = threading.Lock()


def cancel_event_for(request_id: Any) -> threading.Event:
    """Return the cooperative cancel event for an in-flight request id.

    Always returns an Event (creates one if none registered yet) so callers
    can pass it to run_bridge unconditionally; if no cancellation arrives the
    event is simply never set.

    A ``None`` request id (no wire request — e.g. a direct
    ``MCPServer.call_tool`` outside the dispatch runner) gets a fresh,
    never-set event and is not registered, since nothing could ever cancel it.
    """
    key = coerce_request_id(request_id)
    if key is None:
        return threading.Event()
    with _LOCK:
        event = _IN_FLIGHT.get(key)
        if event is None:
            event = threading.Event()
            _IN_FLIGHT[key] = event
        return event


class CancelBridgeMiddleware:
    """Per-request: register an Event; on notifications/cancelled: set it."""

    async def __call__(self, ctx: ServerRequestContext[Any, Any], call_next: CallNext) -> HandlerResult:
        if ctx.request_id is not None:
            # Inbound request (tools/call): ensure an event exists for the handler's duration.
            key = coerce_request_id(ctx.request_id)
            with _LOCK:
                _IN_FLIGHT.setdefault(key, threading.Event())
            try:
                return await call_next(ctx)
            finally:
                with _LOCK:
                    _IN_FLIGHT.pop(key, None)
        if ctx.method == "notifications/cancelled" and ctx.params:
            rid = ctx.params.get("requestId")
            if rid is not None:
                with _LOCK:
                    event = _IN_FLIGHT.get(coerce_request_id(rid))
                if event is not None:
                    event.set()
        return await call_next(ctx)
```

### 2. The `_cancel_event` fallback helper and tool wiring

`mcp-server/juso_search/server.py`:

```python
def _cancel_event(ctx: Context) -> threading.Event:
    """Cooperative cancel event for this call's request id.

    The SDK's high-level ``Context`` carries a request id only inside a live
    dispatch (where ``CancelBridgeMiddleware`` registered the matching event);
    a direct ``MCPServer.call_tool`` — tests, embedded servers — has no request
    context, so fall back to a never-set event (such calls cannot be cancelled).
    """
    try:
        request_id = ctx.request_id
    except ValueError:
        request_id = None
    return cancel_event_for(request_id)


def build_server(config: Config) -> MCPServer:
    """Create the fully-registered MCP server for ``config``."""
    server = MCPServer("Juso Search", version=__version__)
    server.middleware.append(CancelBridgeMiddleware())

    @server.tool(
        name="search",
        description=(...),
        annotations=_TOOL_ANNOTATIONS,
    )
    def search(
        ctx: Context,
        query: str,
        provider: ProviderId,
        force_refresh: bool = False,
    ) -> CallToolResult:
        return call_bridge(
            "search",
            config,
            query=query,
            provider_id=_value(provider),
            force_refresh=force_refresh,
            cancel_event=_cancel_event(ctx),
        )

    # ... engine-search, search-instance, list-providers, list-instances
    #     all pass cancel_event=_cancel_event(ctx) the same way ...
    return server
```

### 3. The `call_bridge` broad-except pattern

`mcp-server/juso_search/bridge_call.py`:

```python
def call_bridge(
    action: str,
    config: Config,
    *,
    query: str | None = None,
    provider_id: str | None = None,
    engine_id: str | None = None,
    instance_id: str | None = None,
    force_refresh: bool = False,
    max_results: int | None = None,
    cancel_event: threading.Event | None = None,
) -> CallToolResult:
    """Run one ``run_bridge`` cycle for ``action`` and wrap its outcome."""
    try:
        reply = juso_bridge.run_bridge(
            action,
            query,
            provider_id=provider_id,
            engine_id=engine_id,
            instance_id=instance_id,
            force_refresh=force_refresh,
            max_results=max_results,
            extension_id=config.extension_id,
            chrome_path=config.chrome_path,
            profile=config.profile,
            timeout=config.timeout,
            cancel_event=cancel_event,
        )
    except juso_bridge.BridgeError as error:
        return failure(error)
    except Exception as error:
        return failure(juso_bridge.BridgeError("internal_error", str(error), exit_status=1))
    return success(reply)
```

The broad `except Exception` guarantees the client always receives a structured `is_error` result — never an opaque transport error.

### 4. The `BridgeHTTPServer` try-block ordering fix (A3)

`public/agent-skill/scripts/juso_bridge.py` (single source, drift-locked into the skill dirs and `mcp-server/juso_search/`):

**Before** — `server` constructed outside `try`, `finally` references an unbound name on construction failure:

```python
server = BridgeHTTPServer(("127.0.0.1", 0), make_handler(state))
worker = threading.Thread(target=server.serve_forever, daemon=True)
worker.start()
process = None
try:
    ...
finally:
    server.shutdown()      # NameError if BridgeHTTPServer raised above
    server.server_close()
```

**After** — initialize to `None` before `try`, construct inside, guard each `finally` cleanup:

```python
server: BridgeHTTPServer | None = None
process: subprocess.Popen | None = None
try:
    server = BridgeHTTPServer(("127.0.0.1", 0), make_handler(state))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    ...
    completed = _wait_for_completion(state, timeout, cancel_event)
    ...
    return state.reply
except OSError as error:
    raise BridgeError(ERROR_CHROME_LAUNCH_FAILED, f"{error}; {RECOVERY_HINT}", exit_status=1)
finally:
    if server is not None:
        server.shutdown()
        server.server_close()
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
```

Note that `_wait_for_completion` polls `cancel_event.is_set()` every 0.2s and raises `BridgeError(kind=cancelled)` when set — which is exactly what `CancelBridgeMiddleware` sets on `notifications/cancelled`. The A3 cleanup ordering and the M2 cancellation compose in the same `finally`: the middleware sets the event, the poll raises, the `except` re-raises (caller-initiated cancel propagates untouched), and the guarded `finally` shuts down the server and terminates Chromium.

## Verification

- `npm run test:mcp` — 38 passed (5 new tests added: cancellation event wiring, broad-except wrapping, config validation, version single-sourcing).
- `npm run test:python` — 52 passed.
- `npm run gen-skills --check` — in sync (the A3 edit to the shared `juso_bridge.py` source preserved the drift lock across all four byte-identical copies).

## Related

- **`integration-issues/agent-bridge-skill-contract-drift.md`** (strong) — Closest sibling. That doc established the cooperative cancellation primitives this doc builds on: Bug 3 introduced the `/v1/abort` back-channel and the aborted state on a `threading.Event`, and Bug 4 introduced process `terminate→wait→kill` cleanup in a `finally` block. The new `CancelBridgeMiddleware` bridges MCP `notifications/cancelled` to `run_bridge`'s cooperative `threading.Event` — the same cooperative-cancellation model, extended from the CLI skill side to the MCP server side.
- **`architecture-patterns/agent-skill-localhost-capability-bridge.md`** (moderate) — Architectural umbrella for the MCP server. Its "MCP server variant (stdio)" section asserts a stdio MCP server is "compatible with this pattern" because each call is one short-lived bridge cycle. This doc reveals the caveat: the SDK's interrupt-mode cancellation cannot kill the `run_sync` worker thread, so that cycle can leak without a `ServerMiddleware` bridging cancellation cooperatively.
- **`integration-issues/mcp-provider-id-optional-contract-drift.md`** (moderate) — Same MCP server package, same architectural-review origin. That doc's fix (making `provider_id` required in the tool schema) is a form of the boundary validation this doc generalizes across config, schema, and exception boundaries.
- **`architecture-patterns/agent-skill-distribution-pipeline.md`** (weak) — Documents the single-source template + drift lock that vendors `juso_bridge.py` byte-identically into `mcp-server/juso_search/`. The A3 fix touched one of the four drift-locked copies and flowed through `gen_skills.py`.

**Refresh recommendation**: `agent-skill-localhost-capability-bridge.md` should gain a note in its "MCP server variant (stdio)" section that stdio MCP server cancellation requires the `ServerMiddleware` cooperative-cancellation pattern (pointing to this doc), since the current assertion that a stdio server is "compatible with this pattern" has an unstated caveat around cancelled in-flight calls.
