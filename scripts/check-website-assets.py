#!/usr/bin/env python3
"""Drift-lock: duplicated assets between the website and the extension/docs.

Some assets are hand-duplicated across the repo for the website build, and
these are manual duplication channels that drift without enforcement. This
script SHA256-compares byte identity of each pair and exits 1 with a clear
diff (filename + which side differs) if any pair has drifted.

  · Icons —— website/static/icons/*.svg  ↔  public/icons/*.svg
    The website mirrors the extension's engine icons 1:1 by filename (21
    pairs). Any new or renamed icon must be copied to BOTH directories.

  · Screenshots —— website/static/img/screenshot-*.png  ↔  docs/assets/screens/*.png
    The website build needs its own copies of the marketing screenshots, so
    they are duplicated from the docs directory. The mapping table lives in
    website/static/img/README.md and is authoritative; the pairs below are
    the four rows with a docs counterpart (screenshot-search.png and
    screenshot-serp.png are website-only and intentionally excluded).

Usage:
  python scripts/check-website-assets.py   # exit 0 if in sync, 1 if drifted
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEBSITE_ICONS = REPO_ROOT / "website" / "static" / "icons"
EXT_ICONS = REPO_ROOT / "public" / "icons"
WEBSITE_IMG = REPO_ROOT / "website" / "static" / "img"
DOCS_SCREENS = REPO_ROOT / "docs" / "assets" / "screens"

# Mapping table from website/static/img/README.md (website name → docs name).
# Rows without a docs counterpart (screenshot-search/screenshot-serp) are
# website-only and not part of the lock.
SCREENSHOT_PAIRS = [
    ("screenshot-instances.png", "settings-instances-clean.png"),
    ("screenshot-cache.png", "search-cache-panel-clean.png"),
    ("screenshot-sources.png", "settings-sources-clean.png"),
    ("screenshot-agent-bridge.png", "settings-general-clean.png"),
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _check_icon_pairs() -> list[str]:
    """Byte-compare website/static/icons vs public/icons, names must match 1:1."""
    site = {p.name: p for p in WEBSITE_ICONS.glob("*.svg")}
    ext = {p.name: p for p in EXT_ICONS.glob("*.svg")}
    diffs: list[str] = []
    for name in sorted(set(site) | set(ext)):
        if name not in site:
            diffs.append(f"icons/{name}: MISSING in website/static/icons/")
        elif name not in ext:
            diffs.append(f"icons/{name}: MISSING in public/icons/")
        elif _sha256(site[name]) != _sha256(ext[name]):
            diffs.append(f"icons/{name}: website/static/icons/ differs from public/icons/")
    return diffs


def _check_screenshot_pairs() -> list[str]:
    """Byte-compare the website/img ↔ docs/assets/screens mapping from README.md."""
    diffs: list[str] = []
    for site_name, docs_name in SCREENSHOT_PAIRS:
        site = WEBSITE_IMG / site_name
        docs = DOCS_SCREENS / docs_name
        if not site.exists():
            diffs.append(f"screenshots/{site_name}: MISSING in website/static/img/")
        elif not docs.exists():
            diffs.append(f"screenshots/{docs_name}: MISSING in docs/assets/screens/")
        elif _sha256(site) != _sha256(docs):
            diffs.append(
                f"screenshots/{site_name} <-> {docs_name}: "
                "website/static/img/ differs from docs/assets/screens/"
            )
    return diffs


def check() -> list[str]:
    diffs = _check_icon_pairs()
    diffs += _check_screenshot_pairs()
    return diffs


def main() -> int:
    ap = argparse.ArgumentParser(description="Lock duplicated website assets to their sources")
    ap.add_argument("--check", action="store_true", help=argparse.SUPPRESS)
    ap.parse_args()
    diffs = check()
    if diffs:
        print("check-website-assets: asset drift detected (website vs sources):")
        for d in diffs:
            print(f"  {d}")
        print("Reconcile the duplicated file(s), or — if the divergence is intentional —")
        print("update both copies / remove the pair from the lock.")
        return 1
    icon_count = len(list(WEBSITE_ICONS.glob("*.svg")))
    print(
        f"check-website-assets: {icon_count} icon pairs + "
        f"{len(SCREENSHOT_PAIRS)} screenshot pairs byte-identical."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
