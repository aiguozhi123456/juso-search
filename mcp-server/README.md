# juso-search

An MCP server (stdio) that exposes the Juso search extension's agent-bridge
search capabilities to MCP clients (Claude Desktop, Cursor, Cline, Claude
Code, …). It mirrors the CLI agent-skill `juso_search` subcommands over MCP
JSON-RPC 2.0, with a short-lived Chromium launch per call that the extension
claims and completes through its Agent Bridge.

- **Transport**: stdio. JSON-RPC flows over stdin/stdout; diagnostics go to
  stderr (stdout stays clean — only newline-delimited JSON-RPC).
- **Config**: environment variables via the client's MCP `env` block. No CLI
  flags besides `--help` / `--version` (prints the package version).
- **Dual era**: accepts both the legacy `initialize` handshake and the modern
  `server/discover` (2026-07-28 protocol). Tested at the wire level.
- **Vendored bridge**: `juso_search/juso_bridge.py` is byte-identical to
  `public/agent-skill/scripts/juso_bridge.py` (the plan's drift lock). Never
  edit it by hand — regenerate from the source.

## Install

Published on [PyPI](https://pypi.org/project/juso-search/). Requires Python
3.10+ and `mcp>=2.0,<3` (installed automatically as a dependency).

```bash
pip install juso-search
```

From this repository (development):

```bash
python -m venv mcp-server/.venv
mcp-server/.venv/Scripts/pip install -e mcp-server/
```

Verify:

```bash
mcp-server/.venv/Scripts/juso-search --help
```

## Environment variables

| Variable             | Required | Meaning                                                          |
| -------------------- | -------- | ---------------------------------------------------------------- |
| `JUSO_EXTENSION_ID`  | **yes**  | The extension's 32-char id (see `chrome://extensions`).          |
| `JUSO_CHROME_PATH`   | **yes**  | Explicit Chromium-family executable (e.g. Chrome/Chromium/Edge). The server refuses to guess — set it explicitly. |
| `JUSO_CHROME_PROFILE`| no       | Chromium profile directory (auto-selected if unset).             |
| `JUSO_TIMEOUT`       | no       | Seconds to wait for the extension to claim a request (default 40). |

`JUSO_EXTENSION_ID` and `JUSO_CHROME_PATH` are required — the server refuses
to start without either (exit code 2 and a stderr message) rather than
guessing. (Browser auto-discovery is a CLI-skill convenience only; the MCP
server always needs an explicit executable because a wrong guess is a silent
failure that is hard to diagnose over stdio.)

## Client configuration

Each client injects these variables differently. Pick your client:

### Claude Desktop (`claude_desktop_config.json`)

Claude Desktop does **not** expand `${VAR}`, so write literal values:

> **`JUSO_CHROME_PATH` by OS** — Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` · macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` · Linux: `/usr/bin/google-chrome` (or `/usr/bin/chromium`).

```json
{
  "mcpServers": {
    "juso": {
      "command": "juso-search",
      "args": [],
      "env": {
        "JUSO_EXTENSION_ID": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "JUSO_CHROME_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "JUSO_TIMEOUT": "40"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "juso": {
      "command": "juso-search",
      "args": [],
      "env": {
        "JUSO_EXTENSION_ID": "${env:JUSO_EXTENSION_ID}",
        "JUSO_CHROME_PATH": "${env:JUSO_CHROME_PATH}",
        "JUSO_CHROME_PROFILE": "${env:JUSO_CHROME_PROFILE}",
        "JUSO_TIMEOUT": "${env:JUSO_TIMEOUT}"
      }
    }
  }
}
```

### Cline (`cline_mcp_settings.json`)

> **`JUSO_CHROME_PATH` by OS** — macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` · Linux: `/usr/bin/google-chrome` (or `/usr/bin/chromium`). The example below uses the Windows path.

```json
{
  "mcpServers": {
    "juso": {
      "command": "juso-search",
      "args": [],
      "env": {
        "JUSO_EXTENSION_ID": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "JUSO_CHROME_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "JUSO_CHROME_PROFILE": "",
        "JUSO_TIMEOUT": "40"
      }
    }
  }
}
```

### Claude Code (`.mcp.json`)

Claude Code expands `${VAR}` from the shell environment, with `:-default`
fallback:

```json
{
  "mcpServers": {
    "juso": {
      "command": "juso-search",
      "args": [],
      "env": {
        "JUSO_EXTENSION_ID": "${JUSO_EXTENSION_ID}",
        "JUSO_CHROME_PATH": "${JUSO_CHROME_PATH}",
        "JUSO_CHROME_PROFILE": "${JUSO_CHROME_PROFILE:-}",
        "JUSO_TIMEOUT": "${JUSO_TIMEOUT:-40}"
      }
    }
  }
}
```

## Tools

| Tool            | Params                                                  | Notes |
| --------------- | ------------------------------------------------------- | ----- |
| `search`        | `query`, `provider`, `force_refresh?`                   | Available providers are discovered via the `list-providers` tool. |
| `engine-search` | `query`, `engine`, `max_results?`                       | Available engines are discovered via the `list-engines` tool. |
| `search-instance`| `query`, `instance`, `force_refresh?`                 | Searches a configured provider instance. |
| `list-providers`| —                                                       | Providers and their config state. |
| `list-engines`  | —                                                       | Available engine ids for `engine-search`. |
| `list-instances`| —                                                       | Registered provider instances. |

All tools are annotated `readOnlyHint` + `openWorldHint`. Tool results carry
`structuredContent` plus a text serialization; `engine-search` error replies
(consent wall, challenge, timeout) surface as **successful** results carrying
an `error` field — only genuine bridge failures (e.g. Chrome not found,
bridge not enabled) come back as `isError`.

## Prerequisites (in the extension)

1. Find your extension id: open `chrome://extensions` (enable *Developer
   mode*), copy the 32-char id from the Juso card.
2. Enable **Agent Bridge** in the extension's Options. Without it every call
   fails with `extension_did_not_claim`.
3. To use `engine-search`, also enable its sub-switch in Options.

## Development / tests

```bash
python -m pytest mcp-server/tests        # or: npm run test:mcp
```

The suite covers config parsing/exit codes, `tools/list` schema and wire
fields, `tools/call` dispatch and error shapes, the dual-era handshake over
real subprocesses, and stdout cleanliness (only JSON-RPC on stdout).
