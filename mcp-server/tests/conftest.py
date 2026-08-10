"""Shared pytest fixtures and helpers for juso-search tests.

Adds the ``mcp-server`` directory to ``sys.path`` so ``juso_search`` imports
without requiring an editable install (the package is still pip-installable;
the path shim keeps the test suite self-contained).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

MCP_SERVER_DIR = Path(__file__).resolve().parents[1]
if str(MCP_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(MCP_SERVER_DIR))

from juso_search.config import Config  # noqa: E402

EXTENSION_ID = "a" * 32

# A path that does not exist (POSIX-safe, works on Windows/macOS/Linux):
# forces run_bridge to fail fast with chrome_not_found instead of launching
# a real browser in tests.
NO_SUCH_CHROME = "/juso-search-test-no-such-chrome"


@pytest.fixture
def config() -> Config:
    return Config(extension_id=EXTENSION_ID, chrome_path=NO_SUCH_CHROME)


@pytest.fixture
def server(config):
    from juso_search.server import build_server

    return build_server(config)


def spawn_server(extra_env: dict[str, str] | None = None) -> subprocess.Popen:
    """Launch ``python -m juso_search`` with a deterministic test environment."""
    env = dict(os.environ)
    env["PYTHONPATH"] = str(MCP_SERVER_DIR)
    env["JUSO_EXTENSION_ID"] = EXTENSION_ID
    env["JUSO_CHROME_PATH"] = NO_SUCH_CHROME
    env["JUSO_TIMEOUT"] = "2"
    if extra_env:
        env.update(extra_env)
    return subprocess.Popen(
        [sys.executable, "-m", "juso_search"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
        text=True,
        encoding="utf-8",
    )


def exchange_jsonrpc(
    proc: subprocess.Popen,
    requests: list[dict],
    timeout: float = 30.0,
) -> list[dict]:
    """Send newline-delimited JSON-RPC requests and read the responses.

    stdin is deliberately left open: closing it right after writing would let
    the server see EOF and cancel an in-flight ``tools/call`` (the modern
    per-request path) before its response is written. A daemon reader thread
    drains stdout while the caller waits for ``len(requests)`` responses.
    """
    responses: list[str] = []

    def _drain() -> None:
        for line in proc.stdout:
            responses.append(line)

    reader = threading.Thread(target=_drain, daemon=True)
    reader.start()

    for request in requests:
        proc.stdin.write(json.dumps(request) + "\n")
        proc.stdin.flush()

    deadline = time.monotonic() + timeout
    while len(responses) < len(requests) and time.monotonic() < deadline:
        time.sleep(0.02)

    parsed = [json.loads(line) for line in responses]
    if len(parsed) != len(requests):
        raise AssertionError(
            f"expected {len(requests)} JSON-RPC responses, got {len(parsed)}: {responses}"
        )
    return parsed


def modern(method: str, params: dict, request_id: int = 1) -> dict:
    """Wrap ``params`` in the 2026-07-28 per-request ``_meta`` envelope."""
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": {
            **params,
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
            },
        },
    }
