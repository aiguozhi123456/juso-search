---
title: MCP server provider_id declared optional but worker bridge requires it
date: 2026-08-09
category: docs/solutions/integration-issues
module: mcp-server
problem_type: integration_issue
component: tooling
symptoms:
  - "MCP search tool call without provider_id returns invalid search request from the worker"
  - "provider_id typed as ProviderId | None = None (optional) but omitting it always fails"
  - "CLI skill requires --provider (argparse required=True) but MCP tool does not"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
tags: [mcp, provider-id, contract-drift, agent-bridge, parameter-alignment]
---

# MCP server provider_id declared optional but worker bridge requires it

## Problem

The MCP server's `search` tool declared `provider_id` as optional
(`provider_id: ProviderId | None = None`), but the extension's Agent Bridge
validator requires a non-null, valid `providerId`. Omitting the parameter
always failed with `invalid search request` — the "optional" default was
unreachable. This contradicted the product contract ("`search` must provide
`--provider`, never silently follows the extension's current provider") and
diverged from the CLI skill, which correctly requires `--provider`.

## Symptoms

- MCP `search` tool call without `provider_id` → worker returns
  `{ ok: false, error: "invalid search request" }` (the bridge validator
  rejects `providerId: null`).
- The tool's JSON schema advertised `provider_id` as non-required (not in the
  `required` array), misleading MCP clients into thinking it was optional.
- The CLI skill (`juso_search.py search --provider`) correctly enforced
  `--provider` as required via argparse — the two integration surfaces
  disagreed.

## What Didn't Work

- **Leaving it optional and relying on the worker to reject null.** This
  "worked" in the sense that the call failed, but it produced a confusing
  `invalid search request` error instead of a clear schema-level "required
  parameter missing" rejection. The MCP client never got a chance to validate
  before the bridge round-trip.
- **A test (`test_search_defaults`) that encoded the wrong behavior** — it
  asserted `provider_id=None` flows through to `run_bridge` when `search` is
  called without the param. This test locked in the bug.

## Solution

Make `provider_id` required in the MCP tool signature, matching the CLI:

```python
# mcp-server/juso_search/server.py — BEFORE (bug)
def search(
    query: str,
    provider_id: ProviderId | None = None,   # optional — but worker rejects null
    force_refresh: bool = False,
) -> CallToolResult:

# AFTER (fix)
def search(
    query: str,
    provider_id: ProviderId,                 # required — matches CLI --provider
    force_refresh: bool = False,
) -> CallToolResult:
```

Test changes:
- **Removed** `test_search_defaults` (it tested the invalid optional path).
- **Added** `assert "provider_id" in schema["required"]` to `test_search_schema`
  to lock the contract.
- **Updated** `test_bridge_error_kinds_surface` to pass `provider_id: "tavily"`
  (it previously called `search` without it to trigger error paths).
- **Updated** the schema assertion from `properties["provider_id"]["anyOf"][0]["$ref"]`
  (Optional → anyOf wrapper) to `properties["provider_id"]["$ref"]` (required →
  direct ref).

Also aligned MCP tool parameter **names** with CLI flags (drop the `_id`
suffix): `provider_id` → `provider`, `engine_id` → `engine`, `instance_id` →
`instance`. The internal `run_bridge` kwargs (`provider_id=`, `engine_id=`,
`instance_id=`) stay unchanged — only the client-visible tool schema params
were renamed.

## Why This Works

The extension's Agent Bridge validator (`lib/agent-bridge.ts`) enforces the
contract at the wire level:

```ts
export type AgentSearchRequest = { action: 'search'; query: string; providerId: ProviderId; ... };
// validator:
if (typeof value.providerId !== 'string' || !isProviderId(value.providerId))
    return { ok: false, error: 'invalid search request' };
```

`providerId` is a non-optional `ProviderId` in the TypeScript type and the
runtime validator rejects null/non-string. The MCP server's `| None = None`
default was a lie — it could never produce a successful search without a real
provider. Making it required moves the validation to the schema layer (the MCP
client sees "required" and rejects the call before it reaches the bridge),
producing a clearer error and an honest contract.

The root cause was **contract drift between two integration surfaces** (CLI
skill vs MCP server) that share the same bridge. The CLI was implemented first
with `--provider` required; the MCP server was added later and its author
defaulted `provider_id` to `None` without checking the bridge validator's
contract.

## Prevention

- **When two surfaces share a bridge, align their parameter contracts.** If
  the CLI requires a parameter, the MCP tool must too — and vice versa. Audit
  the bridge validator (`agent-bridge.ts`) as the source of truth, not the
  CLI's argparse config.
- **Test the schema, not just the dispatch.** `assert "provider_id" in
  schema["required"]` catches a regression where someone re-adds `| None =
  None`. The original test suite only checked `"query" in required` — it
  didn't lock the provider contract.
- **Don't write tests that encode bugs.** `test_search_defaults` asserted that
  omitting `provider_id` sends `None` to `run_bridge` — it locked in the
  invalid behavior. When fixing the bug, the test had to be deleted, not
  updated.
- **Parameter naming: align client-visible names with the CLI.** MCP clients
  see the tool schema; `provider` (matching `--provider`) is less surprising
  than `provider_id`. Internal kwargs can keep their original names.

## Related

- `lib/agent-bridge.ts:15` — `AgentSearchRequest` type (providerId required)
- `lib/agent-bridge.ts:237-245` — bridge validator (rejects null providerId)
- `mcp-server/juso_search/server.py` — MCP tool definitions
- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — the shared bridge architecture
- Root `README.md` — product contract: "search 必须提供 --provider，不会悄悄跟随扩展当前服务"
