"""Build the juso-search ``MCPServer`` with the ten agent-bridge tools.

The tool surface mirrors the extension's agent-bridge actions one-to-one
(``search``, ``engine-search``, ``search-instance``, ``search-site``,
``search-aggregate``, ``list-providers``, ``list-instances``, ``list-engines``,
``list-sites``, ``list-aggregates``), matching the CLI skill's subcommands.
Provider/engine/instance parameters are plain strings: the vocabulary is
discovered at runtime via ``list-providers`` / ``list-engines`` /
``list-instances`` / ``list-sites`` / ``list-aggregates`` rather than
hardcoded here.

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

# `site:<token>` / `agg:<token>` — format-only guards mirroring the extension's
# SITE_ID_TOKEN / AGGREGATE_ID_TOKEN (lib/site-instances.ts, lib/aggregate-instances.ts):
# `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Existence is validated by the extension at runtime;
# the MCP server must not over-constrain beyond the id shape.
_SITE_ID_PATTERN = r"^site:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
_AGGREGATE_ID_PATTERN = r"^agg:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"


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
            "Returns normalized results, optionally bypassing the cache with force_refresh. "
            "Results are leads, not evidence: snippets and summaries may be truncated, "
            "stale, or inaccurate — open result URLs with your own fetch capability "
            "to verify specifics."
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
            "is a normal tool result, not an error. "
            "Results are leads, not evidence: snippets and summaries may be truncated, "
            "stale, or inaccurate — open result URLs with your own fetch capability "
            "to verify specifics."
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
            "bypassing its cache with force_refresh. "
            "Results are leads, not evidence: snippets and summaries may be truncated, "
            "stale, or inaccurate — open result URLs with your own fetch capability "
            "to verify specifics."
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
        name="search-site",
        description=(
            "Search a user-defined site instance (id form site:<token>, as returned by "
            "list-sites) through the Juso extension: the user's browser is navigated to the "
            "site-scoped result page of the instance's backing engine (google, bing, or baidu) "
            "and ordinary result links are extracted. Requires the extension's engine-search "
            "sub-switch to be enabled. max_results caps the returned results (1-20). "
            "Note: an error reply (unknown id, challenge, timeout, ...) is a normal tool result, "
            "not an error. "
            "Results are leads, not evidence: snippets may be truncated, stale, or inaccurate — "
            "open result URLs with your own fetch capability to verify specifics."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def search_site(
        ctx: Context,
        query: str,
        site: Annotated[str, Field(pattern=_SITE_ID_PATTERN)],
        max_results: Annotated[int | None, Field(ge=1, le=20)] = None,
    ) -> CallToolResult:
        return call_bridge(
            "search-site",
            config,
            query=query,
            site_id=site,
            max_results=max_results,
            cancel_event=_cancel_event(ctx),
        )

    @server.tool(
        name="search-aggregate",
        description=(
            "Search a user-defined aggregate instance (id form agg:<token>, as returned by "
            "list-aggregates) through the Juso extension: the query fans out to the instance's "
            "member sources, results are merged and reranked, and a single merged list is "
            "returned. Instances with engine members require the extension's engine-search "
            "sub-switch and can take a while; bypass the cache with force_refresh. "
            "Results are leads, not evidence: snippets and summaries may be truncated, "
            "stale, or inaccurate — open result URLs with your own fetch capability "
            "to verify specifics."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def search_aggregate(
        ctx: Context,
        query: str,
        aggregate: Annotated[str, Field(pattern=_AGGREGATE_ID_PATTERN)],
        force_refresh: bool = False,
    ) -> CallToolResult:
        return call_bridge(
            "search-aggregate",
            config,
            query=query,
            aggregate_id=aggregate,
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

    @server.tool(
        name="list-sites",
        description=(
            "List the user-defined site instances registered in the Juso extension "
            "with their ids (site:<token>), labels, backing engines and target sites."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_sites(ctx: Context) -> CallToolResult:
        return call_bridge("list-sites", config, cancel_event=_cancel_event(ctx))

    @server.tool(
        name="list-aggregates",
        description=(
            "List the user-defined aggregate instances registered in the Juso extension "
            "with their ids (agg:<token>), labels, members and eligibility."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_aggregates(ctx: Context) -> CallToolResult:
        return call_bridge("list-aggregates", config, cancel_event=_cancel_event(ctx))

    return server
