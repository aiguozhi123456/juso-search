# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Provider Adapter

### ProviderAdapter
A normalization interface that wraps each external search provider's API behind a uniform search contract that returns a NormalizedSearchResponse. Each adapter declares whether it supports synthesized answers and owns its transport (REST or MCP), auth header construction, response parsing, and error mapping. The background worker is the only caller — the UI never touches adapters directly.

### NormalizedSearchResponse
The shared data model returned by every ProviderAdapter, collapsing each provider's heterogeneous response into a uniform shape: the original query, the provider id, an optional synthesized answer, and an always-populated results list. The answer is present only when the provider supports synthesized answers (Tavily, Exa) and the request requested one. This is what the UI renders.

## Search Source (v2)

### ProviderId / EngineId / SourceId
The three parallel identity sets of the source model: provider ids (key-backed API integrations), engine ids (keyless navigable search engines), and source ids (the union of both plus user-defined Site Engines, Custom Engines, Provider Instances, and preset AI Engines). The sets deliberately stay separate — provider-backed execution and engine navigation never share an id — and the only cross-cutting merge is SourceId, the composition point that the UI, storage, and the SERP Switch Bar all speak. Provider Instance ids enter SourceId but never ProviderId, preserving the BYOK boundary type.

### Search Engine
A conventional web search engine (Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili, …) that has no API key or synthesized-answer contract. Each engine owns its navigation behavior and remains parallel to providers rather than joining their execution contract.

Engine capability is layered, and membership in the engine identity set declares only navigation: every registered engine can be navigated to and can host the SERP Switch Bar, but exposing ordinary rendered SERP results through the separate browser-extraction path is a per-engine capability. Every registered engine now ships a real Engine Extractor (the placeholder path is retained but unused), and the Agent-facing search surface mirrors the full engine list through its allowlist; default visibility in the quick-switch bar remains the per-engine gate. Adding an engine is therefore several independent decisions — navigation registration, extraction support, Agent-surface inclusion, and default visibility — not one.

Each engine must emit its true canonical SERP URL (verified against the address the engine itself settles on after a real navigation): a non-canonical form that triggers a host-side redirect is an antifraud signal on engines like Yandex and can turn every navigation into a verification wall. The agent-bridge client (Python skill) discovers the engine set at runtime via the `list-engines` bridge action, so a newly extraction-capable engine is exposed to agents automatically once the worker registry includes it — no manual mirror to keep in sync.

Search Engines are deliberately not merged into the provider identity set: provider-backed searches use stored credentials and normalized APIs, while engine search navigates a real browser page and extracts only natural result metadata. Some engines may ship default-hidden in Source Visibility via a one-shot schema migration so they appear in management UI but not in the quick-switch bar until the user shows them.

### Search Source
The unified user-facing representation of a configured AI provider, a conventional Search Engine, a Site Engine, a Custom Engine, or an AI Engine, allowing the same source controls to present all five despite their different execution contracts.

### Site Engine
A user-saved Search Source that searches a chosen public site by navigating a fixed conventional Search Engine (Google, Bing, or Baidu) with a `site:` scope. It is not a BYOK provider and not a first-class engine registry entry: each definition stores a display name, a create-time-fixed underlying engine, and a normalized public hostname target (path depth allowed depends on that engine). Dynamic source ids use the `site:<uuid>` form so Source Order, Source Visibility, Active Source, and the SERP Switch Bar treat them like other sources.

Trusted local reads normalize Site Engine collections item-by-item and must not empty the collection solely because a size or count budget is exceeded; untrusted imports use a strict bound check; mutations reject writes that would exceed the serialized budget. Selecting a Site Engine on the search page or SERP bar re-resolves the definition after the active-source write so concurrent Options edits or deletes cannot navigate with a stale or deleted scope.

