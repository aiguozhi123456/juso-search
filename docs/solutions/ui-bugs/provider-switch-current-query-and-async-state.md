---
title: "Source switching should serialize active-source writes and search the current input"
date: 2026-07-07
last_updated: 2026-08-01
category: ui-bugs
module: "search provider switching UI"
problem_type: ui_bug
component: tooling
symptoms:
  - "Clicking a source changed the active source but did not immediately re-search with the text in the search box"
  - "Rapid source clicks could leave the UI active source out of sync with the worker's stored active source"
  - "In-flight search responses could still update the results after the user intended to stop waiting"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [provider-switching, active-provider, react-state, worker-message, async-timing, search-ui, chrome-storage]
---

# Source switching should serialize active-source writes and search the current input

## Problem

Source switching in the search page originally only changed the stored active source. Users expected clicking a different source to immediately re-run the query they were looking at, but the switch only affected a later manual search.

The first implementation fixed the single-click behavior by auto-searching after a switch, but review exposed an async race: multiple source switch writes could resolve out of order, leaving the UI active source and the worker's stored active source disagreeing.

## Symptoms

- Clicking `Exa` or another source after typing in the search box did not immediately search with that source until the user clicked `搜索` again.
- If auto-search used the last submitted query, changing the input text and then switching source could search stale text instead of the visible search-box value.
- Rapid clicks across source buttons could let an earlier, slower `setActiveProvider` write finish after a later click. The UI could show the later source while worker storage held the earlier source, so the next search would run against the wrong backend.
- While a search was in flight, source buttons remained clickable even though the old search response and the switch-triggered search were competing for the same result area.
- There was no user-visible way to stop waiting for a long-running search while keeping the current input.

## What Didn't Work

- Directly calling `setActiveProviderId` from the search or options page solved persistence but bypassed the worker-message boundary used for provider configuration status. It also encouraged page entrypoints to import storage helpers in an area where BYOK key hygiene matters.
- Storing only the last submitted query was not enough. The desired behavior is based on the current search-box text, including edits the user made after the previous search.
- Adding a request-id guard around only search responses was insufficient. `reqIdRef` prevents stale search results from rendering, but it does not prevent stale active-source writes from completing in storage.
- Letting multiple `setActiveSource` writes run concurrently and only ignoring stale UI updates still leaves worker storage vulnerable to out-of-order writes.

## Solution

Make the search box controlled by the search page, route active-source writes through the background worker, and serialize source switching while search or switch work is pending.

> Simplified illustration — current impl handles all source kinds (`provider` / `site-engine` / `custom-engine` / `ai-engine`) via `lib/serp-handoff.ts` resolvers (`resolveCurrentSiteEngineHandoff` / `resolveCurrentCustomEngineHandoff`); see `entrypoints/search/App.tsx` for the full per-kind source-selection logic. The `handleSearch` signature is now `handleSearch(rawQuery, opts: { ... selectedSource? ... })`.

```tsx
// entrypoints/search/App.tsx
const [query, setQuery] = useState('');
const [loading, setLoading] = useState(false);
const [switching, setSwitching] = useState(false);
const reqIdRef = useRef(0);
const switchReqIdRef = useRef(0);

async function handleSearch(rawQuery: string, providerId?: ProviderId) {
  const query = rawQuery.trim();
  if (!query) return;
  const reqId = ++reqIdRef.current;
  setLoading(true);
  setError(null);
  setResponse(null);
  try {
    // 搜索消息现在是 SearchRequest 对象：{ query, forceRefresh?, providerId? }
    const reply = await sendMessage('search', { query, providerId });
    if (reqId !== reqIdRef.current) return;
    if (reply.ok) setResponse(reply.response);
    else setError({ message: reply.error.message, needKey: reply.error.kind === 'keyMissing' });
  } finally {
    if (reqId === reqIdRef.current) setLoading(false);
  }
}

async function handleSelectSource(source: SearchSource) {
  if (loading || switching) return;
  if (source.id === active) return;
  const switchReqId = ++switchReqIdRef.current;
  setSwitching(true);
  try {
    await sendMessage('setActiveSource', source.id); // 统一来源模型：provider/engine/site-engine 均经此消息
    if (switchReqId !== switchReqIdRef.current) return;
    setActive(source.id);
    if (source.kind === 'site-engine' || source.kind === 'engine') {
      // 引擎/站外搜索：当前页导航（URL 经 resolveSerpHandoff 解析，含 site-engine 作用域改写）
      const handoff = resolveSerpHandoff(source, query.trim());
      if (handoff?.kind === 'navigate') location.assign(handoff.url);
      return;
    }
    const nextQuery = query.trim();
    if (nextQuery) await handleSearch(nextQuery, source.id);
  } finally {
    if (switchReqId === switchReqIdRef.current) setSwitching(false);
  }
}
```

