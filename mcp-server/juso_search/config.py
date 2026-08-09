"""Environment configuration for juso-search.

All configuration arrives through the MCP client's ``mcp.json`` ``env`` block:
``JUSO_EXTENSION_ID`` (required), ``JUSO_CHROME_PATH``, ``JUSO_CHROME_PROFILE``
and ``JUSO_TIMEOUT`` (optional). The MCP path intentionally has no CLI flags —
config is env-only by design.

``JUSO_EXTENSION_ID`` is required at startup: a missing value fails fast with a
message on **stderr** and a non-zero exit code. The server never guesses an
extension id, so a wrong or unset id can never be silently used.

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

    extension_id: str
    chrome_path: str | None = None
    profile: str | None = None
    timeout: float = DEFAULT_TIMEOUT


def load_config(env: Mapping[str, str] | None = None) -> Config:
    """Build a :class:`Config` from ``env`` (defaults to ``os.environ``).

    Raises:
        SystemExit: with code :data:`EXIT_CONFIG_ERROR` (after writing an
            explanatory message to stderr) when ``JUSO_EXTENSION_ID`` is
            missing/empty or not a valid extension id, or ``JUSO_TIMEOUT`` is
            not a positive finite number.
    """
    env = os.environ if env is None else env

    extension_id = (env.get("JUSO_EXTENSION_ID") or "").strip()
    if not extension_id:
        _die(
            "JUSO_EXTENSION_ID is required but not set; add it to the client's "
            "mcp.json env block (find the 32-char extension id at "
            "chrome://extensions) — refusing to guess an extension id"
        )
    if not juso_bridge.EXTENSION_ID_RE.fullmatch(extension_id):
        _die(
            "JUSO_EXTENSION_ID must be 32 lowercase letters a-p (the Chrome "
            "extension id found at chrome://extensions); "
            f"got {extension_id!r}"
        )

    chrome_path = (env.get("JUSO_CHROME_PATH") or "").strip() or None
    profile = (env.get("JUSO_CHROME_PROFILE") or "").strip() or None

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
        extension_id=extension_id,
        chrome_path=chrome_path,
        profile=profile,
        timeout=timeout,
    )


def _die(message: str) -> None:
    """Write ``message`` to stderr and exit non-zero (no stdout writes)."""
    print(f"juso-search: {message}", file=sys.stderr, flush=True)
    raise SystemExit(EXIT_CONFIG_ERROR)
