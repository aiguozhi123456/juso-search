# Juso

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/aiguozhi123456/juso-search?label=Release)](https://github.com/aiguozhi123456/juso-search/releases/latest)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/illmhdnglkjfcenboepdgopaeejdgoji?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/%E5%8F%8C%E9%9D%A2%E6%90%9C/illmhdnglkjfcenboepdgopaeejdgoji)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![WXT](https://img.shields.io/badge/Built%20with-WXT-6B46C1.svg)](https://wxt.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/aiguozhi123456/juso-search/pulls)

[中文](README.md)

> **Search with equal focus on people and agents.**

Juso is an open-source, two-sided search product. It gives people one place to select and switch between conventional search engines, saved site-scoped searches (Site Engines), and configured AI search services. It also lets local AI agents use AI search APIs through the same browser or search conventional engines. The extension manages credentials locally, while requests go directly to the service you select. Even using only the human side, it is a fully functional, ready-to-use search aggregation and switching tool — Google, Bing, Baidu, Douyin, Xiaohongshu, and Bilibili work with zero AI service configuration, and you can save site-scoped searches in settings without any API key.

| For | What it does today |
| --- | --- |
| People | Aggregates conventional engines and saved site-scoped searches with fast switching on the Juso page and result pages |
| People | Turns AI search APIs into a search experience that can fast-switch with conventional engines |
| Local AI agents | Provides one access path to configured AI search APIs |
| Local AI agents | Searches conventional engines through a real browser |

## Screenshots and Demo

**AI search: synthesized answer and results side by side**

![Juso search page showing an AI answer with citations above the result list](docs/assets/screenshot-search.png)

**SERP Switch Bar: switch engines from any result page**

![Juso switch bar at the top of a Bing result page](docs/assets/screenshot-serp.png)

**Full flow demo**

![Switching between the Juso search page and engine result pages](docs/assets/demo.gif)

## Current Capabilities and Sources

Juso presents a **Search Source** as one user-facing choice. A source can be a conventional **Search Engine**, a user-saved **Site Engine**, or a configured AI search service; those three types use different execution paths.

- Conventional Search Engines: Google, Bing, Baidu, Douyin, Xiaohongshu, and Bilibili. They use no API key; Juso navigates a browser for people to use directly; Google, Bing, and Baidu also let agents extract ordinary search results.
- Site Engines: save multiple site-scoped searches in extension settings. Each entry fixes Google, Bing, or Baidu as the underlying engine and searches that site with a `site:` operator. Targets must be public hostnames; the underlying engine is chosen at create time and does not change afterward. Saved entries appear on the search page and the SERP Switch Bar like other sources. No API key required.
- AI search services: Tavily, Exa, Stepfun pay-as-you-go API, and Stepfun Step Plan. They are accessed through a normalized adapter interface, while each service retains its own authentication and billing.
- Answer capability: Tavily and Exa can return a synthesized answer with a result list. Both Stepfun sources currently return result lists only.

In the current release, “aggregation” means unified access, selection, and fast source switching. It does **not** mean a query retrieves from several sources in parallel by default, nor that results are merged, deduplicated, or fused by default.

## For People

The independent search page lets you choose and switch Search Sources, including saved Site Engines. On supported Google, Bing, Baidu, Douyin, Xiaohongshu, and Bilibili result pages, the SERP Switch Bar can move the current query to another search engine, a Site Engine, or hand it off to Juso’s AI search page.

Successful AI searches are cached on the current device and appear in local search history that can be reviewed and replayed. Cache entries are scoped to a service plus normalized query, and are not shared across services. Use explicit refresh when you need fresh results; it bypasses the cache and may incur charges from the selected AI service.

## Quick Start

Juso v1.2.0 is available on the Chrome Web Store for one-click installation. Install the extension through Installation and Updates first, then continue with how you intend to use it.

### People

1. Install and enable the extension through Installation and Updates.
2. Open the Juso search page and choose a Search Source. Google, Bing, Baidu, Douyin, Xiaohongshu, and Bilibili need no configuration (engines hidden by default can be shown from settings). To add site-scoped search, create Site Engines in extension settings (site + underlying engine). Configure the corresponding key only when using an AI search service.

You can now search and switch among conventional engines, saved Site Engines, and configured AI search services from one entry point.

### Local AI Agents

1. Install and enable the extension in the **Chromium-family browser that will run Agent calls** (Chrome, Edge, Chromium, etc.). `engine-search` needs no AI search service configuration; configure the corresponding service only when calling an AI search API through `search --provider`.
2. Choose the skill that matches your Juso installation:
   - **Chrome Web Store installation** (recommended): install or copy `skills/juso-search/` into your agent's skills directory, for example `.agents/skills/juso-search/`. The extension ID is built in by default—no setup needed.
   - **Developer build** (self-built via `npm run build:dev`): install or copy `skills/juso-search-dev/` into your agent's skills directory, for example `.agents/skills/juso-search-dev/`. The only difference between the two skills is the extension ID; choose based on how you installed Juso.
3. Only set `JUSO_EXTENSION_ID` or pass `--extension-id` when you self-sign a pack (or the ID differs from the default).
4. If auto-discovery cannot find a browser, or Juso is installed only in Edge (or another non-default binary), point the skill at **the executable whose profile has Juso** (optionally set a profile directory name):

```powershell
$env:JUSO_CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# optional: $env:JUSO_CHROME_PROFILE = "Default"
# optional: $env:JUSO_EXTENSION_ID = "YOUR_EXTENSION_ID"
```

```bash
export JUSO_CHROME_PATH="/path/to/msedge-or-chrome"
# optional: export JUSO_CHROME_PROFILE="Default"
# optional: export JUSO_EXTENSION_ID="YOUR_EXTENSION_ID"
```

5. Run commands from the skill directory, for example:

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

To override temporarily: `python scripts/juso_search.py --chrome /path/to/browser --extension-id YOUR_EXTENSION_ID list-providers`.

The local agent can now list configured services, perform API searches with an **explicit** provider, or search Google, Bing, and Baidu through the browser—without receiving stored credentials.

## Installation and Updates

### Install from Chrome Web Store (Recommended)

1. Visit [Juso on the Chrome Web Store](https://chromewebstore.google.com/detail/%E5%8F%8C%E9%9D%A2%E6%90%9C/illmhdnglkjfcenboepdgopaeejdgoji).
2. Click **Add to Chrome** to install and enable the extension.

Chrome Web Store installation has no developer-mode warnings and supports automatic updates.

### Install v1.2.0 (GitHub Release)

1. Download `juso-search-1.2.0-chrome-dev.zip` from the [GitHub Release v1.2.0](https://github.com/aiguozhi123456/juso-search/releases/tag/v1.2.0).
2. Extract the ZIP.
3. Open `chrome://extensions` in Chromium, enable Developer mode, choose **Load unpacked**, and select the extracted directory that directly contains `manifest.json`.

### Install from Source

See the [development document](docs/DEVELOPMENT.en.md) for development commands, build differences, and architecture.

## Security and Data Boundaries

- The extension manages AI search-service credentials locally in `chrome.storage.local`; only the background service worker reads them. UI pages do not read stored keys, and local AI agents do not receive them.
- When authentication requires it, a credential is sent to the AI search service you select. Queries reach the selected AI service or conventional Search Engine.
- In its current local mode, Juso operates neither a request proxy nor telemetry. Browsers, networks, conventional search engines, and AI search services may still record requests; Juso cannot guarantee anonymity or control those third parties’ logging practices.
- Configuration export is user-initiated and includes unencrypted credentials and preferences. The export is sensitive and remains in your custody; Juso operates no configuration-backup or credential-sync service.

## Agent Interface and Limits

Agents invoke bounded extension-worker actions through the Agent Bridge: a short-lived, loopback-only capability channel, not a persistent local API. Every invocation uses a new local port, token, and request identity, and expires on completion or timeout.

`search` requires `--provider`; it never silently follows the extension’s current provider. `engine-search` extracts ordinary result links only and does not promise AI summaries, knowledge panels, or other page content. Once an agent has a URL, page retrieval belongs to its host’s own capability, such as `web_fetch`. Launch and bridge failures return structured `error.kind` values on stdout (for example `chrome_not_found`, `chrome_launch_failed`, `extension_did_not_claim`, `extension_did_not_complete`). Fix browser path, profile, extension id, and confirm Juso is enabled in the opened browser—do not retry by exposing keys. Engine searches also fail on challenges, consent pages, unsupported layouts, and no results. See `skills/juso-search/SKILL.md` for the full kind table.

## Development

See the [development document](docs/DEVELOPMENT.en.md) for source install, development commands, architecture, and testing guide.

## Possible Future

This is not a roadmap or a promise. Based on demand, interface availability, and service stability, Juso may adapt more AI search services and conventional search engines. It may also explore optional parallel retrieval from multiple sources, deduplication, ranking, and provenance-preserving result fusion. Any such capability should give users explicit control of cost, scope, and latency.

## Naming History

The project’s original Chinese name was 聚搜, with the English name Juso. As of 2026-07-23 (after the v1.0.0 release), the Chinese name changed to 双面搜 while the English name remains Juso; the brand is written 双面搜 / Juso.

Why: 双面搜 directly reflects the product’s two-sided positioning—one side for people, one for agents—and is more distinctive in Chinese. The English name Juso is kept because it is short, memorable, and owns its brand queries (for example, “Juso extension”).

Code identifiers (package name `juso-search`, `JUSO_*` environment variables, `--juso-*` CSS variables, and the `juso-search` agent skill) keep Juso and are unaffected by the Chinese name change.

## Acknowledgements

The approach of inserting the switch bar as the first child of the result container to inherit its width and simplify alignment, and the approach of injecting a CSS shim into the host page to make room for the bar, on Google / Bing / Baidu result pages, as well as the choice of injection anchors (`.head-contain` / `.search-input`) on the Bilibili result page, are informed by [searchEngineJump 搜索引擎快捷跳转](https://greasyfork.org/zh-CN/scripts/27752-searchenginejump) (authors: NLF, 锐经, [qxin i](https://github.com/qxinGitHub/searchEngineJump), MIT licensed). This extension's implementation is independently written and shares no code with the original script.

## License

Juso’s complete local search loop—the current extension, source integrations, agent access, local configuration, and cache—is open under [MPL-2.0](LICENSE). This commitment does not imply that possible future hosted or operational services will be open source or free.
