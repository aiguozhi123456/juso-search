---
title: Cross-Platform Python Launcher and Free 3-OS CI Matrix for npm-Scripted Projects
date: 2026-08-10
category: tooling-decisions
module: cross-platform-tooling
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "A Node.js project needs to invoke Python across macOS, Linux, and Windows"
  - "CI matrix must verify cross-OS portability of a TypeScript extension plus Python tooling"
  - "Windows python3 resolves to the Microsoft Store stub and must be filtered out"
symptoms:
  - "npm scripts call python directly and fail on macOS/Linux where only python3 exists"
  - "No CI workflows run on non-Windows OS, leaving cross-platform claims unverified"
  - "python3 --version prints nothing and pops the Store on Windows"
root_cause: missing_tooling
resolution_type: tooling_addition
related_components:
  - scripts/python.mjs
  - package.json
  - .github/workflows/test-matrix.yml
  - public/agent-skill/scripts/juso_bridge.py
tags:
  - cross-platform
  - python
  - ci
  - macos
  - linux
  - windows
  - github-actions
  - node
---

# Cross-Platform Python Launcher + Free 3-OS CI for npm-Scripted Projects

## Context

The `juso-search` project is a WXT + React + TypeScript Chrome MV3 extension developed on Windows, paired with a Python skill CLI (`public/agent-skill/scripts/`) and a standalone pip-package MCP server (`mcp-server/`). The goal was to claim — and verify — macOS and Linux support.

The friction was not where you'd expect. Recon of the codebase found it already ~95% portable: the TypeScript/React/WXT extension contains zero platform checks, zero shell execs, and zero native-messaging host manifests (the Agent Bridge communicates over loopback HTTP at `http://127.0.0.1:<port>`, not native messaging, so there is no per-OS host-install ceremony). The only platform-specific code is `chrome_candidates()` in `juso_bridge.py` (replicated as four byte-identical, drift-locked copies) which branches on `sys.platform`: `win32` → `PROGRAMFILES`/`chrome.exe`; `darwin` → `/Applications/Google Chrome.app/...`; else → `/usr/bin/google-chrome*`. `.gitattributes` already forces `eol=lf`; shebangs already say `python3`; `gen_skills.py` is line-ending-agnostic.

The real blocker turned out to be **dev tooling**: three npm scripts in `package.json` — `test:python`, `test:mcp`, and `gen-skills` — invoked `python` directly. That single command name does not work on all three target operating systems:

- **macOS** ships only `python3` (no `python` binary) → `python: command not found`.
- **Linux** (Ubuntu 24.04 and others) requires `python3` unless `python-is-python3` is installed.
- **Windows** has the Microsoft Store stub at `C:\Users\...\AppData\Local\Microsoft\WindowsApps\python3.exe`. When you call `python3`, this stub prints nothing for `--version` and pops the Microsoft Store. Meanwhile `python` (real) and `py -3` (the Windows launcher) are real interpreters.

So no single name — not `python`, not `python3`, not `py -3` — works on all three OSes. The Windows Store stub is the non-obvious trap: it doesn't error out, it just silently produces empty output and hijacks the user into the Store.

Compounding this, the project had **no CI** at all — only `website-pages` and `pypi-publish` workflows existed. So even the claim "the extension builds on macOS/Linux" was unverified, and the per-platform esbuild/lightningcss/rolldown binaries that WXT pulls in had never been exercised on mac/linux runners. Three coverage gaps were identified: (1) the `darwin`/`linux` branches of `chrome_candidates()` were written but never executed by any test (every test mocked discovery via `NO_SUCH_CHROME` or patched `find_chrome`); (2) the JS/extension build pipeline (`npm install`/`typecheck`/`lint`/`test`/`build`) had never run in CI on any OS; (3) the eventual `python.mjs` probe had no timeout, meaning a broken `python3` could hang forever.

## Guidance

### Pattern 1: A cross-platform Python 3 launcher, probed at call time

Instead of hard-coding a command name, probe candidate interpreters at runtime and use the first one that genuinely prints `Python 3.x`. Ship this as a zero-dependency ESM Node script (`scripts/python.mjs`) that all npm scripts route through.

Candidate order and rationale:

1. `python3` — present on macOS and most Linux distros; on Windows this is the Store stub, which the regex filter rejects (see below).
2. `py -3` — the Windows launcher (real Python); `ENOENT` on mac/linux, falls through.
3. `python` — present on Windows (real); on macOS/Linux may not exist, falls through.

