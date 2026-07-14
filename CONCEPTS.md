# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Provider Adapter

### ProviderAdapter
A normalization interface that wraps each external search provider's API (Tavily, Exa, Stepfun) behind a uniform search contract that returns a NormalizedSearchResponse. Each adapter declares whether it supports synthesized answers and owns its transport (REST or MCP), auth header construction, response parsing, and error mapping. The background worker is the only caller — the UI never touches adapters directly.

### NormalizedSearchResponse
The shared data model returned by every ProviderAdapter, collapsing each provider's heterogeneous response into a uniform shape: the original query, the provider id, an optional synthesized answer, and an always-populated results list. The answer is present only when the provider supports synthesized answers (Tavily, Exa) and the request requested one. This is what the UI renders.

## Search Source (v2)

### Search Engine
A conventional web search engine (Google, Bing, Baidu) treated as a **navigation-only** target: it has no API key, no synthesized answer, and no `search()` method. Each engine is a self-contained behavioral adapter owning its SERP-URL building, canonical SERP recognition, query extraction, and SERP-injection anchor strategy; it sits in a registry parallel to providers. Engines are deliberately **not** merged into the `ProviderId` union, because that union is bound to the BYOK key read-path and the `ProviderAdapter.search()` contract — neither of which applies to an engine.

### Search Source
The unified view layer that lets one switcher bar render both configured AI providers and all engines homogeneously. Each source carries a kind discriminator (provider or engine), a display label, whether it supports synthesized answers, and (for engines) a favicon. Providers are filtered to those configured (same v1 rule); engines are always all shown. The id namespaces do not collide (providers: tavily/exa/stepfun/stepfun-plan; engines: google/bing/baidu). The SourceSwitcher component consumes this view in two places — the Juso search page and the injected SERP bar.

### Active Source
The user's default search source preference. It may point to a configured AI provider or to a keyless conventional engine, so it belongs to the source/UI layer rather than the provider/key layer.

An Active Source does not replace the Active Provider: provider sources keep both concepts aligned, while engine sources leave provider-only fallback state untouched. When provider keys disappear, the effective Active Source resolves through usable provider choices and then to a conventional engine, so the extension still has a usable default without sending engine ids into the provider adapter path.

### SERP Switch Bar
A search-source control embedded in a conventional Search Engine result page, allowing the current query to move between Search Engines and configured AI providers without first opening Juso.

It appears before the engine's complete result experience while aligning with that engine's main content column. Each Search Engine owns its placement rule so the control can remain outside replaceable or overlapping result internals. Engine choices navigate directly; provider choices hand off through a Deep Link.

### SERP Scope
The approved set of conventional Search Engine result pages on which the SERP Switch Bar may operate. Membership requires both an approved exact hostname and the engine's canonical secure result route; broad browser match syntax is only an injection boundary and does not itself make a page part of the SERP Scope.

SERP Scope controls where the bar mounts and remains deliberately separate from privileged cross-origin host access. Leaving the scope removes the bar; returning waits for the engine's placement anchor before remounting, and stale navigation waits are canceled.

### Deep Link
A `search.html?provider=X&query=Y` URL that drops the user into the Juso search page with a preselected provider and an auto-fired query. The SERP bar uses it when a provider chip is clicked from a regular search engine page; the page's mount effect parses it (provider must be configured to be honored, else falls back to the active provider). It lets the SERP bar hand off to the AI search experience in one current-tab navigation.

## Security

### BYOK
Bring Your Own Key. The extension stores the user's API keys exclusively in `chrome.storage.local` (`providerKeys` map). Stored keys are read only by the background service worker via worker-side storage helpers. UI pages may temporarily hold the newly typed key a user is saving, but they do not read the stored key map back from storage; they receive only sanitized provider configuration status through worker messages. Key values are never logged, telemetered, sent to third parties, or committed.

### Provider Configuration Status
The declassified status the UI needs to render provider and source choices without reading stored API keys. It includes configured provider IDs, the provider-only active provider, and the user-facing Active Source, returned by the background worker through messaging. Provider execution surfaces use it to hide unconfigured providers; source selection surfaces combine configured providers with always-available engines; API-key configuration surfaces still list all known providers so users can add new keys.

### Config Export
A user-initiated backup of the extension's configuration (provider keys, active provider, Active Source, theme, locale) to a JSON file. The background worker assembles the payload and triggers the file download itself via the downloads API, so plaintext keys never enter page memory. The export file contains plaintext API keys and is owned by the user — the extension warns about its sensitivity but does not encrypt it. Import uses a preview-confirm flow: a dry-run shows what would change (keys to fill, prefs that differ), and the user confirms before preferences are overwritten. Keys are always non-destructive (fill empty slots only); preferences are opt-in.

## Behavioral Rules

### Active Provider
The provider selected for provider-backed searches. It is represented as a provider id, persisted by the background worker, and considered usable only when that provider is configured.

Changing the Active Provider is a stateful worker-side write, not just a UI highlight. UI flows that switch providers and then search must serialize the write before sending the search request, and in-flight switch/search controls should avoid competing writes that could desynchronize visible state from worker storage. It is deliberately narrower than Active Source: engines never become the Active Provider.

### UI Language Preference
The user's chosen language mode for extension UI text. `Auto` follows the browser UI language when the preference is applied; explicit language choices pin the app UI to that language even if the browser language differs. This preference is distinct from the resolved render language, because different preferences can produce the same visible language.

### Answer Capability Degradation (R5)
When the active provider does not support synthesized answers (Stepfun), the UI hides the "AI 回答" section and shows only the results list. The provider adapter's `supportsAnswer` field drives this. Tavily and Exa support answers; Stepfun (both REST and MCP surfaces) does not.

### Local Search Cache
The local, per-device cache of successful provider searches used to avoid repeat billing for the same search object. A search object is keyed by active provider plus normalized query (`providerId + normalizedQuery`), so providers do not share cached results. Cache hits return the stored normalized response without calling the provider; explicit refresh bypasses the cache and may incur provider billing.

### Search Cache Summary
The lightweight index entry shown in the history panel. It contains query, provider, timestamps, answer preview, and a few result title/url previews, while the replayable slim response is stored separately per cache entry. The panel reads summaries first and lazy-loads the full cached entry only when the user selects one.

## Storage Schema

### Storage Schema Domain
A logical partition of `chrome.storage.local` that has its own schema version stamp and migration registry, evolving independently of other domains. The project uses two: a small config domain (user keys and preferences) and a larger cache pool domain (the search result cache). When adding a new persistent storage key, it belongs to exactly one domain, and future shape changes to that key flow through that domain's migration chain — not a global migration. Worker startup checks each domain's version stamp (a single-key read) and runs pending migrations before any gateway handler touches storage; steady-state checks cost near zero because they short-circuit on the stamp alone.

## Billing

### Step Plan
Stepfun's token-based subscription plan. Searches via the MCP channel (`web_search`) consume the user's Step Plan Credit pool (monthly, 0.04 元 per call). This is distinct from Stepfun's pay-as-you-go REST API (`/v1/search`), which is metered independently. The extension exposes both as separate providers (`stepfun` = REST, `stepfun-plan` = MCP/subscription) so the user can pick whichever match their billing arrangement.
