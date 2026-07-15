---
title: Juso README and Positioning - Plan
type: docs
date: 2026-07-15
topic: readme-positioning
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Juso README and Positioning - Plan

## Goal Capsule

- **Objective:** Replace the outdated API-only description with an accurate, bilingual, product-first account of Juso's equal Human and local AI Agent faces.
- **Product authority:** This contract defines the public positioning, README scope, short descriptions, installation story, security claims, future-language boundaries, and open-source commitment.
- **Execution profile:** Documentation-first change with package metadata, locale copy, license packaging, and a release-artifact check.
- **Stop conditions:** Do not publish an “open-source” claim without MPL-2.0 in the repository, and do not advertise the planned v1.0.0 Release ZIP until it is attached to the v1.0.0 release.
- **Open blockers:** None; the planned v1.0.0 Release ZIP path has a documented source-build fallback.

---

## Product Contract

### Summary

Present Juso as an open-source, two-sided search product for Human users and local AI Agents.
The two faces have equal weight: Juso aggregates and switches Search Engines while making AI Search APIs usable by Humans, and aggregates AI Search APIs while making conventional Search Engines callable by local AI Agents.

### Problem Frame

The current README describes Juso mainly as a Chromium extension that turns paid AI Search APIs into a clean Human-facing search page.
That description omits the unified Search Source model, Search Engine switching, the SERP Switch Bar, local caching and history, and the Agent path that exposes both AI Search APIs and browser-powered Search Engines.
It also uses security language that can be read as a privacy guarantee even though queries still reach the selected provider or Search Engine and may be recorded there.

### Key Decisions

- **Two equal product faces:** Human and local AI Agent capabilities receive equal prominence rather than treating the Agent Skill as an extension add-on.
- **Short slogan, precise explanation:** The Chinese README opens with “一面为人，一面为智能体。” and immediately follows it with the full two-sided positioning and four-capability matrix.
- **Product before architecture:** Both READMEs first explain who Juso serves and why it is useful, then cover current capabilities, operation boundaries, installation, security, Agent access, and development architecture.
- **Source aggregation is current:** “聚” currently means unified access, selection, and switching across Search Sources; it does not imply that one query runs against several sources or merges their results.
- **Verifiable trust claims:** Public copy may promote open source and locally managed credentials, but must distinguish those facts from anonymity or third-party logging claims Juso cannot guarantee.
- **Open local core:** The complete local search loop uses MPL-2.0, including the current extension, current source integrations, Agent access, local configuration and cache, and a future user-owned WebDAV client if built.

### Actors

- A1. **人类用户（Human user）:** Uses one interface to choose and switch conventional Search Engines and configured AI search services.
- A2. **本地 AI 智能体（local AI Agent）:** Uses Juso's local Agent interface to call configured AI Search APIs or search through a real browser without receiving stored credentials.
- A3. **传统搜索引擎（conventional Search Engine）:** Google, Bing, or Baidu, reached through navigation and browser-result extraction rather than the provider execution contract.
- A4. **AI 搜索服务（AI search service）:** Tavily, Exa, Stepfun pay-as-you-go, or Stepfun Step Plan, reached through a normalized provider interface.

### Requirements

**Bilingual document structure**

- R1. `README.md` must be a complete Chinese product document with a prominent link to the English version.
- R2. `README.en.md` must be a complete, natural English counterpart with the same information hierarchy and a prominent link to the Chinese version.
- R3. The two documents must not interleave translations paragraph by paragraph or require readers to switch languages to obtain essential information.
- R4. Chinese copy must introduce Chinese names for Human users, local AI Agents, conventional Search Engines, AI Search APIs, and Search Sources rather than using English labels as substitutes for Chinese concepts.

**Positioning and current capabilities**

