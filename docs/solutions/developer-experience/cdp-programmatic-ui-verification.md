---
title: "Verifying extension-page CSS animations programmatically (raw CDP, no screenshots)"
date: 2026-09-08
category: docs/solutions/developer-experience/
module: dev verification workflow
problem_type: developer_experience
component: tooling
severity: low
applies_when:
  - "验证代理无法查看截图/图片，但必须核实 UI 几何、绘制顺序或动画相位"
  - "CSS 重构后对像素布局做回归检查"
  - "校验 computed style 是否符合设计 token 契约"
tags: [cdp, devtools-protocol, css-animation, verification, extension-pages, edge, windows]
---

# Verifying Extension-Page CSS Animations Programmatically (Raw CDP, No Screenshots)

## Context

An AI coding agent (image-blind — it cannot view screenshots or rendered images) had to verify pixel geometry, paint order, and pure-CSS keyframe timing of non-interactive CSS-animation demos on a Chrome extension's onboarding page (WXT build, loaded unpacked in Chrome/Edge). Screenshots were useless to the agent, so *all* verification had to be programmatic: numeric evidence — `getComputedStyle` values, `getBoundingClientRect` rects, CSS transform matrices — pulled from a live page over the Chrome DevTools Protocol (CDP). This doc records the technique set that made every visual claim ("cursor lands on the target", "flyout stays inside its frame", "phases fire in order") checkable with numbers instead of eyes.

## Guidance

Launch a throwaway browser (Edge/Chrome) with a fixed debug port, a temp profile, and the unpacked extension:

```
msedge.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\verify-profile --load-extension=.output\chrome-mv3
```

Then apply these practices:

**1. Throwaway browser + raw CDP, zero dependencies.** From a Node ESM script — no puppeteer/playwright needed:
- `GET http://127.0.0.1:<port>/json/version` → response has `webSocketDebuggerUrl` (the browser-level WS endpoint).
- `GET /json/list` → array of targets; find the page target by URL substring (e.g. `t.url.includes("onboarding.html")`), take its `id`.
- Send `Target.attachToTarget` with `{targetId, flatten: true}` → reply carries a `sessionId`; route every subsequent command with that `sessionId` (flat protocol).
- Run anything in the page via `Runtime.evaluate` with `{expression, returnByValue: true}` — the reply's `result.value` is a plain JSON value you can assert on.
- Wire a tiny `send(method, params, sessionId)` helper keyed by incrementing message `id` and you have a full CDP client in ~20 lines.

**2. Animation-phase sampling (deterministic pure-CSS loops).** A pure-CSS keyframe demo looping on a fixed period (e.g. 10s) is deterministic: `await sleep(ms)` to a chosen phase, then sample `getComputedStyle` / `getBoundingClientRect`. For the cursor-flyout demo, compute a **cursor LANDING DISTANCE** at the moment the keyframe should have landed:

```
dist = Math.hypot(targetCx − stage.left − tip[0], targetCy − stage.top − tip[1])
```

where `tip` is the cursor graphic's hotspot offset inside its element (here measured `(5, 2.3)` once, reused everywhere) and `stage` is the demo container's rect. Pass threshold ≈ **3px**. To verify a *phase chain*, sample the SAME element across phases and assert the expected sequence of observable states — e.g. flyout `opacity: 1` → transform matrix collapses (interpolating matrix values) → result card A/B text swap.

**3. Open-phase-only measurement.** Flyout/popup member items are only truly positioned during their open window (`opacity: 1`, `transform: none`). Outside that window their rects reflect a hidden/pre-transform state and any geometry assertion is garbage. Sleep into the open window before reading rects on flyout members.

**4. `pointer-events: none` blind spot in paint-order checks.** Demo subtrees are commonly marked `pointer-events: none`, and `document.elementFromPoint` **skips** such subtrees entirely — so the stack check silently returns an ancestor and your paint-order assertion "passes" against the wrong element or fails confusingly. Fix: temporarily set `el.style.pointerEvents = 'auto'` on the subtree root, run the elementFromPoint stack check, then restore the original value.