The probe spawns each candidate with `--version`, captures combined stdout+stderr, and accepts the candidate only if the output matches `/^Python 3\.\d+/m`. **This regex filter is the mechanism that rejects the Windows Store stub** — the stub prints nothing, so the regex fails and the probe moves on. A 5-second timeout kills any interpreter that hangs (e.g. a broken Store stub that opens a GUI), so the probe never stalls indefinitely.

```js
#!/usr/bin/env node
/* global console, process, setTimeout, clearTimeout */
import { spawn } from "node:child_process";

const CANDIDATES = [["python3"], ["py", "-3"], ["python"]];
const PY3 = /^Python 3\.\d+/m;

const probe = (cmd) =>
  new Promise((resolve) => {
    const child = spawn(cmd[0], [...cmd.slice(1), "--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false); // ENOENT → try next candidate
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(PY3.test(out));
    });
  });

let resolved = null;
for (const cmd of CANDIDATES) {
  if (await probe(cmd)) {
    resolved = cmd;
    break;
  }
}
if (!resolved) {
  console.error("python.mjs: no Python 3 interpreter found (tried python3, py -3, python).");
  console.error("Install Python 3 or make it available on PATH.");
  process.exitCode = 127;
} else {
  const child = spawn(resolved[0], [...resolved.slice(1), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
  child.on("error", (err) => {
    console.error(`python.mjs: failed to launch ${resolved.join(" ")}: ${err.message}`);
    process.exitCode = 127;
  });
}
```

Key properties: zero npm dependencies (Node `child_process` only), ESM (`"type": "module"` project or `.mjs` extension), 5s probe timeout, `stdio: "inherit"` for the actual invocation so the child inherits the terminal (exit codes propagate via `process.exitCode`, which lets the event loop drain unlike `process.exit()`).

### Pattern 2: Route all Python-invoking npm scripts through the launcher

Every npm script that previously said `python ...` now says `node scripts/python.mjs ...`. The arguments after the launcher are forwarded verbatim to the chosen interpreter.

```json
{
  "scripts": {
    "test:python": "node scripts/python.mjs -m unittest tests/scripts/test_juso_search.py tests/scripts/test_gen_skills.py tests/scripts/test_juso_bridge.py tests/scripts/test_all_export.py",
    "test:mcp": "node scripts/python.mjs -m pytest mcp-server/tests",
    "gen-skills": "node scripts/python.mjs scripts/gen_skills.py"
  }
}
```

Now a developer or CI runner on any OS types `npm run test:python` and it Just Works — the launcher picks `python3` on mac/linux, `py -3` (or `python`) on Windows, and skips the Store stub on Windows automatically.

### Pattern 3: Free 3-OS CI matrix for public repos

GitHub Actions for **public repos** are free and effectively unlimited on standard runners (`ubuntu-latest`, `macos-latest`, `windows-latest`), **including macOS**. The 10× billing multiplier for macOS applies only to private repos beyond their free quota; for public repos there is no billing. Constraints to respect: standard labels only (no `-large`/`-xlarge`), up to 20 concurrent jobs (5 on macOS — queuing only, no billing), 10 GB cache per repo, 6-hour job timeout.

The workflow below runs two jobs across all three OSes. `python-matrix` exercises the Python skill CLI + MCP server; `js-matrix` exercises the full JS/extension build pipeline (including the per-platform esbuild/lightningcss/rolldown binaries). `fail-fast: false` ensures one OS's failure doesn't cancel the others.

