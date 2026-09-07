---
title: "Locale switch froze page text outside the header toggle (subscription + module-scope evaluation)"
date: 2026-09-08
category: docs/solutions/ui-bugs/
module: "i18n / extension-page React trees"
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Clicking the header language toggle flipped the toggle's own state (and Wordmark), but all page body text (every t() call) stayed in the previous language until a full reload"
  - "Pure-CSS demos rendering locale-keyed data (e.g. the typing demo's query text) kept typing the old language's text after switching"
  - "<html lang> and document.title flipped correctly and immediately on every toggle — the bug looked half-fixed and was visible only in React-managed text nodes"
root_cause: missing_association
resolution_type: code_fix
severity: medium
tags: [i18n, locale, react, use-sync-external-store, re-render, subscription, module-scope]
---

# Locale switch froze page text outside the header toggle (subscription + module-scope evaluation)

## Problem

The Juso extension's three extension HTML pages (search / options / onboarding) have a header language switcher (`components/LocaleToggle.tsx`). Toggling UI language re-rendered only the switcher itself (and the `Wordmark`) — every other piece of page text stayed in the OLD language until a full page reload. Meanwhile `document.title` and `<html lang>` DID update live, because each page's `main.tsx` subscribes a plain DOM side-effect (`applyDocumentLocale`) to `subscribeLocale` directly, outside React (see `entrypoints/onboarding/main.tsx:26-32`). That half-updating state masked the bug.

Two root causes:

1. **Missing root-level subscription.** `lib/useLocale.ts` exposes `useLocale()` built on React's external-store primitive:

   ```ts
   // lib/useLocale.ts:39
   const pref = useSyncExternalStore(subscribeLocale, getCurrentLocalePref, getCurrentLocalePref);
   ```

   `useSyncExternalStore` re-renders ONLY the component that calls it. Before the fix, only `components/LocaleToggle.tsx` and `components/Wordmark.tsx` called `useLocale()`. The translation function `t()` in `lib/i18n.ts` is a plain lookup with no reactivity — it reads the module-level locale and returns a string:

   ```ts
   // lib/i18n.ts:112,120
   export function t(messageName: string, substitutions?: string | string[]): string {
     ...
     return lookup(getResolvedLocale(), messageName) || lookup('en', messageName) || messageName;
   }
   ```

   So no other component in the tree ever re-rendered when `setLocale()` fired its listeners (`lib/i18n.ts:73-81`).

2. **Module-level locale-dependent constants.** Demo components such as `entrypoints/onboarding/WelcomeDemo.tsx` computed their locale-keyed content object at MODULE scope — evaluated once at import time — so even a re-render would have kept serving stale strings.

## Symptoms

- Clicking the language toggle in the header flipped the toggle's own active state and the wordmark, but all page body text (`t(MSG.*)` results in App and every child component) stayed in the previous language.
- Pure-CSS animation demos that render locale-keyed data (e.g. the typing demo in `WelcomeDemo` rendering `copy.query`) kept typing the OLD language's text.
- `document.documentElement.lang` and `document.title` flipped correctly and immediately on every toggle — the bug looked "half fixed" and only visible in React-managed text nodes.
- A full page reload restored the correct language (fresh module evaluation + fresh subscription), which made the bug easy to mistake for a caching issue.

## What Didn't Work

Fixing only layer 2 — converting the module-scope `COPY` constant into a render-time function — changed nothing observable on the onboarding page. The App itself never re-rendered on locale change, so `COPY()` was never invoked again; it would have kept returning the same frozen render output either way.

This was caught by programmatic CDP sampling, not eyeballing: after clicking the English toggle, `document.documentElement.lang` flipped to `'en'` while the demo text still read Chinese — proving the DOM side-effect had fired but the React tree had not. Only after adding the root subscription did the sampled text flip live.

Lesson: verifying via `<html lang>`/`document.title` (the side-effect path) would have reported "fixed" for the layer-2-only change. The React text nodes themselves are the only valid probe.

## Solution