**5. Stale-CSS trap.** Extension pages cache stylesheets aggressively. After rebuilding (`wxt build`), you **MUST** reload the extension page before sampling geometry — and reload the extension itself via `chrome://extensions` for background changes — otherwise you are verifying the *old* CSS and will chase phantom regressions.

**6. React-async navigation trap.** Clicking prev/next step buttons in a tight loop outruns React state updates (observed: step counter overshoots negative → blank page). Insert per-click sleeps (~400ms) between synthetic clicks, or send a `Page.reload` to reset step state before the next assertion block.

**7. Cheap phase probes.** Before trusting sampled geometry, confirm *which keyframe window you are in* with a cheap observable: `document.title`, an element's `textContent`, or a data-attribute. This converts "did my sleep land in the right phase?" from guesswork into a precondition check.

**8. Windows shell trap: no `node -e` one-liners.** `node -e "..."` breaks under PowerShell quoting layers. Write the script to a scratch `.mjs` file with the file-writing tool and run `node script.mjs` — ESM gives you top-level `await` for the sleep-driven sampling flow.

**9. Cleanup hygiene.** Kill the throwaway browser by matching `Win32_Process.CommandLine` against the profile dir (`Get-CimInstance Win32_Process` → `taskkill /PID <pid> /T /F`), and delete the scratch script dir **before** running repo lint — stray `.mjs` files in the workspace fail lint.

## Why This Matters

This turns "trust the CSS" into reproducible numeric evidence. Every session claim about the onboarding demos was verified with concrete numbers: cursor landing verified at `dist=0` precision against a 3px threshold, flyout containment confirmed via actual rects, phase chains confirmed via ordered observable states. For an image-blind agent this is not merely convenient — it is the **only** way to see UI at all. The same numbers make the verification repeatable by any future agent or human: re-run the script, compare values, no screenshot interpretation required.

## When to Apply

- Verifying UI geometry or CSS-animation behavior on any locally-served page or extension page.
- Regression-checking pixel layout after CSS refactors (landing-distance and rect assertions are cheap to keep in a scratch script).
- Verifying computed styles match a design-token contract (sample `getComputedStyle` and compare against expected token values).
- Any situation where the verifying agent cannot view images — make the claim numeric or make it not-a-claim.

## Examples

CDP attach + evaluate (abbreviated, no dependencies):

```js
const port = 9222;
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const send = (method, params = {}, sessionId) => new Promise(res => {
  const mid = ++id; pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
});
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find(t => t.url.includes("onboarding.html"));
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId: page.id, flatten: true });
const out = await send("Runtime.evaluate",
  { expression: `getComputedStyle(document.querySelector('.cursor')).transform`, returnByValue: true },
  sessionId);
```

Landing-distance check (abbreviated):

```js
const stage = document.querySelector('.demo-stage').getBoundingClientRect();
const tip = [5, 2.3]; // cursor hotspot offset inside the cursor element, measured once
const cur = document.querySelector('.cursor').getBoundingClientRect();
const tipX = cur.left + tip[0], tipY = cur.top + tip[1];
const dist = Math.hypot(targetCx - stage.left - tipX, targetCy - stage.top - tipY);
if (dist > 3) throw new Error(`landing miss: ${dist.toFixed(1)}px`);
```

## Related

- [Engine search orchestration errors and Baidu URL extraction](../logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md) —— 同一工具链的先例：一次性浏览器 + 临时 profile + `--remote-debugging-port` + `Runtime.evaluate` 探针结果表（MV3 就绪门问题的实证确认）。
- [DuckDuckGo React SERP anchors and real-device probing](../ui-bugs/duckduckgo-react-serp-anchors-and-real-device-probing.md) —— 同一「实测真实渲染页面而非相信文档/截图」原则的手动版（DevTools snippet + 几何数值读数）；本文是其程序化 CDP 对应物。
