---
title: "Provider switching should serialize active-provider writes and search the current input"
date: 2026-07-07
category: ui-bugs
module: "search provider switching UI"
problem_type: ui_bug
component: tooling
symptoms:
  - "Clicking a provider changed the active provider but did not immediately re-search with the text in the search box"
  - "Rapid provider clicks could leave the UI active provider out of sync with the worker's stored active provider"
  - "In-flight search responses could still update the results after the user intended to stop waiting"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [provider-switching, active-provider, react-state, worker-message, async-timing, search-ui, chrome-storage]
---

# Provider switching should serialize active-provider writes and search the current input

## Problem

Provider switching in the search page originally only changed the stored active provider. Users expected clicking a different provider to immediately re-run the query they were looking at, but the switch only affected a later manual search.

The first implementation fixed the single-click behavior by auto-searching after a switch, but review exposed an async race: multiple provider switch writes could resolve out of order, leaving the UI active provider and the worker's stored active provider disagreeing.

## Symptoms

- Clicking `Exa` or another provider after typing in the search box did not immediately search with that provider until the user clicked `搜索` again.
- If auto-search used the last submitted query, changing the input text and then switching provider could search stale text instead of the visible search-box value.
- Rapid clicks across provider buttons could let an earlier, slower `setActiveProvider` write finish after a later click. The UI could show the later provider while worker storage held the earlier provider, so the next search would run against the wrong backend.
- While a search was in flight, provider buttons remained clickable even though the old search response and the switch-triggered search were competing for the same result area.
- There was no user-visible way to stop waiting for a long-running search while keeping the current input.

## What Didn't Work

- Directly calling `setActiveProviderId` from the search or options page solved persistence but bypassed the worker-message boundary used for provider configuration status. It also encouraged page entrypoints to import storage helpers in an area where BYOK key hygiene matters.
- Storing only the last submitted query was not enough. The desired behavior is based on the current search-box text, including edits the user made after the previous search.
- Adding a request-id guard around only search responses was insufficient. `reqIdRef` prevents stale search results from rendering, but it does not prevent stale active-provider writes from completing in storage.
- Letting multiple `setActiveProvider` calls run concurrently and only ignoring stale UI updates still leaves worker storage vulnerable to out-of-order writes.

## Solution

Make the search box controlled by the search page, route active-provider writes through the background worker, and serialize provider switching while search or switch work is pending.

```tsx
// entrypoints/search/App.tsx
const [query, setQuery] = useState('');
const [loading, setLoading] = useState(false);
const [switching, setSwitching] = useState(false);
const reqIdRef = useRef(0);
const switchReqIdRef = useRef(0);

async function handleSearch(rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) return;
  const reqId = ++reqIdRef.current;
  setLoading(true);
  setError(null);
  setResponse(null);
  try {
    const reply = await sendMessage('search', query);
    if (reqId !== reqIdRef.current) return;
    if (reply.ok) setResponse(reply.response);
    else setError({ message: reply.error.message, needKey: reply.error.kind === 'keyMissing' });
  } finally {
    if (reqId === reqIdRef.current) setLoading(false);
  }
}

async function handleSwitch(id: ProviderId) {
  if (loading || switching) return;
  if (id === active) return;
  const switchReqId = ++switchReqIdRef.current;
  setSwitching(true);
  try {
    await sendMessage('setActiveProvider', id);
    if (switchReqId !== switchReqIdRef.current) return;
    setActive(id);
    const nextQuery = query.trim();
    if (nextQuery) await handleSearch(nextQuery);
  } finally {
    if (switchReqId === switchReqIdRef.current) setSwitching(false);
  }
}
```

The `SearchBox` becomes controlled so provider switching can use the text the user currently sees, not a stale submitted value:

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

Active-provider writes go through the background worker so page code does not directly own provider storage mutations:

```ts
// lib/messaging.ts
export type ProtocolMap = {
  setActiveProvider(providerId: ProviderId): Promise<void>;
};

// lib/gateway.ts
export async function handleSetActiveProvider(providerId: ProviderId): Promise<void> {
  await setActiveProviderId(providerId);
}
```

Finally, disable provider buttons whenever search or switch work is pending:

```tsx
<ProviderSwitcher
  providers={configuredProviders}
  active={active}
  onSwitch={handleSwitch}
  disabled={loading || switching}
/>
```

## Why This Works

The visible search box is the source of truth for switch-triggered searches. That matches the user model: if they type `world` and click `Exa`, the app searches `world` with Exa, regardless of the last submitted query.

The worker remains the only code path that mutates active-provider storage. The UI sends a provider id through `setActiveProvider`, then the subsequent `search` message reads the same stored active provider from the worker side.

The `switching` lock prevents concurrent active-provider writes. Without it, a slow first click can finish after a fast second click and overwrite storage even if the UI ignores the stale first response. Disabling provider buttons during switching keeps UI state, storage state, and the next worker search aligned.

The interrupt button does not cancel the provider HTTP request at the transport layer, but it does cancel the UI observation of that request. Incrementing `reqIdRef` makes any later response stale, so it cannot replace the visible result after the user has stopped waiting.

## Prevention

- Treat active-provider changes as stateful writes, not just UI highlights. If the worker reads the persisted active provider for future searches, switching must be serialized or carry a worker-side last-write-wins token.
- When a user action triggers a new search from existing input, make the input controlled at the page level so the action reads the current visible value.
- Guard every async UI pipeline at the same boundary where it mutates state. Search result guards do not protect storage writes; storage write guards do not protect search results.
- Disable controls while their underlying state mutation is pending unless the backend/API supports explicit cancellation or ordering tokens.
- Add regression tests for the real failure modes:
  - provider switch searches with the current input value,
  - empty input switches provider without searching,
  - provider buttons are disabled during a search,
  - interrupting a search drops the stale response,
  - provider buttons are disabled while an active-provider write is pending.

## Related Issues

- `docs/solutions/architecture-patterns/provider-api-integration-patterns.md` — provider adapter and worker-side API integration model.
- `docs/solutions/best-practices/theme-persistence-i18n-key-hygiene.md` — worker-message boundary and BYOK storage hygiene for provider configuration.
- `docs/solutions/ui-bugs/locale-preference-subscription-state.md` — related React UI state bug where visible active state depended on a distinction between preference state and derived render state.
