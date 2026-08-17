---
title: data: URL downloads ignore the filename parameter — files save as "下载.xxx"
date: 2026-08-07
last_updated: 2026-08-17
category: runtime-errors
module: gateway
problem_type: runtime_error
component: background_job
symptoms:
  - "Config export saves as 下载.json instead of juso-config-YYYYMMDD-HHMM.json"
  - "Agent Skill download saves as 下载.zip instead of juso-search-<version>.zip"
  - "The filename passed to browser.downloads.download is correct in code but not applied at runtime"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - chrome-mv3
  - downloads
  - data-url
  - ondeterminingfilename
  - filename
  - background-worker
  - config-export
  - agent-skill
---

# data: URL downloads ignore the filename parameter — files save as "下载.xxx"

## Problem

Both worker-side download paths — Config Export (`handleExportConfig`) and Agent Skill packaging (`handlePackageAgentSkill`) — produce `data:` URLs and pass them to `browser.downloads.download({ url, filename, saveAs: true })`. The `filename` is correct in code (`juso-config-YYYYMMDD-HHMM.json`, `juso-search-<version>.zip`), but Chrome saves the file under the default name "下载" (Chinese locale) + a MIME-derived extension, so users get `下载.json` and `下载.zip` and cannot tell files apart.

## Symptoms

- Config export → file saved as `下载.json` instead of `juso-config-20260807-1430.json`.
- Agent Skill download → file saved as `下载.zip` instead of `juso-search-1.3.0.zip`.
- The `filename` argument in `browser.downloads.download()` is verified correct in source; the problem only manifests at runtime in Chrome.

## What Didn't Work

- **Passing `filename` directly to `downloads.download`**: Chrome does not reliably apply `filename` for `data:` URLs. A `data:` URL carries no original resource name, so Chrome falls back to a default name (locale-dependent: "download" / "下载") plus an extension inferred from the data URL's MIME type. Confirmed by [GoogleChrome/developer.chrome.com#123](https://github.com/GoogleChrome/developer.chrome.com/issues/123): `data:text/plain` + `filename:"foobar.txt"` + `saveAs:true` → "always `download.txt`".
- **Ignoring extension conflicts**: Chrome's official `downloads.idl` states verbatim: *"filename is ignored if there are any `onDeterminingFilename` listeners registered by any extensions."* (Chromium issue 579563, open since 2016.) If the user has any download-manager extension installed, `filename` is silently dropped regardless of the URL scheme — making the data-URL problem deterministic rather than intermittent.
- **Unit tests did not catch this**: existing tests inject a mock `onDownload` callback (`tests/gateway.test.ts`), bypassing the real `browser.downloads.download`. The runtime naming behavior is invisible at the test layer.

## Solution

Register the extension's own `browser.downloads.onDeterminingFilename` listener that forces `suggest({ filename })` for downloads initiated by this extension, and passes through (`suggest()`) for all others. This is the workaround recommended by Chrome's official docs and the community.

**`lib/gateway.ts`** — added a pending-filename queue and a guard installer; `triggerDownload` enqueues before calling `download`:

```ts
// Chrome 对 data: URL 下载不可靠地应用 filename（回退默认名，中文 locale 为「下载」）；
// 且当任意扩展注册 onDeterminingFilename 监听器时 filename 参数被完全忽略
//（Chromium 579563，官方 downloads.idl 明文）。注册本扩展自己的监听器，对由本扩展
// 发起的下载强制 suggest 正确文件名，其他下载放行。Firefox 无此 API 也无此问题。
const pendingFilenames: string[] = [];

export function installDownloadFilenameGuard(): void {
  const events = browser.downloads?.onDeterminingFilename;
  if (!events) return; // Firefox / 不支持：filename 参数本身可靠，无需修复
  events.addListener((item, suggest) => {
    if (item.byExtensionId === browser.runtime.id && pendingFilenames.length > 0) {
      suggest({ filename: pendingFilenames.shift()! });
    } else {
      suggest(); // 放行：非本扩展发起，或队列空
    }
  });
}

async function triggerDownload(url: string, filename: string): Promise<void> {
  // Firefox 拒绝 data: URL 下载（bug 1318564，仍 open）；event page 有 URL.createObjectURL，
  // 转 blob: URL 绕过。Chrome service worker 无 URL.createObjectURL，保留 data: URL + 下方守卫。
  let downloadUrl = url;
  if (url.startsWith('data:') && typeof URL.createObjectURL === 'function') {
    const blob = await (await fetch(url)).blob();
    downloadUrl = URL.createObjectURL(blob);
  }
  pendingFilenames.push(filename);
  await browser.downloads.download({ url: downloadUrl, filename, saveAs: true });
}
```

