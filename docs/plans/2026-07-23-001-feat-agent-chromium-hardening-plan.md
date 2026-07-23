---
title: Agent Chromium Invocation Hardening - Plan
type: feat
date: 2026-07-23
topic: agent-chromium-hardening
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Agent Chromium Invocation Hardening - Plan

## Goal Capsule

- **Objective:** Make local Agent calls through the Juso skill fail in a way Agents can act on: structured launch/bridge errors, and clear guidance for custom Chromium browser path and profile selection—without changing the Agent Bridge security model.
- **Product authority:** This contract defines Agent-facing failure semantics, custom-path experience, and Chromium-first scope for skill-side invocation hardening.
- **Execution profile:** Skill-side Python + docs; unit tests via `npm run test:python`. No extension worker protocol change. No real-browser CI gate.
- **Stop conditions:** Do not alter claim/complete HTTP protocol, sender trust, loopback binding, or key isolation. Do not add multi-browser auto-retry or a required `doctor` command.
- **Open blockers:** None.
- **Product Contract preservation:** Product Contract unchanged (R/A/F/AE IDs and scope preserved). Planning resolved Deferred-to-Planning tokens for error kinds, Edge discovery, and stderr.

---

## Product Contract

### Summary

Harden the Agent invocation path on Chromium browsers by replacing opaque timeouts with structured error kinds and by treating custom browser executable / profile / extension-id configuration as a first-class recovery path in skill docs and error messages.
Default browser discovery may gain only light Chromium-family coverage if planning finds it free; the primary path story is “point at the browser that has the extension installed.”

### Problem Frame

Agent search depends on a short-lived loopback bridge: the skill launches a Chromium binary to open `chrome-extension://…/bridge.html`, the extension worker claims the request, runs the action, and completes.
That protocol is already hardened for trust, size limits, and deadlines.
What still fails poorly for users who have not yet hit production incidents is the **pre-claim and lifecycle surface**: wrong or missing browser binary, wrong profile, extension not installed in the opened browser, or silent wait until a generic `timeout`.
Custom path and profile flags already exist (`--chrome` / `JUSO_CHROME_PATH`, `--profile` / `JUSO_CHROME_PROFILE`, extension id overrides), but skill copy and error payloads do not consistently teach Agents how to recover.
Product intent remains Chromium-first; Firefox/Safari multi-target is out of identity for this work.

### Key Decisions

- **Skill-side only:** Diagnose and document from the launcher and loopback state the skill already owns. Do not redesign claim/complete, worker trust checks, or host permissions in this round.
- **Structured error kinds over doctor:** Agents consume JSON `error.kind` (and actionable `message`). No new primary `doctor` / smoke command.
- **Custom path is the recovery story:** Explicit browser path remains the supported way to use Edge, Brave, portable Chromium, or non-default installs. Default candidate expansion is secondary and must not hide “open the browser that has the extension.”
- **Claim lifecycle distinguishes failures:** Use whether claim and complete occurred to split former catch-all timeout into Agent-actionable kinds, without inventing false certainty about remote browser state.
- **Success reply shape stays compatible:** Successful search, list-providers, and engine-search replies keep their current contracts. Failure kinds are an additive/refined error surface for launch and bridge connectivity.

### Actors

- A1. **Local AI Agent:** Invokes `juso_search` commands and must branch on structured errors without reading API keys.
- A2. **Human operator:** Installs the extension in a Chromium browser, may set path/profile/env overrides when auto-discovery fails.
- A3. **Juso extension worker:** Claims and completes bridge requests; unchanged security and capability surface in this plan.

### Requirements

**Structured launch and bridge errors**

- R1. When the skill cannot resolve a usable browser executable, it returns a structured error with kind `chrome_not_found` (descriptive: browser not found), with a message that names the custom-path override mechanism (CLI flag and env var).
- R2. When process launch fails at the OS level, it returns a structured error with kind `chrome_launch_failed` (descriptive: browser launch failed), including enough of the OS reason for an Agent to surface to a human.
- R3. When the wait ends without a successful complete, the skill must not collapse every case into a single opaque timeout if skill-side state can distinguish:
  - extension never claimed (likely wrong browser, wrong profile, extension disabled/missing, or wrong extension id);
  - claim happened but complete did not (worker/action/complete path failed or stalled);
  - residual wait failure that cannot be classified more tightly (only as a last resort).
