# Browser path, profile, extension id, and persistence

These overrides are peer recovery controls when auto-discovery or the default profile fails:

| Control | CLI | Env |
|---------|-----|-----|
| Browser executable | `--browser` | `JUSO_BROWSER_PATH` |
| Profile (Chrome: directory name e.g. `Default`, `Profile 1`; Firefox: profile name e.g. `default`) | `--profile` | `JUSO_BROWSER_PROFILE` |
| Extension id (Chrome only; skipped when `--bridge-url` is set) | `--extension-id` | `JUSO_EXTENSION_ID` |
| Bridge URL base (Firefox only; full `moz-extension://…/bridge.html` URL) | `--bridge-url` | `JUSO_BRIDGE_URL` |

> `JUSO_CHROME_PATH` / `JUSO_CHROME_PROFILE` are accepted as legacy aliases for the browser path and profile; prefer `JUSO_BROWSER_PATH` / `JUSO_BROWSER_PROFILE`.

Example (Edge on Windows):

```powershell
$env:JUSO_BROWSER_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
python scripts/juso_search.py list-providers
```

## Firefox

Firefox needs an extra override that Chrome does not: the bridge URL. Chrome's bridge URL is `chrome-extension://<id>/bridge.html` and can be derived from the extension id, but Firefox's `moz-extension://` host is a per-install random UUID that cannot be derived from the gecko id — so the skill must be told the full bridge URL.

```powershell
$env:JUSO_BROWSER_PATH = "C:\Program Files\Mozilla Firefox\firefox.exe"
$env:JUSO_BRIDGE_URL = "moz-extension://<your-install-uuid>/bridge.html"
python scripts/juso_search.py list-providers
```

Find the UUID from the installed extension's manifest (in `about:debugging#/runtime/this-firefox` → the extension → the `moz-extension://…` origin), or export the skill from the extension's Options page, which stamps the correct URL automatically.

Profile handling also differs by browser: Chrome uses `--profile-directory=<name>`, Firefox uses `-p <name>` (the flag is chosen automatically from the detected browser type).

Use `--timeout` (or `JUSO_TIMEOUT`) to change the bridge wait time (default: 40 seconds, leaving time beyond the extension's 30-second request deadline).

## Persisting settings

The `JUSO_*` variables persist across invocations when set in your shell profile, so terminals and agents inherit them automatically without passing flags each time. This is the easiest way to pin a non-default browser path or profile on Windows, where session-scoped `$env:` variables do not survive a closed terminal.

**Windows (PowerShell)** — add to your `$PROFILE` (run `if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }` first if it does not exist):

```powershell
$env:JUSO_BROWSER_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$env:JUSO_BROWSER_PROFILE = "Default"
```

GUI-launched shells and tools that do not read `$PROFILE` need a user-scoped variable instead (reopen the shell afterward):

```powershell
[Environment]::SetEnvironmentVariable("JUSO_BROWSER_PATH", "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "User")
```

**macOS / Linux (bash, zsh)** — add to `~/.bashrc` or `~/.zshrc`:

```bash
export JUSO_BROWSER_PATH="/usr/bin/google-chrome"
export JUSO_BROWSER_PROFILE="Default"
```

**fish** — universal variables, persisted across sessions:

```fish
set -Ux JUSO_BROWSER_PATH "/usr/bin/google-chrome"
set -Ux JUSO_BROWSER_PROFILE "Default"
```

`JUSO_EXTENSION_ID` is rarely needed — the built-in id matches the installed extension. Set it only for custom `build:dev` builds whose id differs from the published ones (and skip it entirely on Firefox when `JUSO_BRIDGE_URL` is set).
