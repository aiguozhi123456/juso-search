"""stdout discipline (2026-07-28 gotcha #1): only newline-delimited JSON-RPC.

Spawns the real server as a subprocess and runs a ``tools/list`` + ``tools/call``
cycle. Every byte on stdout must be a well-formed JSON-RPC response — any stray
print, banner, or log line would fail this test.

The ``tools/call`` uses ``JUSO_CHROME_PATH`` pointing at a nonexistent binary,
so ``run_bridge`` fails fast with ``chrome_not_found`` — the response is still a
valid JSON-RPC tool result (``isError: true``), which is exactly the point.
"""

from __future__ import annotations

import json

from conftest import exchange_jsonrpc, modern, spawn_server

ENVELOPE_KEYS = {
    "io.modelcontextprotocol/protocolVersion",
    "io.modelcontextprotocol/clientCapabilities",
}


def _assert_valid_response(message: dict) -> None:
    assert message.get("jsonrpc") == "2.0"
    assert "id" in message
    assert ("result" in message) != ("error" in message), "response must have exactly one of result/error"


def test_stdout_only_jsonrpc():
    proc = spawn_server()
    try:
        responses = exchange_jsonrpc(
            proc,
            [
                modern("tools/list", {}, request_id=1),
                modern("tools/call", {"name": "list-providers", "arguments": {}}, request_id=2),
            ],
        )
    finally:
        proc.terminate()

    assert len(responses) == 2, f"expected 2 JSON-RPC responses, got {len(responses)}"

    for message in responses:
        _assert_valid_response(message)

    # --- tools/list: 6 tools + the 2026-07-28 wire fields -------------------
    list_message = next(m for m in responses if m["id"] == 1)
    list_result = list_message["result"]
    assert list_result["resultType"] == "complete"
    assert list_result["ttlMs"] == 0
    assert list_result["cacheScope"] == "private"
    tool_names = [tool["name"] for tool in list_result["tools"]]
    assert tool_names == ["search", "engine-search", "search-instance", "list-providers", "list-instances", "list-engines"]
    search_tool = next(t for t in list_result["tools"] if t["name"] == "search")
    assert search_tool["annotations"]["readOnlyHint"] is True
    assert search_tool["annotations"]["openWorldHint"] is True
    # provider is a plain string now (vocabulary discovered at runtime via list-providers)
    assert search_tool["inputSchema"]["properties"]["provider"]["type"] == "string"

    # --- tools/call: deterministic failure surfaced as a tool result ---------
    call_message = next(m for m in responses if m["id"] == 2)
    call_result = call_message["result"]
    assert call_result["isError"] is True
    assert call_result["resultType"] == "complete"
    assert call_result["structuredContent"]["error"]["kind"] == "chrome_not_found"
    assert "chrome_not_found" in call_result["content"][0]["text"]
