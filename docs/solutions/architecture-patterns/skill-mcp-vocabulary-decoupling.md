---
title: "Runtime discovery for Agent Skill and MCP vocabulary (eliminate provider/engine tuple drift)"
date: 2026-08-10
last_updated: 2026-08-15
category: architecture-patterns
module: agent-bridge
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "A downstream surface (CLI skill, MCP server, docs) mirrors a TS-side union/registry that evolves independently"
  - "Adding a provider/engine to the extension should be a one-line registry change, not an N-touch manual propagation"
  - "The extension is the authoritative source of its own vocabulary and runs in the user's own browser"
  - "A bridge or MCP layer is a transport layer, not a policy layer"
tags: [agent-bridge, juso-skill, mcp-server, runtime-discovery, drift, single-source-of-truth, provider-registry, engine-registry]
---

# Runtime discovery for Agent Skill and MCP vocabulary (eliminate provider/engine tuple drift)

## Context

The Juso Search extension (WXT + React + TypeScript, Chrome MV3) ships two external interfaces for AI agents:

1. **Agent Skill** — a Python CLI (`juso_search.py` + `juso_bridge.py`) that launches a local loopback HTTP bridge to the extension. The Python side binds `127.0.0.1` on an OS-assigned port, launches Chromium with a `chrome-extension://<id>/bridge.html#v=1&p=<port>&t=<token>` URL, the extension claims the request over `/v1/claim`, processes it through the worker gateway (`lib/gateway.ts`), and POSTs the reply back over `/v1/complete`. The Python side validates the reply shape before returning it.
2. **MCP server** — a pip package (`juso-search`) that exposes the same six bridge actions (`search`, `engine-search`, `search-instance`, `list-providers`, `list-instances`, `list-engines`) as MCP tools over stdio.

Both interfaces are thin transport layers. The authoritative source of the provider and engine vocabularies lives in the extension itself: `lib/providers/types.ts` defines `ProviderId` as a TypeScript union and `allProviders()` reads the registry; `lib/engines/` together with `allEngines()` define the engine registry. Adding a provider or engine is meant to be a one-line registry change.

In practice, however, the two external interfaces carried **six hardcoded coupling points** that manually mirrored those TS unions. Every addition of a provider or engine required touching all of them by hand:

1. **`juso_bridge.py` lines 79-80** — two module-level tuples, byte-copied to four locations by `scripts/gen_skills.py`:
   ```python
   PROVIDERS = ("tavily", "exa", "brave", "stepfun", "stepfun-plan", "jina", "doubao", "doubao-global")
   ENGINES = ("google", "bing", "baidu", "yandex", "duckduckgo", "bilibili", "xiaohongshu", "douyin")
   ```
2. **`lib/agent-bridge.ts` line 220** — a hardcoded literal engine array instead of the dynamic `isEngineId()` function:
   ```ts
   ['google', 'bing', 'baidu', 'yandex', 'duckduckgo', 'bilibili', 'xiaohongshu', 'douyin'].includes(value.engineId)
   ```
3. **`juso_search.py` lines 62, 66** — `argparse` `choices=PROVIDERS` / `choices=ENGINES` constraints on `--provider` and `--engine`.
4. **`mcp-server/server.py` lines 39-40** — `ProviderId`/`EngineId` enums built from the tuples and rendered as JSON Schema enums in the MCP tools' `inputSchema`:
   ```python
   ProviderId = Enum("ProviderId", {provider: provider for provider in juso_bridge.PROVIDERS})
   EngineId = Enum("EngineId", {engine: engine for engine in juso_bridge.ENGINES})
   ```
5. **Hardcoded provider/engine name lists in prose** — `SKILL.md` line 33, `server.py` tool descriptions, and `README.md` all enumerated the same ids in free text.
6. **`tests/scripts/test_juso_bridge.py` lines 371-376** — a test that locked the tuple contents, turning the drift into a lock rather than a guard.

The friction was not merely that these updates were tedious. The deeper problem is that the drift is **invisible to each side's isolated tests**: the TS suite asserted `allProviders()` returned the right count; the Python suite asserted `PROVIDERS` had the right count; no test asserted the two sets were equal. The earlier learning `docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md` documented exactly this failure mode concretely — `brave` was added to the TS `ProviderId` union but missed in Python's `PROVIDERS` tuple, and every `list-providers` call failed with `extension_did_not_complete` because the Python validator rejected the worker's valid 8-provider reply as `invalid_reply`. That learning's Prevention section prescribed "a provider set equality test" — a per-instance patch. This learning generalizes the root cause and fixes it **structurally**: the downstream surface should not hold a copy of the vocabulary at all.

