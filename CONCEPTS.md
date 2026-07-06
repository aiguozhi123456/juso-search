# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Provider Adapter

### ProviderAdapter
A normalization interface that wraps each external search provider's API (Tavily, Exa, Stepfun) behind a uniform `search(query, opts, key): NormalizedSearchResponse` contract. Each adapter declares `supportsAnswer: boolean` and owns its transport (fetch or MCP), auth header construction, response parsing, and error mapping. The background worker is the only caller — the UI never touches adapters directly.

### NormalizedSearchResponse
The shared data model returned by every ProviderAdapter: `{ query, provider, answer?, results: NormalizedResult[] }`. The `answer` field is present only when the provider supports synthesized answers (Tavily, Exa) and the request requested one. The `results` array is always populated. This is what the UI renders.

## Security

### BYOK
Bring Your Own Key. The extension stores the user's API keys exclusively in `chrome.storage.local` (`providerKeys` map). Stored keys are read only by the background service worker via worker-side storage helpers. UI pages may temporarily hold the newly typed key a user is saving, but they do not read the stored key map back from storage; they receive only sanitized provider configuration status through worker messages. Key values are never logged, telemetered, sent to third parties, or committed.

### Provider Configuration Status
The declassified status the UI needs to render provider choices without reading stored API keys. It includes configured provider IDs and the active provider ID, returned by the background worker through messaging. Search and active-provider selection surfaces use it to hide unconfigured providers; API-key configuration surfaces still list all known providers so users can add new keys.

## Behavioral Rules

### UI Language Preference
The user's chosen language mode for extension UI text. `Auto` follows the browser UI language when the preference is applied; explicit language choices pin the app UI to that language even if the browser language differs. This preference is distinct from the resolved render language, because different preferences can produce the same visible language.

### Answer Capability Degradation (R5)
When the active provider does not support synthesized answers (Stepfun), the UI hides the "AI 回答" section and shows only the results list. The provider adapter's `supportsAnswer` field drives this. Tavily and Exa support answers; Stepfun (both REST and MCP surfaces) does not.

## Billing

### Step Plan
Stepfun's token-based subscription plan. Searches via the MCP channel (`web_search`) consume the user's Step Plan Credit pool (monthly, 0.04 元 per call). This is distinct from Stepfun's pay-as-you-go REST API (`/v1/search`), which is metered independently. The extension exposes both as separate providers (`stepfun` = REST, `stepfun-plan` = MCP/subscription) so the user can pick whichever match their billing arrangement.