- R5. The Chinese hero must open with “一面为人，一面为智能体。” and describe Juso as a 双面搜索产品.
- R6. The English hero must communicate the same two-sided product identity in idiomatic English rather than translate the Chinese slogan mechanically.
- R7. Both heroes must lead into an equal four-capability matrix: Search Engine aggregation and switching for Humans, Human-facing AI Search APIs, unified AI Search APIs for Agents, and browser-powered Search Engines for Agents.
- R8. The current-capability section must identify Google, Bing, and Baidu as conventional Search Engines and Tavily, Exa, Stepfun pay-as-you-go, and Stepfun Step Plan as AI search services.
- R9. The documents must explain that Tavily and Exa can provide synthesized answers while both Stepfun surfaces currently provide result lists only.
- R10. The Human face must cover the independent search page, Search Source switching, SERP Switch Bar, local search cache, history, and explicit refresh behavior.
- R11. The Agent face must cover provider listing, explicit-provider API search, browser-powered Search Engine search, ordinary-result extraction boundaries, and the requirement for a locally installed extension.
- R12. The documents must state that current aggregation unifies sources and switching but does not default to parallel multi-source retrieval or result fusion.

**Installation and project status**

- R13. Juso must be described as early but usable for adopters comfortable with manual installation and configuration.
- R14. Human and Agent quick starts must be presented as parallel paths with distinct completion outcomes.
- R15. The primary early installation path must use a production ZIP from GitHub Releases, followed by extraction and Chromium developer-mode loading.
- R16. A source-build path must remain available for developers, including the existing install, build, typecheck, test, Python test, and lint commands.
- R17. The documentation must not recommend or document CRX deployment.
- R18. The release installation path must disclose developer-mode warnings and manual update/reload expectations until browser-store distribution exists.

**Security, data, and openness**

- R19. Security copy must say stored provider credentials are managed locally by the extension, read by the background worker, and not exposed to UI pages or local AI Agents.
- R20. Security copy must say credentials are sent to the selected AI search service when required for authentication and that queries reach the selected service or Search Engine.
- R21. Security copy must not promise anonymous searching, absence of provider or network records, or privacy beyond Juso's observable boundary.
- R22. Security copy must distinguish Juso's lack of an operated proxy and telemetry in the current local mode from the logging practices of browsers, networks, Search Engines, and AI search services.
- R23. Configuration export must be described as user-initiated, unencrypted, sensitive, and under the user's custody.
- R24. Juso must not claim to operate configuration backup or credential-sync infrastructure.
- R25. The repository must adopt MPL-2.0 before public copy calls Juso open source.
- R26. The open-source commitment must cover the complete local search loop and must not imply that all possible future hosted or operational services will be open source or free.

**Public descriptions and architecture**

- R27. GitHub Description should use: “An open-source, two-sided search gateway with locally managed credentials—for humans and local AI agents.”
- R28. The package description and Chinese and English extension descriptions must reflect both product faces within their practical length constraints.
- R29. Short descriptions must not use provider lists as the primary positioning or use `BYOK` without explanation.
- R30. The architecture section must reflect the current Search Engine, SERP Switch Bar, cache/history, Agent Bridge, provider adapter, messaging, and storage responsibilities instead of linking to the initial plan as if it described the current scope completely.

**Possible future**

- R31. Both READMEs must include a brief, non-promissory “可能的未来 / Possible Future” section.
- R32. The future section may describe adapting additional AI search services and conventional Search Engines according to demand, interface availability, and service stability.
- R33. The future section may describe optional multi-source parallel retrieval, deduplication, ranking, and result fusion with retained provenance and explicit cost, scope, and latency controls.
- R34. The future section must not present commercial connectors, pricing, hosted credential backup, or an uncommitted business model as roadmap items.

### Key Flows

- F1. **Human quick start**
  - **Trigger:** A Human user discovers Juso through the repository.
  - **Actors:** A1, A3, A4
  - **Steps:** Understand the two-sided value, install the release ZIP, configure an AI search service if desired, choose a Search Source, and search or switch sources.
  - **Outcome:** The user reaches a working Human search flow without reading implementation architecture first.
  - **Covered by:** R5, R7, R8, R10, R13, R15, R18
- F2. **Agent quick start**
  - **Trigger:** A local AI Agent user wants callable search capabilities.
  - **Actors:** A2, A3, A4
  - **Steps:** Install and configure the extension, install the Agent Skill or script integration, identify available providers, and run either explicit-provider search or browser-powered Search Engine search.
  - **Outcome:** The Agent can search through Juso without receiving the user's stored provider credentials.
  - **Covered by:** R7, R11, R14, R19