## Guidance

**Discover vocabulary at runtime from the extension; never hardcode it in a downstream surface.** The extension is the user's own code running in their own browser; it is the authoritative source of its own vocabulary. The bridge and the MCP server are transport layers, not policy layers. The six changes below implement that principle end to end.

### A. Add a `list-engines` bridge action (mirrors the existing `list-providers`)

The bridge already had `list-providers` for provider discovery. Engines had no equivalent, so the only way for a client to know the engine set was to read the hardcoded tuple. Add a parallel discovery action:

- **Request:** `{ action: 'list-engines' }` — no extra fields.
- **Reply:** `{ engines: [{ id: string }] }` — just the id, no label or metadata.
- **TS gateway handler** `handleListAgentEngines` returns `allEngines().map(e => ({ id: e.id }))`, exactly mirroring how `handleListAgentProviders` reads `allProviders()`.
- **Wired into `AgentBridgeDeps`** as an optional `listEngines?` dependency, so the same injection seam that gates provider listing also gates engine listing.
- **Exposed in the CLI** as a `list-engines` subcommand and **in the MCP server** as a `list-engines` tool.

The reply shape is deliberately minimal. Engines are behaviorally homogeneous from the agent's perspective — every engine accepts `query` + `engineId` + `maxResults` and returns either `{ engine, query, results }` or `{ engine, query, error }`. There is no need for the `configured` / `supportsAnswer` / `hasInstances` fields that `list-providers` carries, because those are provider-specific concepts (a provider may or may not be configured with a key; a provider may or may not support answer mode; a provider may have instances). Engines have none of those axes.

### B. Remove `PROVIDERS` / `ENGINES` tuples entirely from `juso_bridge.py`

The tuples were the single most dangerous coupling point — they were the mirror that `gen_skills.py` byte-copied to four locations and that every validator checked against. Remove them from the module constants and from `__all__`. Then relax every reply validator that checked vocabulary *membership* into a check of vocabulary *shape* (non-empty string):

**Before** (`juso_bridge.py`, validators):
```python
PROVIDERS = ("tavily", "exa", "brave", "stepfun", "stepfun-plan", "jina", "doubao", "doubao-global")
ENGINES = ("google", "bing", "baidu", "yandex", "duckduckgo", "bilibili", "xiaohongshu", "douyin")

def is_search_reply(reply):
    provider = reply.get("provider")
    if provider not in PROVIDERS:          # vocabulary membership
        return False
    ...

def is_provider_list_reply(reply):
    for provider in reply.get("providers", []):
        if provider["id"] not in PROVIDERS:  # vocabulary membership
            return False
    ...

def is_instance_list_reply(reply):
    for instance in reply.get("instances", []):
        if instance["providerId"] not in PROVIDERS:  # vocabulary membership
            return False
    ...

def is_engine_search_reply(reply):
    engine = reply.get("engine")
    if engine not in ENGINES:              # vocabulary membership
        return False
    ...
```

**After** (`juso_bridge.py`, validators):
```python
# PROVIDERS / ENGINES tuples removed entirely.
# Validators now check shape (non-empty string), not vocabulary membership.

def is_search_reply(reply):
    provider = reply.get("provider")
    if not (isinstance(provider, str) and provider):
        return False
    ...

def is_provider_list_reply(reply):
    for provider in reply.get("providers", []):
        if not (isinstance(provider["id"], str) and provider["id"]):
            return False
    ...

def is_instance_list_reply(reply):
    for instance in reply.get("instances", []):
        if not (isinstance(instance["providerId"], str) and instance["providerId"]):
            return False
    ...

def is_engine_search_reply(reply):
    engine = reply.get("engine")
    if not isinstance(engine, str) or not engine:
        return False
    ...
```

The validators still protect the Python side from malformed replies (missing field, wrong type, empty string). What they no longer protect is vocabulary correctness — because that is not the Python side's job. The extension validates the id via `isProviderId()` / `isEngineId()` on the claim side, and the reply just echoes back the already-validated id.

### C. CLI: remove `choices=` argparse constraints

`--provider` and `--engine` now accept any string; the extension validates at runtime.

**Before** (`juso_search.py`):
```python
parser.add_argument("--provider", choices=PROVIDERS, required=True)
parser.add_argument("--engine", choices=ENGINES, required=True)
```

**After** (`juso_search.py`):
```python
parser.add_argument("--provider", required=True)
parser.add_argument("--engine", required=True)
```

