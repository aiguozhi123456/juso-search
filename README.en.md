# Juso

[中文](README.md)

> **Search with equal focus on people and agents.**

Juso is an open-source, two-sided search product. It gives people one place to select and switch between conventional search engines and configured AI search services. It also lets local AI agents use AI search APIs through the same browser or search conventional engines. The extension manages credentials locally, while requests go directly to the service you select.

| For | What it does today |
| --- | --- |
| People | Aggregates conventional search engines with fast switching in both the Juso page and result pages |
| People | Turns AI search APIs into a search experience that can fast-switch with conventional engines |
| Local AI agents | Provides one access path to configured AI search APIs |
| Local AI agents | Searches conventional engines through a real browser |

## Current Capabilities and Sources

Juso presents a **Search Source** as one user-facing choice. A source can be a conventional **Search Engine** or a configured AI search service; those two types use different execution paths.

- Conventional Search Engines: Google, Bing, and Baidu. They use no API key; Juso navigates a browser for people to use directly or for agents to extract ordinary search results.
- AI search services: Tavily, Exa, Stepfun pay-as-you-go API, and Stepfun Step Plan. They are accessed through a normalized adapter interface, while each service retains its own authentication and billing.
- Answer capability: Tavily and Exa can return a synthesized answer with a result list. Both Stepfun sources currently return result lists only.

In the current release, “aggregation” means unified access, selection, and fast source switching. It does **not** mean a query retrieves from several sources in parallel by default, nor that results are merged, deduplicated, or fused by default.

## For People

The independent search page lets you choose and switch Search Sources. On supported Google, Bing, and Baidu result pages, the SERP Switch Bar can move the current query to another search engine or hand it off to Juso’s AI search page.

Successful AI searches are cached on the current device and appear in local search history that can be reviewed and replayed. Cache entries are scoped to a service plus normalized query, and are not shared across services. Use explicit refresh when you need fresh results; it bypasses the cache and may incur charges from the selected AI service.

## Quick Start

Juso v1.0.0 is available for adopters comfortable with manual installation and configuration. Install the extension through Installation and Updates first, then continue with how you intend to use it.

### People

1. Install and enable the extension through Installation and Updates.
2. Open the Juso search page and choose a Search Source. Google, Bing, and Baidu need no configuration; configure the corresponding key in extension settings only when using an AI search service.

You can now search and switch among Google, Bing, Baidu, and your configured AI search services from one entry point.

### Local AI Agents

1. Install and enable the extension as above. `engine-search` needs no AI search service configuration; configure the corresponding service only when calling an AI search API through `search --provider`.
2. Install or copy `skills/juso-search/` into your agent’s skills directory, for example `.agents/skills/juso-search/`.
3. Open `chrome://extensions` (`edge://extensions` in Edge), enable Developer mode, and copy the 32-character ID shown on the Juso extension card.
4. Set that value as `JUSO_EXTENSION_ID`, or provide it with `--extension-id`:

```powershell
$env:JUSO_EXTENSION_ID = "YOUR_EXTENSION_ID"
```

```bash
export JUSO_EXTENSION_ID="YOUR_EXTENSION_ID"
```

5. Run commands from the skill directory, for example:

```bash
python scripts/juso_search.py list-providers
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

You can skip the environment variable and run `python scripts/juso_search.py --extension-id YOUR_EXTENSION_ID list-providers` instead. Loading another copy of the extension from a different directory may change its ID, so copy it again when needed.

The local agent can now list configured services, perform API searches with an **explicit** provider, or search Google, Bing, and Baidu through the browser—without receiving stored credentials.

## Installation and Updates

### Install v1.0.0

1. Download `juso-search-1.0.0-chrome.zip` from the [GitHub Release v1.0.0](https://github.com/aiguozhi123456/juso-search/releases/tag/v1.0.0).
2. Extract the ZIP.
3. Open `chrome://extensions` in Chromium, enable Developer mode, choose **Load unpacked**, and select the extracted directory that directly contains `manifest.json`.

### Install from Source

1. Clone the repository and install dependencies: `npm install`.
2. Build the production extension: `npm run build`.
3. Follow the **Load unpacked** flow above and select `.output/chrome-mv3/`.

Developer-mode installation triggers browser warnings. Until browser-store distribution exists, updates require manually downloading the new ZIP (or rebuilding), replacing the loaded directory, and reloading the extension from the extensions page.

## Security and Data Boundaries

- The extension manages AI search-service credentials locally in `chrome.storage.local`; only the background service worker reads them. UI pages do not read stored keys, and local AI agents do not receive them.
- When authentication requires it, a credential is sent to the AI search service you select. Queries reach the selected AI service or conventional Search Engine.
- In its current local mode, Juso operates neither a request proxy nor telemetry. Browsers, networks, conventional search engines, and AI search services may still record requests; Juso cannot guarantee anonymity or control those third parties’ logging practices.
- Configuration export is user-initiated and includes unencrypted credentials and preferences. The export is sensitive and remains in your custody; Juso operates no configuration-backup or credential-sync service.

## Agent Interface and Limits

Agents invoke bounded extension-worker actions through the Agent Bridge: a short-lived, loopback-only capability channel, not a persistent local API. Every invocation uses a new local port, token, and request identity, and expires on completion or timeout.

`search` requires `--provider`; it never silently follows the extension’s current provider. `engine-search` extracts ordinary result links only and does not promise AI summaries, knowledge panels, or other page content. Once an agent has a URL, page retrieval belongs to its host’s own capability, such as `web_fetch`. Commands fail when Chrome cannot launch, the extension cannot connect, a timeout occurs, or the protocol is rejected; engine searches also fail on challenges, consent pages, unsupported layouts, and no results. Check the extension ID, browser setup, and provider configuration—do not retry by exposing keys.

## Development and Current Architecture

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm test
npm run test:python
npm run lint
```

- `entrypoints/search/`: independent human search page, source switching, cache, and history.
- `entrypoints/options/`: local credentials and Search Source preferences.
- `entrypoints/background.ts` and `lib/gateway.ts`: background service, message gateway, and bounded Agent Bridge actions.
- `lib/providers/`: adapters and normalized response model for Tavily, Exa, Stepfun pay-as-you-go, and Step Plan.
- Search Engines and the SERP Switch Bar: real-browser navigation, result-page switching, and ordinary-result extraction, on an execution path distinct from API services.
- `lib/storage.ts`: local configuration, source preferences, cache, and user-initiated configuration exports.

## Possible Future

This is not a roadmap or a promise. Based on demand, interface availability, and service stability, Juso may adapt more AI search services and conventional search engines. It may also explore optional parallel retrieval from multiple sources, deduplication, ranking, and provenance-preserving result fusion. Any such capability should give users explicit control of cost, scope, and latency.

## License

Juso’s complete local search loop—the current extension, source integrations, agent access, local configuration, and cache—is open under [MPL-2.0](LICENSE). This commitment does not imply that possible future hosted or operational services will be open source or free.