Two coordinated changes, applied to all three pages:

**1. Root-level `useLocale()` subscription** — one line (+ import) at the top of each page's root component, so a locale change re-renders the whole tree:

- `entrypoints/onboarding/App.tsx:30`
- `entrypoints/search/App.tsx:43`
- `entrypoints/options/App.tsx:122`

```tsx
// entrypoints/onboarding/App.tsx:28-30
// 根级订阅 locale：切语言时整树重渲染（t() 与各演示的 COPY() 渲染时求值随动），
// 否则只有 header 的开关自身刷新、正文与演示停在旧语言。
useLocale();
```

**2. Render-time evaluation of locale-derived content** — convert module-level locale-derived constants into functions invoked during render, and derive per-render values in the component body, never at module scope:

```tsx
// entrypoints/onboarding/WelcomeDemo.tsx:20-21 (now a function, not a const object)
const COPY = () =>
  getCurrentLocale() === 'zh_CN'
    ? { query: '双面搜 Juso', /* ... */ }
    : { query: 'Juso search', /* ... */ };

// entrypoints/onboarding/WelcomeDemo.tsx:72-73 (called inside the component)
const copy = COPY();
const queryChars = Array.from(copy.query);
```

Verified live bidirectional switching (en↔zh) via CDP sampling: page title, footer button labels, demo query text, and demo sentences all flip without reload. Typecheck, lint, all 67 test files, and build pass.

## Why This Works

- `useSyncExternalStore` notifies exactly its subscribers — nothing else. The i18n module keeps a plain `Set<() => void>` of listeners (`lib/i18n.ts:42`) and `setLocale()` calls each one (`lib/i18n.ts:80`); a listener added by a leaf widget re-renders only that leaf. Locale is page-scoped global state, so the React subscription must sit at the tree root for the re-render cascade to cover all `t()` call sites — a root re-render re-invokes every child's render, where each `t(MSG.*)` re-reads the now-current locale.
- Render-time evaluation guarantees locale-keyed strings (`COPY()`, `Array.from(copy.query)`, `AI_ACK_LINKS[getCurrentLocale()]` in the options About page) are read against the CURRENT locale on every render. Both layers are required: the subscription without render-time evaluation leaves stale module constants; render-time evaluation without the subscription never re-runs.

## Prevention

- **Audit one-liner:** `rg -n "useLocale(" entrypoints` — every page App root (`entrypoints/{search,options,onboarding}/App.tsx`) must appear. A subscription that lives only in leaf widgets (LocaleToggle, Wordmark) silently freezes the rest of the page.
- **Rule:** anything derived from volatile global state (locale, theme, time) must be computed during render, never at module scope. Module-scope evaluation is a freeze hazard even when re-rendering works — it silently snapshots global state at import time.
- **Do not trust document-level side effects as evidence of React updates.** The `applyDocumentLocale` subscription in each page's `main.tsx` (setting `<html lang>` and `document.title`) made the bug look half-fixed. When verifying reactivity fixes, assert on React-rendered text nodes themselves (e.g. via CDP-sampled element text), not on DOM side effects wired outside React.

## Related Issues

- [Locale preference updates must notify even when the resolved locale is unchanged](locale-preference-subscription-state.md) —— 互补的另一半：其 store 侧规则（`setLocale` 在偏好变化即使 resolved locale 不变时也必须通知订阅者）+ 本文 consumer 侧规则（每个页面 App 根必须 `useLocale()`、文案渲染时求值），合起来才是完整的 locale 重渲染正确性。
- [Theme persistence & i18n key hygiene](../best-practices/theme-persistence-i18n-key-hygiene.md) —— 两文共享的运行时 i18n 模型底座（`_locales` 经 import.meta.glob 打包、localePref 的 worker 广播、MSG/_locales 对齐测试）。
- [Provider switch keeps current query and async state consistent](provider-switch-current-query-and-async-state.md) —— 同族问题：React 可见状态因别处状态变化而陈旧，需要显式订阅/同步而非假设级联。
