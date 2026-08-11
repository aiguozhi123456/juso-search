# juso-search

An MCP server (stdio) that exposes the Juso search extension's agent-bridge
search capabilities to MCP clients (Claude Desktop, Cursor, Cline, Claude
Code, …). It mirrors the CLI agent-skill `juso_search` subcommands over MCP
JSON-RPC 2.0, with a short-lived browser launch per call (Chromium-family or
Firefox) that the extension claims and completes through its Agent Bridge.

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
| `JUSO_EXTENSION_ID`  | no*      | The extension id (Chrome `[a-p]{32}` or Firefox email-style/`{GUID}`) — see `chrome://extensions` / `about:addons`. |
| `JUSO_BROWSER_PATH`  | **yes**  | Explicit browser executable (Chrome, Chromium, Edge, Firefox, …). The server refuses to guess — set it explicitly. (`JUSO_CHROME_PATH` is a legacy alias.) |
| `JUSO_BRIDGE_URL`    | no*      | Full bridge URL base, e.g. `moz-extension://<uuid>/bridge.html` — **required for Firefox** (the `moz-extension://` host is a per-install random UUID, not derivable from the id). |
| `JUSO_BROWSER_PROFILE`| no      | Browser profile (Chrome directory name / Firefox profile name; auto-selected if unset). (`JUSO_CHROME_PROFILE` is a legacy alias.) |
| `JUSO_TIMEOUT`       | no       | Seconds to wait for the extension to claim a request (default 40). |

\* Either `JUSO_EXTENSION_ID` **or** `JUSO_BRIDGE_URL` must be set. Chrome can
derive the bridge URL from the id, so only the id is needed; Firefox needs the
full bridge URL and the id is optional. `JUSO_BROWSER_PATH` is always required —
the server refuses to start without it (exit code 2 and a stderr message)
rather than guessing. (Browser auto-discovery is a CLI-skill convenience only;
the MCP server always needs an explicit executable because a wrong guess is a
silent failure that is hard to diagnose over stdio.)

## Client configuration

Each client injects these variables differently. Pick your client:

### Claude Desktop (`claude_desktop_config.json`)

Claude Desktop does **not** expand `${VAR}`, so write literal values:

> **`JUSO_BROWSER_PATH` by OS** — Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` (or `C:\Program Files\Mozilla Firefox\firefox.exe`) · macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or `/Applications/Firefox.app/Contents/MacOS/firefox`) · Linux: `/usr/bin/google-chrome` (or `/usr/bin/firefox`).

```json
{
  "mcpServers": {
    "juso": {
      "command": "juso-search",
      "args": [],
      "env": {
        "JUSO_EXTENSION_ID": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "JUSO_BROWSER_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
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
        "JUSO_BROWSER_PATH": "${env:JUSO_BROWSER_PATH}",
        "JUSO_BROWSER_PROFILE": "${env:JUSO_BROWSER_PROFILE}",
        "JUSO_TIMEOUT": "${env:JUSO_TIMEOUT}"
      }
    }
  }
}
```

### Cline (`cline_mcp_settings.json`)

> **`JUSO_BROWSER_PATH` by OS** — macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or `/Applications/Firefox.app/Contents/MacOS/firefox`) · Linux: `/usr/bin/google-chrome` (or `/usr/bin/firefox`). The example below uses the Windows path.

```json
{
  "mcpServers": {
    "juso": {
      "command": "juso-search",
      "args": [],
      "env": {
        "JUSO_EXTENSION_ID": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "JUSO_BROWSER_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "JUSO_BROWSER_PROFILE": "",
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
        "JUSO_BROWSER_PATH": "${JUSO_BROWSER_PATH}",
        "JUSO_BROWSER_PROFILE": "${JUSO_BROWSER_PROFILE:-}",
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
   mode*), copy the 32-char id from the Juso card — or use `about:addons` on
   Firefox for the email-style/`{GUID}` id, and export the skill from the
   Options page to get the full `moz-extension://` bridge URL (set it as
   `JUSO_BRIDGE_URL` instead of the id).
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
