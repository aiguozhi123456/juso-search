---
title: Heterogeneous AI Search Provider API Integration
date: 2026-07-01
last_updated: 2026-07-07
category: architecture-patterns
module: provider-adapter
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "integrating multiple external search APIs"
symptoms:
  - Tavily and Exa support synthesized answers but Stepfun REST/MCP return results only
  - Stepfun MCP returns REST-shaped data as JSON string in result.content[0].text
  - Stepfun has two billing surfaces (pay-as-you-go REST vs Step Plan MCP subscription)
resolution_type: standardized_interface
related_components:
  - lib/providers/
  - lib/gateway.ts
tags:
  - provider-adapter
  - mcp
  - search-api
  - normalization
  - byok
  - stepfun
  - tavily
  - exa
---

# Heterogeneous AI Search Provider API Integration

## Context

A Chrome MV3 extension (WXT + React + TypeScript) needed to integrate four AI search providers — Tavily, Exa, Stepfun REST, and Stepfun MCP — each with different auth schemes, response shapes, feature sets (answer synthesis, result fields, error codes), and transport protocols (REST vs MCP streamableHttp). The UI required a single, clean search result experience regardless of which provider was active.

## Guidance

**Model every external API behind a `ProviderAdapter` interface** that maps to a project-owned `NormalizedSearchResponse`. Each adapter owns its transport (fetch / MCP client), auth header construction, response parsing, and error translation. The caller — typically a background worker — only knows the adapter interface.

```
interface ProviderAdapter {
  readonly name: string
  readonly supportsAnswer: boolean
  search(query: string, config: SearchConfig): Promise<NormalizedSearchResponse>
}
```

The normalized model collapses variation into uniform fields:

```
NormalizedSearchResponse {
  query: string
  provider: string
  answer?: { text: string; citations: Citation[] }
  results: NormalizedResult[]
}
NormalizedResult {
  title: string
  url: string
  snippet: string
  content?: string       // full text (when available)
  published?: string     // ISO date (Stepfun)
  score?: number         // relevance (Tavily)
  favicon?: string
}
```

Key decisions per provider:

- **Tavily**: Pass `include_answer: true` to get a synthesized answer string; derive citations from `results[]` index references. Auth: `Authorization: Bearer <key>`.
- **Exa**: Use `outputSchema: { type: "text" }` to get `output.content` (answer) and `output.grounding[]` (field-level citations with url/title). Auth: `x-api-key: <key>`.
- **Stepfun REST**: No answer available; use `results[].snippet` + `results[].content`. Auth: `Authorization: Bearer <key>`.
- **Stepfun MCP**: Uses a stateless streamableHttp transport — send an `initialize` handshake (no session persisted), then `tools/call` with `name: "web_search"` and `arguments.input`. The response nests the identical REST result shape as a JSON string inside `result.content[0].text`. Same adapter can serve both Stepfun surfaces with different backends.

**Security**: Keys are BYOK, stored in `chrome.storage.local`, read only inside the background worker. The UI gets sanitized provider configuration status through worker messages (for example, configured provider IDs and active provider ID), and it sends newly typed keys to the worker for storage. It does not read the stored key map back from storage. Each adapter receives the key from the worker's secure context.

## Why This Matters

- **Isolation**: Each provider's quirks (Stepfun MCP's nested JSON, Exa's grounding schema, Tavily's index-based citations) live in one file. Breaking changes or new providers only touch one adapter.
- **UI simplicity**: Downstream components switch on `supportsAnswer` once at mount time, avoiding a cascade of conditionals per provider.
- **Security**: BYOK + worker-only key access means stored secrets do not leak into content scripts or page contexts. Worker-returned configuration status keeps the UI usable without exposing the `providerKeys` map.
- **Billing separation**: Each Stepfun adapter uses the same search backend but different meters (pay-as-you-go REST vs Step Plan MCP subscription). Separate adapters make it impossible to charge against the wrong account.

## When to Apply

- Integrating two or more external APIs that return semantically similar data (search results, LLM completions, vector embeddings).
- The consuming UI expects a single data shape regardless of backend.
- APIs differ in auth scheme, transport protocol, feature support, or response envelope.
- Security boundaries require worker-only access to credentials.

## Examples

**Adapter skeleton** (Tavily example):

```ts
// lib/providers/tavily.ts
export class TavilyAdapter implements ProviderAdapter {
  readonly name = 'tavily'
  readonly supportsAnswer = true

  private constructor(private key: string) {}
  static async create(): Promise<TavilyAdapter> {
    const key = await storage.getKey('tavily')
    return new TavilyAdapter(key)
  }

  async search(query: string, config: SearchConfig): Promise<NormalizedSearchResponse> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, include_answer: true, max_results: config.maxResults ?? 10 }),
    })
    if (res.status === 401) throw new AuthError('tavily')
    if (res.status === 429) throw new RateLimitError('tavily')
    const json = await res.json()
    return this.normalize(json, query)
  }

  private normalize(json: TavilyResponse, query: string): NormalizedSearchResponse { … }
}
```

**Adapter registry**:

```ts
// lib/gateway.ts
const adapters: Record<string, ProviderAdapter> = {
  tavily: await TavilyAdapter.create(),
  exa: await ExaAdapter.create(),
  'stepfun-rest': await StepfunRestAdapter.create(),
  'stepfun-mcp': await StepfunMcpAdapter.create(),
}

export async function search(provider: string, query: string) {
  return await adapters[provider].search(query, {})
}
```

**UI degradation** (React):

```tsx
function SearchResults({ response }: { response: NormalizedSearchResponse }) {
  return (
    <div>
      {response.answer && <AnswerBox text={response.answer.text} citations={response.answer.citations} />}
      {response.results.map(r => <ResultCard key={r.url} result={r} />)}
    </div>
  )
}
```

**Worker-only key access**:

```ts
// lib/storage.ts — never imported by UI entrypoints
export async function getKey(provider: string): Promise<string> {
  const data = await chrome.storage.local.get(providerKey(provider))
  return data[providerKey(provider)] ?? ''
}
```

```ts
// In settings/search UI — sanitized status, never the stored key map
const config = await sendMessage('getProviderConfig', undefined)
setConfiguredProviderIds(config.configuredProviderIds)

// Saving sends only the key currently typed by the user to the worker.
await sendMessage('saveProviderKey', { providerId: 'exa', key: typedKey })
```

## Related

- `docs/plans/2026-07-01-001-product-ai-search-for-humans-plan.md` — full product plan
- `lib/providers/` — adapter implementations
- `lib/gateway.ts` — worker-side dispatch
- `lib/messaging.ts` — webext-core messaging pattern (ok/error discriminant unions)