- R4. Each structured error includes a short, Agent-readable recovery hint: check custom browser path, profile directory name, extension id, and that the extension is installed and enabled in the browser instance that opens.
- R5. Successful command replies retain their existing JSON shapes and semantics so Agents that only handle success paths need no change.

**Custom Chromium path experience**

- R6. Skill documentation states that any Chromium-family executable may be selected via the existing custom path mechanism, and that the chosen binary’s profile must be the one where Juso is installed.
- R7. Skill documentation and failure messages treat profile directory name and extension id overrides as peer recovery controls alongside browser path.
- R8. Compatibility language moves from “Google Chrome or Chromium only” to “Chromium-family browser with the extension installed,” while still documenting that auto-discovery defaults may only cover common Chrome/Chromium installs.
- R9. Light expansion of default discovery candidates (e.g. Edge) is allowed only when it does not change the primary recovery story and does not claim cross-browser product support beyond Chromium sideloading.

**Scope discipline**

- R10. The claim/complete protocol, bridge sender trust rules, loopback host binding, and “keys never leave the worker” guarantee remain unchanged.
- R11. No multi-candidate automatic retry that opens successive browsers until claim succeeds.
- R12. No new primary self-check command as the main deliverable of this work.

### Key Flows

- F1. **Custom path recovery**
  - **Trigger:** Agent run fails with browser-not-found or extension-never-claimed after auto-discovery.
  - **Actors:** A1, A2
  - **Steps:** Agent surfaces structured error; human or Agent config sets browser path (and profile/id if needed) to the install that has Juso; retry succeeds with unchanged success JSON.
  - **Covered by:** R1, R3, R4, R6, R7

- F2. **Claim vs complete classification**
  - **Trigger:** Bridge wait expires or ends without a usable reply.
  - **Actors:** A1, A3
  - **Steps:** Skill inspects loopback lifecycle state it already tracks; emits the finest kind it can honestly assert; Agent chooses next step (fix path/profile/id vs treat as extension/runtime failure) without guessing from a single timeout string.
  - **Covered by:** R3, R4, R5, R10

### Acceptance Examples

- AE1. **Covers R1, R4.** Given no Chrome/Chromium on PATH and no custom path, when the Agent runs `list-providers`, then stdout is one JSON error with kind `chrome_not_found` and a message that points at the custom path flag/env.
- AE2. **Covers R3, R4, R7.** Given a browser launches but Juso is not installed in that profile (or extension id is wrong), when the wait ends without claim, then the error kind is `extension_did_not_claim` (not a generic timeout), and recovery text mentions profile and extension id.
- AE3. **Covers R3, R5.** Given claim succeeds and a normal provider search completes, when the skill finishes, then the success JSON shape matches today’s search reply contract.
- AE4. **Covers R6, R8.** Given Edge (or another Chromium binary) is selected via custom path and hosts the extension, when the Agent runs a command, then the skill treats that path as valid and does not require Google Chrome branding.
- AE5. **Covers R10–R12.** Given any failure mode in this plan, when the skill responds, then it has not opened a second browser automatically, has not introduced a required doctor subcommand, and has not altered bridge trust or key isolation.
- AE6. **Covers R2, R4.** Given a resolved browser path whose process launch fails at the OS level, when the Agent runs a command, then stdout is one JSON error with kind `chrome_launch_failed` and a message that includes enough of the OS reason for a human, plus recovery controls.

### Success Criteria

- An Agent can branch on error kinds without parsing free-form English alone.
- A human using only Edge (or another non-default Chromium install) can complete Agent setup by setting path/profile/id from skill docs and error hints.
- Existing automated Python bridge tests and Agent bridge unit tests remain the regression floor; planning adds cases for new kinds without requiring real-browser CI as a gate for this requirements set.

### Scope Boundaries

**Deferred for later**

- Broad default path matrices (Brave, Canary, Snap/Flatpak edge cases) beyond optional light Edge coverage.
- `--user-data-dir` / enterprise multi user-data launches.
- Optional secondary `doctor` command after structured errors ship.
- SERP Switch Bar / content-script navigation hardening on Chromium forks (separate from Agent external launch).
- Real-browser E2E CI for Agent bridge.

**Outside this product's identity for this work**

- Firefox or Safari as Agent launch targets.
- Replacing Agent Bridge with Native Messaging or a long-lived local API.
- Raising the same-OS-user attacker threat model beyond the existing accepted skill pattern.

### Dependencies / Assumptions