```yaml
# .github/workflows/test-matrix.yml
name: test-matrix

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  python-matrix:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.13"
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: npm
      - name: Install mcp-server (dev)
        run: pip install -e "mcp-server[dev]"
      - name: Smoke launcher
        run: node scripts/python.mjs --version
      - name: Python tests
        run: npm run test:python
      - name: MCP tests
        run: npm run test:mcp

  js-matrix:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

Pinning details that matter:

- **Node LTS pin to `24`**, not the `lts/*` alias. The alias silently jumps when a new Node version enters LTS (Node 26 is coming), which can break builds overnight. Pin the concrete version.
- **Actions at `v7`** (Node 24 runtime). Older actions versions run on a Node 20 runtime and emit the `Node 20 is being deprecated` warning on every run. Bumping to `v7` silences that.
- **`actions/setup-python` with `python-version: "3.13"`** plus its built-in pip cache keeps installs fast and reproducible.
- **`fail-fast: false`** is mandatory for a 3-OS matrix — you want to see all failures, not just the first.

### Pattern 4: Close the "written but never executed" coverage gap

When platform branches are written but every test mocks the discovery layer, the `darwin`/`linux` branches of `chrome_candidates()` are dead code from a test-coverage perspective. Add a parametrized test that patches `sys.platform` to each value and asserts the returned candidate paths:

```python
# tests/scripts/test_juso_bridge.py
import sys
from unittest import mock

from juso_bridge import chrome_candidates


class ChromeCandidatesTests(unittest.TestCase):
    def test_chrome_candidates_platform_branches(self):
        cases = {
            "darwin": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "linux": "/usr/bin/google-chrome",
            "win32": "chrome.exe",  # with PROGRAMFILES/LOCALAPPDATA patched
        }
        for platform, expected in cases.items():
            with mock.patch.object(sys, "platform", platform):
                candidates = chrome_candidates()
                assert any(expected in str(c) for c in candidates), (
                    f"{platform}: no candidate matching {expected!r} in {candidates}"
                )
```

Also make the existing `NO_SUCH_CHROME` sentinel in `conftest.py` POSIX-safe (a leading `/`-rooted path works on all OSes and never collides with a real install): `/juso-search-test-no-such-chrome`.

## Why This Matters

The headline insight is that **the extension itself was already cross-platform**. It runs inside Chrome (the browser abstracts the OS), contains zero platform code, and uses a loopback-HTTP bridge (`http://127.0.0.1:<port>`) instead of native messaging — so there are no per-OS host-install manifests to ship. The only thing standing between "Windows-only dev experience" and "verified macOS/Linux support" was the **Python command name** in three npm scripts.

That is a much smaller and more durable problem than it first appears. "No single `python`/`python3` command works on all three OSes" is a well-known cross-platform gotcha, but the Windows Store stub is the non-obvious trap: `python3` on Windows doesn't `ENOENT`, it doesn't error — it prints nothing for `--version` and silently opens the Microsoft Store. A naive `try { python3 } catch { python }` falls into the trap because `python3` "succeeds" (exits 0) while producing no usable interpreter. The launcher's `/^Python 3\.\d+/m` regex filter is the precise mechanism that defeats this: an interpreter that prints nothing is rejected, and the probe moves on to `py -3` / `python`.

Once the launcher is in place, the cost of adding 3-OS CI is **zero dollars and zero maintenance burden** for a public repo. GitHub Actions standard runners (ubuntu/macos/windows) are free and unlimited for public repos — including macOS, whose 10× billing multiplier applies only to private repos beyond quota. So "supports macOS and Linux" becomes a **verified claim, not a hope**: every PR runs the full Python test suite, the MCP server tests, the vitest suite, lint, typecheck, and the WXT build (which pulls in per-platform esbuild/lightningcss/rolldown binaries) on all three operating systems.

The side benefits compound:

- The `darwin`/`linux` branches of `chrome_candidates()` are now executed by a parametrized test, closing a real coverage gap where platform-specific code had been written but never run.
- The full JS build pipeline (`npm install` → `typecheck` → `lint` → `test` → `build`) now runs on every OS in CI, catching platform-specific binary issues (e.g. a missing prebuilt esbuild binary for a given OS/arch) before they reach a user.
- Pinning Node to concrete `24` (not `lts/*`) and actions to `v7` (Node 24 runtime) silences the `Node 20 is being deprecated` warning and prevents surprise breakage when Node 26 enters LTS.

The reusable durable learning, then, is the **cross-platform Python launcher pattern** (probe + filter the Store stub + 5s timeout) plus the **free public-repo 3-OS CI matrix**. Together they turn a Windows-only dev story into verified cross-platform support with a few dozen lines of Node, one workflow file, and no ongoing cost.

## When to Apply

Apply this guidance when **any** of the following are true:

- **Any npm-scripted project that shells out to Python across Windows/macOS/Linux.** If your `package.json` has `python` or `python3` in any script and you intend developers on more than one OS to run it, you need the launcher. The command-name problem has no single-name solution.
- **Any public GitHub repo wanting free 3-OS CI.** If the repo is public, the macOS runner is free — there is no cost reason to skip it. A `test-matrix.yml` with ubuntu/macos/windows is pure upside.
- **Any project where the Windows `python3` Store stub silently breaks things.** If you've ever seen `python3 --version` produce no output on Windows (and especially if it popped the Store), this is the fix. The regex filter is the specific defense.
- **Any project whose platform-specific branches are written but never executed by tests.** If your tests always mock the discovery layer, add a parametrized `sys.platform` test so the branches actually run in CI.
- **Any project using per-platform native binaries (esbuild, lightningcss, rolldown, swc, better-sqlite3, etc.).** Running `npm run build` on all three OSes in CI catches missing prebuilt binaries before users do.

Do **not** apply the launcher pattern if your project only ever runs on one OS — the indirection adds noise for no benefit. And do not pin `lts/*` for Node in CI if reproducibility matters; pin a concrete LTS version.

## Examples

### Before: command-name roulette

```json
{
  "scripts": {
    "test:python": "python -m unittest tests/scripts/test_juso_search.py tests/scripts/test_gen_skills.py tests/scripts/test_juso_bridge.py tests/scripts/test_all_export.py",
    "test:mcp": "python -m pytest mcp-server/tests",
    "gen-skills": "python scripts/gen_skills.py"
  }
}
```

- On **macOS**: `python: command not found` (no `python` binary).
- If you "fix" it by switching to `python3`:
  - On **Windows**: `python3` is the Microsoft Store stub — no version output, Store pops open, script appears to hang or do nothing.
  - On **Linux** (Ubuntu 24.04 without `python-is-python3`): `python3` works, `python` doesn't.
- There is **no single command name** that works on all three OSes. Naive fallback (`try python3, catch python`) fails on Windows because `python3` exits 0 while being unusable.

### After: launcher + routed scripts

`scripts/python.mjs` (probe logic shown in Guidance; ~72 lines, ESM, zero deps):

```js
const CANDIDATES = [["python3"], ["py", "-3"], ["python"]];
const PY3 = /^Python 3\.\d+/m;
// probe each: spawn --version, capture stdout+stderr, 5s timeout, accept iff /PY3/.test(out)
// then spawn resolved[0] with forwarded args, stdio: "inherit"
```

`package.json`:

```json
{
  "scripts": {
    "test:python": "node scripts/python.mjs -m unittest tests/scripts/test_juso_search.py tests/scripts/test_gen_skills.py tests/scripts/test_juso_bridge.py tests/scripts/test_all_export.py",
    "test:mcp": "node scripts/python.mjs -m pytest mcp-server/tests",
    "gen-skills": "node scripts/python.mjs scripts/gen_skills.py"
  }
}
```

Result: `npm run test:python` picks `python3` on macOS/Linux, `py -3` (or `python`) on Windows, and skips the Store stub automatically — on all three OSes, with no per-OS config.

### After: 3-OS CI matrix (abridged)

```yaml
jobs:
  python-matrix:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with: { python-version: "3.13" }
      - uses: actions/setup-node@v7
        with: { node-version: "24", cache: npm }
      - run: pip install -e "mcp-server[dev]"
      - run: node scripts/python.mjs --version
      - run: npm run test:python
      - run: npm run test:mcp
  js-matrix:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: "24", cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

### After: closing the coverage gap

```python
class ChromeCandidatesTests(unittest.TestCase):
    def test_chrome_candidates_platform_branches(self):
        cases = {
            "darwin": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "linux": "/usr/bin/google-chrome",
            "win32": "chrome.exe",
        }
        for platform, expected in cases.items():
            with mock.patch.object(sys, "platform", platform):
                candidates = chrome_candidates()
                assert any(expected in str(c) for c in candidates)
```

### Verification (Tier 1, all green)

- `npm run test:python` → 59 tests OK
- `npm run test:mcp` → 41 passed
- `npm run gen-skills -- --check` → in sync
- `npm run lint` / `npm run typecheck` → EXIT 0
- `node scripts/python.mjs --version` → `Python 3.13.14`
- CI ran green on ubuntu-latest, macos-latest, and windows-latest
- Bumping actions to `v7` silenced the `Node 20 is being deprecated` warning

## Related

- [Agent Bridge skill contract drift](../integration-issues/agent-bridge-skill-contract-drift.md) — Bug 5 (Windows GBK console encoding) is the direct cross-platform Python precedent; the new `chrome_candidates()` parametrized test extends the test surface this doc identified as a gap.
- [Agent Skill localhost capability bridge](../architecture-patterns/agent-skill-localhost-capability-bridge.md) — establishes the loopback-HTTP bridge (not native messaging) that makes the extension cross-platform by design; the launcher + 3-OS CI now enforce that portability rather than just claim it.
- [Agent Skill distribution pipeline](../architecture-patterns/agent-skill-distribution-pipeline.md) — documents `gen_skills.py` and the drift-lock test that the launcher wraps (`npm run gen-skills`, `npm run test:python`).
- [PyPI trusted publishing (monorepo subdir)](../workflow-issues/pypi-trusted-publishing-monorepo-subdir.md) — publishing remains Linux-only (Docker-based action); tests now run on ubuntu/macos/windows via the new matrix.
- [npm overrides for transitive Dependabot fixes](./npm-overrides-transitive-dependabot-fixes.md) — documents the wxt/vite/esbuild toolchain whose per-platform binaries the new 3-OS CI matrix exercises on mac/linux.
