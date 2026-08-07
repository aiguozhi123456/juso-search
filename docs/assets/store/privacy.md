# Chrome Web Store 上架 · 隐私权步骤填表文案

归档 Chrome Web Store Developer Dashboard「隐私权」步骤各字段填表内容。**英文为填表主版**。配合代码门控(Agent Bridge + engine-search 默认关闭)与公开隐私政策(`privacy-policy.md`)。

最后更新:2026-08-07

---

## 1. 单一用途(Single Purpose)

> Unified search interface for querying and switching between multiple search sources — conventional web search engines (Google, Bing, Baidu, Douyin, Xiaohongshu, Bilibili, Yandex, DuckDuckGo), AI conversation engines (ChatGPT, DeepSeek, Gemini, Doubao, Grok — query auto-filled, optionally auto-submitted), custom search engines (URL templates with %s, no API key), site-scoped searches (Site Engines, no API key), and AI search APIs (Tavily, Exa, Brave, Stepfun, Jina, Doubao, user's own keys). Users search from a toolbar page and move the query between sources via a switch bar on supported search-engine result pages. Optionally, the user can expose this same search capability to a locally-run AI assistant (e.g. a coding agent) over a loopback bridge, so the assistant searches through the user's already-configured sources without receiving the stored keys; this is the same search function exposed programmatically rather than via the toolbar UI, and the only programmatic surface.

## 2. 权限理由 — storage

> Stores the user's own API keys for configured AI search providers and search preferences (active source, source ordering and visibility, source groups, per-provider result counts, provider instances — multiple named configs per provider, switch-bar position, UI language, theme, and style) so configuration persists across browser sessions. Also stores user-saved custom search engines (URL templates) and Site Engines (site-scoped searches), and a local per-device cache of successful search results to avoid billing the user twice for the same query. All data stays in `chrome.storage.local` (never synced) and is never logged. API keys are read exclusively by the background service worker and are never read by any extension page or content script; UI pages read only non-sensitive preferences. Keys are sent only to the user's selected search provider when fulfilling a search.

## 3. 权限理由 — downloads

> Allows the background service worker to save user-initiated files to the user's Downloads folder: (a) a configuration backup file (JSON containing the user's provider API keys and search preferences, which the user can later import to restore their setup), and (b) a downloadable Agent Skill package (a ZIP containing a Python CLI and reference docs that let a local AI assistant call the extension's search capability). Both are performed by the worker (rather than a page `<a>` download) so stored API keys flow from the service worker directly into the file without entering any page's memory, and files are written only when the user explicitly requests them.

## 4. 权限理由 — 主机权限(限 1000 字符;实测 ~981)

> (1) Provider APIs (api.tavily.com, api.exa.ai, api.search.brave.com, api.stepfun.com, s.jina.ai, open.feedcoopapi.com): worker sends query+key+minimal params; Stepfun MCP calls only 'web_search'. No cookies/history.
>
> (2) 127.0.0.1 (Agent Bridge, off by default): local AI assistant searches via loopback, no keys. Engine extraction (separate opt-in) opens one background tab, reads public results (title/url/snippet). Fresh port/token per call.
>
> (3) Content scripts on search-engine result pages (Google/Bing/Baidu/Douyin/Xiaohongshu/Bilibili/Yandex/DuckDuckGo) and AI chat pages (chatgpt.com, chat.deepseek.com, www.doubao.com, gemini.google.com): injects closed shadow-root bar + <style> (inline: repositions Baidu/Douyin toolbars; top/bottom: pads page). Reads only anchors + URL query on search pages (no result alteration); fills query into chat input on AI pages, optionally submits. Extractor reads public results on request. No cookies/credentials/account data read; nothing sent externally.

## 5. 远程代码:否

选「No, this extension does not use remote code.」

补充说明(若有详细框):
> All JavaScript and Wasm is bundled into the extension package by the build (WXT/webpack). The extension contains no `<script>` tags referencing external files, no external module imports, and no `eval`/`new Function` string evaluation. The Stepfun Step Plan MCP surface is a JSON-RPC protocol over `fetch` (request/response data only); the client is hard-coded to call only the static `web_search` tool and executes no code received from the server.

---

## 附 A:代码门控事实(支撑文案,审核员真机核对一致)

- **Agent Bridge 总开关默认关闭**:`agentBridgeEnabled` 偏好默认 `false`;`entrypoints/background.ts` 的 `agentBridgeClaim` handler 入口检查,off 时直接返回 `{ok:false}`,不响应任何 action。
- **engine-search 子开关默认关闭**:`engineSearchEnabled` 偏好默认 `false`;`entrypoints/background.ts` 包装 `handleEngineSearch`,off 时返回 `{error:'extract-failed'}` 不开标签。
- **子开关 UI 依赖总开关**:`components/AgentBridgeSettings.tsx` 子开关 `disabled={!bridgeEnabled}`。
- **新偏好入 config schema 白名单**:`lib/schema.ts` 的 `CONFIG_KEYS` 含两键;未 bump version(默认 false,getter 兜底)。
- **隐私政策已就绪**:`docs/assets/store/privacy-policy.md`(双语,用作公开 Privacy Policy URL)。

## 附 B:ora-1 代码审查关键修正(已落地)

审查发现并修正的 3 处「必须修正」(否则审核员真机一测即破,会被判 misleading description / undeclared capability):

1. **§4C** 不再说「不修改页面内容」——如实承认注入 `<style>` 位移百度/抖音工具栏避让(不改结果本身)。证据:`lib/engines/{baidu,douyin}.ts` 的 `PAGE_STYLES`。
2. **§4B** 披露 engine-search 会让浏览器加载 Google/Bing/Baidu 页面(原「all traffic stays on device」误导)。证据:`lib/engine-search.ts:46` `tabs.create({active:false})`。
3. **§1** 单一用途补提 Agent Bridge(避免权限理由里有、用途声明里没有的不对称)。