An invalid id no longer gets a local argparse rejection ("choose from 'tavily', 'exa', ..."); instead it gets a runtime error from the extension, classified through the existing error taxonomy. This is preferable: the error message comes from the authoritative source, the set is never stale, and `--help` no longer lies about what is accepted.

### D. MCP: replace enums with plain strings

The MCP server previously built `ProviderId` / `EngineId` enums from the tuples and rendered them as JSON Schema `enum` arrays in the tools' `inputSchema`. A client that cached the tool list at handshake time would pin whatever set it saw; a client that connected to a newer extension would see a stale enum. Replace the enums with plain strings and point clients at discovery.

**Before** (`mcp-server/server.py`):
```python
from enum import Enum
ProviderId = Enum("ProviderId", {provider: provider for provider in juso_bridge.PROVIDERS})
EngineId = Enum("EngineId", {engine: engine for engine in juso_bridge.ENGINES})

# search tool inputSchema:
{ "provider": { "type": "string", "enum": [...all provider ids...] } }
# engine-search tool inputSchema:
{ "engine":  { "type": "string", "enum": [...all engine ids...] } }

# instance id pattern (provider vocabulary baked in):
_INSTANCE_ID_PATTERN = r"^inst:(?:tavily|exa|brave|stepfun|stepfun-plan|jina|doubao|doubao-global):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
```

**After** (`mcp-server/juso_search/server.py`):
```python
# ProviderId / EngineId enums removed.

# search tool inputSchema:
{ "provider": { "type": "string", "description": "Provider id. Call list-providers to discover available ids." } }
# engine-search tool inputSchema:
{ "engine":  { "type": "string", "description": "Engine id. Call list-engines to discover available ids." } }

# instance id pattern: format-only, no provider vocabulary:
_INSTANCE_ID_PATTERN = r"^inst:[A-Za-z0-9][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"
```

Tool descriptions that previously enumerated the provider/engine list now say "call `list-providers` / `list-engines` to discover available ids." The instance-id regex is loosened from "one of these known providers" to "the `inst:<providerId>:<instanceName>` shape" — it validates format, not membership.

A **lazy-enum** alternative (populate the enum at server startup by calling `list-providers` once) was explicitly rejected. It would require launching Chromium at startup, which is slow and may fail (Chrome not installed, extension not enabled, wrong profile); the result goes stale the moment a provider is added or removed without restarting the MCP server; and it breaks the stateless, one-bridge-cycle-per-call contract that makes the MCP server a thin relay. Plain string with a discovery instruction is the right tradeoff: the client pays one extra `list-providers` / `list-engines` call when it needs the set, and the set it gets is always live.

### E. Fix the TS-side engine validation to use the dynamic function

Even the TS side had a hardcoded copy — `lib/agent-bridge.ts` line 220 validated the incoming `engineId` against a literal array instead of the dynamic `isEngineId()` function. This is the same drift, one layer up, and it meant adding an engine to the registry would not automatically make it accepted by the bridge claim handler.

**Before** (`lib/agent-bridge.ts`):
```ts
if (!['google', 'bing', 'baidu', 'yandex', 'duckduckgo', 'bilibili', 'xiaohongshu', 'douyin'].includes(value.engineId)) {
  return { ok: false, error: { kind: 'invalid_engine_id', ... } };
}
```

**After** (`lib/agent-bridge.ts`):
```ts
if (!isEngineId(value.engineId)) {
  return { ok: false, error: { kind: 'invalid_engine_id', ... } };
}
```

`isEngineId()` is generated from `allEngines()`, so a registry change flows through automatically. The provider side already used `isProviderId()`; this just brings the engine side to parity.

### F. Call `/v1/abort` on claim-side rejection in `bridge/main.ts`

When the extension rejects a claim (for example, because the `providerId` or `engineId` is invalid), `runAgentBridge` in `entrypoints/bridge/main.ts` returned `{ ok: false }` without calling either `/v1/complete` or `/v1/abort`. The Python side therefore waited the full 40-second timeout before reporting `extension_did_not_complete`. With vocabulary validation now happening entirely at the extension and arbitrary strings flowing through the CLI/MCP, an invalid id is a normal, expected error path — not a timeout.

The fix extracts an `abortBridge(credentials, reason)` helper and calls it in both the `!result.ok` branch and the `catch` branch:

**Before** (`entrypoints/bridge/main.ts`, sketch):
```ts
const result = await sendMessage('agentBridgeClaim', { ... });
if (!result.ok) {
  return;  // silent — Python waits 40s
}
```

