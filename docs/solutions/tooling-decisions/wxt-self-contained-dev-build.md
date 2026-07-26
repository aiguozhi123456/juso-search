---
title: WXT Self-Contained Development Build with Stable Extension ID
date: 2026-07-24
category: tooling-decisions
module: build
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - "Need a development build without requiring the Vite dev server to be running"
  - "Automated E2E tests need a predictable extension ID"
  - "Distributing a dev build to testers without dev server setup"
symptoms:
  - "ERR_CONNECTION_REFUSED WebSocket errors when dev server is not running"
  - "HTML files reference http://localhost:3000 for script loading"
root_cause: config_error
resolution_type: config_change
tags:
  - wxt
  - dev-server
  - build-mode
  - extension-id
  - signing-key
  - hmr
---

# WXT Self-Contained Development Build with Stable Extension ID

## Context

In a WXT + React Chrome extension (MV3), `npm run dev` produces a build tightly coupled to the Vite dev server: HTML files load scripts from `http://localhost:3000`, background and reload chunks open a WebSocket to `ws://localhost:3000` for HMR, and the manifest CSP whitelists that origin. Without the dev server running, the extension is broken — console floods with `ERR_CONNECTION_REFUSED` and `[wxt] Failed to connect to dev server`.

The project also embeds a development signing key in `manifest.json` so the extension keeps a stable ID across reloads. WXT gates this injection on `command === 'serve'`, meaning `wxt build` never includes the key — the extension gets a fresh random ID every load, breaking any flow that depends on a predictable extension ID (message passing from content scripts, storage isolation during testing, OAuth redirect URIs).

The need: a self-contained build artifact with no dev-server dependency that still carries the stable-ID signing key.

## Guidance

Use WXT's `--mode` flag to decouple "development configuration" from "dev server presence." The key insight is that WXT exposes two orthogonal axes:

- **`command`** — `'serve'` (dev server running) vs `'build'` (static output)
- **`mode`** — `'development'` vs `'production'` (controls `.env` loading, `import.meta.env.MODE`, and is available to the `manifest()` callback)

`wxt build --mode development` gives you `COMMAND === 'build'` (no dev server, no HMR, no localhost references) while `MODE === 'development'` remains available for conditional config.

Gate the signing key on `mode` instead of `command`:

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: ({ mode }) => ({
    ...(mode === 'development' ? { key: DEV_EXTENSION_KEY } : {}),
    // ...rest of manifest
  }),
});
```

Add a dedicated script:

```json
{
  "scripts": {
    "dev": "wxt",
    "build:dev": "wxt build --mode development",
    "build": "wxt build"
  }
}
```

This yields three distinct tiers:

| Command | Signing key | Dev server | Output dir | Use case |
|---|---|---|---|---|
| `npm run dev` | yes | yes (HMR) | `.output/chrome-mv3-dev` | Daily development with hot reload |
| `npm run build:dev` | yes | no | `.output/chrome-mv3-dev` | Self-contained, stable extension ID |
| `npm run build` | no | no | `.output/chrome-mv3` | Chrome Web Store submission |

## Why This Matters

- **Stable extension ID without a running server.** The `build:dev` artifact can be loaded as an unpacked extension on any machine, in CI, or in automated browser tests — no `wxt dev` process required, no `ERR_CONNECTION_REFUSED` noise, and the ID stays deterministic.
- **Clean separation of concerns.** Production builds remain pristine (no key, no dev artifacts). The signing key never leaks into store submissions.
- **No WXT internals patched.** The solution uses only the public `--mode` flag and the `manifest()` callback's `mode` parameter — no post-build sed hacks, no custom Vite plugins, no monkey-patching.
- **Virtual modules already guard HMR code.** WXT's generated WebSocket/HMR code is wrapped in `import.meta.env.COMMAND !== "serve"` checks, so a `build` command produces zero `localhost:3000` or `ws://` references regardless of mode. No additional tree-shaking configuration is needed.

## When to Apply

- You need to distribute or test a development build without requiring contributors/testers to run the dev server.
- Automated E2E tests (Playwright, Puppeteer) load the extension and need a predictable extension ID for `chrome.runtime.sendMessage` or storage assertions.
- You want to verify the extension behaves correctly without HMR noise (e.g., testing service worker lifecycle, offline behavior, or CSP enforcement).
- You are debugging whether a bug is HMR-related vs inherent to the production bundle.

Do **not** use `build:dev` for store submissions — always use plain `wxt build` (production mode, no embedded key).

## Examples

**Before** — key gated on `command`, only available during `wxt dev`:

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: ({ command }) => ({
    ...(command === 'serve' ? { key: DEV_EXTENSION_KEY } : {}),
  }),
});
```

Running `wxt build` or `wxt build --mode development` produced a manifest without `key`, yielding a random extension ID on every load.

**After** — key gated on `mode`, available in any development-mode build:

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: ({ mode }) => ({
    ...(mode === 'development' ? { key: DEV_EXTENSION_KEY } : {}),
  }),
});
```

```bash
$ npm run build:dev
# .output/chrome-mv3-dev/manifest.json contains "key": "MIIBIjANBg..."
# Zero references to localhost:3000 or ws:// in any output file
```

Verification check:

```bash
grep -r "localhost:3000\|ws://" .output/chrome-mv3-dev/
# (no output — clean)
```

## Related

- [WXT Extension Icon Rasterization and Manifest Wiring](./wxt-extension-icon-rasterization-and-manifest-wiring.md) — also touches the `manifest()` callback in `wxt.config.ts`
- [Chrome Extension Dual-Version Release Process](./workflow-issues/chrome-extension-release-process.md) — 完整的发布流程（版本升级、双版本构建、标签、GitHub Release、CWS 提交）