### Custom Engine
A user-saved Search Source that navigates an arbitrary search URL built from a stored URL template with a `%s` query placeholder, mirroring the browser's built-in custom search engines. It is not a BYOK provider and not a first-class engine registry entry: each definition stores a display name and an http(s) URL template containing exactly one `%s`. Dynamic source ids use the `custom:<uuid>` form so Source Order, Source Visibility, Active Source, and the SERP Switch Bar treat them like other sources. Unlike a Site Engine, a Custom Engine has no backing engine, no SERP extractor, and is not part of the SERP Scope (the switch bar is never injected into a custom engine's own page); its navigation is per-surface — same-tab from the search page, new-tab from the SERP Switch Bar so the current results page is preserved.

Custom Engine collections share the Site Engine storage invariants: trusted local reads normalize item-by-item and never empty solely for a size or count budget; untrusted imports use a strict bound check; mutations reject writes that would exceed the serialized budget. Selecting a Custom Engine re-resolves the definition from fresh configuration before navigating so concurrent Options edits or deletes cannot navigate with a stale or deleted template.

### Provider Instance
A user-saved Search Source that binds a base ProviderId to a per-instance options bag, letting the same BYOK provider run under multiple tuned variants (e.g. one Exa instance for AI research, another for startup news). It is not a new provider type and not a new adapter — it reuses its base provider's adapter and API key. Dynamic source ids use the `inst:<providerId>:<uuid>` form so Source Order, Source Visibility, Active Source, and the SERP Switch Bar treat them like other sources, but instance ids enter SourceId and never ProviderId — the gateway resolves an instance id to its base provider id plus options at the boundary, so the BYOK key path (getAdapter/getKey) only ever sees a ProviderId.

A provider with instances projects one pill per instance in the quick-switch bar and does not project a bare provider pill. The default instance is implicit-first (no defaultInstanceId field) — a bare provider search routes to the first instance's options, and deleting a non-sole instance makes the next one the default automatically. The sole instance for a provider cannot be deleted (protects the default) but can be hidden. When a provider key is configured, a default instance is auto-created (empty options = adapter defaults) so every instance-supporting provider always has ≥1 instance — the model is uniform, no bare pill ever appears for these providers. Re-adding a deleted key does not create a duplicate (the auto-create checks for existing instances). Keys configured before this feature existed — or filled by config import, which never re-saves a key — are covered by a lazy backfill on config read: any instance-supporting provider that is configured yet has zero instances gets its default instance filled the next time configuration is pulled (worker-side, BYOK-safe; idempotent; self-heals storage edited back to zero instances). Provider Instance collections share the Site Engine and Custom Engine storage invariants (trusted-read normalize, strict import bound, serialized mutation queue). The agent bridge exposes instances through additive v2 actions (search-instance, list-instances) that do not widen the v1 search action's ProviderId-typed field; the v1 list-providers reply includes an optional hasInstances flag so agents can discover whether to call list-instances.

### AI Engine
A preset Search Source that navigates an AI chat site (DeepSeek, ChatGPT, Gemini, Doubao, Grok) carrying the current query, so a search can be handed off to an AI conversation without retyping. It is not a BYOK provider (no API key, no normalized search contract) and not a conventional Search Engine (no SERP URL, no extractor, no Switch Bar mounting on its own page) — an AI Engine is a conversation-navigation target. Preset source ids use the `ai:<slug>` form so Source Order, Source Visibility, Active Source, and the SERP Switch Bar treat them like other sources.

