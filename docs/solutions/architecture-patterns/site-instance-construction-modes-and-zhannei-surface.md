---
title: "Site Instances: per-instance construction modes, migration-free options bag, and zhannei SERP surface"
date: 2026-09-08
category: architecture-patterns
module: "site-instances / engines / serp-handoff / storage"
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Upgrading a persisted user-defined source kind to multi-instance, where the same site scope can exist as several quick-switch targets"
  - "Adding per-instance options to an already-stored record additively, with read-side defaults for legacy rows and create-side defaults for new ones (no schema bump)"
  - "Decoupling URL construction from URL recognition so hand-typed or bookmarked queries (site: prefix, q1 parameter) still resolve to the right instance across modes"
  - "Admitting a new SERP host into the switch bar's SERP Scope as a synthetic surface engine without entering the engine registry or EngineId union"
  - "Extending a storage dedup key so per-instance variants of the same (engine, scope) coexist instead of silently dropping each other"
related_components:
  - lib/site-instances.ts
  - lib/engines/baidu-zhannei.ts
  - lib/engines/scopes.ts
  - lib/engines/registry.ts
  - lib/serp-handoff.ts
  - lib/storage/site-instance-store.ts
  - lib/gateway.ts
  - lib/config-io.ts
  - components/SiteInstanceManager.tsx
  - entrypoints/serp-bar.content.ts
  - entrypoints/search/App.tsx
tags:
  - site-instance
  - construction-mode
  - zhannei
  - bing-q1
  - additive-options
  - read-side-defaults
  - serp-scope
  - dedup-key
---

# Site Instances: construction/recognition decoupling, migration-free options, and a synthetic SERP surface

## Context

The 快切栏 (quick-switch bar) previously had a "Site Engine" concept: one saved record per site, whose URL construction was always a `site:scope query` prefix into the backing engine (google/bing/baidu), and whose SERP recognition *reused the same prefix*. That coupling was fine while construction had exactly one shape, but it capped the feature in two ways:

1. **No true site search.** Baidu's main-station `wd=site:host q` is a loose restriction, not a real site search. Baidu operates a dedicated 站内搜索 endpoint, `https://zhannei.baidu.com/cse/site`, with host-only `cc`, plus `sti` (time range), `sort=lds` (by time), `stp=1` (title only). Bing has a first-class advanced keyword param `q1` that carries `site:` operators separately from `q` and survives pagination/filter links.
2. **No multi-instance.** Dedup keyed on `(engineId, scope)` meant one site could have exactly one instance per engine — no "百度-zhannei-一周内" coexisting with "百度-zhannei-不限".

The session (plan `docs/plans/2026-09-08-001-site-instances-plan.md`; a pure-vocabulary rename commit, then the semantics commit, then review-fix commits) upgraded Site Engine to **Site Instance**: per-instance construction modes, zhannei filters, `zhannei.baidu.com` as a SERP scope the bar can mount on. Persisted config stayed read-compatible throughout: the `options` field defaults at read time, and the storage key / export field name were subsequently migrated to `siteInstances` by a schema-versioned rename (v9→v10) whose import path permanently accepts the legacy `siteEngines` field. The full test suite, typecheck, and lint stayed green; `npm run build` manifest auto-derived the zhannei match patterns.

The authoritative model now lives in `lib/site-instances.ts`:

```ts
export type BaiduSiteConstruction = 'zhannei' | 'query';
export type BingSiteConstruction = 'query' | 'q1';

export interface SiteInstanceOptions {
  mode?: BaiduSiteConstruction | BingSiteConstruction;
  zhannei?: ZhanneiFilters; // timeRange?: 60|1440|10080|43200; sortByTime?: boolean; titleOnly?: boolean
}

export interface SiteInstanceDefinition {
  id: SiteInstanceId;      // still `site:<uuid>` — persistence anchor
  name: string;
  target: string;          // canonical https URL
  engineId: 'google' | 'bing' | 'baidu';
  options?: SiteInstanceOptions; // purely additive — legacy records have none
}
```