**After** (`entrypoints/bridge/main.ts`):
```ts
async function abortBridge(credentials: BridgeCredentials, reason: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${credentials.port}/v1/abort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    // Python server may be gone — skill will time out
  }
}

const result = await sendMessage('agentBridgeClaim', { ... });
if (!result.ok) {
  await abortBridge(credentials, result.error?.kind ?? 'claim_rejected');
  return;
}
```

This reuses the `/v1/abort` back-channel introduced in `docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md` (Bug 3) — that learning wired it for fragment parse failures; this learning wires it for claim-side rejections, completing the fast-failure story.

### G. Update docs to point at discovery instead of enumerating

All hardcoded lists in `SKILL.md`, the `reference/*` files, and `README.md` were replaced with "call `list-providers` / `list-engines` to discover available ids." Documentation that enumerates a set that evolves is just another hardcoded copy, and it drifts just as silently.

## Why This Matters

**The drift problem is structural, not per-instance.** The `agent-bridge-skill-contract-drift.md` learning documented `brave` missing from `PROVIDERS` and prescribed a set-equality test as prevention. That prevention is correct but tactical: it catches the next drift at test time, but it does not remove the cause — there is still a second copy of the vocabulary that can drift. Runtime discovery removes the copy. There is nothing to test for equality because there is nothing to mirror. The registry is consulted live, every time, by the only party that owns it.

**Trust boundary alignment.** The extension is the user's own code running in their own browser. It holds the keys, the registries, and the validation functions (`isProviderId`, `isEngineId`) generated from those registries. The bridge and the MCP server are transports: they carry bytes between the Agent and the extension; they do not decide what is valid. Keeping vocabulary validation on the Python/MCP side inverts that boundary — it lets a downstream surface overrule or lag the authority. Relaxing the Python validators to shape checks and letting the extension validate membership restores the boundary: the extension says yes or no; the transport just carries the answer.

**Fast failure replaces 40-second timeouts.** When validation lived only on the Python side (via `choices=` and tuple membership), an invalid id was rejected locally in milliseconds — but that rejection was against a potentially stale copy, so it could reject a valid id. When validation moved to the extension, an invalid id had to round-trip to the extension to be rejected — and until change F, that rejection was silent on the `/v1/abort` channel, so the Python side burned its full 40-second timeout. The `abortBridge` wiring makes the new boundary usable in practice: invalid ids fail in seconds, not 40 seconds, with a classified error kind rather than `extension_did_not_complete`.

**Why codegen was rejected.** Generating the Python tuples from the TS union at build time (`scripts/gen_skills.py` already byte-copies files; it could render tuples too) would reduce manual updates but re-introduces drift at a different layer: the generated artifact is still a copy, it is only as fresh as the last build, and it requires the consumer (skill, MCP server) to be rebuilt whenever the registry changes — which a published pip package cannot guarantee. Runtime discovery eliminates the copy entirely, at the cost of one extra `list-*` call when a client needs the set.

**Why lazy-enum at MCP startup was rejected.** Populating the JSON Schema enum once, at MCP server startup, seems like a middle ground — discover at runtime, but still present an enum. It is worse than plain string: it requires launching Chromium at startup (slow, may fail, couples server boot to browser state); the enum is frozen for the server's lifetime and goes stale on any registry change without a restart; and it violates the stateless, one-bridge-cycle-per-call contract that keeps the MCP server a thin relay. Plain string plus a discovery instruction preserves statelessness and liveness at once.

**Protocol compatibility is preserved.** `list-engines` was added without bumping the protocol version (it stays at 2). Adding an action is backward-compatible: an old skill never calls `list-engines` and is unaffected; a new skill that calls `list-engines` against an old extension gets a clean `unknown_action` error path rather than a hang. The same backward-compatibility discipline applies to the MCP tool list — adding a tool is additive.

## When to Apply

- A downstream surface (CLI skill, MCP server, generated SDK, docs page) mirrors a TS-side union or registry that evolves independently, and the two are maintained by hand.
- Adding a provider/engine/capability to the extension should be a one-line registry change, not an N-touch manual propagation across surfaces.
- The authoritative source runs in the user's own process (their browser) and is reachable at runtime by the downstream surface over a local channel — i.e., the downstream surface can ask.
- The bridge or MCP layer is a transport layer, not a policy layer; it should not decide what is valid, only carry what is asked.
- A hardcoded copy has already drifted at least once (as `brave` did), or cross-end equality tests are absent and each side's suite only asserts its own internal count.