Execution is layered into three mechanisms behind one `execution` discriminated union. **url-only** sites natively prefill and auto-submit from a `?q=` URL parameter and need no injection. **inject** sites need a content script: the light variant is prefilled natively but requires a synthesized Enter to submit; the full variants must wait for the SPA input element, fill it through the editor-appropriate path (native value setter for plain textareas, execCommand for contenteditable rich-text editors, innerText for MutationObserver-synced editors), then submit — contenteditable editors may require clicking the send button or dispatching a `beforeinput` event rather than a synthetic Enter keydown. Auto-submit on inject sites is gated by an `enter=1` URL contract: `?q=` alone means native prefill only (no submit), while `?q=&enter=1` means prefill plus auto-submit. An `aiAutoEnter` toggle (default ON) controls whether the extension appends `enter=1` when building inject-type navigation URLs; the content script reads the `enter` param (strict `=== '1'`) to decide whether to submit, so no worker round-trip is needed on page load. The registry stays pure data and is the single source of truth for `injectorKey` (typed as an `InjectorKey` literal union), and the content script maps host → engineId → the registry's injectorKey → injector function, so DOM-touching code never enters the worker/UI-shared registry. Injection is additionally gated on Source Visibility: before filling, the content script asks the worker whether that engine is shown (not in the hidden set), and silently skips when hidden or when the check fails (fail-closed) — so a `?q=` link to a never-enabled engine never auto-submits.

AI Engines ship default-hidden via a one-shot schema migration because each requires a logged-in session; the user shows them in the quick-switch bar management surface. They are deliberately not merged into the EngineId set (which binds SERP URL/anchor/extractor contracts an AI site cannot satisfy) nor implemented as Custom Engines (preset hardcoded definitions have a different lifecycle from user-stored `custom:<uuid>` records). Selecting an AI Engine on the search page navigates same-tab like a conventional engine; on the SERP Switch Bar it opens a new tab without persisting the active source, mirroring the Custom Engine precedent so the current results page is preserved.

### Source Order
The user's preferred ordering of the complete known Search Source set, independent of which provider-backed sources are currently visible.

Unconfigured providers may disappear temporarily without being removed from the preference, and return to their prior relative position when configured again (the implicit axis of Source Visibility). Missing future sources are appended deterministically, while direct edits and configuration imports share one serialized mutation boundary.

### Source Visibility
The user's explicit choice of which Search Sources appear in the quick-switch bar, modeled as a sparse set of hidden sources that is independent of Source Order and independent of the Active Source.

Visibility has two independent axes. The implicit axis hides a source automatically while it lacks a configured key, and restores it when configured. The explicit axis is this user-chosen hide, which can remove any configured provider or engine regardless of key state. Only the explicit axis is a stored preference; both are applied as a final projection at render time, never persisted as the rendered list itself. A hidden source remains a valid Active Source and remains listed on configuration management surfaces so it can be shown again; the hide set is sparse, so normalization never re-adds sources the user removed.

Hiding is orthogonal to the Active Source at the **storage** layer — hiding never mutates the persisted Active Source, so unhiding restores the user's original choice. But at the **display and execution** layer a hidden Active Source must be reselected: the active highlight, the search target, the active-source selector, and the decision to mount the SERP Switch Bar on a hidden engine's own page must all fall back to a visible source. The reselect is a derived view, never a persisted write, so storage orthogonality composes cleanly with a coherent display.

### Active Source
The user's default search source preference. It may point to a configured AI provider, a keyless conventional engine, or a preset AI Engine, so it belongs to the source/UI layer rather than the provider/key layer.

An Active Source does not replace the Active Provider: provider sources keep both concepts aligned, while engine sources leave provider-only fallback state untouched. When provider keys disappear, the effective Active Source resolves through usable provider choices and then to a conventional engine, so the extension still has a usable default without sending engine ids into the provider adapter path.

### Source Group Layout
A pure layout layer over the projected Search Source set that decides which sources are pinned flat in the quick-switch bar's top row versus collapsed into labeled groups. It does not change which sources exist, which are visible, or their underlying Source Order — it only re-projects the already-projected source list into a mixed sequence of pinned pills and collapsible group pills.

The same projection also drives the right-click context-menu search tree, so pinned/grouped choices stay consistent between the bar and the menu: any surface that mirrors the source switcher reads this layout, not a per-surface copy.