Three facts about the persisted shape anchored the original design: the storage key **value** `'siteEngines'`, the config-export field name, and the id prefix `site:` — the three strings that Source Order / Visibility / Active Source / Group Layout all reference. Keeping them meant zero data migration and no schema bump. A post-review decision then migrated the first two to `siteInstances` (schema v9→v10 rename migration; imports permanently accept the legacy export field), because vocabulary consistency at the storage layer was judged worth one bounded migration — leaving the `site:` id prefix as the only deliberately untouched anchor, since it is a value threaded through four persistence axes, not a name.

## Guidance

### 1. Decouple URL construction from SERP recognition (KTD2)

`options.mode` is a **construction** concern only — it picks which URL `buildSiteInstanceUrl` produces. **Recognition** never consults it. `matchSiteInstanceFromUrl` resolves any SERP URL to a `(engineId, scope)` pair through three independent routes:

1. **zhannei route** — URL is a zhannei canonical SERP (`zhannei.baidu.com/cse/site`) → `cc` param is the host-only scope; candidates are all `engineId === 'baidu'` definitions whose scope equals it, matched **cross-mode**.
2. **bing q1 route** — `engine.id === 'bing'` and the URL carries a `q1` param → first `site:` operand (case-insensitive regex, since Bing treats operators case-insensitively) is the scope; matched against all bing definitions **cross-mode**.
3. **prefix fallback** — `engine.extractQuery(url)` yields a raw query; the old `site:scope ` prefix match (now `matchSiteInstanceQuery`, scope-driven, active-source-first ordering preserved).

```ts
// lib/site-instances.ts (essentials)
export function matchSiteInstanceFromUrl(engine, url, definitions, activeSourceId?, sourceOrder?) {
  // ① zhannei: cc is the host-only scope (URL parsed once).
  // ② bing q1: siteOperandFromBingQ1(url) — /(?:^|\s)site:(\S+)/i
  // ③ prefix: matchSiteInstanceQuery(engine.id, engine.extractQuery(url) ?? '', ...)
}
```

All three routes funnel into the same preference order (`pickByPreference`: active source → sourceOrder → first-seen) and return `{ siteId, baseQuery }`. Because routes ①/② read a *parameter* while route ③ reads a *prefix*, a user who hand-types `site:x q` on any engine — or hand-crafts `q1=site:x` — still gets the matching instance highlighted and a clean `baseQuery` for the next handoff. Legacy `site:` bookmarks keep working after the instance's mode changed.

### 2. Additive options bag with split read-side / build-side defaults (KTD1/KTD4)

