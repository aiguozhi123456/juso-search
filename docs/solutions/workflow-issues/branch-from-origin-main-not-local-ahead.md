---
title: "Branch from origin/main, Not a Local-Ahead main: Rider Commits and PR Contamination"
date: 2026-11-06
category: workflow-issues
module: "git / PR workflow"
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Cutting a feature branch while local main has unpushed commits (this repo's standing local-first workflow)"
  - "A PR's commit list or diff does not match what the PR description says it contains"
  - "Recovering after rider commits already merged into origin/main"
  - "Reviewing any branch-base decision in a repo where origin/main routinely lags local main"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags: [git-workflow, pr-hygiene, rider-commits, force-with-lease, branch-base, main-divergence]
---

# Branch from origin/main, Not a Local-Ahead main: Rider Commits and PR Contamination

## Context

This repo's maintainer works on `main` locally with stretches of unpushed
commits; `origin/main` has repeatedly lagged by days in this repo's observed
history. During the wxt 0.21 adaptation (issue #20), the feature branch was cut
from local main, which carried six unpushed commits (five docs commits and one
Python-baseline commit). PR #26 was described as four commits but contained
ten — the four intended commits plus six "rider" commits that had never been
independently reviewed (both PRs involved ended with zero reviews; the author
self-merged). It merged, so `origin/main`'s history diverged from the PR's
stated scope. Detection was post-merge, via `git log --graph`. Recovery
required rewriting main: force-push main back to the rider tip (the commit
local main was at when the branch was cut), which put the six commits on
`origin/main` directly, then re-push the branch and merge a clean follow-up PR
(#27) that cross-referenced the superseded one.

A grep sweep of `docs/solutions/` before writing this doc found zero coverage
of the area: `origin/main` 0 hits, `force-with-lease` 0 hits, `rebase` 0 hits.
The repo's merge-time and commit-scope disciplines exist (release process,
PR drift gating) but nothing covers the branching base.

## Guidance

**Before cutting any branch** — one command, the whole lesson:

```bash
git fetch origin
git log --oneline origin/main..main
```

Non-empty output means local main has unpushed commits. Decide explicitly,
never silently:

- The commits are complete and meant to be public → push them to main first,
  then branch.
- They are not → branch from `origin/main` (`git switch -c <branch> origin/main`)
  and leave them sitting on local main.

**When opening the PR**, the branch's commit list must equal what the PR
claims:

```bash
git log --oneline origin/main..<branch>
```

If a PR described as "4 commits" shows ten, stop — that is rider
contamination, and the extra commits need their own review before anything
merges.

**If contamination already merged** (the recovery this session executed, in
order):

1. Identify the **rider tip** — the commit local main was at when the branch
   was cut. It is the tip of the rider commits, not the fork point: the fork
   point (parent of the oldest rider commit) is the pre-rider baseline that
   `origin/main` already had. Confusing the two puts the recovery off by the
   whole rider range.
2. Reset local main to the rider tip and force-push with an explicit lease:
   `git reset --hard <rider-tip>` then
   `git push --force-with-lease=refs/heads/main:<old-remote-tip> origin main`.
   The force-push is what lands the rider commits on `origin/main` — they
   become part of main's first-parent line, so no separate "push the riders"
   step exists. The explicit expected SHA makes the push refuse to clobber a
   remote that moved for any other reason.
3. Treat a direct push to main as an action with consequences: push-triggered
   automation fires. In this session the push ran a Dependabot dynamic job that
   failed on the new main tip and queued a deploy check; the repo's
   `.github/workflows/test-js-matrix.yml` and `test-python-matrix.yml` both
   declare `push: branches: [main]` triggers. Check what will run before
   pushing. (The riders here were already CI-tested inside the superseded PR —
   a fact to verify per case, not a default.)
4. Re-create the branch at the intended tip, push it, and open a follow-up PR
   that cross-references the superseded PR. Identical commit SHAs already
   carry green checks from the superseded PR and GitHub shows them
   immediately — but it still re-runs the `pull_request` workflows on the new
   PR (in this session #27 merged about 70 seconds before its re-runs
   finished). "Approve then merge" speed depends on branch protection — main
   here is not protected — not on checks resolving.

## Why This Matters

- Rider commits make review, CI scope, and main history misleading: the PR
  stated four commits and main received ten, and the six riders had no
  independent review at all.
- The prevention costs one command. The recovery is a force-push of a shared
  branch — it rewrites published history for everyone and can clobber
  concurrent pushes (mitigated, not eliminated, by `--force-with-lease` with an
  explicit expected SHA).
- The failure is invisible at branch-creation time: nothing warns that the
  commit you branched from contains unpushed work, and the PR UI shows the
  rider commits as ordinary branch commits.

## When to Apply

- Cutting any feature branch in this repo — the local-ahead-main state is the
  standing workflow here, not an anomaly.
- Any repo where local main routinely runs ahead of origin/main.
- Reviewing a PR whose commit count or content does not match its description.
- Recovering after riders already merged (rider-tip reset + explicit-lease
  force-push + clean follow-up PR).

## Examples

**The incident (issue #20 work).** Local main was six commits ahead of
origin/main. The branch was cut from local main. PR #26 described four
commits; the merge brought ten. `git log --graph origin/main` showed the branch
line containing six commits that predated the feature work.

**The recovery (main rewritten clean).**

```bash
git fetch origin
# rider tip = the commit local main was at when the branch was cut
git checkout main && git reset --hard <rider-tip>
git push --force-with-lease=refs/heads/main:<old-remote-tip> origin main
# origin/main now holds exactly the six rider commits on its first-parent line
git branch chore/wxt-021-strict-tsconfig <intended-tip>   # the 4 wxt commits
git push -u origin chore/wxt-021-strict-tsconfig
# PR #27: exactly the four intended commits, cross-referencing superseded #26
```

## Related

- `docs/solutions/workflow-issues/chrome-extension-release-process.md` — the
  release flow whose push/tag steps assume the branching base this doc defines.
- `docs/solutions/architecture-patterns/serp-bar-bottom-position-and-scroll-hide.md` —
  records the downstream cost of a diverged main (cherry-pick onto diverged
  main); this doc addresses the upstream cause that produces divergence.
- `docs/solutions/architecture-patterns/website-hugo-subpath-deployment.md` —
  PR-gating discipline in the same family ("drift must be caught before merge,
  not by reddening main after it").
- Issue #20, PR #26, PR #27 — the incident, the contaminated merge, and the
  clean re-merge.
