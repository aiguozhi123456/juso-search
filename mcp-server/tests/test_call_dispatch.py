"""tools/call dispatch: each tool maps to one run_bridge call; result shapes."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest

from juso_search import juso_bridge

SEARCH_REPLY = {
    "ok": True,
    "response": {"query": "hello", "provider": "tavily", "results": [{"title": "T", "url": "https://e.com", "snippet": "S"}]},
    "cache": {"hit": False},
}


def _call(server, name, arguments):
    return asyncio.run(server.call_tool(name, arguments))


def _patch_run_bridge():
    return patch("juso_search.bridge_call.juso_bridge.run_bridge")


def _assert_bridge_kwargs(run_bridge, *, action, query=None, **expected):
    run_bridge.assert_called_once()
    call_args = run_bridge.call_args
    assert call_args.args[0] == action
    assert call_args.args[1] == query
    kwargs = call_args.kwargs
    for key, value in expected.items():
        assert kwargs[key] == value, f"{key!r}: expected {value!r}, got {kwargs[key]!r}"


# --- dispatch correctness: one run_bridge call per tool ---------------------

def test_search_dispatch(server):
    with _patch_run_bridge() as run_bridge:
        run_bridge.return_value = SEARCH_REPLY
        result = _call(server, "search", {"query": "hello", "provider": "tavily", "force_refresh": True})
    _assert_bridge_kwargs(
        run_bridge,
        action="search",
        query="hello",
        provider_id="tavily",
        force_refresh=True,
        extension_id="a" * 32,
    )
    assert result.is_error is False
    assert result.structured_content == SEARCH_REPLY
    assert json.loads(result.content[0].text) == SEARCH_REPLY
    assert result.content[0].type == "text"


def test_engine_search_dispatch(server):
    with _patch_run_bridge() as run_bridge:
        run_bridge.return_value = {"engine": "google", "query": "q", "results": []}
        result = _call(server, "engine-search", {"query": "q", "engine": "google", "max_results": 10})
    _assert_bridge_kwargs(run_bridge, action="engine-search", query="q", engine_id="google", max_results=10)
    assert result.is_error is False


def test_engine_search_error_reply_is_success(server):
    """engine-search error *replies* are valid completions, surfaced normally."""
    reply = {"engine": "google", "query": "q", "error": "extract-failed"}
    with _patch_run_bridge() as run_bridge:
        run_bridge.return_value = reply
        result = _call(server, "engine-search", {"query": "q", "engine": "google"})
    _assert_bridge_kwargs(run_bridge, action="engine-search", query="q", engine_id="google", max_results=None)
    assert result.is_error is False
    assert result.structured_content == reply
    assert "extract-failed" in result.content[0].text


def test_search_instance_dispatch(server):
    instance_id = "inst:exa:9f2220a2-f6ed-4ecc-80f9-142605a5e706"
    with _patch_run_bridge() as run_bridge:
        run_bridge.return_value = SEARCH_REPLY
        result = _call(server, "search-instance", {"query": "q", "instance": instance_id})
    _assert_bridge_kwargs(run_bridge, action="search-instance", query="q", instance_id=instance_id, force_refresh=False)
    assert result.is_error is False


@pytest.mark.parametrize(
    ("name", "arguments", "action"),
    [
        ("list-providers", {}, "list-providers"),
        ("list-instances", {}, "list-instances"),
        ("list-engines", {}, "list-engines"),
    ],
)
def test_list_tools_dispatch(server, name, arguments, action):
    replies = {"list-providers": {"providers": []}, "list-instances": {"instances": []}, "list-engines": {"engines": []}}
    reply = replies[action]
    with _patch_run_bridge() as run_bridge:
        run_bridge.return_value = reply
        result = _call(server, name, arguments)
    _assert_bridge_kwargs(run_bridge, action=action, query=None)
    assert result.is_error is False
    assert result.structured_content == reply


# --- failure shapes ----------------------------------------------------------

def test_bridge_error_becomes_is_error_result(server):
    error = juso_bridge.BridgeError("chrome_not_found", "no Chromium-family browser found", exit_status=2)
    with _patch_run_bridge() as run_bridge:
        run_bridge.side_effect = error
        result = _call(server, "list-providers", {})
    assert result.is_error is True
    text = result.content[0].text
    assert "chrome_not_found" in text
    assert "no Chromium-family browser found" in text
    assert result.structured_content == {"error": {"kind": "chrome_not_found", "message": "no Chromium-family browser found"}}


@pytest.mark.parametrize("kind", ["invalid_extension_id", "chrome_not_found", "wait_failed",
                                  "extension_did_not_claim", "extension_did_not_complete", "chrome_launch_failed"])
def test_bridge_error_kinds_surface(server, kind):
    error = juso_bridge.BridgeError(kind, f"boom {kind}", exit_status=1)
    with _patch_run_bridge() as run_bridge:
        run_bridge.side_effect = error
        result = _call(server, "search", {"query": "q", "provider": "tavily"})
    assert result.is_error is True
    assert kind in result.content[0].text


def test_unexpected_exception_becomes_is_error_result(server):
    """Non-BridgeError exceptions are wrapped as isError results, not propagated."""
    with _patch_run_bridge() as run_bridge:
        run_bridge.side_effect = OSError("boom")
        result = _call(server, "list-providers", {})
    assert result.is_error is True
    assert "internal_error" in result.content[0].text
    assert result.structured_content == {"error": {"kind": "internal_error", "message": "boom"}}


def test_cancel_event_passed_to_run_bridge(server):
    """The cancellation middleware wires a cancel_event into run_bridge."""
    with _patch_run_bridge() as run_bridge:
        run_bridge.return_value = {"providers": []}
        _call(server, "list-providers", {})
    kwargs = run_bridge.call_args.kwargs
    assert "cancel_event" in kwargs
    assert kwargs["cancel_event"] is not None
    assert hasattr(kwargs["cancel_event"], "set")  # threading.Event-like