`options` is an additive preference bag on an existing record type — the same options-bag precedent as `lib/provider-instances.ts`. The options bag itself needs no migration: old records simply lack `options`, and defaults are resolved by getters at read time (the project's Default-by-Getter convention, see `CONCEPTS.md`). (The schema bump in this change belongs to the storage-key rename, not to `options`.) Two default functions exist because two audiences exist:

```ts
// lib/site-instances.ts
/** 读侧默认 (legacy records without options) */
export function legacyDefaultConstruction(engineId) {
  return engineId === 'baidu' ? 'zhannei' : 'query';   // baidu: intentional behavior change (user-approved);
}                                                       // bing: behavior unchanged
/** 建侧默认 (UI form initial value + submit) */
export function formDefaultConstruction(engineId) {
  return engineId === 'baidu' ? 'zhannei' : engineId === 'bing' ? 'q1' : 'query';
}
/** Effective mode: legal explicit mode wins, else read-side default. */
export function constructionFor(definition) { /* ... */ }
```

The asymmetry is the point: legacy **baidu** instances migrate to the zhannei endpoint "for free" (an intentional, user-confirmed improvement — baidu scopes are host-only anyway, so nothing is lost), while legacy **bing** instances keep the `q=site:...` prefix so nothing visibly changes for anyone who didn't opt in. Newly *created* instances get the better default (`q1`). The UI always submits an explicit `mode` (`editorOptions` in `components/SiteInstanceManager.tsx`), so the moment a user edits and saves a legacy bing record, `query` becomes an explicit value — defaults are a read-time bridge, not a permanent ambiguity.

### 3. Whitelist degradation, never record rejection, never raw concatenation (KTD5)

`normalizeSiteInstanceOptions` treats `options` as untrusted input from storage/imports and degrades field-by-field instead of rejecting the record:

- `mode` not in the engine's allowed set → dropped (falls to read-side default);
- `timeRange` not in `{60, 1440, 10080, 43200}` → dropped;
- `sortByTime`/`titleOnly` materialize only when literally `true` (`false`/absent generate no URL param);
- unknown keys ignored; `google` with any options → options discarded entirely;
- zhannei filters materialize only when the *effective* construction is zhannei.

Nothing a user types ever becomes an arbitrary URL parameter: `buildSiteInstanceUrl` emits only whitelist-checked enum values and `encodeURIComponent`-encoded strings (`q`, and the whole `site:<scope>` operand for `q1`).

```ts
// lib/site-instances.ts (essentials of buildSiteInstanceUrl)
if (mode === 'zhannei') {
  let url = `https://zhannei.baidu.com/cse/site?q=${encodeURIComponent(baseQuery)}&cc=${target.hostname}`;
  if (filters?.timeRange != null) url += `&sti=${filters.timeRange}`;
  if (filters?.sortByTime === true) url += '&sort=lds';
  if (filters?.titleOnly === true) url += '&stp=1';
  return url;
}
if (mode === 'q1') {
  return `https://www.bing.com/search?q=${encodeURIComponent(baseQuery)}&q1=${encodeURIComponent(`site:${scope}`)}`;
}
return getEngine(definition.engineId).buildSerpUrl(buildSiteScopeQuery(scope, baseQuery)); // query mode + google
```

### 4. Synthetic surface engine for a new SERP host (KTD3)

The bar needs to mount on `zhannei.baidu.com/cse/site` result pages, but zhannei must **not** become a real engine: a bare zhannei pill without `cc` is meaningless, and every `allEngines()` consumer (快切栏 pills, context menu, agent engine list) would be polluted. The solution is a second `SearchEngine` object that exists only for URL matching:

```ts
// lib/engines/baidu-zhannei.ts
export const baiduZhanneiSurface: SearchEngine = {
  id: 'baidu',                                  // legal EngineId; backing-engine semantics hang off baidu
  matches(url) { return isSerpUrl(new URL(url), isZhanneiSerpHostname, '/cse/site'); }, // exact path
  extractQuery(url) { return new URL(url).searchParams.get('q'); },
  anchors: [{ selector: 'body', append: 'first' }], // conservative fallback; TODO(qa) real-device check
  /* buildSerpUrl/buildHomeUrl: minimal — nothing calls them */
};