- Fixed extension id via packaged key remains the default; overrides stay for self-signed packs.
- Skill today tracks complete (`completed` Event + `reply`) but **does not** yet record that `/v1/claim` was served; classification requires a small skill-local claim observation flag (see KTD1). Worker protocol stays unchanged.
- Product remains Chromium MV3 first; Edge sideload of the same package is already an accepted human install path.

### Outstanding Questions

**Resolved in planning**

- Error kind tokens: see KTD2 (legacy `timeout` retained only as residual last resort).
- Light Edge default candidates: **docs-first this round**; optional one-line candidate append only if zero risk to recovery narrative (KTD4).
- stderr: keep **one JSON on stdout**; do not add a parallel structured stderr channel (KTD5).

### Sources / Research

- Agent Bridge concept and lifecycle notes in `CONCEPTS.md` (Agent Bridge).
- Skill contract and overrides in `skills/juso-search/SKILL.md`.
- Launcher discovery, loopback server, and current error kinds in `skills/juso-search/scripts/juso_search.py`.
- Worker claim path and trust checks in `lib/agent-bridge.ts`, `entrypoints/bridge/`, `entrypoints/background.ts` (read-only for this work).
- Architecture write-up: `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md`.
- Timeout-as-SW-bug pattern: `docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md`.
- Product baseline: Chromium MV3 first, Firefox later — `docs/plans/2026-07-01-001-juso-search-plan.md`.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. Observe claim on the skill loopback handler.**  
  `BridgeState` today sets `claim` before the server starts and only flips `completed` on successful `/v1/complete`. Successful authorized `/v1/claim` responses are idempotent and leave no “was claimed” bit, so never-claimed vs claimed-not-complete cannot be distinguished.  
  Add skill-local observation (e.g. `claimed` Event or boolean under the existing lock) set when `_claim` returns the claim payload successfully. Do **not** change HTTP status codes, claim body, complete schema, or worker behavior.

- **KTD2. Agent-facing launch/bridge `error.kind` tokens.**  
  Keep existing launch kinds; replace opaque wait `timeout` with classified kinds. Product R1/R2 prose is descriptive; **stable tokens** are the `chrome_*` / `extension_*` names below (do not rename to space-separated phrases).

  | kind | When | Exit |
  |------|------|------|
  | `invalid_extension_id` | ID fails a-p{32} check | 2 |
  | `chrome_not_found` | no executable resolved | 2 |
  | `chrome_launch_failed` | `Popen`/`OSError` | 1 |
  | `extension_did_not_claim` | wait ends; claim never observed | 1 |
  | `extension_did_not_complete` | wait ends; claim observed; no complete | 1 |
  | `wait_failed` | wait raises unexpectedly | 1 |
  | `timeout` | defensive residual only if claim observation is missing/non-binary; with KTD1 flag, prefer the two extension_* kinds | 1 |

  Shape stays `{"ok": false, "error": {"kind": str, "message": str}}`. Success replies and provider/engine error shapes unchanged.  
  Prefer snake_case tokens already used by the skill (`chrome_not_found`) over camelCase worker search errors (`keyMissing`) — launch errors are skill-owned, not gateway-owned.

- **KTD3. Recovery message pattern.**  
  Mirror existing `chrome_not_found` / `invalid_extension_id` style: short imperative naming CLI flag **and** env var for path, profile, and extension id as peers. Example intent (not final copy): for never-claimed, mention that the opened browser/profile must have Juso enabled and that path/profile/id can be overridden.

- **KTD4. Default discovery stays Chrome/Chromium-first; custom path is primary for Edge.**  
  Do **not** ship a broad multi-fork path matrix. Optional: append common Windows Edge `msedge.exe` candidates only if implementer judges it zero-risk and messages still prioritize custom path. Prefer docs examples for Edge over auto-picking Edge when Chrome is absent (wrong binary without extension is worse than `chrome_not_found`).

- **KTD5. One JSON on stdout; stderr remains free-form diagnostics only.**  
  Do not duplicate structured errors on stderr. Agents parse stdout only (existing contract in SKILL.md).

- **KTD6. Classification after wait only.**  
  After `completed.wait` returns false, branch on claim observation. Do not invent remote states (extension disabled vs wrong id vs adblock). Messages may list recovery checks; kinds stay binary on claim vs complete.

### High-Level Technical Design