- F3. **Trust evaluation**
  - **Trigger:** A prospective user evaluates whether Juso's openness and credential handling meet their needs.
  - **Actors:** A1, A2
  - **Steps:** Review the MPL-2.0 source, local credential boundary, direct destination of requests, export sensitivity, and third-party logging caveats.
  - **Outcome:** The user can distinguish Juso's verifiable protections from privacy properties outside Juso's control.
  - **Covered by:** R19, R20, R21, R22, R23, R25, R26

### Acceptance Examples

- AE1. **Covers R7, R12.** Given a reader sees the hero and capability matrix, when they describe Juso afterward, then they identify both Human and Agent faces and do not claim that every query searches all sources at once.
- AE2. **Covers R15, R17, R18.** Given a user wants to install an early release, when they follow the primary installation instructions, then they download a ZIP and load its extracted directory without being directed to install a CRX.
- AE3. **Covers R19, R20, R21, R22.** Given a user reads the security section, when they assess query privacy, then they understand that Juso manages credentials locally but selected external services and the network may still record requests.
- AE4. **Covers R24, R26, R34.** Given a reader reviews current and future scope, when they look for hosted backup or commercial plans, then they find no claim that Juso stores their credentials and no README commitment to an unconfirmed business model.
- AE5. **Covers R31, R32, R33.** Given a reader opens the future section, when they evaluate upcoming possibilities, then they can distinguish additional-source adaptation and optional result aggregation from currently delivered features or promised milestones.

### Scope Boundaries

**Included**

- Chinese and English README documents with equal Human and local AI Agent positioning.
- Accurate public short descriptions across repository, package, and extension surfaces.
- MPL-2.0 licensing and an explicit open local-core commitment.
- Current source compatibility, installation, security, Agent access, architecture, and non-promissory future directions.

**Excluded**

- New search, synchronization, account, billing, or hosted service functionality.
- CRX packaging or installation documentation.
- A commercial roadmap, commercial connector policy, pricing model, or hosted API design.
- Hosted configuration backup or custody of user provider and WebDAV credentials.
- Claims that optional multi-source result fusion already exists.

### Dependencies and Assumptions

- The GitHub repository description must be changed through repository settings and cannot be implemented solely by editing tracked files.
- Release ZIP instructions assume the planned v1.0.0 release attaches a production build whose extracted directory directly contains the extension manifest.
- User-owned WebDAV remains a possible open local-client capability, not a Juso-operated backup service and not a requirement of the README update itself.
- Commercialization remains undecided; any future strategy document must preserve the complete local search loop promised here.

### Sources and Research

- `README.md` — current public description and missing product surfaces.
- `CONCEPTS.md` — authoritative Search Source, Search Engine, Agent Bridge, BYOK, cache, and Step Plan vocabulary.
- `docs/plans/2026-07-01-001-juso-search-plan.md` — original user problem and value proposition, but not current feature scope.
- Chrome Extensions documentation: `https://developer.chrome.com/docs/extensions/how-to/distribute`
- Microsoft Edge extension sideloading documentation: `https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading`
- Mozilla Public License 2.0: `https://www.mozilla.org/en-US/MPL/2.0/`

---

## Planning Contract

### Product Contract Preservation

Product Contract unchanged.

### Key Technical Decisions

- **Two standalone READMEs:** Keep `README.md` and `README.en.md` complete and structurally parallel, but write each in natural language rather than maintaining sentence-level translations.
- **One vocabulary source:** Use `CONCEPTS.md` to keep Search Source, Search Engine, Provider Adapter, Agent Bridge, Local Search Cache, Config Export, and Step Plan descriptions aligned with implemented semantics.
- **MPL in source and distribution:** Add the official MPL-2.0 text at `LICENSE`, declare its SPDX identifier in package metadata, and include the same text under `public/` so production extension archives carry the license.
- **Guard extension-description constraints:** Extend the existing locale parity test to enforce Chrome's 132-character manifest-description limit for both locales; keep `wxt.config.ts` on the localized `__MSG_ext_description__` key.
- **Release claims follow artifacts:** `npm run zip` is the production packaging path. README may make the planned v1.0.0 Release ZIP the primary installation path only when execution also attaches the generated ZIP to the v1.0.0 release; otherwise source build and load-unpacked remain the current path.
- **Repository settings stay operational:** The GitHub Description is not stored in the repository. Update it with repository tooling only after confirming the target remote; otherwise report the exact approved string as a manual repository-setting action.