// lib/engines/registry.ts — appended AFTER the main registry loop
export function matchEngineByUrl(url: string): SearchEngine | null {
  return allEngines().find((e) => e.matches(url)) ?? (baiduZhanneiSurface.matches(url) ? baiduZhanneiSurface : null);
}
```

Because the surface is not in the `engines` record, `allEngines()` (and everything it drives) never sees it. Downstream, `resolveSerpContext` (in `lib/serp-handoff.ts`) picks the surface's `id: 'baidu'` as `activeId` when no visible instance matches, and existing `shouldMountForEngine('baidu', ...)` semantics already handle "hidden bare engine + visible matching instance still mounts".

The host list is the single source of truth: adding `ZHANNEI_SERP_HOSTS = ['zhannei.baidu.com']` to `lib/engines/scopes.ts` and folding it into `SERP_HOSTS` + one `SERP_CONTENT_MATCH_PATTERNS` entry (`/cse/site`) auto-derived the MV3 manifest `content_scripts` matches, the favicon web-accessible-resource host patterns (via `SERP_HOST_MATCH_PATTERNS`), and challenge/consent detection — **`wxt.config.ts` was not touched at all**.

### 5. Dedup key refinement, applied in three places (KTD6)

Multiple instances per site require a finer dedup key: `(engineId, effective mode, scope, zhannei fingerprint)` joined with `\u0000`. `zhanneiFingerprintFor` produces a fixed-order fingerprint (`timeRange|sortByTime|titleOnly`, `''` when not zhannei), where unmaterialized `false` values hash the same as absent — so `timeRange: 10080` + `sortByTime: false` is the same instance as `timeRange: 10080`.

The new key is **strictly finer** than the old `(engineId, scope)`: any two records that collided before still collide (same effective mode + empty fingerprint) — so normalization can never drop *more* records than before — while same-scope records differing by mode or filters now legally coexist (AE5).

The key must be changed in **three** synchronized places; missing any one causes bugs of different severity:

| Place | Consequence if missed |
|---|---|
| `normalizeSiteInstanceDefinitions` (storage read) | **Silent data loss** — cross-mode records dropped on every storage read; the next create/update/delete rewrite wipes them (plan risk R-2, the most critical regression point) |
| `findDuplicateSiteInstanceScopes` (UI validate) | Stale false-positive duplicate errors block legitimate instances |
| gateway create/update duplicate check | API-level creation of true duplicates |

### 6. Two-phase rename: vocabulary first, semantics second (KTD7)

The Site Engine → Site Instance rename (~46 files: types, functions, store, messages, component, i18n) landed as its own commit with **zero behavior change** — all tests green, `git diff` semantically equivalent. The semantic feature, the review fixes, and the storage-name migration each landed separately, so reviewers bisecting a future regression can attribute any failure to a bounded commit. The rename initially stopped at three persistence anchors (`'siteEngines'` key value, export field name, `site:` id prefix); the follow-up decision migrated the first two (schema v9→v10 + import dual-accept) and kept only the `site:` id prefix untouched — it is a value woven through four persistence axes, where a rename means rewriting order/hidden/active/group data atomically for zero user-visible benefit.

## Why This Matters

- **Users keep their mental model.** A user who hand-types `site:52pojie.cn python` into Bing, or opens a months-old `site:` bookmark, still sees the right instance highlighted and clean base-query handoff. If recognition had been keyed to the construction mode, every mode switch, every legacy bookmark, and every manual URL would silently break highlighting — the failure mode would be "the bar just doesn't light up," which users report as "broken," not as "unrecognized."
- **Migration is a real cost — spend it on names, never on values.** Deferring all migration kept the feature shippable with no schema bump; when vocabulary consistency at the storage layer became a goal, the *affordable* migration was the key/field **name** rename (one bounded step, import dual-accept). The still-rejected alternative is migrating **values** — the `site:` id prefix threads through Source Order, Visibility, Active Source, and Group Layout, so renaming it means atomically rewriting four axes' data for zero user-visible benefit.
- **Data safety hinged on one function.** The R-2 risk (storage-read dedup dropping cross-mode records) is the kind of bug that ships silently: nothing errors, records just vanish on next write. The mixed legacy+new normalization test is the guard; anyone touching the dedup key must keep all three call sites in lockstep.
- **The surface pattern keeps registries honest.** `allEngines()` is consumed by pills, context menus, and the agent-facing engine list. A synthetic surface admitted only through `matchEngineByUrl` is how you get "this host is a SERP we understand" without "this host is a selectable engine" — two concerns that a registry entry would have conflated.
- **Read-side vs build-side defaults let migration be intentional per engine.** Baidu could adopt the better endpoint immediately (user-approved behavior change) while bing stayed bit-for-bit identical, in the same release, with one function pair.

## When to Apply

- **Adding a construction mode** (e.g., a future engine with a dedicated site param): extend the mode union and the engine's allowed-set, add a branch in `buildSiteInstanceUrl`, and — only if the mode carries its scope in a *URL parameter* — consider a recognition route in `matchSiteInstanceFromUrl`. Never make recognition depend on the saved mode. Update the dedup-key test matrix (defaults, degradation, cross-mode coexistence).
- **Surfacing a new SERP host that is not a standalone engine** (e.g., another engine's dedicated site-search subdomain): follow `baidu-zhannei.ts` — a `SearchEngine` object with the backing engine's `id`, exact-path `matches()`, appended to `matchEngineByUrl` after the registry, never in `allEngines()`. Add hosts to `scopes.ts` only; the manifest, favicon WAR, and challenge detection follow automatically.
- **Adding option fields to `SiteInstanceOptions`**: they must be additive and optional; extend the whitelist in `normalizeSiteInstanceOptions` (degradation, not rejection); decide explicitly whether read-side and build-side defaults differ; if the field affects instance identity, fold it into the dedup key/fingerprint in all three places and into the cross-mode normalization tests.
- **Any large vocabulary rename over persisted data**: split into a pure-rename commit (all tests green, semantically equivalent diff) followed by semantics. Enumerate persistence anchors *before* renaming and exclude them explicitly.
- **Whenever construction and recognition share a representation** (here, the `site:` prefix served both): introducing a second construction form is the moment to split them, before the second form exists — retrofitting after is far harder.

## Examples

**Before → after: one definition, three URLs.** A legacy record and the same site under new modes (`buildSiteInstanceUrl`, verified in `tests/site-instances.test.ts`):

```ts
// legacy baidu (no options) — read-side default zhannei, intentional change:
buildSiteInstanceUrl({ engineId: 'baidu', target: 'https://52pojie.cn' }, 'install')
// → 'https://zhannei.baidu.com/cse/site?q=install&cc=52pojie.cn'