（data: → blob: 转换为 Firefox MV3 支持（74b17b4）所加：Firefox 根本不接受 data: 下载；Chrome service worker 无 `URL.createObjectURL`，仍走 data: URL + 守卫路径，故本守卫仍是 Chrome 侧的必要修复。）

**`entrypoints/background.ts`** — call the installer once at worker startup so the listener is registered before any download can fire:

```ts
export default defineBackground(() => {
  installDownloadFilenameGuard();
  // ...rest of worker setup
});
```

No `wxt.config.ts` permission change needed — the `downloads` permission already covers `onDeterminingFilename`.

## Why This Works

`onDeterminingFilename` is the Chrome-sanctioned hook for overriding download filenames. It fires after Chrome determines the MIME type and tentative filename, and a `suggest({ filename })` call from any listener wins over the `filename` parameter passed to `downloads.download`. By registering our own listener and matching only `item.byExtensionId === browser.runtime.id`, we:

1. **Fix the data-URL root cause**: even though Chrome ignores `filename` for `data:` URLs, our listener explicitly suggests it during the filename-determination phase, which Chrome honors.
2. **Fix the conflict-extension root cause**: when another extension's `onDeterminingFilename` listener causes Chrome to ignore the `filename` parameter, our own listener still calls `suggest` and wins (last-installed listener that passes a suggestion wins; for our own downloads we always pass one).
3. **Don't interfere with other downloads**: the `byExtensionId` check ensures we only override filenames for downloads this extension initiated; all other downloads get a bare `suggest()` (pass-through).
4. **Preserve the R7 security boundary**: keys and packaged artifacts never enter page memory — the guard runs entirely in the worker, same as the existing `triggerDownload`.

The pending-filename queue (rather than a single slot) handles the theoretical case of rapid sequential downloads; in practice both download paths are user-initiated single actions, but the queue is safe under any ordering.

## Prevention

- **When adding a new worker-side download path**, always route through `triggerDownload` (which enqueues the filename) rather than calling `browser.downloads.download` directly — the guard only fires for filenames it knows about.
- **Tests that exercise download handlers must mock `browser.downloads.onDeterminingFilename`** if they want to verify runtime naming behavior. The existing mock-`onDownload` pattern verifies handler logic but cannot catch platform-level filename issues. The new `installDownloadFilenameGuard` describe block in `tests/gateway.test.ts` is the template: stub `onDeterminingFilename.addListener` to capture the listener, simulate Chrome firing it from within the `download` mock, and assert `suggest` received the correct filename.
- **`onDeterminingFilename` is Chrome-only** (Firefox has no such API and no such problem). The guard's `if (!events) return` makes it a no-op on Firefox, so the same codebase ships cross-browser without conditionals at call sites.
- **Do not assume `filename` in `downloads.download` is applied** for any `data:` or `blob:` URL — always pair with an `onDeterminingFilename` listener when the filename matters.

## Related Issues

- [GoogleChrome/developer.chrome.com#123](https://github.com/GoogleChrome/developer.chrome.com/issues/123) — `filename` in `chrome.downloads.download` doesn't work for `data:` URLs (files saved as "download").
- [Chromium 579563](https://bugs.chromium.org/p/chromium/issues/detail?id=579563) — `filename` ignored when any extension registers `onDeterminingFilename`.
- [`docs/solutions/architecture-patterns/agent-skill-distribution-pipeline.md`](../architecture-patterns/agent-skill-distribution-pipeline.md) — the Agent Skill packaging pipeline whose download output was affected.
- [`docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md`](../architecture-patterns/dual-domain-storage-schema-versioning.md) — documents the Config Export download flow (worker-assembled payload → data URL → `browser.downloads.download`).
- [`docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md`](./service-worker-fetch-illegal-invocation.md) — same family of Chrome MV3 worker API gotchas (global `fetch` binding); same `wrong_api` root cause pattern.
