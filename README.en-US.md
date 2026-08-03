

# Dual-Side Search / Juso

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/aiguozhi123456/juso-search?label=Release)](https://github.com/aiguozhi123456/juso-search/releases/latest)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/illmhdnglkjfcenboepdgopaeejdgoji?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/%E5%8F%8C%E9%9D%A2%E6%90%9C/illmhdnglkjfcenboepdgopaeejdgoji)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![WXT](https://img.shields.io/badge/Built%20with-WXT-6B46C1.svg)](https://wxt.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/aiguozhi123456/juso-search/pulls)

[English](README.en.md)

> **One side for humans, one side for AI agents.**

Juso is an open-source dual-side search product: it allows human users to select and switch between traditional search engines, site-specific searches (Site Engine), and configured AI search services from a single entry point; it also enables local AI agents to invoke AI search APIs or retrieve from traditional search engines through the same browser. Keys are managed locally by the extension, and search requests go directly to the services you choose. Even if used only for the human side, it is a fully-featured, out-of-the-box search aggregation and switching tool—ready to use Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili, Yandex, and DuckDuckGo without configuring any AI services. You can also save site-specific searches (Site Engine) for designated domains in the settings.

| For Whom | What It Can Do Now |
| --- | --- |
| Human Users | Aggregate traditional search engines and saved site-specific searches, and quickly switch between them on the standalone search page and results pages |
| Human Users | Turn AI search APIs into a ready-to-use search experience that can quickly switch with traditional engines |
| Local AI Agents | Invoke configured AI search APIs through a unified entry point |
| Local AI Agents | Retrieve from traditional search engines using a real browser |

## Screenshots & Demos

**AI Search: Comprehensive Answer & Results List on the Same Screen**

![Juso search page, AI service returns a comprehensive answer with citations, with a results list below](docs/assets/screenshot-search.png)

**SERP Switch Bar: One-Click Switching Within Search Engine Results Pages**

![Juso switch bar at the top of Bing results page, allowing switching to other engines or AI search](docs/assets/screenshot-serp.png)

**Full Workflow Demo**

![Demo of switching between Juso search page and search engine results page](docs/assets/demo.gif)

## Current Capabilities & Sources

Juso treats **search sources** as a unified user choice: it can be a traditional **search engine**, a user-saved **site-specific search (Site Engine)**, or a configured AI search service; each has a different execution method.

- Traditional Search Engines: Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili, Yandex, DuckDuckGo. They do not use API keys; Juso navigates via the browser for direct human use; all eight engines support agent extraction of standard search results (Bilibili, Xiaohongshu, and Douyin require a logged-in browser session for extraction).
- Site-Specific Search (Site Engine): Save multiple sites in the extension settings; each entry fixes the selection of one of Google, Bing, or Baidu, and searches with `site:` restricted to that domain. Targets must be public domain names; the underlying engine is selected at creation time and cannot be changed later. Once created, they appear on the search page and SERP switch bar, switchable like other sources. No API keys required.
- AI Search Services: Tavily, Exa, Brave, Stepfun (Pay-as-you-go API), Stepfun Step Plan, Jina, Doubao (Custom & Global endpoints). Services are accessed via a unified adapter interface, but authentication and billing are determined by each respective service.
- Answer Capabilities: Tavily and Exa can return comprehensive answers along with result lists; Stepfun (including Step Plan), Brave, Jina, and Doubao currently only return result lists.

"Aggregation" in the current version refers to unified integration, selection, and quick switching of search sources; it **does not imply** parallel requests to multiple sources by default for a single query, nor does it imply default merging, deduplication, or fusion of results.

## Human Usage

The standalone search page provides search source selection and switching (including saved site-specific searches); on supported results pages for Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili, Yandex, and DuckDuckGo, the SERP switch bar can directly switch the current query to other search engines, site-specific searches, or jump to Juso's AI search page.

Successful AI searches are cached on the current device and form a viewable, replayable local search history. Caches are distinguished by "service + normalized query" and are not shared across services. When fresh results are needed, please refresh explicitly; refreshing bypasses the cache and may incur charges from the selected AI service.

## Quick Start

Juso v1.3.0 is available on GitHub Releases (Chrome Web Store is currently on v1.2.0, with v1.3.0 under review).

### Install the Extension

**Install from Chrome Web Store (Recommended)**

1. Visit [Dual-Side Search on Chrome Web Store](https://chromewebstore.google.com/detail/%E5%8F%8C%E9%9D%A2%E6%90%9C/illmhdnglkjfcenboepdgopaeejdgoji).
2. Click "Add to Chrome" to install and enable the extension.

Chrome Web Store installations do not show developer mode warnings and support automatic updates.

**Install from GitHub Release (v1.3.0)**

1. Download `juso-search-1.3.0-chrome-dev.zip` from [GitHub Release v1.3.0](https://github.com/aiguozhi123456/juso-search/releases/tag/v1.3.0).
2. Extract the ZIP file.
3. Open `chrome://extensions` in Chromium, enable "Developer mode", select "Load unpacked", and choose the directory that directly contains `manifest.json` after extraction.

**Install from Source**

See the [Development Documentation](docs/DEVELOPMENT.md) for details, including development commands, build differences, and architecture notes.

### For Human Users

1. Open the Juso search page and select a search source. Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili, Yandex, and DuckDuckGo require no configuration (hidden by default, can be enabled via "Show" on the settings page); for site-specific searches, add a Site Engine (site + underlying engine) in the extension settings; API keys are only required when using AI search services.

Once done, you can search, switch between traditional engines, saved site-specific searches, and configured AI search services from a single entry point.

### For Local AI Agents

1. Follow the steps above to install and enable the extension in a **Chromium-based browser with Juso installed** (Chrome / Edge / Chromium, etc.). Using `engine-search` to retrieve from traditional search engines does not require configuring AI search services; API keys are only needed when invoking AI search APIs via `search --provider`.
2. Choose the skill based on your Juso installation method:
   - **Chrome Web Store Installation** (Recommended): Install or copy `skills/juso-search/` to your agent's skill directory, e.g., `.agents/skills/juso-search/`. The extension ID has a built-in default and generally requires no configuration.
   - **Development Build** (built via `npm run build:dev` yourself): Install or copy `skills/juso-search-dev/` to your agent's skill directory, e.g., `.agents/skills/juso-search-dev/`. The only difference between the two skills is the extension ID; choose as needed.
3. Only set `JUSO_EXTENSION_ID` or pass `--extension-id` if you are signing/packaging yourself (or if the extension ID differs from the default).
4. If auto-discovery fails to find the browser, or if the extension is installed on a non-default binary like Edge, point the executable path to **the browser instance where Juso is installed** (you can also specify the profile directory name):

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

You can also temporarily override: `python scripts/juso_search.py --chrome /path/to/browser --extension-id YOUR_EXTENSION_ID list-providers`.

Once done, local agents can list configured services, perform API searches with **explicit** service parameters, or retrieve from supported traditional search engines (Google, Bing, Baidu, Yandex, DuckDuckGo, Bilibili, Xiaohongshu, Douyin) via the browser, without accessing stored keys.

## Security & Data Boundaries

- AI search service keys are managed locally by the extension and stored in `chrome.storage.local`; only the background service worker reads them. UI pages do not read stored keys, and local AI agents do not gain access to these keys.
- When authentication is required, keys are sent to the AI search service you select; queries reach the AI search service or traditional search engine you choose.
- Juso's current local mode does not operate a request relay service, nor does it send telemetry. However, browsers, networks, traditional search engines, and AI search services may log requests; Juso cannot guarantee anonymity or control the logging practices of these third parties.
- Configuration export is user-triggered and includes unencrypted keys and preferences. Exported files are sensitive and are your responsibility to safeguard; Juso does not operate configuration backup or credential sync services.

## Agent Interface & Boundaries

Agents invoke a single restricted operation in the extension background via a short-lived, loopback-only Agent Bridge, rather than connecting to a persistent local API. Each invocation uses a new local port, token, and request identifier, and becomes invalid upon completion or timeout.

`search` must provide `--provider` and will not silently follow the extension's current service. `engine-search` only extracts standard result links and does not promise AI summaries, knowledge panels, or other page content; once URLs are obtained, page scraping should be handled by the agent host's own capabilities like `web_fetch`. On launch or bridge failure, the JSON in standard output will include a structured `error.kind` (e.g., `chrome_not_found`, `chrome_launch_failed`, `extension_did_not_claim`, `extension_did_not_complete`); please follow prompts to check the browser path, profile, extension ID, and whether Juso is enabled in the open browser. Do not retry by exposing keys. `engine-search` will also fail on verification pages, consent pages, unsupported layouts, or when no results are found. See `skills/juso-search/SKILL.md` for the complete list of `kind` values.

## Development

See the [Development Documentation](docs/DEVELOPMENT.md) for details, including source installation, development commands, architecture notes, and testing guides.

## Potential Future Directions

This is not a roadmap or a promise. We may adapt more AI search services and traditional search engines based on demand, interface availability, and service stability; we may also explore optional multi-source parallel retrieval, deduplication, ranking, and result fusion with source attribution. Any such capabilities should allow users to explicitly control cost, scope, and wait time.

## Naming History

The project's original Chinese name was "Ju Sou" (聚搜), with the English name "Juso". Effective 2026-07-23 (after the v1.0.0 release), the Chinese name was changed to "Shuang Mian Sou" (双面搜), while the English name remains Juso. The brand is written as "双面搜 / Juso".

Reason for the change: "双面搜" (Dual-Side Search) directly aligns with the product's positioning as a "dual-side search"—one side for humans, one side for AI agents—and offers greater uniqueness in Chinese. The English name Juso is retained for its simplicity, memorability, and exclusive brand searchability (e.g., "Juso extension").

Code-level identifiers (package name `juso-search`, environment variables `JUSO_*`, CSS variables `--juso-*`, agent skill name `juso-search`) follow Juso and do not change with the Chinese name.

## Acknowledgments

Part of the approach for injecting the switch bar into Google / Bing / Baidu results pages in this extension—specifically, "inserting as the first child element of the results container to inherit width and simplify alignment," and "injecting a CSS shim into the host page to make room for the switch bar"—as well as the selection of injection anchors (`.head-contain` / `.search-input`) for Bilibili results pages, was inspired by [searchEngineJump Quick Search Engine Switch](https://greasyfork.org/zh-CN/scripts/27752-searchenginejump) (authors: NLF, Rui Jing, [qxin i](https://github.com/qxinGitHub/searchEngineJump), MIT License). This extension's implementation is independently written and shares no code with the original script.

## License

Juso's complete local search loop—comprising the current extension, source integrations, agent access, and local configuration & caching—is open-sourced under [MPL-2.0](LICENSE). This commitment does not imply that any future hosted or operational services will necessarily be open-source or free.