The `SearchBox` becomes controlled so source switching can use the text the user currently sees, not a stale submitted value:

```tsx
// components/SearchBox.tsx
export function SearchBox({ value, onChange, onSearch, onInterrupt, loading }: Props) {
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onSearch(v);
  }

  return (
    <form className="search-box" onSubmit={submit}>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="submit" disabled={loading}>{loading ? t(MSG.btn_searching) : t(MSG.btn_search)}</button>
      {loading && onInterrupt && (
        <button type="button" onClick={onInterrupt}>{t(MSG.btn_interrupt)}</button>
      )}
    </form>
  );
}
```

The interrupt button makes the current search response stale and returns the UI to an idle state without clearing the user's input or the previous successful result:

```ts
function handleInterrupt() {
  reqIdRef.current += 1;
  setLoading(false);
}
```

Active-source writes go through the background worker so page code does not directly own source storage mutations. Selection speaks **source ids** via `setActiveSource`（provider/engine/site-engine 统一）；`setActiveProvider` 仍在协议与 worker 中（`gateway.ts` 的 `handleSetActiveProvider` 路由到 `setActiveProviderAndSourceId`），但**已无任何 UI 调用方——仅作为 legacy/compat 消息保留**（协议与测试仍引用）。activeSource 与 activeProvider 的模型拆分见 `docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md`：

```ts
// lib/messaging.ts
export type ProtocolMap = {
  setActiveProvider(providerId: ProviderId): Promise<void>; // legacy/compat，无 UI 调用方
};

// lib/gateway.ts
export async function handleSetActiveProvider(providerId: ProviderId): Promise<void> {
  await setActiveProviderAndSourceId(providerId);
}
```

Finally, disable source buttons whenever search or switch work is pending:

```tsx
<SourceSwitcher
  sources={configuredSources}
  activeId={active}
  onSelect={handleSelectSource}
  disabled={loading || switching}
/>
```

## Why This Works

The visible search box is the source of truth for switch-triggered searches. That matches the user model: if they type `world` and click `Exa`, the app searches `world` with Exa, regardless of the last submitted query.

The worker remains the only code path that mutates active-source storage. The UI sends the source id through `setActiveSource`, and the subsequent `search` message carries the UI-chosen `providerId` snapshot (`SearchRequest.providerId`), so the search binds to the view rather than a worker active state that may have drifted.

The `switching` lock prevents concurrent active-source writes. Without it, a slow first click can finish after a fast second click and overwrite storage even if the UI ignores the stale first response. Disabling source buttons during switching keeps UI state, storage state, and the next worker search aligned.

The interrupt button does not cancel the provider HTTP request at the transport layer, but it does cancel the UI observation of that request. Incrementing `reqIdRef` makes any later response stale, so it cannot replace the visible result after the user has stopped waiting.

## Prevention

- Treat active-source changes as stateful writes, not just UI highlights. If the worker reads the persisted active source for future searches, switching must be serialized or carry a worker-side last-write-wins token.
- When a user action triggers a new search from existing input, make the input controlled at the page level so the action reads the current visible value.
- Guard every async UI pipeline at the same boundary where it mutates state. Search result guards do not protect storage writes; storage write guards do not protect search results.
- Disable controls while their underlying state mutation is pending unless the backend/API supports explicit cancellation or ordering tokens.
- Add regression tests for the real failure modes:
  - source switch searches with the current input value,
  - empty input switches source without searching,
  - source buttons are disabled during a search,
  - interrupting a search drops the stale response,
  - source buttons are disabled while an active-source write is pending.

## Related Issues

- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` — provider adapter and worker-side API integration model.
- `docs/solutions/architecture-patterns/separate-active-search-source-from-active-byok-provider.md` — the activeSource/activeProvider model split: the UI speaks source ids while the worker keeps a separate active-provider state, and `setActiveProvider` survives only as a legacy compat message with no UI caller.
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — worker-message boundary and BYOK storage hygiene for provider configuration.
- `docs/solutions/ui-bugs/locale-preference-subscription-state.md` — related React UI state bug where visible active state depended on a distinction between preference state and derived render state.
