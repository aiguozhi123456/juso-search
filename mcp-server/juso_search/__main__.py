"""Entry point for the juso-search console script and ``python -m juso_search``.

Startup order: parse trivial CLI flags (``--version``) → load environment
config (fails fast on stderr with a non-zero exit when ``JUSO_EXTENSION_ID`` is
missing) → build the server → ``MCPServer.run()`` (defaults to stdio). Once the
server is running, stdout carries only newline-delimited JSON-RPC — all
diagnostics belong on stderr.
"""

from __future__ import annotations

import argparse
import sys

from . import __version__
from .config import load_config
from .server import build_server


def main(argv: list[str] | None = None) -> int:
    """Parse flags, load config and run the stdio MCP server."""
    parser = argparse.ArgumentParser(
        prog="juso-search",
        description=(
            "MCP server (stdio) exposing the Juso search extension's five "
            "agent-bridge tools. Configuration comes from environment variables "
            "(JUSO_EXTENSION_ID, JUSO_CHROME_PATH, JUSO_CHROME_PROFILE, JUSO_TIMEOUT)."
        ),
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"juso-search {__version__}",
    )
    parser.parse_args(argv)

    config = load_config()
    try:
        build_server(config).run()
    except Exception as error:
        print(f"juso-search: server error: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
