---
title: Keyless Free Tier for Providers (key 可选机制)
date: 2026-10-25
category: architecture-patterns
module: providers
problem_type: architecture_decision
component: extension
severity: medium
applies_when:
  - "Exposing a provider's anonymous/keyless free tier in the quick-switch bar and agent bridge"
  - "Widening the configuredProviderIds semantics beyond stored-key presence"
  - "Handling upstream error bodies that embed auto-generated credentials"
tags:
  - keyless
  - key-optional
  - byok
  - tavily
  - jina
  - anysearch
  - provider-registry
  - source-projection
---

# Keyless Free Tier for Providers (key 可选机制)

## Context

Several of the eleven providers ship anonymous free tiers that work with no API key, quota
metered per IP: Tavily (official keyless mode — same `/search` endpoint with
`X-Tavily-Access-Mode: keyless` instead of `Bearer`, identical response schema), Jina
(`s.jina.ai` without `Authorization`, ~20 RPM/IP), and AnySearch (official anonymous tier on
`/v1/*`; lower limits). The gateway previously hard-gated every provider on a stored key
(`runProviderSearch` returned `keyMissing`), and every "is this provider usable" derivation
was a scattered `keys[p.id]` boolean, so these tiers were unreachable.

## Guidance

### Mechanism

- `ProviderAdapter.keyOptional?: boolean` declares the capability on the adapter
  (`lib/providers/types.ts`); the gateway passes an **empty-string apiKey** when no key is
  stored, and each adapter decides what that means (omit `Authorization`, or swap in the
  upstream's keyless header — Tavily's case). Never send both auth headers.
- One predicate, zero scattered booleans: `isProviderUsable(id, keys)` in
  `lib/providers/registry.ts` (`keys[id] || keyOptional`) replaced every `keys[...]`
  derivation across `provider-keys-store` / `shared` / `snapshot` / `source-graph-store` /
  `sources`. New derivations must go through it.
- `configuredProviderIds` semantics widened to **usable** (keyed or keyless) — it keeps
  driving quick-switch projection, aggregate eligibility, agent-bridge `configured`, and
  deep-link validation unchanged. A new sanitized `keyedProviderIds` list (snapshot +
  `ProviderConfigReply`) serves the key-specific options UI (configured badge, delete
  button, override placeholder), because the usable list can no longer answer "has a key".
- **Two-tier active-source fallback** (`preferredProviderFallback`): keyed providers in
  registry order outrank keyless ones. Explicitly chosen sources always win (validated by
  the usable predicate — a chosen keyless provider persists). This keeps existing keyed
  users' fallbacks from drifting to Tavily while still giving fresh installs an
  out-of-the-box working source.
- Product decision (confirmed by owner): keyless providers are **visible by default** in
  the quick-switch bar **and may serve as the active-source fallback** — a fresh install's
  default source is the first keyless provider in registry order (Tavily), not Google.
  Queries reach the third-party API only on an explicit user search action, so this does
  not violate the "no default scope expansion without explicit choice" boundary.

### Security invariants

- **AnySearch 402**: the anonymous-tier-exhausted response body carries auto-generated
  credentials. The adapter maps 402 (keyless path only) to `ProviderError('rateLimit')`
  with a dedicated i18n message via the `overrideStatusError` restTransport hook, **with
  the body discarded** — it must never enter `errorDetail`, which reaches UI surfaces.
  Keyed 402 keeps the default provider-kind mapping.
- **Rate-limit hint is worker-side only**: pages see only `configuredProviderIds` (usable
  semantics) and cannot distinguish keyed from keyless (BYOK boundary), so the
  "configure a key for higher limits" hint appended to keyless rateLimit errors is
  synthesized in the gateway (`withKeylessRateLimitHint`).
- BYOK boundary unchanged: keyless = worker passes `''`; pages touch no new data.

### Test-ripple playbook

Widening usability semantics flips fresh-install expectations: default active
provider/source (`null`/`google` → `tavily`), `getConfiguredProviderIds` now always
includes the keyless set, hidden-set repair tests must hide keyless providers too
(otherwise a visible keyless source satisfies the "≥1 visible usable" guarantee and the
repair never fires), and delete-instance fallback lands on the first visible-usable
source. Component tests that mock `getProviderConfig` must add `keyedProviderIds` and
target the keyless placeholder for unkeyed keyless rows.

## References

- `lib/providers/registry.ts` — `isProviderKeyless` / `isProviderUsable` / `preferredProviderFallback`
- `lib/providers/http.ts` — `overrideStatusError` hook
- `lib/gateway.ts` — keyless gate + `withKeylessRateLimitHint`
- Supersedes the "intentionally not wired" note in
  `docs/solutions/tooling-decisions/deepseek-anysearch-providers.md` (AnySearch section)
