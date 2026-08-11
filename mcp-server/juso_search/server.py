"""Build the juso-search ``MCPServer`` with the six agent-bridge tools.

The tool surface mirrors the extension's agent-bridge actions one-to-one
(``search``, ``engine-search``, ``search-instance``, ``list-providers``,
``list-instances``, ``list-engines``), matching the CLI skill's subcommands.
Provider/engine parameters are plain strings: the vocabulary is discovered at
runtime via ``list-providers`` / ``list-engines`` rather than hardcoded here.

Each ``tools/call`` runs one short-lived bridge cycle via
``juso_search.bridge_call.call_bridge`` (start the configured browser —
Chromium-family or Firefox — → ``bridge.html`` → claim/complete → validated
reply). No long-lived service, no API-key handling.

``MCPServer.run()`` defaults to stdio; stdin EOF terminates the process.
"""

from __future__ import annotations

import threading
from typing import Annotated

from mcp.server import MCPServer
from mcp.server.mcpserver.context import Context
from mcp_types import CallToolResult, ToolAnnotations
from pydantic import Field

from . import __version__
from .bridge_call import call_bridge
from .cancel_registry import CancelBridgeMiddleware, cancel_event_for
from .config import Config

# Tool annotations: every tool is a read-only observer of the world (searching
# changes nothing) that may interact with an open world of external entities.
_TOOL_ANNOTATIONS = ToolAnnotations(read_only_hint=True, open_world_hint=True)

# `inst:<providerId>:<token>` — provider part is format-only (any non-empty
# alphanumeric/hyphen/underscore token starting alphanumeric); the extension
# validates the actual provider id at runtime. The token part mirrors the
# extension's INSTANCE_ID_TOKEN (lib/provider-instances.ts):
# `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Worker-generated UUIDs satisfy this, but so
# do other stable storage-safe ids it may emit, so the MCP server must not
# over-constrain to UUID shape (else it rejects ids the CLI accepts).
_INSTANCE_ID_PATTERN = r"^inst:[A-Za-z0-9][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"


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
        description=(
            "Search one of Juso's AI search providers through the Juso extension. "
            "Call list-providers first to discover available provider ids. "
            "Returns normalized results, optionally bypassing the cache with force_refresh."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def search(
        ctx: Context,
        query: str,
        provider: str,
        force_refresh: bool = False,
    ) -> CallToolResult:
        return call_bridge(
            "search",
            config,
            query=query,
            provider_id=provider,
            force_refresh=force_refresh,
            cancel_event=_cancel_event(ctx),
        )

    @server.tool(
        name="engine-search",
        description=(
            "Search a traditional web engine through the Juso extension. "
            "Call list-engines first to discover available engine ids. "
            "Requires the extension's engine-search sub-switch to be enabled. "
            "max_results caps the returned results (1-20). "
            "Note: an engine error reply (challenge, consent, timeout, extract-failed, ...) "
            "is a normal tool result, not an error."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def engine_search(
        ctx: Context,
        query: str,
        engine: str,
        max_results: Annotated[int | None, Field(ge=1, le=20)] = None,
    ) -> CallToolResult:
        return call_bridge(
            "engine-search",
            config,
            query=query,
            engine_id=engine,
            max_results=max_results,
            cancel_event=_cancel_event(ctx),
        )

    @server.tool(
        name="search-instance",
        description=(
            "Search a user-defined provider instance (id form inst:<providerId>:<token>, "
            "as returned by list-instances) through the Juso extension, optionally "
            "bypassing its cache with force_refresh."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def search_instance(
        ctx: Context,
        query: str,
        instance: Annotated[str, Field(pattern=_INSTANCE_ID_PATTERN)],
        force_refresh: bool = False,
    ) -> CallToolResult:
        return call_bridge(
            "search-instance",
            config,
            query=query,
            instance_id=instance,
            force_refresh=force_refresh,
            cancel_event=_cancel_event(ctx),
        )

    @server.tool(
        name="list-providers",
        description=(
            "List the AI search providers known to the Juso extension, including "
            "whether each is configured and supports an answer-style response."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_providers(ctx: Context) -> CallToolResult:
        return call_bridge("list-providers", config, cancel_event=_cancel_event(ctx))

    @server.tool(
        name="list-instances",
        description=(
            "List the user-defined provider instances registered in the Juso extension "
            "with their ids (inst:<providerId>:<token>), labels, descriptions and "
            "configuration status."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_instances(ctx: Context) -> CallToolResult:
        return call_bridge("list-instances", config, cancel_event=_cancel_event(ctx))

    @server.tool(
        name="list-engines",
        description=(
            "List the traditional web engines known to the Juso extension "
            "(e.g. google, bing, baidu). Returns their ids for use with engine-search."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_engines(ctx: Context) -> CallToolResult:
        return call_bridge("list-engines", config, cancel_event=_cancel_event(ctx))

    return server
