"""Build the juso-search ``MCPServer`` with the five agent-bridge tools.

The tool surface mirrors the extension's agent-bridge actions one-to-one
(``search``, ``engine-search``, ``search-instance``, ``list-providers``,
``list-instances``), matching the CLI skill's subcommands. Parameter enums are
derived from ``juso_bridge.PROVIDERS`` / ``juso_bridge.ENGINES`` at import time
so they can never drift from the bridge's vocabulary.

Each ``tools/call`` runs one short-lived bridge cycle via
``juso_search.bridge_call.call_bridge`` (start Chromium → ``bridge.html`` →
claim/complete → validated reply). No long-lived service, no API-key handling.

``MCPServer.run()`` defaults to stdio; stdin EOF terminates the process.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Annotated

from mcp.server import MCPServer
from mcp_types import CallToolResult, ToolAnnotations
from pydantic import Field

from . import juso_bridge
from .bridge_call import call_bridge
from .config import Config

# Tool annotations: every tool is a read-only observer of the world (searching
# changes nothing) that may interact with an open world of external entities.
_TOOL_ANNOTATIONS = ToolAnnotations(read_only_hint=True, open_world_hint=True)

# Dynamic enums built from the bridge's own vocabulary (single source of truth;
# never duplicated here). Pydantic renders them as `enum` in the inputSchema.
ProviderId = Enum("ProviderId", {provider: provider for provider in juso_bridge.PROVIDERS})
EngineId = Enum("EngineId", {engine: engine for engine in juso_bridge.ENGINES})

# `inst:<providerId>:<token>` — provider part constrained to the bridge's known
# providers; token part mirrors the extension's INSTANCE_ID_TOKEN
# (lib/provider-instances.ts): `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Worker-generated
# UUIDs satisfy this, but so do other stable storage-safe ids it may emit, so the
# MCP server must not over-constrain to UUID shape (else it rejects ids the CLI accepts).
_INSTANCE_ID_PATTERN = (
    r"^inst:(?:" + "|".join(re.escape(provider) for provider in juso_bridge.PROVIDERS) + r"):"
    r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
)


def _value(member: Enum | None) -> str | None:
    """Convert a pydantic-validated enum member back to its plain string."""
    return member.value if member is not None else None


def build_server(config: Config) -> MCPServer:
    """Create the fully-registered MCP server for ``config``."""
    server = MCPServer("Juso Search", version="0.1.0")

    @server.tool(
        name="search",
        description=(
            "Search one of Juso's AI search providers (tavily, exa, brave, stepfun, "
            "stepfun-plan, jina, doubao, doubao-global). Returns normalized results "
            "from the Juso extension, optionally bypassing its cache with force_refresh."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def search(
        query: str,
        provider_id: ProviderId | None = None,
        force_refresh: bool = False,
    ) -> CallToolResult:
        return call_bridge(
            "search",
            config,
            query=query,
            provider_id=_value(provider_id),
            force_refresh=force_refresh,
        )

    @server.tool(
        name="engine-search",
        description=(
            "Search a traditional web engine (google, bing, baidu, yandex, duckduckgo, "
            "bilibili, xiaohongshu, douyin) through the Juso extension. Requires the "
            "extension's engine-search sub-switch to be enabled. max_results caps the "
            "returned results (1-20). Note: an engine error reply (challenge, consent, "
            "timeout, extract-failed, ...) is a normal tool result, not an error."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def engine_search(
        query: str,
        engine_id: EngineId,
        max_results: Annotated[int | None, Field(ge=1, le=20)] = None,
    ) -> CallToolResult:
        return call_bridge(
            "engine-search",
            config,
            query=query,
            engine_id=_value(engine_id),
            max_results=max_results,
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
        query: str,
        instance_id: Annotated[str, Field(pattern=_INSTANCE_ID_PATTERN)],
        force_refresh: bool = False,
    ) -> CallToolResult:
        return call_bridge(
            "search-instance",
            config,
            query=query,
            instance_id=instance_id,
            force_refresh=force_refresh,
        )

    @server.tool(
        name="list-providers",
        description=(
            "List the AI search providers known to the Juso extension, including "
            "whether each is configured and supports an answer-style response."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_providers() -> CallToolResult:
        return call_bridge("list-providers", config)

    @server.tool(
        name="list-instances",
        description=(
            "List the user-defined provider instances registered in the Juso extension "
            "with their ids (inst:<providerId>:<token>), labels, descriptions and "
            "configuration status."
        ),
        annotations=_TOOL_ANNOTATIONS,
    )
    def list_instances() -> CallToolResult:
        return call_bridge("list-instances", config)

    return server
