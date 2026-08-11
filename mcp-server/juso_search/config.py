"""Environment configuration for juso-search.

All configuration arrives through the MCP client's ``mcp.json`` ``env`` block:
``JUSO_BROWSER_PATH`` (required), ``JUSO_EXTENSION_ID`` or ``JUSO_BRIDGE_URL``
(at least one; ``JUSO_BRIDGE_URL`` covers Firefox's per-install ``moz-extension://``
UUID host), ``JUSO_BROWSER_PROFILE`` and ``JUSO_TIMEOUT`` (optional). The legacy
aliases ``JUSO_CHROME_PATH`` / ``JUSO_CHROME_PROFILE`` are still accepted. The
MCP path intentionally has no CLI flags — config is env-only by design.

``JUSO_BROWSER_PATH`` is required at startup: a missing value fails fast with a
message on **stderr** and a non-zero exit code. The server never guesses an
extension id or a browser executable, so a wrong or unset value can never be
silently used. (Browser auto-discovery lives in ``juso_bridge.find_chrome`` and
is reserved for the CLI skill, where a human is in the loop to read the
``chrome_not_found`` error.)

Stdout discipline (2026-07-28 gotcha #1): the only diagnostics this module
emits go to stderr. Nothing here ever writes to stdout.
"""

from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass
from typing import Mapping

from . import juso_bridge

# Seconds to wait for the extension to claim+complete a bridge request.
# Matches juso_bridge.run_bridge's own default.
DEFAULT_TIMEOUT = 40.0

# Non-zero exit code used for configuration failures.
EXIT_CONFIG_ERROR = 2


@dataclass(frozen=True)
class Config:
    """Resolved server configuration."""

    extension_id: str | None
    chrome_path: str
    profile: str | None = None
    timeout: float = DEFAULT_TIMEOUT
    bridge_url: str | None = None


def load_config(env: Mapping[str, str] | None = None) -> Config:
    """Build a :class:`Config` from ``env`` (defaults to ``os.environ``).

    Raises:
        SystemExit: with code :data:`EXIT_CONFIG_ERROR` (after writing an
            explanatory message to stderr) when ``JUSO_BROWSER_PATH`` is
            missing/empty, when neither ``JUSO_EXTENSION_ID`` nor
            ``JUSO_BRIDGE_URL`` is set (or the id is invalid), or when
            ``JUSO_TIMEOUT`` is not a positive finite number.
    """
    env = os.environ if env is None else env

    bridge_url = (env.get("JUSO_BRIDGE_URL") or "").strip() or None

    extension_id = (env.get("JUSO_EXTENSION_ID") or "").strip()
    if not extension_id and not bridge_url:
        _die(
            "JUSO_EXTENSION_ID is required but not set; add it to the client's "
            "mcp.json env block (find the extension id at chrome://extensions or "
            "about:addons) — refusing to guess an extension id. "
            "Alternatively, set JUSO_BRIDGE_URL for Firefox (the full bridge URL)."
        )
    if extension_id and not juso_bridge.EXTENSION_ID_RE.fullmatch(extension_id):
        _die(
            "JUSO_EXTENSION_ID must be Chrome [a-p]{32}, Firefox email-style, or {GUID}; "
            f"got {extension_id!r}"
        )

    chrome_path = (env.get("JUSO_BROWSER_PATH") or env.get("JUSO_CHROME_PATH") or "").strip()
    if not chrome_path:
        _die(
            "JUSO_BROWSER_PATH (or JUSO_CHROME_PATH) is required but not set; add it to the client's "
            "mcp.json env block (the browser executable, e.g. "
            r"C:\Program Files\Google\Chrome\Application\chrome.exe on Windows "
            "or /usr/bin/google-chrome on Linux, or /usr/bin/firefox for Firefox) "
            "— refusing to guess a browser "
            "(auto-discovery is a CLI-skill convenience, not an MCP one)"
        )
    profile = (env.get("JUSO_BROWSER_PROFILE") or env.get("JUSO_CHROME_PROFILE") or "").strip() or None

    timeout = DEFAULT_TIMEOUT
    raw_timeout = env.get("JUSO_TIMEOUT")
    if raw_timeout:
        try:
            parsed = float(raw_timeout)
        except ValueError:
            _die(f"JUSO_TIMEOUT must be a number of seconds, got {raw_timeout!r}")
        if not math.isfinite(parsed):
            _die(f"JUSO_TIMEOUT must be a finite number of seconds, got {parsed!r}")
        if parsed <= 0:
            _die(f"JUSO_TIMEOUT must be positive, got {parsed!r}")
        timeout = parsed

    return Config(
        extension_id=extension_id or None,
        chrome_path=chrome_path,
        profile=profile,
        timeout=timeout,
        bridge_url=bridge_url,
    )


def _die(message: str) -> None:
    """Write ``message`` to stderr and exit non-zero (no stdout writes)."""
    print(f"juso-search: {message}", file=sys.stderr, flush=True)
    raise SystemExit(EXIT_CONFIG_ERROR)