```
run()
  resolve chrome → chrome_not_found | continue
  start loopback + BridgeState(claim ready, claimed=false, completed=false)
  Popen(chrome, [optional --profile-directory], chrome-extension://…/bridge.html#…)
    → chrome_launch_failed on OSError
  wait(completed, timeout)
    if completed → return reply (unchanged shapes)
    if not claimed → extension_did_not_claim + recovery message
    if claimed and not completed → extension_did_not_complete + recovery message
    else → timeout (residual)
```

Worker path (`lib/agent-bridge.ts`, bridge page, background handler) is **out of write scope**. Implementers may read it for mental model only.

### Assumptions

- Claim observation on successful `_claim` is a faithful proxy for “extension reached the skill”; false positives (claim without later complete) map to `extension_did_not_complete` intentionally.
- Agents that already branch on `timeout` should treat new kinds as refinements of the same failure class; docs list the kinds so Agents can update.
- README Agent sections should stay product-level; full flag table lives in `skills/juso-search/SKILL.md`.

### Implementation Constraints

- Touch only skill launcher, its tests, skill doc, and bilingual README Agent-facing failure/setup copy unless a one-line Edge candidate is added in the same launcher file.
- Preserve loopback host checks (`127.0.0.1` only), Bearer compare, claim idempotency, complete single-use.
- Do not add `doctor` subcommand, multi-candidate Popen loops, or Native Messaging.
- Do not change `tests/agent-bridge.test.ts` protocol expectations unless a regression is found (should be none).

### Sequencing

1. **U1** — claim observation + classified wait errors + recovery messages in `juso_search.py`.
2. **U2** — Python unit tests for claim flag and classification (depends on U1).
3. **U3** — SKILL.md + README.md / README.en.md Agent copy (depends on KTD2 tokens from U1).

U3 may start once kind names are frozen in U1; preferably land after U2 green.

### Research Notes

- Institutional: SW bare `fetch` can still surface as never-complete timeouts; classification separates that class (`extension_did_not_complete`) from install/profile mistakes (`extension_did_not_claim`). See `docs/solutions/runtime-errors/service-worker-fetch-illegal-invocation.md`.
- No new external framework research required; work is pure Python stdlib + existing unittest patterns.
- External research: skipped — strong local patterns; no new library.

---

## Implementation Units

### U1. Skill claim observation and structured wait errors

- **Goal:** Let the launcher honestly classify wait failures and emit recovery-oriented skill lifecycle errors without changing bridge HTTP contracts.
- **Requirements:** R1–R5, R9 (optional light discovery only), R10–R12, F1 (runtime half: structured error + recovery message), F2, AE1–AE3, AE5–AE6
- **Dependencies:** None
- **Files:**
  - Modify: `skills/juso-search/scripts/juso_search.py`
- **Patterns:**
  - `BridgeState` + lock around complete (`juso_search.py` ~159–254)
  - Existing error shape and exit codes (`run` ~309–335)
  - Message style naming flag + env (`invalid_extension_id`, `chrome_not_found`)
- **Approach:**
  - Add claim observation set on successful authorized `_claim` response path.
  - After failed `completed.wait`, map to `extension_did_not_claim` / `extension_did_not_complete` (residual `timeout` only if observation missing).
  - Enrich messages for those kinds and for `chrome_not_found` / `chrome_launch_failed` so path, profile, and extension id are peer recovery controls.
  - Keep success pass-through and provider/engine reply validators unchanged; preserve existing `chrome_not_found` kind/exit (AE1 is mostly message enrichment + regression).
  - Optional: only if trivial and narrative-safe, append Windows Edge path candidates; otherwise skip (KTD4 / R9).
- **Test scenarios:**
  - Covered primarily by U2; U1 is incomplete without U2 green.
- **Verification:**
  - `npm run test:python` (after U2 scenarios exist).
- **Execution posture:** characterization-friendly — extend existing loopback tests rather than inventing real browser launches.

### U2. Python tests for claim lifecycle classification

- **Goal:** Lock claim observation and classified wait kinds with unit tests; no real browser.
- **Requirements:** R1–R5, AE1–AE3, AE5–AE6; Success Criteria automated floor
- **Dependencies:** U1
- **Files:**
  - Modify: `tests/scripts/test_juso_search.py`
- **Patterns:**
  - importlib load of skill script (~14–18)
  - `BridgeServerTests` real loopback (~22–74)
  - `run(Namespace)` for lifecycle errors (~172–181)
  - `patch` for `shutil.which` / `subprocess.Popen` as needed
