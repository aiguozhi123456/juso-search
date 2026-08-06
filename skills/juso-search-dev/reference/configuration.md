# Browser path, profile, extension id, and persistence

These three overrides are peer recovery controls when auto-discovery or the default profile fails:

| Control | CLI | Env |
|---------|-----|-----|
| Browser executable | `--chrome` | `JUSO_CHROME_PATH` |
| Profile directory name (e.g. `Default`, `Profile 1`) | `--profile` | `JUSO_CHROME_PROFILE` |
| Extension id | `--extension-id` | `JUSO_EXTENSION_ID` |

Example (Edge on Windows):

```powershell
$env:JUSO_CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
python scripts/juso_search.py list-providers
```

Use `--timeout` (or `JUSO_TIMEOUT`) to change the bridge wait time (default: 40 seconds, leaving time beyond the extension's 30-second request deadline).

## Persisting settings

The `JUSO_*` variables persist across invocations when set in your shell profile, so terminals and agents inherit them automatically without passing flags each time. This is the easiest way to pin a non-default browser path or profile on Windows, where session-scoped `$env:` variables do not survive a closed terminal.

**Windows (PowerShell)** — add to your `$PROFILE` (run `if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }` first if it does not exist):

```powershell
$env:JUSO_CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$env:JUSO_CHROME_PROFILE = "Default"
```

GUI-launched shells and tools that do not read `$PROFILE` need a user-scoped variable instead (reopen the shell afterward):

```powershell
[Environment]::SetEnvironmentVariable("JUSO_CHROME_PATH", "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "User")
```

**macOS / Linux (bash, zsh)** — add to `~/.bashrc` or `~/.zshrc`:

```bash
export JUSO_CHROME_PATH="/usr/bin/google-chrome"
export JUSO_CHROME_PROFILE="Default"
```

**fish** — universal variables, persisted across sessions:

```fish
set -Ux JUSO_CHROME_PATH "/usr/bin/google-chrome"
set -Ux JUSO_CHROME_PROFILE "Default"
```

`JUSO_EXTENSION_ID` is rarely needed — the built-in id matches the installed extension. Set it only for custom `build:dev` builds whose id differs from the published ones.
