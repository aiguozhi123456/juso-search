---
title: Agent Skill Distribution Pipeline — Single-Source Template, Generator with Drift Lock, and Runtime ID Stamping
date: 2026-08-06
last_updated: 2026-08-11
category: architecture-patterns
module: agent-skill-distribution
problem_type: architecture_pattern
component: tooling
severity: low
applies_when:
  - "Shipping a bundled script or skill both inside a browser extension and published to a repo or marketplace"
  - "The shipped artifact must embed an identifier not knowable for all builds at authoring time"
  - "Two or more content variants (prod/dev) where hand-keeping has produced drift or the difference is expressible as transforms"
  - "A BYOK extension must ship an id-embedded helper without exposing keys to the packaging layer"
tags:
  - agent-skill
  - code-generation
  - drift-lock
  - template
  - runtime-id-stamping
  - zip-packaging
  - chrome-mv3
  - single-source-of-truth
---

# Agent Skill Distribution Pipeline: Single-Source Template, Generator with Drift Lock, and Runtime ID Stamping

## Context

Juso ships a companion Agent Skill (a `SKILL.md` + a `scripts/juso_search.py` that bridges the Agent to the extension's worker over loopback — see `agent-skill-localhost-capability-bridge.md`) through **two distribution channels** that pull in opposite directions:

1. **Repo-published directories** for GitHub users, skill-market browsers, and maintainers dogfooding both the prod (Chrome Web Store) and dev (`build:dev`) builds. This audience needs to *recognize* which build a skill targets, so the two directories must keep distinct names (`skills/juso-search/`, `skills/juso-search-dev/`) and distinct content (the dev variant carries a "this is a developer build" warning block).
2. **In-extension download** for end users who installed the extension and want the skill pre-stamped with *their* extension id without cloning anything. These users have exactly one build installed, so the downloaded skill should be uniform (`juso-search/`), not a variant they have to choose between.

Three sources of friction forced a designed pipeline rather than "copy the skill around":

- **Manual-twin drift.** The two repo directories started as a hand-maintained prod/dev pair (commit `563ef30` copy+edit). Five independent drift defects accumulated (recorded in `agent-bridge-skill-contract-drift.md`). Any edit to one twin that wasn't mirrored in the other became a silent contract divergence.
- **Unknown extension ids.** Custom dev builds (`build:dev` with a user-supplied `DEV_EXTENSION_KEY`) get an extension id the repo cannot predict. A skill that hard-codes one of the two known ids is wrong for every custom dev build, and the only workaround was asking the user to pass `--extension-id` / `JUSO_EXTENSION_ID` by hand.
- **Dual delivery shape.** The same authoritative content must render as *two distinct named skills* for channel 1 but as *one uniform skill* for channel 2. Naively, that implies three hand-maintained copies — the exact situation that produced the drift bugs.

The pipeline below makes one template the single source of truth, derives every published artifact from it, and stamps the extension id at the latest possible moment (download time) so that no rebuild is needed for unknown ids.

## Guidance

### One template, two placeholders

The authoritative source is `public/agent-skill/` — `SKILL.md` + `scripts/juso_search.py`. It is prod-style content verbatim, with exactly **two** placeholders: `DEFAULT_EXTENSION_ID = "__JUSO_EXTENSION_ID__"` and `DEFAULT_BRIDGE_URL = "__JUSO_BRIDGE_URL__"` at `public/agent-skill/scripts/juso_search.py:27-28`. There are no `{{...}}` tokens in `SKILL.md`. (An earlier design proposed seven `{{}}` placeholders; the implemented design collapses every variant difference into Python-side find/replace patches instead — see the next subsection — so the TypeScript packager needs zero content configuration.)

WXT copies `public/` into the build output verbatim by standard behavior, so the template ships inside the extension with no build hook and is reachable at runtime via `browser.runtime.getURL('agent-skill/...')`. The generator's `TEMPLATE_DIR = REPO_ROOT / "public" / "agent-skill"` (`scripts/gen_skills.py:25`) reads from the same source — the template is the single consumer-shared truth for both channels.

### Generator with encoded prod→dev patches and a loud-match contract

`scripts/gen_skills.py` renders the two repo-published directories from the template:

- `VARIANTS` (`scripts/gen_skills.py:34-43`) maps `prod` → `skills/juso-search/` and `dev` → `skills/juso-search-dev/`, each carrying only its extension id and target directory.
- `render(variant_key)` (`:127`) reads each template file, and for `dev` only, applies `DEV_PATCH_SKILL_MD` / `DEV_PATCH_PY` — the encoded prod→dev prose diff as `(find, replace)` pairs. The final pass substitutes both `__JUSO_EXTENSION_ID__` and `__JUSO_BRIDGE_URL__` everywhere (`:139-140`), including any the patches themselves injected.
- `_apply_patch` (`:112`) enforces a **loud-match contract**: every `find` string must occur *exactly once* in the template. A count of 0 or 2 raises `SystemExit` with the offending snippet. A partial or ambiguous transform can never silently ship.

This is why the template carries only the two placeholders and no name/description/warning placeholders: those differences are *transforms on prod prose*, expressed as find/replace pairs, not slots to fill. The pairs are the authoritative record of "what makes dev different from prod".

### Drift lock: generated output must equal tracked output

`tests/scripts/test_gen_skills.py` runs `gen_skills.check()` and asserts the tracked directories equal the generator output byte-for-byte (`test_generated_dirs_match_tracked`). It also asserts no placeholder survives rendering, and that prod/dev differ only in the expected dimensions (name, description, compatibility, id, docstring, argparse description, the dev-only warning block, and a removed auto-discovery line). Driven through `npm run test:python`.

Any hand-edit to a tracked directory, or any template change not followed by `npm run gen-skills`, turns CI red and names the drifted file — the hand-maintained-twin drift class is structurally eliminated.

### Runtime id stamping at download time

`lib/agent-skill-packager.ts:packageAgentSkill(variant)` is the in-extension channel:

1. `const extId = browser.runtime.id` (`:53`), validated against `EXTENSION_ID_RE = /^(?:[a-p]{32}|[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+|\{[0-9a-fA-F]{8}-…\})$/` (`:21`) — relaxed to also accept Firefox email-style ids and `{GUID}`s, so the same packager serves both browsers. A mismatch throws with a message that flags a dev/custom build as the expected cause rather than a generic failure.
2. `fetch(browser.runtime.getURL('agent-skill/SKILL.md'))`, `.../scripts/juso_search.py`, `.../scripts/juso_bridge.py`, and the `reference/*.md` chapters read the bundled template. The bridge URL is derived as `browser.runtime.getURL('bridge.html')` (`:67`) — full URL, not id-derived, because Firefox's `moz-extension://` host is a per-install random UUID.
3. `stamp(text, placeholder, value)` (`:29`) splits on the placeholder and joins with the value, applied once per placeholder: `__JUSO_EXTENSION_ID__` ← runtime id and `__JUSO_BRIDGE_URL__` ← bridge URL (`:82-84`). Post-stamp checks (`:85-90`, plus `reference/` at `:94-99`) throw if either placeholder remains — a guard against template drift sneaking past the build.
4. `createStoreZip` (`lib/zip.ts`) packages the entries under a **uniform** `juso-search/` top-level folder, with auto-inserted directory entries (`juso-search/`, `juso-search/scripts/`, `juso-search/reference/`).
5. The result is returned as `{ dataUrl, filename }` — `data:application/zip;base64,...` and `juso-search[-dev]-<version>.zip`, where `<version> = browser.runtime.getManifest().version`.

Crucially, the **variant does not touch skill content** in this channel — only the zip filename token. The downloaded skill is always `juso-search`-named, prod-styled, with no dev warning block: a downloader already has the matching extension, so a "use juso-search-dev instead" warning is meaningless to them (plan R7/KTD5).

### Three seams, one purpose each

The pipeline uses three distinct seams that are easy to conflate:

- **`__JUSO_EXTENSION_ID__`** — a *runtime* placeholder in the template, resolved at download time from `browser.runtime.id`. This is the seam that covers unknown custom dev ids with no rebuild.
- **`__JUSO_BRIDGE_URL__`** — a second *runtime* placeholder, resolved at download time from `browser.runtime.getURL('bridge.html')`. Chrome could derive this from the id (`chrome-extension://{id}/bridge.html`), but Firefox's `moz-extension://` host is a per-install random UUID, so the full URL must be stamped into the skill for it to reach the right bridge page.
- **`__SKILL_VARIANT__`** — a *build-time* constant injected by Vite `define` in `wxt.config.ts:14-18` (`env.mode === 'development' ? 'dev' : 'prod'`), surfaced through `lib/skill-variant.ts`. It is used **only** to pick the zip filename token inside `packageAgentSkill`. It never reaches skill content, and it never reaches the Python generator (which has its own per-variant config).

Keeping these seams separate is the reason a custom dev build (unknown id, but `mode === 'development'` so `__SKILL_VARIANT__ === 'dev'`) produces a correctly-named `juso-search-dev-<version>.zip` whose content is stamped with the *user's own* runtime id and bridge URL.

### Worker-side packaging and messaging flow

The packager runs entirely inside the MV3 worker. The flow mirrors the existing `handleExportConfig` precedent (`lib/gateway.ts:333`):

```text
Options UI (AgentBridgeSettings) ──sendMessage('packageAgentSkill')──▶ worker
  entrypoints/background.ts:116  onMessage('packageAgentSkill', () => handlePackageAgentSkill())
  lib/gateway.ts:360             handlePackageAgentSkill() → packageAgentSkill(SKILL_VARIANT)
                                  → triggerDownload(dataUrl, filename)  (browser.downloads.download)
                                  → { ok: true } | { ok: false, error }
```

`packageAgentSkill` is declared in `lib/messaging.ts:115` with the standard ok/error discriminated-union reply (`PackageAgentSkillReply` at `:66`). The template is a keyless text resource, the worker is the only reader of BYOK keys, and the data URL never enters page memory — so the packager preserves the existing BYOK boundary without any new privilege.

### Compact flow

```text
 public/agent-skill/  (single source: prod content + __JUSO_EXTENSION_ID__ + __JUSO_BRIDGE_URL__ placeholders)
        │
        ├─ scripts/gen_skills.py  ──render(+ DEV_PATCH_*, loud-match)──▶ skills/juso-search/
        │                                                          └─▶ skills/juso-search-dev/
        │           ▲
        │           └── tests/scripts/test_gen_skills.py  (drift lock: tracked == generated)
        │
        └─ bundled in extension ──fetch at runtime──▶ lib/agent-skill-packager.ts
                                                       stamp(__JUSO_EXTENSION_ID__ ← browser.runtime.id,
                                                             __JUSO_BRIDGE_URL__ ← browser.runtime.getURL('bridge.html'))
                                                       createStoreZip → uniform 'juso-search/' folder
                                                       ──▶ browser.downloads.download
```

## Why This Matters

- **Single source eliminates drift by construction.** With both published directories derived from one template and a test asserting equality, the hand-maintained-twin failure mode cannot recur — there is no second copy to forget to update. The drift lock is the operationalization of "cross-end contracts must be tested across the ends" (`agent-bridge-skill-contract-drift.md` Prevention) applied to the template↔published-directory pair.
- **Runtime stamping covers every build, including unknown ones.** Stamping from `browser.runtime.id` at download time means a custom dev build with a repo-unknown id still gets a correctly targeted skill. Pre-writing the two known id constants would have left custom dev builds as second-class citizens requiring manual `--extension-id` overrides — exactly the friction this pipeline removes.
- **The drift lock catches divergence early.** A maintainer who edits a tracked directory or changes the template without regenerating sees a red `test:python` naming the drifted file, before the divergence reaches a release.
- **Two channels, deliberately shaped differently.** Repo directories stay *distinct* (`juso-search` vs `juso-search-dev`) for audiences that must distinguish builds; the in-extension download stays *uniform* (`juso-search`) for audiences that already committed to one build. One template serves both shapes because the variant difference is expressed as transforms, not as parallel content.
- **The packager adds no new trust surface.** It runs in the worker, reads only a keyless template, and reuses the existing `triggerDownload` path — the BYOK boundary stays intact.

## When to Apply

- You ship a bundled script, skill, or config **with** a browser extension and also publish it **to** a repo or marketplace — i.e., the same artifact has both an in-extension delivery path and an external discovery path.
- The artifact must embed an identifier (extension id, runtime id, build hash) that is not knowable for all builds at authoring time — typically because users produce their own dev builds with their own keys.
- You maintain two or more variants of the same content (prod/dev, stable/canary, free/paid) where hand-keeping has already produced drift, or where the variant difference is small enough to express as transforms on a single source.
- A BYOK extension needs to ship an id-targeted localhost bridge (or any id-embedded helper) without exposing keys to the bundling/packaging layer.

Do not apply the runtime-stamping half when the placeholder must be resolved for an audience that has *not* installed the producing extension (e.g., a public marketplace listing) — those need a build-time-resolved constant, not a runtime id. The repo-published directories handle that case here precisely because they are stamped at generation time with the two known ids.

## Pitfalls

- **Terminals silently drop characters when rendering 32-char lowercase a–p extension ids, and hand-typing them corrupts the id.** This bit this project: a plan doc once carried `cenboedgopa` where the correct id is `cenboepdgopa` — a single dropped `p` that made every literal `.Replace`/edit against it fail, while looking plausible at a glance. All-lowercase a–p strings have no visual landmarks, so a missing character is invisible to proofreading. **Prevention:** never hand-type an extension id into docs or code. Extract ids programmatically — e.g. regex over `git rev-parse HEAD` output or a known-good source file — and paste the extracted literal. The two ids in `scripts/gen_skills.py:34-43` (`VARIANTS`) were ultimately pinned this way. If an id comparison mysteriously fails, suspect a dropped character before suspecting the logic.
- **Each `DEV_PATCH_*` find-string must match exactly once, or the generator fails loudly.** This is intentional, not a limitation to work around. If you add a patch whose `find` matches zero or multiple times, `gen_skills.py:_apply_patch` raises `SystemExit` rather than applying a partial transform. When the template drifts away from a patch (e.g. you rephrased a line in `public/agent-skill/SKILL.md`), update *both* the template and the patch in the same change, then run `npm run gen-skills` and `npm run test:python` to confirm the drift lock is green again. Never loosen the exactly-once check to "make it pass".
- **Do not conflate the two runtime placeholders with `__SKILL_VARIANT__` (build-time).** `__JUSO_EXTENSION_ID__` and `__JUSO_BRIDGE_URL__` are content placeholders resolved per-download from `browser.runtime.id` / `browser.runtime.getURL('bridge.html')`; `__SKILL_VARIANT__` is a compile-time constant used only for the zip filename token. Routing variant content through `__SKILL_VARIANT__` would reintroduce a parallel content path and defeat the single-template property.
- **A custom dev build's id is correct only if it is stamped at runtime.** Any "optimization" that pre-writes the two known ids into the bundled template (to skip the stamp step) silently breaks every custom dev build. The runtime stamp is load-bearing for that case.
- **Stamping rewrites placeholder-detection code inside the published skill — never detect a placeholder by its literal string.** The generator's final pass substitutes `__JUSO_BRIDGE_URL__` *everywhere* in the published file, including inside the very check that was meant to detect the unstamped placeholder. `juso_search.py` originally had `bridge_url = raw_bridge_url if raw_bridge_url and "__JUSO_BRIDGE_URL__" not in raw_bridge_url else None`; after stamping this became `"<real-url>" not in raw_bridge_url`, always `False`, so `bridge_url` was always `None` and `run_bridge()` fell back to a `chrome-extension://` URL that fails on Firefox's `moz-extension://`. Detect real URLs by scheme instead: `bridge_url = raw_bridge_url if raw_bridge_url and "://" in raw_bridge_url else None`. Same rule applies to any placeholder whose detection logic ships in the stamped artifact.

## Related

- `agent-skill-localhost-capability-bridge.md` — primary sibling. Its "Single-source template and in-extension download" section is the condensed form of this doc; this doc is the full treatment of the distribution/generation mechanism while that doc covers the capability/contract (how the Agent calls the extension over localhost).
- `integration-issues/agent-bridge-skill-contract-drift.md` — the five real drift defects from hand-maintained skill twins; its Prevention ("cross-end contracts must be tested across the ends") is the principle the drift-lock test implements.
- `tooling-decisions/wxt-self-contained-dev-build.md` — provenance of the dev extension id (`pdklefhommhabbhkglgkgomeibeibmcl`) hardcoded in the generator via the embedded `DEV_EXTENSION_KEY`.
- `architecture-patterns/engine-capability-is-per-registry-not-per-id-union.md` — the shared "mirrors must be tested for equality, not maintained by hand" principle underpinning the drift lock.
- `workflow-issues/chrome-extension-release-process.md` — release workflow; skill dirs must be regenerated (`python scripts/gen_skills.py`) before release commits, and the skill zip name `juso-search-dev-<version>.zip` must stay distinct from the extension zip `juso-search-{v}-chrome-dev.zip`.
- `tooling-decisions/npm-overrides-transitive-dependabot-fixes.md` — why the hand-rolled STORE zip adds no direct zip dependency (adm-zip exists only transitively via web-ext-run).
- `architecture-patterns/default-off-capability-gating-for-cws-compliance.md` — the download entry is independent of `agentBridgeEnabled` and touches no keys, preserving the BYOK + opt-in trust model.
- `runtime-errors/service-worker-fetch-illegal-invocation.md` — service-worker `fetch` this-binding context for the packager's fetch of extension-internal template resources.
- `logic-errors/engine-search-orchestration-errors-and-baidu-url-extraction.md` — the `__JUSO_BRIDGE_URL__` stamping-rewrites-detection bug (bridge_url placeholder check inside the stamped file) was first hit during the Firefox engine-search adaptation; see its Related Issues for the before/after.
- `docs/plans/2026-08-05-001-bundle-agent-skill-plan.md` — the authoritative implementation plan (KTD1 template in `public/`, KTD4 runtime stamping, KTD5 uniform `juso-search` folder, KTD6 hand-rolled STORE zip, KTD7 worker-side `triggerDownload`) this doc records as implemented.
