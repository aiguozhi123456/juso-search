---
title: PyPI Trusted Publishing workflow for a monorepo-subdir Python package
date: 2026-08-09
category: docs/solutions/workflow-issues
module: mcp-server
problem_type: workflow_issue
component: tooling
severity: medium
applies_when:
  - Publishing a Python package to PyPI from a GitHub Actions workflow
  - The package lives in a subdirectory of a monorepo (not repo root)
  - Setting up Trusted Publishing (OIDC) for the first time
tags: [pypi, trusted-publishing, oidc, github-actions, pep-639, setuptools]
---

# PyPI Trusted Publishing workflow for a monorepo-subdir Python package

## Context

The `juso-search` MCP server pip package lives in `mcp-server/` within a
Chrome-extension monorepo. It needed a GitHub Actions workflow to publish to
PyPI on release. The package uses setuptools + `pyproject.toml` (build-system
`setuptools>=77`, one dependency `mcp>=2.0,<3`, a console_script entry point).

Three non-obvious issues surfaced during setup and first publish:

1. **Trusted Publishing (OIDC)** is the 2026 best practice but requires exact
   workflow-filename + environment-name registration on pypi.org — a mismatch
   silently 403s the upload.
2. **PyPI's file-name-reuse policy** blocks re-uploading a filename previously
   held by a deleted file. A botched 0.1.0 release (wheel uploaded, sdist
   rejected) left a half-published version; deleting it on PyPI did NOT free
   the filenames — the only fix is a version bump.
3. **PEP 639 license deprecation**: `license = { text = "MPL-2.0" }` (the
   table form) is deprecated in setuptools ≥77; the build emits a warning. The
   SPDX string form `license = "MPL-2.0"` requires setuptools ≥77.

## Guidance

### Workflow structure (`.github/workflows/pypi-publish.yml`)

Use **Trusted Publishing (OIDC)** — no API tokens. Two separate jobs:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: python -m pip install --upgrade pip build
      - run: python -m build mcp-server/   # srcdir positional → mcp-server/dist/
      - uses: actions/upload-artifact@v4
        with: { name: python-package-distributions, path: mcp-server/dist/ }

  publish:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: pypi, url: "https://pypi.org/project/juso-search/" }
    permissions: { id-token: write }   # REQUIRED for OIDC; only on this job
    steps:
      - uses: actions/download-artifact@v4
        with: { name: python-package-distributions, path: dist/ }
      - uses: pypa/gh-action-pypi-publish@release/v1
```

Key points:

- **`python -m build <srcdir>`** accepts the package directory as a positional
  arg — no `cd` needed. Output lands in `<srcdir>/dist/`.
- **Separate build and publish jobs.** This is a security requirement, not
  style: build dependencies are untrusted, and mixing them with the
  OIDC-elevated publish job enables dependency-poisoning privilege escalation.
- **`id-token: write` only on the publish job**, never globally.
- **`environment: pypi`** — the name must exactly match what you register on
  pypi.org. Required reviewers can be added to this environment for a manual
  approval gate.
- The action is Docker-based → **Linux runners only** (`ubuntu-latest`).
- PEP 740 Sigstore attestations are generated automatically (on by default).

### One-time PyPI setup

pypi.org → Manage the project → Publishing → add a GitHub Actions publisher
with EXACTLY:
- workflow filename: `pypi-publish.yml` (must match the file path under
  `.github/workflows/`; renaming the file later breaks publishing)
- environment name: `pypi` (must match the `environment:` block)

No tokens to create or secrets to paste. If the project doesn't exist yet, the
same form creates it on first upload.

### PEP 639 license (pyproject.toml)

```toml
[build-system]
requires = ["setuptools>=77"]          # SPDX license form needs ≥77

[project]
license = "MPL-2.0"                     # SPDX expression (NOT { text = "..." })
```

The legacy `license = { text = "MPL-2.0" }` table form still works but emits a
deprecation warning on every build with setuptools ≥77. The string form
produces `License-Expression: MPL-2.0` in wheel METADATA (PEP 639).

### File-name-reuse recovery

If a publish partially fails (e.g., wheel uploaded, sdist 400'd) and you
delete the version on PyPI, the filenames are **permanently burned** — PyPI
forbids reusing a filename previously held by a deleted file (supply-chain
protection). The only recovery is a **version bump** (`0.1.0` → `0.1.1`),
commit, push, re-trigger.

## Why This Matters

- **Trusted Publishing** eliminates long-lived API tokens that can leak. The
  OIDC token is project-scoped and expires in 15 minutes.
- **Build/publish separation** prevents a compromised build dependency from
  minting PyPI upload tokens.
- **File-name-reuse** is a PyPI policy most teams discover only after a botched
  first release. Knowing it upfront saves a confused debugging cycle.
- **PEP 639** is the current standard; shipping a deprecation-warning-free
  build is baseline hygiene for a new package.

## When to Apply

- Any new Python package published to PyPI via GitHub Actions.
- When a package lives in a monorepo subdir (use `python -m build <srcdir>/`).
- When migrating from API-token publishing to Trusted Publishing.
- When a first publish fails with "This filename was previously used by a file
  that has since been deleted" — bump the version, don't try to fix the filename.

## Related

- [pypa/gh-action-pypi-publish](https://github.com/pypa/gh-action-pypi-publish) — action README + releases
- [packaging.python.org publishing guide](https://packaging.python.org/en/latest/guides/publishing-package-distribution-releases-using-github-actions-ci-cd-workflows/)
- [docs.pypi.org trusted publishers](https://docs.pypi.org/trusted-publishers/)
- `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md` — the MCP server this package ships
