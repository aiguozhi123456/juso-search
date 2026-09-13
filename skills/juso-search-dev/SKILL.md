---
name: juso-search-dev
description: Search through configured Juso providers, browser search engines, user-defined site or aggregate instances, or inspect configured sources (developer build, uses dev extension ID).
compatibility: Python 3.11+, a Chromium-family or Firefox browser with the Juso developer extension installed and enabled
metadata:
  author: Juso
  version: "2"
---

# Juso Search (Developer Build)

Use this skill when a task needs web search through the user's locally configured Juso **developer build** providers, or needs to discover which providers are configured. The extension keeps API keys inside its background worker; this skill never reads or prints them.

> **注意：** 本技能仅适用于自行构建的 Juso 开发版（`npm run build:dev` 构建，扩展 ID `pdklefhommhabbhkglgkgomeibeibmcl`）。若你从 Chrome Web Store 安装 Juso，请改用 [juso-search](https://github.com/aiguozhi123456/juso-search/tree/main/skills/juso-search) 技能。

## Prerequisites

- Build and load the Juso developer extension (`npm run build:dev` → load `.output/chrome-mv3-dev/` in `chrome://extensions` with Developer mode).
- The browser you open must be the one whose profile has Juso developer build installed and enabled.
- 扩展 ID 已内置，无需手动配置。
- Configure at least one provider in the extension before `search`.
- Run the script from this skill directory, or use its path relative to the skill root: `scripts/juso_search.py`.
- The skill folder bundles `scripts/juso_bridge.py` (shared bridge core) alongside `scripts/juso_search.py` (the entry point). Keep both files together when copying the skill.

## Commands

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py list-engines
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py --extension-id YOUR_EXTENSION_ID search "query" --provider exa --force-refresh
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
python scripts/juso_search.py --bridge-url "moz-extension://<your-install-uuid>/bridge.html" engine-search "query" --engine bing  # Firefox
python scripts/juso_search.py list-sites
python scripts/juso_search.py search-site "query restricted to one site" --site-id site:abc123
python scripts/juso_search.py list-aggregates
python scripts/juso_search.py search-aggregate "broad research query" --aggregate-id agg:abc123
```

Global options (`--extension-id`, `--browser`, `--profile`, `--bridge-url`, `--timeout`) must appear **before** the subcommand — `python scripts/juso_search.py --timeout 60 list-sites`, not `list-sites --timeout 60`. `--timeout` (seconds) sets the end-to-end budget and applies to every command, including the fast `list-*` discovery commands.

`--provider` is required for provider searches so a request cannot silently follow the extension's active-provider state; call `list-providers` to discover available provider ids. `--engine` is required for engine searches; call `list-engines` to discover available engine ids. `--site-id` / `--aggregate-id` are required for site/aggregate searches; call `list-sites` / `list-aggregates` to discover their ids. `engine-search` extracts ordinary result links only and does not promise AI or knowledge-panel content. Results are leads, not evidence: titles, snippets, and AI summaries may be truncated, stale, or inaccurate — open the result URL with the host's built-in `web_fetch` and verify specifics on the source page. Fetching pages is not a Juso capability.

## Reference

Detail files live under `reference/` (shipped inside the skill). Read them on demand:

- `reference/engines.md` — per-engine result shapes and caveats for specific engines; the engine list is dynamic — call `list-engines` to discover current engine ids.
- `reference/provider-instances.md` — custom provider instances: `list-instances` and `search-instance`.
- `reference/site-instances.md` — user-defined site instances (per-site searches): `list-sites` and `search-site`.
- `reference/aggregate-instances.md` — user-defined aggregate instances (multi-source reranked search): `list-aggregates` and `search-aggregate`.
- `reference/configuration.md` — browser path / profile / extension-id overrides, the Firefox `--bridge-url`, `--timeout`, and persisting `JUSO_*` env vars across shells.
- `reference/errors.md` — output contract and the `error.kind` table for branching.

## Verification

From the repository root, run `npm run test:python`, `npm test`, `npm run typecheck`, and `npm run lint`.