Do not apply this pattern when the authoritative source is **not** reachable at runtime by the downstream surface (for example, a published SDK consumed offline against a registry the user does not have running). In that case, codegen against a versioned artifact — or a versioned enum shipped with the SDK — is the correct tool, and the drift must be managed by version pinning rather than eliminated by discovery. The discovery pattern specifically requires that the consumer can ask the authority live.

## Examples

### Discovering providers and engines before a search

**Before** (hardcoded, drift-prone):
```bash
# SKILL.md told the agent the providers were exactly these eight:
python scripts/juso_search.py search "latest AI research" --provider tavily
# argparse rejected anything else with choices=[...8 ids...]
```

**After** (discover, then call):
```bash
python scripts/juso_search.py list-providers
# -> {"ok": true, "providers": [{"id": "tavily", ...}, {"id": "exa", ...}, {"id": "brave", ...}, ...]}
python scripts/juso_search.py list-engines
# -> {"ok": true, "engines": [{"id": "google"}, {"id": "bing"}, ...]}
python scripts/juso_search.py search "latest AI research" --provider tavily
python scripts/juso_search.py engine-search "latest AI research" --engine google --max-results 10
```

The MCP surface mirrors this: a client calls the `list-providers` / `list-engines` tools when it needs the set, then calls `search` / `engine-search` with a plain string.

### Invalid id fails fast, not in 40 seconds

**Before** (after the vocabulary moved to the extension but before change F):
```text
$ python scripts/juso_search.py search "x" --provider notarealprovider
# extension rejects the claim, returns { ok: false } silently
# Python waits the full 40s timeout
# -> {"ok": false, "error": {"kind": "extension_did_not_complete", ...}}
```

**After** (change F wired):
```text
$ python scripts/juso_search.py search "x" --provider notarealprovider
# extension rejects the claim, calls /v1/abort with reason 'invalid_provider_id'
# Python receives the abort within seconds
# -> {"ok": false, "error": {"kind": "extension_did_not_complete", "message": "bridge aborted: invalid_provider_id; ..."}}
```

### MCP tool inputSchema: enum -> plain string + discovery

**Before:**
```json
{
  "name": "search",
  "inputSchema": {
    "type": "object",
    "properties": {
      "provider": { "type": "string", "enum": ["tavily", "exa", "brave", "stepfun", "stepfun-plan", "jina", "doubao", "doubao-global"] }
    }
  }
}
```

**After:**
```json
{
  "name": "search",
  "inputSchema": {
    "type": "object",
    "properties": {
      "provider": { "type": "string", "description": "Provider id. Call list-providers to discover available ids." }
    }
  }
}
```

### TS-side validation uses the dynamic function

**Before** (`lib/agent-bridge.ts:220`):
```ts
['google', 'bing', 'baidu', 'yandex', 'duckduckgo', 'bilibili', 'xiaohongshu', 'douyin'].includes(value.engineId)
```

**After** (`lib/agent-bridge.ts:220`):
```ts
isEngineId(value.engineId)
```

Adding a ninth engine to the registry now flows through to the bridge claim handler with no second edit.

## Related

- `docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md` — the concrete instance (`brave` missing from `PROVIDERS`) that motivated this structural fix; documents the `/v1/abort` back-channel (Bug 3) that change F extends to claim-side rejections, plus process cleanup and Windows encoding fixes.
- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — intended bridge architecture; documents the `#v=1` fragment format, the claim/complete protocol, and the two-layer opt-in gating. The `list-engines` action and the `/v1/abort`-on-rejection path are additions to that protocol.
- `docs/solutions/architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md` — the registry-is-authoritative principle for the engine whitelist; this learning generalizes it from "mirror must be tested for equality" to "do not maintain a mirror at all."
- `docs/solutions/architecture-patterns/agent-skill-distribution-pipeline.md` — the `scripts/gen_skills.py` single-source template + drift-lock discipline; this learning removes the tuples that the drift lock was byte-copying, so the lock now covers fewer (and less dangerous) surfaces.
- `docs/solutions/architecture-patterns/default-off-capability-gating-for-cws-compliance.md` — why `list-engines` and `engine-search` must remain behind the existing `agentBridgeEnabled` / `engineSearchEnabled` opt-in gates; discovery does not relax gating.
- `skills/juso-search/SKILL.md`, `lib/agent-bridge.ts`, `lib/gateway.ts`, `entrypoints/bridge/main.ts`, `mcp-server/juso_search/server.py`, `public/agent-skill/scripts/juso_bridge.py`
