---
title: "Theme persistence, BYOK key hygiene, and i18n parity in a WXT/React MV3 extension"
date: 2026-07-04
category: docs/solutions/best-practices
module: "theme / i18n / storage layer"
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Building a WXT + React Chrome MV3 extension with persisted UI state"
  - "Storing secrets (BYOK API keys) in chrome.storage.local accessed from page code"
  - "Localizing with Chrome native browser.i18n alongside JS message constants"
  - "Implementing cross-tab state sync via storage.onChanged"
tags: [wxt, mv3, dark-theme, fouc, i18n, browser-i18n, chrome-storage, byok, react-hooks, matchmedia]
---

# Theme persistence, BYOK key hygiene, and i18n parity in a WXT/React MV3 extension

## Context

A multi-reviewer code review (ce-code-review) on a freshly built dark-theme + bilingual-i18n feature surfaced 10 findings spanning correctness, security, reliability, and testability. None were P0/P1, but several partially broke the feature's core UX contract or breached the project's own documented security invariant. The fixes — committed across two review-labelled commits — encode a set of durable practices for any WXT/React MV3 extension that persists UI state, holds secrets, or localizes via Chrome's native i18n. This doc captures those practices so the next feature in this area gets them right on the first pass.

The repo conventions (AGENTS.md): use the typed `browser` global, not `chrome`; BYOK API keys live only in `chrome.storage.local` and are read **only** by the background service worker; the UI never holds or sends plaintext keys.

## Guidance

### 1. Apply persisted UI theme before first paint (FOUC prevention)

A theme preference read inside a React `useEffect` applies **after** the first paint, so a user with a persisted `pref='dark'` on a light OS sees a white→dark flash on every cold reload. Fix it with a tiny inline `<head>` script that sets `data-theme` synchronously from the media query, then corrects it from storage:

```html
<!-- entrypoints/<page>/index.html <head> -->
<script>
  (function () {
    try {
      var d = document.documentElement;
      var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      d.dataset.theme = sysDark ? 'dark' : 'light';   // synchronous, before paint
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('themePref', function (r) {  // async correct
          var p = r && r.themePref;
          if (p === 'light' || p === 'dark') d.dataset.theme = p;
        });
      }
    } catch (e) { /* fall back to :root light tokens */ }
  })();
</script>
```

The inline script uses `chrome.storage` (not `browser`) deliberately: WXT's `browser` global is module-injected and unavailable to inline HTML. Guard with `typeof chrome`. The React hook then takes over `data-theme` maintenance after mount.

Once `data-theme` is reliably written pre-paint, the `@media (prefers-color-scheme: dark)` CSS override becomes redundant — keep **one** dark-token source (`:root[data-theme="dark"]`), not two.

### 2. Scope storage reads from page code (BYOK key hygiene)

A storage accessor that does `browser.storage.local.get(null)` materializes the **entire** store — including secrets — into whichever context calls it. Even if the function only returns a scalar, the full object (e.g. `providerKeys`) transits page-realm memory. This breaches a "keys read only by worker" invariant even though no key is *returned*.

```ts
// ❌ getThemePref() used readAll() -> get(null): providerKeys landed in page memory
const all = await readAll();
return all[THEME_KEY];

// ✅ scope the read to only the key needed
const got = await browser.storage.local.get(THEME_KEY);
return got[THEME_KEY];
```

Rule: any storage accessor reachable from page/entrypoint code should scope its `get()` to the specific keys it needs — never `get(null)`. Reserve full-store reads for the worker.

### 3. Derive derived state; don't dispatch it from multiple sites

When a value (`resolved` theme) is a pure function of inputs (`pref` + system preference), derive it with `useMemo` rather than calling `setResolved` from three different effects. Multiple write sites are the shape that drifts: an effect, a listener, and an optimistic handler can each compute from a stale snapshot.

```ts
// inputs as state; systemDark is its own state so matchMedia changes re-trigger
const [pref, setPrefState] = useState<ThemePref>('auto');
const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

// single derived value, single DOM-write effect
const resolved = useMemo(() => resolve(pref, systemDark), [pref, systemDark]);
useEffect(() => { document.documentElement.dataset.theme = resolved; }, [resolved]);
```

### 4. Roll back optimistic state when persistence fails

`void persistPref(next)` with no rejection handler gives an unhandled rejection **and** silent state/storage divergence: the UI shows the new value, storage keeps the old one, `onChanged` never fires, and the UI silently reverts on reload with no signal.

```ts
const setPref = (next: ThemePref) => {
  const prev = pref;
  setPrefState(next);                          // optimistic
  void persistPref(next).catch(() => setPrefState(prev));  // roll back on failure
};
```

### 5. Guard every `window.matchMedia` call site, not just one helper

