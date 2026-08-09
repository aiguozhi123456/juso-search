"""juso-search: an MCP server (stdio) for the Juso search extension.

Every ``tools/call`` runs one short-lived bridge cycle through the vendored
``juso_bridge`` module (single source: ``public/agent-skill/scripts/juso_bridge.py``,
drift-locked byte-identical). The package is a thin, pip-installable client of
the extension's existing agent-bridge protocol — it never touches API keys or
extension-gating state.
"""

__version__ = "0.1.1"