// legacy bing (no options) — read-side default query, behavior unchanged:
buildSiteInstanceUrl({ engineId: 'bing', target: 'https://docs.example.com/guide' }, 'install')
// → 'https://www.bing.com/search?q=site%3Adocs.example.com%2Fguide%20install'

// new bing q1 + zhannei with filters:
buildSiteInstanceUrl({ engineId: 'bing', target: 'https://52pojie.cn', options: { mode: 'q1' } }, 'hello world')
// → 'https://www.bing.com/search?q=hello%20world&q1=site%3A52pojie.cn'
buildSiteInstanceUrl({ engineId: 'baidu', target: 'https://52pojie.cn',
  options: { mode: 'zhannei', zhannei: { timeRange: 10080 } } }, 'python')
// → 'https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn&sti=10080'
```

**Cross-mode recognition (KTD2, from `tests/site-instances.test.ts`).** Given zhannei-mode, query-mode, and q1-mode definitions for `52pojie.cn`, all three recognize regardless of how the URL was produced:

```ts
const defs = [
  { id: 'site:z-week', engineId: 'baidu', target: 'https://52pojie.cn',
    options: { mode: 'zhannei', zhannei: { timeRange: 10080 } } },
  { id: 'site:q', engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'query' } },
  { id: 'site:b-q1', engineId: 'bing', target: 'https://52pojie.cn', options: { mode: 'q1' } },
];

// ① zhannei cc → cross-mode highlight of a *query-mode* baidu instance:
matchSiteInstanceFromUrl(getEngine('baidu'), 'https://zhannei.baidu.com/cse/site?q=x&cc=52pojie.cn', defs, 'site:q')
// → { siteId: 'site:q', baseQuery: 'x' }

// ② hand-crafted q1 (not built by us) still recognizes:
matchSiteInstanceFromUrl(getEngine('bing'), 'https://www.bing.com/search?q=hello+world&q1=site%3A52pojie.cn', defs)
// → { siteId: 'site:b-q1', baseQuery: 'hello world' }

// ③ hand-typed prefix (any engine) keeps the legacy path:
matchSiteInstanceFromUrl(getEngine('bing'), 'https://www.bing.com/search?q=site%3A52pojie.cn+hello', defs)
// → { siteId: 'site:b-q1', baseQuery: 'hello' }
```

**The R-2 regression guard — mixed legacy + new collection must not lose records** (`tests/site-instances.test.ts`):

```ts
const normalized = normalizeSiteInstanceDefinitions([
  { id: 'site:legacy', engineId: 'baidu', target: 'https://52pojie.cn' },                    // effective zhannei, no filters
  { id: 'site:z', engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'zhannei' } }, // same key → dropped
  { id: 'site:q', engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'query' } },   // finer key → kept
  { id: 'site:b', engineId: 'bing',  target: 'https://52pojie.cn', options: { mode: 'q1' } },
]);
expect(normalized.map((d) => d.id)).toEqual(['site:legacy', 'site:q', 'site:b']);
// Under the old (engineId, scope) key, site:q and site:b would have been silently discarded.
```

**UI submits explicit options (KTD4 build-side)** — `components/SiteInstanceManager.tsx` always writes an explicit `mode`; `openEdit` seeds the form with `constructionFor(definition)` (read-side default) so editing a legacy record materializes its effective mode on save:

```ts
function editorOptions(editor: EditorFields): SiteInstanceOptions | undefined {
  if (editor.engineId === 'google') return undefined;
  const options: SiteInstanceOptions = { mode: editor.construction };
  if (editor.engineId === 'baidu' && editor.construction === 'zhannei') {
    /* timeRange/sortByTime/titleOnly — only truthy values included */
  }
  return options;
}
// submit → sendMessage('createSiteInstance', { name, target, engineId, options })
```

**Handoff integration** — `lib/serp-handoff.ts` signature changed from query-string to `(engine, url, ...)` so URL-parameter recognition could get in (KTD8); the site-instance handoff branch is now a single call:

```ts
export function resolveSerpContext(engine: SearchEngine, url: string, siteDefinitions, activeSourceId?, sourceOrder?, hiddenSourceIds?): SerpContext {
  const rawQuery = engine.extractQuery(url) ?? '';
  const match = matchSiteInstanceFromUrl(engine, url, siteDefinitions, activeSourceId, sourceOrder);
  const matchingSiteId = match && !hiddenSourceIds?.includes(match.siteId) ? match.siteId : null;
  return { baseQuery: match?.baseQuery ?? rawQuery, activeId: matchingSiteId ?? engine.id, matchingSiteId };
}

