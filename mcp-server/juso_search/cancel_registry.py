"""Bridge the SDK's notifications/cancelled into threading.Event for run_bridge.

The MCP SDK's default interrupt-mode cancellation cancels the event-loop task
awaiting a sync tool handler, but cannot kill the worker thread running
run_bridge — so the bridge cycle (Chromium launch + loopback server) would
leak until timeout. This middleware registers a per-request threading.Event
and sets it when notifications/cancelled arrives, so run_bridge's cooperative
cancel_event polling aborts within ~0.2s.
"""
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
