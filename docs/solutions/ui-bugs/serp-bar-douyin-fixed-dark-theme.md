---
title: "Douyin SERP Bar Forces Dark Theme via engine.serpTheme"
date: 2026-09-13
last_updated: 2026-09-13
category: ui-bugs
module: "serp-bar / content-script"
problem_type: ui_bug
component: ux
severity: low
symptoms:
  - "Douyin SERP quick-switch bar renders with a white background on Douyin's always-black page"
  - "Bar readability/contrast breaks only when the user's theme preference (or auto→prefers-color-scheme) resolves to light"
root_cause: incomplete_implementation
resolution_type: code_fix
tags:
  - serp-bar
  - douyin
  - theme
  - shadow-dom
  - data-theme
  - engine-contract
related_components:
  - entrypoints/serp-bar.content.ts
  - entrypoints/shared/serp-bar-styles.ts
  - lib/engines/types.ts
  - lib/engines/douyin.ts
  - tests/engines.test.ts
---

# Douyin SERP Bar Forces Dark Theme via `engine.serpTheme`

## Problem

The SERP bar's shadow host carries `data-theme` derived purely from the user's
theme preference (`getThemePref()` → `resolveTheme`, `auto` resolving via
`prefers-color-scheme`). The bar stylesheet (`serp-bar-styles.ts`) switches
token palettes on `:host([data-theme=...])`. Douyin's SERP page is always
black, but with a light preference the bar rendered with the light palette
(`--bg: #ffffff`) — a white bar on a black page.

## Solution

Engines now declare the host SERP page's fixed color scheme as part of the v3
engine adapter contract (alongside `anchors` / `pageStyles`):

```ts
// lib/engines/types.ts
readonly serpTheme?: 'light' | 'dark';
// lib/engines/douyin.ts
serpTheme: 'dark',
```

The bar consumes it at the single theme resolution point:

```ts
// entrypoints/serp-bar.content.ts, loadBarState()
resolvedTheme: engine.serpTheme ?? resolveTheme(themePref),
```

`loadBarState` runs at initial mount and on every SPA remount, and `onMount`
writes `state.resolvedTheme` to the host's `data-theme`, so all mount paths are
covered. No CSS changes were needed: the dark colorful palette, focus rings,
and the top/bottom overlay frosted backgrounds (`color-mix` on `var(--bg)`)
all key off `:host([data-theme="dark"])` and inherit automatically.

**Why `data-theme` instead of a `:host([data-engine="douyin"])` CSS token
override:** duplicating the dark token block (plain + colorful) keyed by engine
would fork every future token addition into two selector variants and depend on
attribute-selector ordering for cascade precedence. The attribute is the
existing single switch; setting it at the source keeps one theme mechanism.

Known unchanged behavior: `data-theme` is written only at mount; theme
preference changes do not live-sync into open SERP tabs (pre-existing, see the
`serpBarPosition` live-sync comment in `serp-bar.content.ts`). On Douyin the
forced theme is a constant, so no new inconsistency is introduced.

## Prevention

- When a host page's appearance is fixed (not user/configurable), express that
  as engine metadata (`serpTheme`) rather than hardcoding engine ids in the
  content script or forking CSS token blocks per engine.
- `tests/engines.test.ts` locks the contract: Douyin declares
  `serpTheme: 'dark'`; no other engine declares one — update both sides when
  another fixed-color SERP appears.