- **Approach:**
  - Assert successful `_claim` sets claim observation; complete still single-use.
  - Drive short-timeout `run()` (or equivalent helper) with mocked `Popen` and no claim → `extension_did_not_claim`.
  - After HTTP claim then wait without complete → `extension_did_not_complete`.
  - Mock `Popen` raising `OSError` → `chrome_launch_failed` (R2 / AE6).
  - Preserve existing `chrome_not_found` / `invalid_extension_id` / reply-shape tests; assert recovery message substrings for override flags where cheap.
  - Do not require Chrome installed.
- **Test scenarios:**
  - Claim endpoint sets observation flag (or Event).
  - Wait timeout with no claim → kind `extension_did_not_claim`, message mentions path/profile/id recovery.
  - Claim then no complete → kind `extension_did_not_complete`.
  - `Popen` OSError → kind `chrome_launch_failed`, exit 1, message includes OS reason fragment.
  - `chrome_not_found` still exit 2; message still names `--chrome` / `JUSO_CHROME_PATH`.
  - Successful complete path still returns valid reply status 0 (existing cases remain green).
  - Regression: claim remains idempotent; complete remains single-use.
- **Verification:**
  - `npm run test:python`

### U3. Skill and README Agent recovery docs

- **Goal:** Document Chromium-family custom path as first-class recovery; list structured lifecycle error kinds Agents should branch on.
- **Requirements:** R6–R8, F1 (docs half), AE4
- **Dependencies:** U1 (frozen kind names)
- **Files:**
  - Modify: `skills/juso-search/SKILL.md`
  - Modify: `README.md` (本地 AI 智能体 + 智能体接口与边界)
  - Modify: `README.en.md` (Local AI Agents + Agent Interface and Limits)
- **Patterns:**
  - Existing bilingual Agent sections (README plan `docs/plans/2026-07-15-001-docs-readme-positioning-plan.md`)
  - SKILL.md prerequisites / flags / failures (~14–34)
  - CONCEPTS vocabulary: Agent Bridge, not “local API”
- **Approach:**
  - Compatibility: Chromium-family browser with extension installed; auto-discovery may only find common Chrome/Chromium.
  - Document `--chrome` / `JUSO_CHROME_PATH`, `--profile` / `JUSO_CHROME_PROFILE`, extension id as peer recovery controls; note binary must be the one whose profile has Juso.
  - List skill lifecycle error kinds Agents care about (`chrome_not_found`, `chrome_launch_failed`, `extension_did_not_claim`, `extension_did_not_complete`, plus existing invalid id / wait_failed). Residual `timeout` may be noted as defensive only.
  - Keep README product-level; put the kind table or dense flag detail in SKILL.md.
  - Do not claim Firefox/Safari support. R9 (optional default Edge candidates) is launcher-side only — not a U3 deliverable.
- **Test scenarios:**
  - Manual doc review: Chinese and English Agent sections mention custom path recovery; SKILL no longer says Chrome-only compatibility without Chromium-family framing.
  - No automated doc tests required unless repo already has one (none for this).
- **Verification:**
  - Human skim of the three files against R6–R8 and AE4.

---

## Verification Contract

| Command / check | Applies to | Purpose |
|-----------------|------------|---------|
| `npm run test:python` | U1, U2 | Skill loopback + classification + launch error regression |
| `npm test` | Optional smoke after docs-only if desired | Ensure no accidental TS touch; not required if only skill/docs changed |
| `npm run typecheck` / `npm run lint` | Only if TS/React files touched | Should be no-op for this plan’s write set |
| Manual doc skim | U3 | R6–R8, bilingual consistency |

Real-browser Agent smoke remains deferred (Scope Boundaries); not a gate.

---

## Definition of Done

**Global**

- [ ] Wait failures no longer always emit opaque `timeout` when claim observation is available.
- [ ] Skill lifecycle errors use KTD2 kinds with recovery messages naming path/profile/id peers.
- [ ] Success reply shapes unchanged; bridge protocol and worker trust untouched.
- [ ] SKILL + bilingual README teach Chromium-family custom path recovery.
- [ ] `npm run test:python` green with new classification cases.
- [ ] No doctor command; no multi-browser auto-retry; no Firefox/Safari claims.

**Per unit**

- [ ] U1: claim observation + classification + messages landed in `juso_search.py`.
- [ ] U2: tests cover never-claimed, claimed-not-complete, and existing launch errors.
- [ ] U3: SKILL + README.md + README.en.md updated and aligned on kind names.
