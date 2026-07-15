---
name: juso-search
description: Search through configured Juso providers or supported browser search engines, or inspect configured providers.
compatibility: Python 3.11+, Google Chrome or Chromium, Juso extension installed and enabled
metadata:
  author: Juso
  version: "1"
---

# Juso Search

Use this skill when a task needs web search through the user's locally configured Juso providers, or needs to discover which providers are configured. The extension keeps API keys inside its background worker; this skill never reads or prints them.

## Prerequisites

- Install and enable the Juso Chrome extension.
- Set its extension ID with `JUSO_EXTENSION_ID`, or pass `--extension-id`.
- Configure at least one provider in the extension before `search`.
- Run the script from this skill directory, or use its path relative to the skill root: `scripts/juso_search.py`.

## Commands

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py --extension-id YOUR_EXTENSION_ID search "query" --provider exa --force-refresh
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

`--provider` is required for provider searches so a request cannot silently follow the extension's active-provider state. `engine-search` supports `google`, `bing`, and `baidu`; it extracts ordinary result links only and does not promise AI or knowledge-panel content. Once an Agent has a result URL, use the host's built-in `web_fetch` to retrieve it; fetching pages is not a Juso capability. Use `--chrome` or `JUSO_CHROME_PATH` to choose a browser executable, `--profile` or `JUSO_CHROME_PROFILE` for a Chrome profile directory name, and `--timeout` to change the bridge wait time (default: 40 seconds, leaving time beyond the extension's 30-second request deadline).

## Output and failures

Standard output contains exactly one JSON value: the normalized Juso search reply or the provider list. Diagnostics go to standard error. A nonzero exit status with a JSON error indicates that Chrome could not launch, the extension did not connect, the request timed out, or the bridge rejected the protocol. For `engine-search`, `challenge`, `consent`, `unsupported-layout`, and `no-results` also return nonzero because no usable engine results were obtained. Do not retry by exposing API keys; confirm the extension ID, browser profile, and provider configuration instead.

## Verification

From the repository root, run `npm run test:python`, `npm test`, `npm run typecheck`, and `npm run lint`.
