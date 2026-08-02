---
title: "Sanitizing Content-Script-Supplied URLs Before the Worker Opens a Tab"
date: 2026-08-02
category: security-issues
module: "background worker / custom-engines / serp"
problem_type: security_issue
component: tooling
severity: medium
symptoms:
  - "A background handler opens a tab from a URL supplied by a content script running on an arbitrary third-party page"
  - "Without sanitization the caller could request privileged targets (chrome://, chrome-extension://, extension pages, file://, javascript:, data:)"
root_cause: missing_validation
resolution_type: code_fix
related_components: [entrypoints/background.ts, lib/custom-engines.ts, entrypoints/serp-bar.content.ts]
tags: [security, url-sanitization, content-script, worker, tabs-create, scheme-allowlist, toctou, custom-engine]
---

# Sanitizing Content-Script-Supplied URLs Before the Worker Opens a Tab

## Problem

Custom Engine 的 SERP-bar 路径把结果在**新标签页**打开，并委托给 worker 执行——内容脚本（运行在 `google.com`/`bing.com` 等任意第三方 SERP 上）发送 `openNewTab(url)`，background 调用 `browser.tabs.create`（`entrypoints/background.ts:62-74`）。任何时候，只要 worker 会打开一个由调用方提供的 URL，调用方（一个运行在任意、可能被攻陷或敌对的第三方 SERP 上的内容脚本）就不能被允许打开特权 URL。worker 是特权上下文，它发起的导航不受普通网页的反滥用拦截约束，因此这条路径必须自己把守入口。

## Symptoms

- 一个 background handler 从内容脚本提供的 URL 打开标签页；该内容脚本运行在任意第三方页面上。
- 缺少净化时，调用方可以请求特权目标：`chrome://`、`chrome-extension://`、扩展页、`file://`、`javascript:`、`data:`。

## What Didn't Work

- **只校验 `new URL(data).protocol` 然后导航原始 `data`。** 这校验的是某一种序列化，导航的却是可能不同的另一种——WHATWG URL 解析器会把空白 / C0 控制字符剥进 `url.href`，于是 raw `data` 与解析后的 `href` 可能并不一致。这是典型的「校验后用」（validate-then-use）差异，即 TOCTOU。
- **不拒绝凭据。** 形如 `http://user:pass@host/` 的 URL 携带 `username`/`password`，未被拦下。
- **静默拒绝。** 拒绝时不打日志，事后无从排查到底挡了什么。
- **一段夸大其词的注释，声称 `sender.tab` 能区分内容脚本。** 它不能——「在标签页打开的扩展页」同样带有 `sender.tab`。当前代码的注释（`entrypoints/background.ts:63-65`）已修正为：`sender.tab` 只保证存在一个 tab 上下文，真正的安全边界是 `sanitizeOpenNewTabUrl` 内的 http/https 协议白名单（并拒绝凭据）。

## Solution

在 `lib/custom-engines.ts` 提供一个**纯的、可导出的** helper `sanitizeOpenNewTabUrl(raw: string): string | null`（`lib/custom-engines.ts:147-158`）：

```ts
export function sanitizeOpenNewTabUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_CUSTOM_ENGINE_URL_LENGTH + 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}
```

语义：

- 只接受 `http:`/`https:`；
- 拒绝凭据（`url.username || url.password`，与 `normalizeCustomEngineUrlTemplate` 一致，见 `lib/custom-engines.ts:58`）；
- 强制长度上限；
- 返回**解析后的** `url.href`（任何拒绝或解析失败则返回 `null`）。

handler（`entrypoints/background.ts:62-74`）：

```ts
onMessage('openNewTab', ({ data, sender }) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  const target = sanitizeOpenNewTabUrl(data);
  if (!target) {
    console.warn('[openNewTab] rejected URL', data);
    return;
  }
  void browser.tabs.create({ url: target }).catch((e) => console.warn('[openNewTab] tabs.create failed', e));
});
```

关键在于：导航的是 `url.href`——**与被校验的是同一份序列化**，所以 validated == navigated，没有差异。外加 `sender.tab` 守卫，先确保有 tab 可导航。

## Why This Works

- `http`/`https` 白名单挡掉一切特权 scheme（`chrome://`、`chrome-extension://`、`javascript:`、`data:`、`file:`、`view-source:`）。
- 解析器会把 scheme 小写化，所以没有大小写绕过——特权 scheme 无论大小写都被拒。
- 导航解析后的 `href`，消除了「校验 / 使用」间隙。
- 注意：内容脚本本来就能用 `window.open` 打开一个 http(s) URL，所以放行 http(s) 并不构成提权——白名单的职责是挡掉特权 scheme，让 worker 这条路不会成为绕过通道。

## Prevention

任何打开调用方提供 URL 的 worker handler 都必须：

1. scheme 白名单；
2. 导航解析后的序列化，而非原始输入；
3. 拒绝凭据；
4. 长度上限 + `.catch`；
5. 记录拒绝日志。

此外：

- 加上 scheme 拒绝测试（`chrome://`、`chrome-extension://`、`javascript:`、`data:`、`file://`、带凭据）。
- 把校验器保持为 `lib/` 下的纯 helper，使其可单测——内容脚本无法导出命名成员用于测试。

## Related Issues

- `../runtime-errors/serp-to-extension-page-blocked-by-client.md` — 互补的 `openSearchPage` 另一半：扩展页导航用固定 base + 参数白名单；也解释了 worker 导航为何存在。
- `../architecture-patterns/custom-engine-arbitrary-url-source-type.md` — Custom Engine 作为「任意 URL 源类型」的架构。
- `../architecture-patterns/testable-content-script-helpers-via-lib-extraction.md` — helper 为何放在 `lib/`。
- `../design-patterns/source-level-favicon-field-pipeline.md` — `web_accessible_resources`。
- `../../../CONCEPTS.md` — 项目领域词汇。
