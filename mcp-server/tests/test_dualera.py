"""Dual-era service (KTD4): legacy `initialize` and modern `server/discover`.

Each leg spawns a fresh server subprocess because the client's first request
decides the connection's era (modern `_meta` envelope vs legacy handshake).
Both eras must succeed — Claude Desktop / Cursor / Cline still speak the legacy
handshake while modern clients probe `server/discover`.
"""

from __future__ import annotations

import pytest

from conftest import exchange_jsonrpc, modern, spawn_server

pytestmark = pytest.mark.slow


def test_modern_server_discover():
    proc = spawn_server()
    try:
        responses = exchange_jsonrpc(
            proc,
            [
                modern(
                    "server/discover",
                    {},
                    request_id=1,
                ),
            ],
        )
    finally:
        proc.terminate()

    assert len(responses) == 1
    message = responses[0]
    assert message.get("jsonrpc") == "2.0"
    assert message.get("id") == 1
    result = message["result"]
    assert result["resultType"] == "complete"
    supported = result["supportedVersions"]
    assert "2026-07-28" in supported
    assert "tools" in result["capabilities"]


def test_legacy_initialize_then_tools_list():
    proc = spawn_server()
    try:
        responses = exchange_jsonrpc(
            proc,
            [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "juso-search-tests", "version": "0.0.1"},
                    },
                },
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            ],
        )
    finally:
        proc.terminate()

    assert len(responses) == 2
    init = next(m for m in responses if m["id"] == 1)
    assert init.get("jsonrpc") == "2.0"
    assert init["result"]["protocolVersion"] == "2025-11-25"
    assert init["result"]["serverInfo"]["name"] == "Juso Search"

    from juso_search import __version__

    assert init["result"]["serverInfo"]["version"] == __version__

    tools = next(m for m in responses if m["id"] == 2)
    names = [tool["name"] for tool in tools["result"]["tools"]]
    assert names == ["search", "engine-search", "search-instance", "list-providers", "list-instances"]
