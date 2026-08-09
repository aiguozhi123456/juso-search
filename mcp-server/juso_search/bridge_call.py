"""Map MCP tool arguments to ``juso_bridge.run_bridge`` and wrap the outcome.

Every tool in ``server.py`` funnels through :func:`call_bridge`, which runs
one full bridge cycle and wraps the result into an MCP ``CallToolResult``:

- Success (including ``engine-search`` error *replies* like
  ``{"engine", "query", "error"}`` — those are valid completions the bridge
  returns normally, NOT raised): ``content=[TextContent(json.dumps(reply))]``
  plus ``structured_content=reply`` so the structured payload is machine
  readable (2026-07-28 "structured + TextContent serialization" compatibility).
- ``juso_bridge.BridgeError`` (raised by the bridge for real failures): an
  ``is_error=True`` result whose text names ``error.kind`` and ``error.message``.
- Any other exception (unexpected, e.g. ``OSError`` from the loopback server
  construction): wrapped as ``BridgeError("internal_error", ...)`` so the
  client gets a structured ``is_error`` result instead of an opaque error.

Stdout discipline (2026-07-28 gotcha #1): this module never prints to stdout —
the only place output is allowed is the SDK's JSON-RPC write path.
"""

from __future__ import annotations

import json
import threading

from mcp_types import CallToolResult, TextContent

from . import juso_bridge
from .config import Config


def success(reply: dict) -> CallToolResult:
    """Wrap a validated bridge reply as a successful tool result."""
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(reply, ensure_ascii=False))],
        structured_content=reply,
    )


def failure(error: juso_bridge.BridgeError) -> CallToolResult:
    """Wrap a structured bridge failure as a readable ``is_error`` result."""
    message = f"Juso bridge error [{error.kind}]: {error.message}"
    return CallToolResult(
        content=[TextContent(type="text", text=message)],
        structured_content={"error": {"kind": error.kind, "message": error.message}},
        is_error=True,
    )


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