### High-Level Design

Public positioning has one canonical meaning expressed at different lengths:

1. The READMEs carry the complete two-sided story, current capability boundaries, quick starts, trust model, architecture, and possible future.
2. Package and extension descriptions compress that story without provider-list-first copy, unexplained `BYOK`, or broad privacy claims.
3. `LICENSE`, package metadata, and the packaged license make the open-source claim verifiable.
4. Release and repository settings expose the same approved positioning only when their underlying artifact or target can be verified.

### Sequencing

1. Establish the license and metadata truth before adding open-source claims.
2. Write both READMEs from the same section outline and verified feature inventory.
3. Align extension descriptions and add the durable length guard.
4. Build the production archive, inspect its contents, and update external repository surfaces when available.

### Risks and Mitigations

- **Planned v1.0.0 installation may lack its artifact:** Gate primary Release instructions on an attached v1.0.0 artifact; retain a source-build fallback.
- **Bilingual documents may drift:** Keep matching section order, capability tables, source lists, caveats, and links; review them side by side without forcing literal translation.
- **Open-source wording may outrun licensing:** Land `LICENSE`, package metadata, packaged license, and README wording together.
- **Security copy may overpromise:** Describe Juso-controlled credential handling separately from provider, Search Engine, browser, and network logging.
- **The initial architecture plan is stale as a feature inventory:** Use current code, `CONCEPTS.md`, and `skills/juso-search/SKILL.md` for factual claims; retain the original plan only as historical product context.

---

## Implementation Units

### U1. Establish MPL-2.0 licensing and package metadata

- **Goal:** Make the open-source claim legally and mechanically grounded in source and distributed artifacts.
- **Requirements:** R25, R26
- **Files:** `LICENSE`, `public/LICENSE`, `package.json`, `package-lock.json`
- **Approach:** Add the unmodified official MPL-2.0 license text to both license locations, add `"license": "MPL-2.0"` to the root package, and synchronize only the root package entry in the lockfile.
- **Dependencies:** None.
- **Test scenarios:**
  - Root and packaged license files are byte-identical and contain the complete MPL-2.0 text.
  - Package and lockfile root metadata both report `MPL-2.0` without changing dependency-license metadata.
  - A production ZIP includes `LICENSE` at its root.
- **Verification:** Compare both license files, inspect package metadata, and inspect the archive produced by `npm run zip`.

### U2. Replace the Chinese README and add the English README

- **Goal:** Deliver the complete product-first, two-sided documentation and parallel Human and Agent quick starts.
- **Requirements:** R1–R24, R26, R30–R34
- **Files:** `README.md`, `README.en.md`
- **Patterns:** Domain wording from `CONCEPTS.md`; Agent commands and limits from `skills/juso-search/SKILL.md`; current developer commands from `package.json`.
- **Approach:** Use the agreed product-first outline: language switch, hero and four-capability matrix, current capabilities and supported sources, operation and aggregation boundary, parallel quick starts, project status and installation, security and data boundaries, Agent details, development architecture, possible future, and license.
- **Dependencies:** U1 for open-source and license claims; U4 verifies the planned v1.0.0 Release artifact before installation copy references it.
- **Test scenarios:**
  - A reader can identify both equal product faces and all four capabilities from each hero section.
  - Current source aggregation is not described as multi-source parallel retrieval or fusion.
  - Human and Agent quick starts both reach a concrete completion state.
  - Security sections state local credential management, direct third-party requests, possible third-party logging, sensitive unencrypted exports, and no Juso-operated configuration backup.
  - Supported-source names and answer-capability differences match current implementations.
  - Future sections mention additional sources and optional result aggregation only as possibilities, with no commercial connector or pricing language.
- **Verification:** Side-by-side content review against R1–R34, link validation, command validation against `package.json`, and targeted fact comparison with `CONCEPTS.md` and `skills/juso-search/SKILL.md`.

### U3. Align public package and extension descriptions