Every source is in exactly one of two states: **pinned** (a top-row flat pill) or **grouped** (folded into a group). The five built-in groups — search engines, sites, AI search, API search, custom — always exist, and a source with no explicit assignment falls through to its type group, so the out-of-box experience needs no persisted assignments. The config is self-healing: any value read from storage is re-normalized against the live source set before use, dropping references to deleted/hidden sources and deleted groups. It is orthogonal to Source Order, Source Visibility, and Active Source. A group's internal order is its own explicit member order (per-group `groupOrders`), decoupled from the global Source Order; a group without an explicit order falls back to the Source Order projection filtered, so pre-grouping configs behave identically. Sorting controls live only in the layout editor (drag-and-drop with arrow-button fallback for touch), not on the quick-switch bar.

An adaptive rule dissolves the grouping layer entirely when grouping provides no separation value: when the visible source set is small, or when every visible source shares a single group, all sources project as flat top-row pills instead of folded ones. Grouping returns once the source set is numerous enough to crowd a flat row, or once a second bucket appears and grouping starts separating again; a preference gates the behavior.

### Pinned Group Flyout
A group flyout opened by clicking its group trigger, which stays open regardless of hover — as opposed to the hover/focus transient flyout that closes when the pointer leaves. The click-pin interaction is unified across the search-page top bar and the SERP bar's three placement modes (inline, top overlay, bottom overlay).

Lifecycle: a click creates the pin (directly, or by converting a hover-transient flyout); only explicit actions close it — clicking the trigger again, Escape, pointerdown outside the group, selecting a source inside the flyout, or scroll-hiding the SERP bar overlay. At most one group is open at a time and a pinned group is always the open group; hovering another group clears the pin, and hovering back does not restore it.

### SERP Switch Bar
A search-source control embedded in a conventional Search Engine result page, allowing the current query to move between Search Engines and configured AI providers without first opening Juso.

It appears before the engine's complete result experience while aligning with that engine's main content column. Its integration rules keep the control outside replaceable or overlapping result internals without covering native page interactions. Engine choices navigate directly; provider choices hand off through a Deep Link.

On slow SPA SERPs, the bar re-resolves ordered placement anchors on each mount, remounts with a budget when the host is detached by the page, and upgrades placement only from a last-resort fallback—not between intermediate anchors—so the control does not jump vertically as optional shells appear later.

The bar has **three placement models**, selected by a user preference (`auto` / `top` / `inline` / `bottom`). The **inline** model is per-engine anchor insertion: the shadow host is a sibling of a persistent results container, horizontally aligned to the engine's main content column. The **top** and **bottom** models are universal fixed viewport overlays (`position: fixed; top: 0` / `bottom: 0`) with page-padding shims so the fixed bar does not cover content; they ignore per-engine anchors entirely and mount the shadow host to `document.body` to escape site stacking and containing-block contexts. In `auto` mode the bar resolves to **inline** on desktop viewports and **bottom** on narrow viewports (≤480px). The overlay variants support scroll-to-hide (the bar slides out on downward scroll and returns on upward scroll or near page top) and mobile polish (safe-area insets, horizontal chip scroll, active-chip centering).

### Selection Search
A cursor-anchored floating popup shown after selecting text on any webpage, letting the user hand the selected text to the active or a chosen Search Source without leaving the page. Distinct from the SERP Switch Bar (which operates on Search Engine result pages) and from the right-click context menu: the popup appears at the pointer and its flyout pick is one-shot — choosing a source from the flyout searches once and closes without changing the user's default source.

The popup's primary action uses the fixed-source preference when one is set, otherwise falls back to the Active Source, then the first visible source; the fixed-source preference is a UI-layer setting that never alters the persisted Active Source.

### SERP Scope
The approved set of conventional Search Engine result pages on which the SERP Switch Bar may operate. Membership requires both an approved exact hostname and the engine's canonical secure result route; broad browser match syntax is only an injection boundary and does not itself make a page part of the SERP Scope.

SERP Scope controls where the bar mounts and remains deliberately separate from privileged cross-origin host access. Leaving the scope removes the bar; returning waits for the engine's placement anchor before remounting, and stale navigation waits are canceled.

