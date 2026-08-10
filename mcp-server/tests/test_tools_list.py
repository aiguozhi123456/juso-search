"""tools/list surface: names, inputSchema, annotations and 2026-07-28 wire fields."""

from __future__ import annotations

import asyncio

EXPECTED_NAMES = [
    "search",
    "engine-search",
    "search-instance",
    "list-providers",
    "list-instances",
    "list-engines",
]


def _list_tools(server):
    return asyncio.run(server.list_tools())


def _by_name(server, name):
    return next(tool for tool in _list_tools(server) if tool.name == name)


def test_tools_count_and_names(server):
    tools = _list_tools(server)
    assert [tool.name for tool in tools] == EXPECTED_NAMES
    assert len(tools) == 6


def test_tools_annotations(server):
    for tool in _list_tools(server):
        assert tool.annotations is not None
        assert tool.annotations.read_only_hint is True
        assert tool.annotations.open_world_hint is True


def test_search_schema(server):
    schema = _by_name(server, "search").input_schema
    assert schema["type"] == "object"
    properties = schema["properties"]
    assert properties["query"]["type"] == "string"
    assert "query" in schema["required"]
    assert "provider" in schema["required"]
    # provider is a plain string; the vocabulary is discovered at runtime
    assert properties["provider"]["type"] == "string"
    assert "$defs" not in schema or "ProviderId" not in schema.get("$defs", {})
    assert properties["force_refresh"]["type"] == "boolean"


def test_engine_search_schema(server):
    schema = _by_name(server, "engine-search").input_schema
    assert "query" in schema["required"]
    assert "engine" in schema["required"]
    assert schema["properties"]["engine"]["type"] == "string"
    assert "$defs" not in schema or "EngineId" not in schema.get("$defs", {})
    max_results = schema["properties"]["max_results"]
    integer_branch = next(branch for branch in max_results["anyOf"] if branch.get("type") == "integer")
    assert integer_branch["minimum"] == 1
    assert integer_branch["maximum"] == 20


def test_search_instance_schema(server):
    schema = _by_name(server, "search-instance").input_schema
    assert "query" in schema["required"]
    assert "instance" in schema["required"]
    pattern = schema["properties"]["instance"]["pattern"]
    # inst:<providerId>:<token> — provider part is format-only (the extension
    # validates the actual provider id at runtime); token part mirrors the
    # extension's INSTANCE_ID_TOKEN (see the shape test below).
    assert pattern.startswith("^inst:")
    assert "uuid" not in pattern  # token vocabulary is spelled out, no placeholder word


def test_search_instance_accepts_extension_token_shape(server):
    """instance pattern mirrors the extension's INSTANCE_ID_TOKEN
    (lib/provider-instances.ts), not a hard-pinned UUID — so persisted, migrated,
    or non-UUID ids the worker may emit keep working through MCP just like the CLI."""
    import re

    pattern = _by_name(server, "search-instance").input_schema["properties"]["instance"]["pattern"]
    regex = re.compile(pattern)

    valid = [
        "inst:tavily:11111111-2222-3333-4444-555555555555",  # real UUID (today's worker output)
        "inst:exa:abc123",
        "inst:stepfun-plan:A_b-c",
        "inst:doubao-global:t0",        # minimal 2-char token
        "inst:jina:" + "a" * 128,       # max length: 1 lead + 127 more
        "inst:unknownprovider:abc",     # provider not in vocabulary — format-only; extension validates
    ]
    for candidate in valid:
        assert regex.match(candidate), f"pattern should accept {candidate!r}"

    invalid = [
        "inst:tavily:",                 # empty token
        "inst:tavily:_lead",            # must start alphanumeric
        "inst:tavily:-lead",            # must start alphanumeric
        "inst:tavily:" + "a" * 129,     # over max length
        "inst:tavily:bad char",         # illegal character (space)
        "custom:tavily:abc",            # wrong prefix
    ]
    for candidate in invalid:
        assert not regex.match(candidate), f"pattern should reject {candidate!r}"


def test_list_tools_have_no_params(server):
    for name in ("list-providers", "list-instances", "list-engines"):
        assert _by_name(server, name).input_schema["properties"] == {}


def test_result_wire_fields_present(server):
    """2026-07-28: ListToolsResult always carries resultType/ttlMs/cacheScope."""
    from mcp.client import Client

    async def _go():
        async with Client(server, mode="auto") as client:
            return await client.list_tools()

    result = asyncio.run(_go())
    assert result.result_type == "complete"
    assert result.ttl_ms == 0
    assert result.cache_scope == "private"