- **Goal:** Replace the API-only descriptions with concise two-sided positioning that stays within manifest constraints.
- **Requirements:** R28, R29
- **Files:** `package.json`, `package-lock.json`, `public/_locales/zh_CN/messages.json`, `public/_locales/en/messages.json`, `tests/i18n-parity.test.ts`
- **Approach:** Write compact Chinese and English extension descriptions covering Human and local AI Agent value without provider lists, unexplained `BYOK`, or unsupported privacy claims; update the package description and add a locale test for the 132-character limit.
- **Dependencies:** U1 may touch the same package metadata and should land first or in the same coordinated edit.
- **Test scenarios:**
  - Chinese and English locale key sets remain identical and messages remain non-empty.
  - Both `ext_description` values are at most 132 characters.
  - Generated manifest description remains `__MSG_ext_description__`, with both locale files present in the production build.
  - Package description reflects both Humans and local AI Agents.
- **Verification:** `npm test -- tests/i18n-parity.test.ts`, followed by production archive inspection in U4.

### U4. Validate distribution and update repository-facing surfaces

- **Goal:** Ensure install documentation points to a real loadable artifact and expose the approved repository description where possible.
- **Requirements:** R13–R18, R27
- **Files:** `README.md`, `README.en.md`, `.output/juso-search-1.0.0-chrome.zip` as a generated artifact; GitHub repository settings when a target remote is available.
- **Approach:** Run `npm run zip`, verify that the archive root contains `manifest.json`, localized messages, and `LICENSE`, then attach it to the planned GitHub Release v1.0.0 before using primary Release instructions. Update the GitHub Description only after verifying the repository remote.
- **Dependencies:** U1–U3.
- **Test scenarios:**
  - The generated ZIP opens successfully and contains a root `manifest.json`, both locale message files, icons/assets required by the build, and `LICENSE`.
  - Extracting the ZIP produces a directory suitable for Chromium's Load unpacked flow.
  - README does not mention CRX deployment.
  - Unconditional “download from Releases” wording appears only when the referenced release and artifact exist.
  - GitHub Description exactly matches the approved R27 string when repository settings are updated.
- **Verification:** `npm run zip`, archive-content inspection, README link check against the real release when present, and repository metadata inspection when a remote is configured.

---

## Verification Contract

| Evidence | Command or check | Establishes |
|---|---|---|
| Locale description guard | `npm test -- tests/i18n-parity.test.ts` | Locale parity, non-empty copy, and 132-character manifest-description limits |
| Type safety | `npm run typecheck` | Metadata and test edits do not introduce TypeScript errors |
| Lint quality | `npm run lint` | Updated tests and tracked text-adjacent code meet repository lint rules |
| Production package | `npm run zip` | WXT can build the extension and produce the expected Chrome archive |
| Archive contract | Inspect `.output/juso-search-1.0.0-chrome.zip` | Root manifest, locales, and MPL license are actually distributed |
| Documentation truth review | Compare both READMEs with R1–R34 and current source files | Two-sided positioning, capability inventory, security caveats, installation state, and future boundaries are accurate |
| External surface | Inspect the real Release and GitHub repository metadata when available | Download instructions and GitHub Description refer to existing public surfaces |

The full Vitest suite and Python suite are not required solely by documentation and metadata changes unless focused checks or the production build reveal integration uncertainty. The production ZIP build is the decisive integration evidence because it consumes package metadata, manifest localization, public assets, and the packaged license together.

---

## Definition of Done

- U1 is complete when MPL-2.0 is declared in source, root package metadata, lockfile root metadata, and the production archive.
- U2 is complete when Chinese and English readers receive complete, parallel, product-first documentation with equal Human and local AI Agent paths.
- U3 is complete when all public short descriptions reflect the two-sided product, locale parity passes, and extension descriptions meet the manifest limit.
- U4 is complete when the load-unpacked archive contract is verified and README installation wording matches the actual release state.
- GitHub Description is updated when a verified target repository is available; otherwise the exact approved value is reported as the only operational follow-up.
- Focused tests, typecheck, lint, ZIP build, archive inspection, and documentation truth review pass.
- No CRX instructions, hosted credential-backup claims, commercial connector roadmap, stale API-only positioning, or abandoned draft text remains in the diff.
