---
name: juso-search
description: Search through configured Juso providers or supported browser search engines, or inspect configured providers.
compatibility: Python 3.11+, Chromium-family browser with the Juso extension installed and enabled
metadata:
  author: Juso
  version: "1"
---

# Juso Search

Use this skill when a task needs web search through the user's locally configured Juso providers, or needs to discover which providers are configured. The extension keeps API keys inside its background worker; this skill never reads or prints them.

## Prerequisites

- Install and enable the Juso extension in a Chromium-family browser (Chrome, Edge, Chromium, Brave, etc.).
- Auto-discovery may only find common Chrome/Chromium installs. If the extension lives in Edge or another binary, set the browser path (below).
- The browser you open must be the one whose profile has Juso installed and enabled.
- 扩展 ID 已内置默认值，无需手动配置。仅在自行签名打包时才需设置 `JUSO_EXTENSION_ID` 或传 `--extension-id` 覆盖。
- Configure at least one provider in the extension before `search`.
- Run the script from this skill directory, or use its path relative to the skill root: `scripts/juso_search.py`.

## Commands

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py --extension-id YOUR_EXTENSION_ID search "query" --provider exa --force-refresh
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

`--provider` is required for provider searches so a request cannot silently follow the extension's active-provider state. `engine-search` supports `google`, `bing`, and `baidu`; it extracts ordinary result links only and does not promise AI or knowledge-panel content. Once an Agent has a result URL, use the host's built-in `web_fetch` to retrieve it; fetching pages is not a Juso capability.

### Browser path, profile, and extension id

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

Use `--timeout` to change the bridge wait time (default: 40 seconds, leaving time beyond the extension's 30-second request deadline).

## Output and failures

Standard output contains exactly one JSON value: the normalized Juso search reply, the provider list, or a skill lifecycle error. Diagnostics go to standard error.

Skill lifecycle errors use `{"ok":false,"error":{"kind":"...","message":"..."}}`. Agents should branch on `error.kind`:

| kind | Meaning |
|------|---------|
| `chrome_not_found` | No browser executable resolved |
| `chrome_launch_failed` | OS failed to start the browser process |
| `extension_did_not_claim` | Browser opened (or was targeted) but the extension never claimed the bridge request — wrong browser, profile, extension id, or extension disabled/missing |
| `extension_did_not_complete` | Extension claimed but did not complete — reload the extension; check worker/runtime if path/profile/id are correct |
| `invalid_extension_id` | Extension id is not 32 lowercase letters a–p |
| `wait_failed` | Unexpected wait failure |

Do not retry by exposing API keys. Fix path, profile, extension id, and that Juso is enabled in the opened browser, then retry. For `engine-search`, `challenge`, `consent`, `unsupported-layout`, and `no-results` also return nonzero because no usable engine results were obtained.

## Verification

From the repository root, run `npm run test:python`, `npm test`, `npm run typecheck`, and `npm run lint`.
