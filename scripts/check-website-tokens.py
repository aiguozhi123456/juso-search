#!/usr/bin/env python3
"""Drift-lock: the website's CSS tokens vs the extension's source of truth.

The site inherits its design system from entrypoints/shared/tokens.css by hand,
so drift is a real failure mode. This script locks the shared subset.

Split (the same split documented in the comment block at the top of
website/assets/css/style.css `:root`):

  · MUST-MATCH  —— the site and the extension must be value-identical:
      - brand colors:  --brand / --brand-soft / --brand-softer / --brand-on
      - neutrals:      --bg / --bg-soft / --fg / --muted / --border
      - motion:        --duration-fast / --duration-normal / --duration-slow
    in two scopes: `:root` (light) and `@media (prefers-color-scheme: dark)`
    (dark). Durations are declared once in `:root` and cascade into dark, so the
    dark scope only locks the color tokens. Any value change on either side
    exits 1 with a per-token diff.

  · INTENTIONAL DIVERGENCE  —— allowed to differ, never fails:
      - Fonts: site self-hosts Fraunces / Hanken Grotesk / JetBrains Mono woff2
        (latin subsets) for distinctive marketing typography; the extension uses
        system CJK font stacks.
      - Shadows: site uses larger/softer shadows (0 6px 20px / 0 18px 48px) for
        a marketing feel vs the extension (0 4px 12px / 0 12px 32px).
      - Site-only tokens (--brand-ink / --faint / --bg-sunk / --maxw / --gut):
        legitimate site additions with no extension counterpart.

Usage:
  python scripts/check-website-tokens.py   # exit 0 if in sync, 1 if drifted
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEBSITE_CSS = REPO_ROOT / "website" / "assets" / "css" / "style.css"
TOKENS_CSS = REPO_ROOT / "entrypoints" / "shared" / "tokens.css"

# Light scope locks colors + durations; dark scope only colors (durations are
# declared once in `:root` and cascade into dark on both sides).
COLOR_TOKENS = [
    "--brand",
    "--brand-soft",
    "--brand-softer",
    "--brand-on",
    "--bg",
    "--bg-soft",
    "--fg",
    "--muted",
    "--border",
]
DURATION_TOKENS = ["--duration-fast", "--duration-normal", "--duration-slow"]
MUST_MATCH_LIGHT = COLOR_TOKENS + DURATION_TOKENS
MUST_MATCH_DARK = COLOR_TOKENS


@dataclass
class Rule:
    selector: str
    props: dict[str, str] = field(default_factory=dict)


def _strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _parse_props(text: str) -> dict[str, str]:
    props: dict[str, str] = {}
    for decl in text.split(";"):
        if ":" not in decl:
            continue
        name, _, value = decl.partition(":")
        name = name.strip()
        if name.startswith("--"):
            props[name] = value.strip()
    return props


def _split_rules(body: str) -> list[Rule]:
    """Split a block body into top-level `selector { ... }` rules (no nesting)."""
    rules: list[Rule] = []
    i = 0
    n = len(body)
    while i < n:
        j = body.find("{", i)
        if j == -1:
            break
        selector = body[i:j].strip()
        depth = 1
        k = j + 1
        while k < n and depth:
            if body[k] == "{":
                depth += 1
            elif body[k] == "}":
                depth -= 1
            k += 1
        rules.append(Rule(selector=selector, props=_parse_props(body[j + 1 : k - 1])))
        i = k
    return rules


def _first_dark_media_body(css: str) -> str:
    """Return the body of the FIRST `@media (prefers-color-scheme: dark)` block."""
    m = re.search(r"@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{", css)
    if not m:
        return ""
    start = m.end()
    depth = 1
    k = start
    while k < len(css) and depth:
        if css[k] == "{":
            depth += 1
        elif css[k] == "}":
            depth -= 1
        k += 1
    return css[start : k - 1]


def extract_tokens(css: str) -> tuple[dict[str, str], dict[str, str]]:
    """Return (light_props, dark_props) for the `:root` token scopes.

    Light = top-level rules whose selector is exactly `:root` (excludes
    `:root[data-theme="dark"]` / `:root[data-style=...]` variants).
    Dark = every `:root`-ish rule inside the first dark media block
    (`:root:not([data-theme])` on the extension side; the colorful/dark
    data-theme variants are intentionally not part of the lock).
    """
    css = _strip_comments(css)
    light: dict[str, str] = {}
    for rule in _split_rules(css):
        if rule.selector == ":root":
            light.update(rule.props)
    dark: dict[str, str] = {}
    for rule in _split_rules(_first_dark_media_body(css)):
        if ":root" in rule.selector:
            dark.update(rule.props)
    return light, dark


def check() -> list[str]:
    site_light, site_dark = extract_tokens(WEBSITE_CSS.read_text(encoding="utf-8"))
    ext_light, ext_dark = extract_tokens(TOKENS_CSS.read_text(encoding="utf-8"))
    diffs: list[str] = []
    for scope, must_match, site, ext in (
        ("light", MUST_MATCH_LIGHT, site_light, ext_light),
        ("dark", MUST_MATCH_DARK, site_dark, ext_dark),
    ):
        for token in must_match:
            sv = site.get(token)
            ev = ext.get(token)
            if sv is None:
                diffs.append(f"{scope} {token}: MISSING in website/assets/css/style.css")
            elif ev is None:
                diffs.append(f"{scope} {token}: MISSING in entrypoints/shared/tokens.css")
            elif sv != ev:
                diffs.append(f"{scope} {token}: website {sv!r} != extension {ev!r}")
    return diffs


def main() -> int:
    ap = argparse.ArgumentParser(description="Lock website CSS tokens to the extension's tokens.css")
    ap.add_argument("--check", action="store_true", help=argparse.SUPPRESS)
    ap.parse_args()
    diffs = check()
    if diffs:
        print("check-website-tokens: token drift detected (website vs entrypoints/shared/tokens.css):")
        for d in diffs:
            print(f"  {d}")
        print("Reconcile website/assets/css/style.css to the extension values, or — if the")
        print("divergence is intentional — document it in the :root comment block in style.css.")
        return 1
    print("check-website-tokens: must-match tokens in sync (light + dark); intentional divergences allowed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
