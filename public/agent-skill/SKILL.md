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
- Auto-discovery may only find common Chrome/Chromium installs. If the extension lives in Edge or another binary, set the browser path (below).
- The browser you open must be the one whose profile has Juso installed and enabled.
- 扩展 ID 已内置，无需手动配置。
- Configure at least one provider in the extension before `search`.
- Run the script from this skill directory, or use its path relative to the skill root: `scripts/juso_search.py`.

## Commands

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py --extension-id YOUR_EXTENSION_ID search "query" --provider exa --force-refresh
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

`--provider` is required for provider searches so a request cannot silently follow the extension's active-provider state. `engine-search` supports `google`, `bing`, `baidu`, `yandex`, `duckduckgo`, `bilibili`, `xiaohongshu`, and `douyin`; it extracts ordinary result links only and does not promise AI or knowledge-panel content. Once an Agent has a result URL, use the host's built-in `web_fetch` to retrieve it; fetching pages is not a Juso capability.

For `bilibili`, results are scraped from `search.bilibili.com/all` in the user's logged-in profile; `snippet` is rich metadata (`UP主: … · 播放: … · 弹幕: … · 时长: …`), not a description. The list mixes two card types: true search results (full metadata) and a top "author latest videos" aggregate block (no UP主/弹幕 — those snippet fields are omitted, not zero). Distinguish them by snippet completeness, not position.

For `xiaohongshu`, results are scraped from `www.xiaohongshu.com/search_result` in the user's logged-in profile; `snippet` is rich metadata (`作者: … · 点赞: …`), not a note body. Notes often have no title — untitled notes carry the placeholder `(无标题)`. Ad/live-stream/trending cards carry no `/explore/` link and are excluded automatically.

For `douyin`, results are scraped from `www.douyin.com/search/{keyword}` in the user's logged-in profile. Douyin is heavily obfuscated: cards have no `<a>` links (navigation is JS-routed), so the result `url` is synthesized from the card id as `https://www.douyin.com/video/{id}` (videos) or `/note/{id}` (image posts). There is no title element — `title` is the full caption text and `snippet` is `作者: … · 点赞: …` parsed from it. User-aggregate / related-searches cards (no duration or `图文` prefix) are skipped.

> **`douyin` headless limitation (2026-07-31):** the extractor code is correct (verified: the same selectors return 25 cards when the tab is open and visible), but in the automated `engine-search` flow — which opens the SERP as a programmatically-created tab — Douyin's anti-bot frequently returns `no-results` (cards not rendered) or `challenge` (captcha/slider). This is a site anti-bot reaction to the automated tab, not an extraction bug. Retry, or treat `douyin` as best-effort; `bilibili` and `xiaohongshu` are reliable in the same flow.

### Provider instances

Providers that support custom instances (currently Exa) can have multiple tuned variants — e.g. one Exa instance for AI research (category=publication), another for startup news (category=news). Each instance is a first-class search target with its own options.

Use `list-providers` to discover which providers have instances (the `hasInstances` field). Use `list-instances` to list all instances with their ids and labels. Use `search-instance` to search through a specific instance.

```bash
python scripts/juso_search.py list-providers          # check hasInstances field
python scripts/juso_search.py list-instances           # list all provider instances
python scripts/juso_search.py search-instance "latest AI research" --instance-id inst:exa:abc123
```

`--instance-id` is required for `search-instance`. Instance ids are opaque strings starting with `inst:` — obtain them from `list-instances`.

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

Do not retry by exposing API keys. Fix path, profile, extension id, and that Juso is enabled in the opened browser, then retry. For `engine-search`, page-state errors (`challenge`, `consent`, `unsupported-layout`, `no-results`) and orchestration errors (`tab-closed`, `timeout`, `aborted`, `extract-failed`) also return nonzero because no usable engine results were obtained.

## Verification

From the repository root, run `npm run test:python`, `npm test`, `npm run typecheck`, and `npm run lint`.