If a `systemPrefersDark()` helper guards against missing `matchMedia`, every **other** call site of `window.matchMedia` in the same module needs the same guard. One unguarded call throws synchronously during React commit; with no ErrorBoundary anywhere, that unmounts the whole tree to a blank page. An inconsistency between a guarded helper and an unguarded call site three lines away is the tell that the guard was forgotten, not deliberately trusted.

```ts
useEffect(() => {
  if (pref !== 'auto') return;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return; // ← don't skip this
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  ...
}, [pref]);
```

### 6. Add a structural parity test for multi-source i18n

Chrome-native i18n has three manually-synced sources: the JS message-name constants (`MSG`), `_locales/<default>/messages.json`, and `_locales/<other>/messages.json`. The `t()` fallback (`msg || messageName`) renders the **raw key name** to users when a key is missing or its `message` is empty — a silent production failure. Lock it with one structural test:

```ts
import { MSG } from '@/lib/i18n';
import zh from '../../public/_locales/zh_CN/messages.json';
import en from '../../public/_locales/en/messages.json';

it('every MSG constant exists in both locales', () => {
  for (const key of Object.values(MSG)) {
    expect(Object.keys(zh)).toContain(key);
    expect(Object.keys(en)).toContain(key);
  }
});
it('zh_CN and en have identical key sets', () => { /* diff keys */ });
it('no locale has an empty message value', () => { /* truthy check */ });
```

Also: in page/component tests, load the **real** `messages.json` for the i18n mock instead of hand-copying a subset string map — a subset map with a `?? name` fallback masks forgotten keys.

### 7. Capture event listeners in tests; don't stub them inert

An `onChanged`/`addEventListener` stub of `addListener: vi.fn()` is a no-op: the listener callback is never captured, so the entire branch is dead from a test's standpoint and a regression there passes CI. Capture the listener instead, then fire it:

```ts
function mockOnChanged() {
  const listeners = new Set<(c: unknown) => void>();
  vi.stubGlobal('browser', {
    storage: { onChanged: {
      addListener: (l: (c: unknown) => void) => listeners.add(l),
      removeListener: (l: (c: unknown) => void) => listeners.delete(l),
    } },
  });
  return listeners;  // test fires: act(() => listeners.forEach(l => l({ themePref: { newValue: 'dark' } })))
}
```

## Why This Matters

Each class has a concrete observable consequence, not a theoretical one:

- **FOUC** partially breaks the theme feature's core contract — a "persisted manual dark mode" that flashes white on every reload reads as broken to the user.
- **Unscoped storage reads** put plaintext API keys in page-realm memory on every page mount, breaching the security invariant the storage module itself documents, widening the surface for any compromised page script.
- **Raw-key UI rendering** (missing i18n key) is a silent production failure — no test fails, the user just sees `error_service_unavailable` instead of localized text.
- **Unguarded `matchMedia`** blanks the entire page in any matchMedia-less context, with no recovery affordance (no ErrorBoundary).
- **Optimistic state without rollback** produces silent state/storage divergence that reverts on reload with no signal.
- **Inert listener stubs** leave cross-tab sync — a shipped, user-visible feature — with zero effective coverage.

## When to Apply

- Any **WXT / Chrome MV3 React extension** with persisted UI state (theme, density, layout).
- Any **secret held in `chrome.storage.local`** where page code also accesses storage (BYOK, tokens).
- Any **Chrome-native i18n** (`browser.i18n` + `_locales`) used alongside JS message constants or `__MSG_` manifest substitution.
- Any **cross-tab state sync** via `storage.onChanged`, or any feature wired through event listeners you intend to test.
- Any **derived React state** computed from multiple asynchronous inputs.

## Examples

### Scoped storage read (before/after)

```ts
// before — pulls providerKeys into page memory
export async function getThemePref(): Promise<ThemePref> {
  const all = await readAll();               // browser.storage.local.get(null)
  const stored = all[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

// after — only the theme key transits page memory
export async function getThemePref(): Promise<ThemePref> {
  const got = await browser.storage.local.get(THEME_KEY);
  const stored = got[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}
```

### i18n parity test skeleton

```ts
describe('i18n locale parity', () => {
  it('every MSG constant exists in both locales', () => {
    for (const key of Object.values(MSG)) {
      expect(Object.keys(zh), `MSG key "${key}" missing from zh_CN`).toContain(key);
      expect(Object.keys(en), `MSG key "${key}" missing from en`).toContain(key);
    }
  });
  it('no locale has an empty message value (would fall back to raw key)', () => {
    for (const [key, entry] of Object.entries({ ...zh, ...en })) {
      expect((entry as { message?: string }).message, `${key} has empty message`).toBeTruthy();
    }
  });
});
```

## Related

- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` — same extension, different area (provider adapter normalization); low overlap.
- `CONCEPTS.md` — `BYOK`, `ProviderAdapter` entries define the trust invariant and adapter contract referenced above.
