---
title: "Locale preference updates must notify even when the resolved locale is unchanged"
date: 2026-07-06
category: docs/solutions/ui-bugs
module: "i18n / settings UI"
problem_type: ui_bug
component: tooling
symptoms:
  - "Clicking Chinese while language preference was Auto did not visibly move the active state from Auto to Chinese"
  - "The language switcher appeared as a compact topbar control instead of a persistent settings preference"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [i18n, locale, react-hooks, use-sync-external-store, settings-ui, chrome-storage]
---

# Locale preference updates must notify even when the resolved locale is unchanged

## Problem

Runtime UI language switching uses two related but different values: the user's language preference (`auto`, `zh_CN`, or `en`) and the resolved render locale (`zh_CN` or `en`). When `auto` already resolved to Chinese, clicking the explicit Chinese option changed the preference but not the resolved locale, so subscribers were not notified and the segmented control could keep showing `Auto` as active.

This surfaced while moving language selection out of the search/start page and into the options page as a persistent setting after API Key configuration.

## Symptoms

- Clicking `中文` while the active preference was `自动` could appear to do nothing when the browser UI language already resolved `auto` to Chinese.
- The search page topbar exposed language switching next to theme and settings, making it feel like a per-search quick action rather than a durable preference.
- The options page header also held the language control, instead of placing it with other settings content.
- The previous `A / 中 / EN` control reused theme-toggle styling and did not read like a settings-row language selector.

## What Didn't Work

- Using Chrome's native `browser.i18n.getMessage()` directly is not enough for runtime manual switching. Chrome chooses the locale from the browser UI language; extension JavaScript cannot ask it to render a different language on demand.
- Treating the language control as a topbar widget fixed access but not information architecture. Language behaves like a persisted app preference, so it belongs in settings content.
- Returning early when only the resolved locale stayed the same missed a real state change. React components subscribed through `useSyncExternalStore` consume `currentPref`, not only `currentLocale`, so `auto -> zh_CN` must notify even if both resolve to `zh_CN`.

## Solution

Move `LocaleToggle` out of the search page and the options header. Render it as the final options-page section, after API Key settings:

```tsx
// entrypoints/options/App.tsx
<section>
  <h2>{t(MSG.locale_group)}</h2>
  <LocaleToggle />
</section>
```

Remove the search-page topbar instance so the start/search page keeps only theme and settings actions:

```tsx
// entrypoints/search/App.tsx
<div className="topbar-actions">
  <ThemeToggle />
  <SettingsButton onClick={openSettings} />
</div>
```

Change `LocaleToggle` from terse hard-coded labels to localized full labels, and give it dedicated segmented-control styling rather than reusing `.theme-toggle`:

```tsx
const OPTIONS: { value: LocalePref; label: string }[] = [
  { value: 'auto', label: MSG.locale_auto },
  { value: 'zh_CN', label: MSG.locale_zh },
  { value: 'en', label: MSG.locale_en },
];

export function LocaleToggle() {
  const { pref, setPref } = useLocale();

  return (
    <div className="locale-toggle" role="group" aria-label={t(MSG.locale_group)}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={pref === opt.value ? 'active' : ''}
          onClick={() => setPref(opt.value)}
          aria-pressed={pref === opt.value}
        >
          {t(opt.label)}
        </button>
      ))}
    </div>
  );
}
```

Fix the i18n store by comparing the previous preference before deciding whether subscribers can be skipped:

```ts
export function setLocale(pref: LocalePref): void {
  const next = resolvePref(pref);
  const prevPref = currentPref;
  currentPref = pref;
  if (next === currentLocale && pref === prevPref && pref !== 'auto') return;
  currentLocale = next;
  for (const l of listeners) l();
}
```

The broader i18n model remains unchanged:

- `_locales/*/messages.json` are bundled into the app with `import.meta.glob` so UI code can switch languages at runtime.
- `LocalePref` stays as `auto | zh_CN | en`.
- `auto` resolves from `browser.i18n.getUILanguage()` when applied.
- Manifest name/description/title still follow Chrome's own `__MSG_*__` localization and cannot be manually overridden at runtime.

## Why This Works

The active button depends on `currentPref`; translated strings depend on `currentLocale`. Those are intentionally separate because `auto` is a preference, not a locale. In a Chinese browser, both `auto` and `zh_CN` can render Chinese, but they mean different future behavior.

Notifying subscribers when `currentPref` changes keeps `useSyncExternalStore` snapshots consistent with what React renders. The early return is still safe for true no-ops: repeated explicit clicks like `zh_CN -> zh_CN` can skip notification because neither the preference nor resolved locale changed.

Moving the control to the final settings section also matches the product model: language is a durable app preference, while the search page should focus on provider choice, search input, results, theme, and settings entry.

## Prevention

- Test preference-store subscriptions with cases where derived output is unchanged but the consumed snapshot changes. The regression test should assert listener notification for `auto -> zh_CN` when `auto` already resolves to `zh_CN`.
- Page tests should pin placement: options page shows the language section after API Key, search page does not render the language group.
- Component tests should assert visible labels and active state via accessible roles, not only implementation classes.
- When a store exposes both a preference and a resolved value, decide notification based on every value subscribers read, not only the most visible derived value.

Regression test added for the i18n store:

```ts
it('notifies subscribers when pref changes even if resolved locale stays the same', () => {
  vi.unstubAllGlobals();
  setLocale('auto');
  const listener = vi.fn();
  const unsubscribe = subscribeLocale(listener);

  setLocale('zh_CN');

  unsubscribe();
  expect(getCurrentLocale()).toBe('zh_CN');
  expect(getCurrentLocalePref()).toBe('zh_CN');
  expect(listener).toHaveBeenCalledTimes(1);
});
```

## Related Issues

- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — related i18n, persisted preference, storage, and listener-testing practices; this document covers the narrower UI bug where preference and resolved locale diverge.
- `docs/plans/2026-07-01-001-product-ai-search-for-humans-plan.md` — product structure for search and options entrypoints.