// resolveSerpHandoff, site-instance branch:
if (source.kind === 'site-instance' && source.siteInstance) {
  const url = buildSiteInstanceUrl(source.siteInstance, trimmed);
  return url ? { kind: 'navigate', url } : null;
}
```

Only `entrypoints/serp-bar.content.ts` (`loadBarState`, `applyConfigSnapshot`) calls `resolveSerpContext`; the search-page App goes through `resolveSerpHandoff` instead. When extending recognition, the tests to keep green are the prefix-path behavior snapshots in `tests/serp-handoff.test.ts` (google/bing prefix, raw `site:` fallback) — they are the pre-refactor regression baseline that R-1 called out.

**Verification chain** (per project conventions): `npm run typecheck && npm run lint && npm test` per phase; final `npm run build` with a manual check that `.output/chrome-mv3/manifest.json` content_scripts/web_accessible_resources contain the zhannei patterns. Outstanding by design: the zhannei anchor is a conservative `body`-first fallback pending real-device QA (`TODO(qa)` in `lib/engines/baidu-zhannei.ts`, plan R-3) — overlay bar positions (top/bottom) do not depend on anchors and were usable immediately.

## Related Docs

- [site-engine-third-source-and-safe-persistence](./site-engine-third-source-and-safe-persistence.md) — predecessor: the Site Engine source kind and the persistence invariants (trusted-read normalize, byte budget, post-write re-resolve) this feature inherits unchanged; vocabulary predates the rename.
- [provider-instance-multi-config-model](./provider-instance-multi-config-model.md) — the options-bag precedent this plan deliberately mirrors (KTD1).
- [google-bing-serp-scope-minimization](./google-bing-serp-scope-minimization.md) — the SERP host allowlist and the derive-manifest-matches-from-one-list rule that `ZHANNEI_SERP_HOSTS` extends.
- [adding-search-engine](./adding-search-engine.md) — the full registry-registration counterpoint; the synthetic surface is the minimal alternative when a host must NOT become a selectable engine.
- [dynamic-source-stale-navigation-guard](../design-patterns/dynamic-source-stale-navigation-guard.md) — post-write re-resolve guard the site-instance handoff branches follow (`resolveCurrentSiteInstanceHandoff`).
- [pref-value-redefinition-migration](./pref-value-redefinition-migration.md) — the Default-by-Getter boundary framing the no-schema-bump choice.
- [source-graph-new-type-threading-data-loss](../logic-errors/source-graph-new-type-threading-data-loss.md) — why keeping the storage key / id prefix means the four persisted source axes need zero migration.
- [hidden-source-still-active-across-hosts](../ui-bugs/hidden-source-still-active-across-hosts.md) — the visibility-vs-active mount semantics R5 reuses for the zhannei surface.
- [custom-engine-arbitrary-url-source-type](./custom-engine-arbitrary-url-source-type.md) — sibling source kind; its Site-vs-Custom comparison predates the three construction modes.
- [serp-switch-bar-and-unified-source-model](./serp-switch-bar-and-unified-source-model.md) — the unified SearchSource model and recognition/mount path this extends.