### Deep Link
A `search.html?provider=X&query=Y` URL that drops the user into the Juso search page with a preselected provider and an auto-fired query. The SERP bar uses it when a provider chip is clicked from a regular search engine page; the page's mount effect parses it (provider must be configured to be honored, else falls back to the active provider). It lets the SERP bar hand off to the AI search experience in one current-tab navigation.

## Security

### Agent Bridge
A short-lived, loopback-only capability channel that lets a local Agent invoke selected extension-worker actions without receiving the extension's stored secrets.

Each invocation uses a new local port, token, and request identity. The protocol is a claim/complete/abort triple: the agent claims a single bounded request on the loopback endpoint, the worker validates sender and request, executes the one action, and reports completion; if the bridge page cannot process the fragment (e.g. version mismatch) or the worker rejects the claim (e.g. invalid provider/engine id), it sends an abort so the skill fails fast instead of waiting for timeout. The bridge disappears after completion, abort, or timeout; it is not a persistent local API or a source of long-term identity.

The bridge ships disabled by default behind a two-layer opt-in: a total switch gates the entire bridge, and a separate sub-switch gates only the engine-search action, which can drive the browser to load third-party search-engine pages and extract their public results. A capability that silently loads third-party pages on an external process's behalf must be opt-in, not default-on.

The temporary `bridge.html` page is fire-and-forget: after claim success or failure it closes itself. It should not remain the focused tab: the page deactivates itself immediately after open, and Agent SERP tabs are created inactive (with a best-effort re-assert) so skill invocations do not steal the user’s current page. Worker-side host APIs such as `fetch` must be injected with a bound/wrapped call form when stored on a deps object, because bare method extraction from `WorkerGlobalScope` throws Illegal invocation.

### Engine Extraction Error
A structured failure returned by browser-powered Search Engine search when no usable natural results are obtained. Kinds split into two groups Agents must branch on separately:

- **Page-state** — the SERP (or interstitial) itself: `challenge`, `consent`, `unsupported-layout`, `no-results`.
- **Orchestration** — temporary-tab lifecycle around extraction: `tab-closed`, `timeout`, `aborted`, `extract-failed`.

Page-state kinds mean “do not trust this page’s organic list as empty success.” Orchestration kinds mean “the tab or handshake failed before a trustworthy page-state decision.” Collapsing orchestration into `unsupported-layout` misroutes recovery (for example treating a user-closed tab as a DOM-layout bug).

### Engine Extractor
The per-engine DOM reader that turns a rendered Search Engine result page into natural result metadata (title, url, snippet). Each Search Engine registers exactly one extractor; they run in the content-script context of the temporary search tab and are pure DOM functions over the live page. A failure to produce usable results surfaces as an Engine Extraction Error, never as an empty success.

### BYOK
Bring Your Own Key. The extension stores the user's API keys exclusively in `chrome.storage.local` (`providerKeys` map). Stored keys are read only by the background service worker via worker-side storage helpers. UI pages may temporarily hold the newly typed key a user is saving, but they do not read the stored key map back from storage; they receive only sanitized provider configuration status through worker messages. Key values are never logged, telemetered, sent to third parties, or committed.

### Provider Configuration Status
The declassified status the UI needs to render provider and source choices without reading stored API keys. It includes configured provider identities, the provider-only Active Provider, the user-facing Active Source, and the source-bar preferences the UI projects — Source Order, Source Visibility, Source Group Layout, and per-provider settings such as result count — returned by the background worker through messaging.

Provider execution surfaces hide unconfigured providers; source selection surfaces project visible choices from Source Order; API-key configuration surfaces still list all known providers so users can add new keys.

### Config Export
A user-initiated JSON backup of provider keys and user preferences, including Active Source and Source Order. The background worker assembles and downloads it so plaintext keys never enter page memory; the file remains sensitive, user-owned, and unencrypted.

