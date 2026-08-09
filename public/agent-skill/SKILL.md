---
name: juso-search
description: Search through configured Juso providers or supported browser search engines, or inspect configured providers.
compatibility: Python 3.11+, Chromium-family browser with the Juso extension installed and enabled
metadata:
  author: Juso
  version: "2"
---

# Juso Search

Use this skill when a task needs web search through the user's locally configured Juso providers, or needs to discover which providers are configured. The extension keeps API keys inside its background worker; this skill never reads or prints them.

## Prerequisites

- Install and enable the Juso extension in a Chromium-family browser (Chrome, Edge, Chromium, Brave, etc.).
- Auto-discovery may only find common Chrome/Chromium installs. If the extension lives in Edge or another binary, set the browser path (see `reference/configuration.md`).
- The browser you open must be the one whose profile has Juso installed and enabled.
- 扩展 ID 已内置，无需手动配置。
- Configure at least one provider in the extension before `search`.
- Run the script from this skill directory, or use its path relative to the skill root: `scripts/juso_search.py`.
- The skill folder bundles `scripts/juso_bridge.py` (shared bridge core) alongside `scripts/juso_search.py` (the entry point). Keep both files together when copying the skill.

## Commands

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py --extension-id YOUR_EXTENSION_ID search "query" --provider exa --force-refresh
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

`--provider` is required for provider searches so a request cannot silently follow the extension's active-provider state. `engine-search` supports `google`, `bing`, `baidu`, `yandex`, `duckduckgo`, `bilibili`, `xiaohongshu`, and `douyin`; it extracts ordinary result links only and does not promise AI or knowledge-panel content. Once an Agent has a result URL, use the host's built-in `web_fetch` to retrieve it; fetching pages is not a Juso capability.

## Reference

Detail files live under `reference/` (shipped inside the skill). Read them on demand:

- `reference/engines.md` — per-engine result shapes and caveats for `bilibili`, `xiaohongshu`, and `douyin`.
- `reference/provider-instances.md` — Exa custom instances: `list-instances` and `search-instance`.
- `reference/configuration.md` — browser path / profile / extension-id overrides, `--timeout`, and persisting `JUSO_*` env vars across shells.
- `reference/errors.md` — output contract and the `error.kind` table for branching.

## Verification

From the repository root, run `npm run test:python`, `npm test`, `npm run typecheck`, and `npm run lint`.