Import uses a preview-confirm flow. Keys only fill empty slots, preference replacement is opt-in, and preferences absent from an older file do not overwrite values introduced by newer versions.

### Agent Skill
A standalone, distributable Python package (`SKILL.md` plus `scripts/`) that lets a general-purpose local Agent invoke selected extension-worker capabilities — primarily search and engine-search — through the Agent Bridge. It is published in two variants (prod and dev) generated from a single-source template, and is also bundled inside the extension as a downloadable zip. It is the Agent-facing counterpart to the Agent Bridge: the Skill is what the Agent runs, the Bridge is the MV3 channel those runs speak over.

### Juso Bridge (`juso_bridge.py`)
The single-source Python module shared by the Agent Skill's CLI and the MCP Server that implements the loopback HTTP client for the Agent Bridge protocol (claim/complete/abort, fragment parsing, process cleanup, reply-shape validation). It is vendored byte-identically into the prod and dev published Skill directories and the MCP package, with a drift test locking all copies equal — so the Skill CLI and the MCP Server can never silently disagree on the protocol. Distinct from "Agent Bridge," which is the extension-side channel; `juso_bridge.py` is the client that speaks it.

### MCP Server
An independently published pip package (`juso-search`) that exposes the same Agent Bridge actions as MCP tools over stdio, so MCP-native Agent clients can call them without the Skill CLI. It reuses `juso_bridge.py` as its transport (hence the byte-equality drift lock), maps each bridge action to one MCP tool, and shares the bridge's vocabulary through runtime discovery rather than a duplicated allowlist. It is the third Agent delivery surface alongside the bundled Skill zip and the published Skill directories.

## Behavioral Rules

### Active Provider
The provider selected for provider-backed searches. It is represented as a provider id, persisted by the background worker, and considered usable only when that provider is configured.

Changing the Active Provider is a stateful worker-side write, not just a UI highlight. UI flows that switch providers and then search must serialize the write before sending the search request, and in-flight switch/search controls should avoid competing writes that could desynchronize visible state from worker storage. It is deliberately narrower than Active Source: engines never become the Active Provider.

### UI Language Preference
The user's chosen language mode for extension UI text. `Auto` follows the browser UI language when the preference is applied; explicit language choices pin the app UI to that language even if the browser language differs. This preference is distinct from the resolved render language, because different preferences can produce the same visible language.

### UI Style Preference
The user's chosen visual language for extension surfaces, independent of the resolved light/dark theme.

It propagates to every participating UI surface; embedded surfaces follow it without owning a separate preference.

### Page Atmosphere
The full-viewport brand canvas behind extension HTML pages — classic soft brand glows or a low-contrast colorful categorical gradient — owned by the document rather than a width-constrained content column.

Search start layout and options layout may center or grid content independently; atmosphere stays document-level so both entrypoints share one product shell.

### Options Settings Group
A top-level partition of the options page that shows only a related subset of settings sections at a time (search setup, credentials, general preferences).

Groups are an information-architecture shell: they do not replace individual preference keys or worker messaging. Switching groups changes which sections mount; it does not scroll a single long form.

### Answer Capability Degradation (R5)
When the active provider does not support synthesized answers, the UI hides the "AI 回答" section and shows only the results list. The provider adapter's `supportsAnswer` field drives this: only providers whose adapter declares answer support render the section, so the capability list is owned by the adapters, not by any fixed enumeration.

### Local Search Cache
The local, per-device cache of successful provider searches used to avoid repeat billing for the same search object. A search object is keyed by active provider plus normalized query, so providers do not share cached results. Cache hits return the stored normalized response without calling the provider; explicit refresh bypasses the cache and may incur provider billing.

The cache key is a subset of the inputs that produced the cached value. When a stored setting influences the response shape (e.g. per-provider result count), the key does not include it — so writes to that setting must invalidate the cache, or cache hits silently return responses with the stale shape. The cache also caps how many results it stores per entry; that cap must be at least the maximum the adapter is allowed to return, or a cache hit returns fewer results than the live miss did.

### Search Cache Summary
The lightweight index entry shown in the history panel. It contains query, provider, timestamps, answer preview, and a few result title/url previews, while the replayable slim response is stored separately per cache entry. The panel reads summaries first and lazy-loads the full cached entry only when the user selects one.

## Storage Schema

### Storage Schema Domain
A logical partition of `chrome.storage.local` that has its own schema version stamp and migration registry, evolving independently of other domains. The project uses two: a small config domain (user keys and preferences) and a larger cache pool domain (the search result cache). When adding a new persistent storage key, it belongs to exactly one domain, and future shape changes to that key flow through that domain's migration chain — not a global migration. Worker startup checks each domain's version stamp (a single-key read) and runs pending migrations before any gateway handler touches storage; steady-state checks cost near zero because they short-circuit on the stamp alone.

## Storage Concurrency

### Storage Mutation Queue
A module-level promise chain that serializes read-modify-write cycles against the extension's local storage, one queue per mutable storage collection, so concurrent operations cannot interleave their read and write phases (lost updates). Write functions that join a queue are the only sanctioned way to mutate that collection; cross-module writers (such as config import) call the same exported queue helpers rather than writing directly.

Its protection comes entirely from every writer closing over the same single queue instance — a second copy of the queue (a forked module graph or duplicated queue code) silently reintroduces races with no error. Lock order: an operation that touches both the source graph and provider keys or provider instances must acquire the source-graph queue first, then the inner queue. Consumers reach queue-guarded functions through the storage barrel only; deep imports into its domain modules are lint-banned because they can duplicate the module graph and fork the queues.

## Billing

### Step Plan
Stepfun's token-based subscription plan. Searches via the MCP channel (`web_search`) consume the user's monthly Step Plan Credit pool, metered per call. This is distinct from Stepfun's pay-as-you-go REST API (`/v1/search`), which is metered independently. The extension exposes both as separate providers (`stepfun` = REST, `stepfun-plan` = MCP/subscription) so the user can pick whichever matches their billing arrangement.

### Dual-provider pattern
Shipping one provider brand as two adapters that share a single icon, label family, and error mapping when the brand has two billing or API surfaces (pay-as-you-go REST vs. a subscription channel): Stepfun/Stepfun Plan and Doubao/Global are both built this way. The adapters stay separate providers so the user picks whichever matches their billing arrangement; the shared identity is presentation only.

## Drift Prevention

### Drift-lock
A CI test that asserts two manually-maintained copies of the same source stay byte-identical (binary assets) or value-identical (text tokens), turning silent drift into a red build.

The project's drift-lock family includes the `juso_bridge` byte-equality locks (generated copies), the website token value-equality lock, and the website asset byte-equality lock. A drift-lock splits its assertions into a must-match set (copies that should be identical) and an intentional-divergence set (copies that legitimately differ, like marketing-only fonts or shadows); a lock without this split either misses real drift or cries wolf. Drift-lock is the "lock the copy" strategy, distinct from "generate the copy" (single source + generator, where drift is impossible by construction) — lock when the copy is consumed at build time by a static pipeline, generate when it could be read at runtime.

## Website (marketing site)

### Face
The product's two-audience presentation model ("双面搜"): a human face for people searching directly, and an agent face for local AI agents searching through the same browser. The marketing site mirrors this structure — a neutral overview presents both faces as equal doorways, and each face owns its own section route on the site.

## Flagged ambiguities

- "pinned" 在快切栏领域有两个独立含义：Source Group Layout 的"置顶平铺"（layout pinned —— source 直接平铺顶行，与之相对的是折叠进分组）与 Group Flyout 的"点击固定展开"（flyout pinned —— 已展开浮层不随 hover 收起）。前者决定 source 是否进分组，后者决定浮层的关闭时机，互不干扰。
