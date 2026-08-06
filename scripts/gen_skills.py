#!/usr/bin/env python3
"""Generate the two published Agent Skill dirs (prod + dev) from a single template.

Single source of truth: skills/_template/ holds prod-style content with one placeholder
(__JUSO_EXTENSION_ID__ inside scripts/juso_search.py). The prod published dir is the template
with the prod id substituted; the dev published dir additionally applies DEV_PATCH_* find/replace
pairs (the encoded prod->dev prose diff), then the dev id. Each patch `find` must match exactly
once, so any template drift surfaces as a loud generation error.

CLI:
  python scripts/gen_skills.py               # write both variants
  python scripts/gen_skills.py --check       # exit 1 if tracked dirs differ from generated
  python scripts/gen_skills.py --variant dev # write a single variant
"""
from __future__ import annotations

import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = REPO_ROOT / "public" / "agent-skill"
EXTENSION_ID_PLACEHOLDER = "__JUSO_EXTENSION_ID__"

VARIANTS = {
    "prod": {
        "extension_id": "illmhdnglkjfcenboepdgopaeejdgoji",
        "target_dir": REPO_ROOT / "skills" / "juso-search",
    },
    "dev": {
        "extension_id": "pdklefhommhabbhkglgkgomeibeibmcl",
        "target_dir": REPO_ROOT / "skills" / "juso-search-dev",
    },
}

# Encoded prod -> dev prose diff for SKILL.md. Authored with "\n"; adapted to the file's actual
# line separator at apply time. Each `find` must occur exactly once in the template.
DEV_PATCH_SKILL_MD = [
    ("name: juso-search\n", "name: juso-search-dev\n"),
    (
        "description: Search through configured Juso providers or supported browser search engines, or inspect configured providers.\n",
        "description: Search through configured Juso providers or supported browser search engines, or inspect configured providers (developer build, uses dev extension ID).\n",
    ),
    (
        "compatibility: Python 3.11+, Chromium-family browser with the Juso extension installed and enabled\n",
        "compatibility: Python 3.11+, Chromium-family browser with the Juso developer extension installed and enabled\n",
    ),
    ("# Juso Search\n", "# Juso Search (Developer Build)\n"),
    (
        "Use this skill when a task needs web search through the user's locally configured Juso providers, or needs to discover which providers are configured. The extension keeps API keys inside its background worker; this skill never reads or prints them.\n",
        "Use this skill when a task needs web search through the user's locally configured Juso **developer build** providers, or needs to discover which providers are configured. The extension keeps API keys inside its background worker; this skill never reads or prints them.\n\n> **注意：** 本技能仅适用于自行构建的 Juso 开发版（`npm run build:dev` 构建，扩展 ID `" + EXTENSION_ID_PLACEHOLDER + "`）。若你从 Chrome Web Store 安装 Juso，请改用 [juso-search](https://github.com/aiguozhi123456/juso-search/tree/main/skills/juso-search) 技能。\n",
    ),
    (
        "- Install and enable the Juso extension in a Chromium-family browser (Chrome, Edge, Chromium, Brave, etc.).\n",
        "- Build and load the Juso developer extension (`npm run build:dev` → load `.output/chrome-mv3-dev/` in `chrome://extensions` with Developer mode).\n",
    ),
    (
        "- Auto-discovery may only find common Chrome/Chromium installs. If the extension lives in Edge or another binary, set the browser path (see `reference/configuration.md`).\n",
        "",
    ),
    (
        "- The browser you open must be the one whose profile has Juso installed and enabled.\n",
        "- The browser you open must be the one whose profile has Juso developer build installed and enabled.\n",
    ),
]

DEV_PATCH_PY = [
    (
        '"""Local authenticated bridge to the Juso Chrome extension."""',
        '"""Local authenticated bridge to the Juso Chrome extension (developer build)."""',
    ),
    (
        'argument_parser = argparse.ArgumentParser(description="Search through the local Juso extension")',
        'argument_parser = argparse.ArgumentParser(description="Search through the local Juso extension (developer build)")',
    ),
]

# dev variant 只对 SKILL.md 与 .py 有 prose 差异；reference/ 文件 prod/dev 共有，无 patch。
DEV_PATCHES = {
    "SKILL.md": DEV_PATCH_SKILL_MD,
    "scripts/juso_search.py": DEV_PATCH_PY,
}


def _template_files() -> list[str]:
    """递归收集模板目录下所有文件（相对 POSIX 路径），排除 __pycache__。"""
    files: list[str] = []
    for path in sorted(TEMPLATE_DIR.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            files.append(path.relative_to(TEMPLATE_DIR).as_posix())
    return files


def _read_template(rel: str) -> str:
    # newline="" preserves original line endings byte-for-byte.
    return (TEMPLATE_DIR / rel).read_text(encoding="utf-8", newline="")


def _line_sep(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def _apply_patch(text: str, patch: list[tuple[str, str]], label: str, sep: str) -> str:
    for find, replace in patch:
        find_adj = find.replace("\n", sep)
        replace_adj = replace.replace("\n", sep)
        count = text.count(find_adj)
        if count != 1:
            raise SystemExit(
                f"gen_skills: DEV_PATCH[{label}] find-string matched {count} time(s), expected 1.\n"
                f"  find: {find_adj[:90]!r}\n"
                f"  The template drifted from the patch; update skills/_template/ or the patch."
            )
        text = text.replace(find_adj, replace_adj)
    return text


def render(variant_key: str) -> dict[str, str]:
    cfg = VARIANTS[variant_key]
    out: dict[str, str] = {}
    for rel in _template_files():
        text = _read_template(rel)
        sep = _line_sep(text)
        if variant_key == "dev":
            patch = DEV_PATCHES.get(rel, [])
            if patch:
                text = _apply_patch(text, patch, rel, sep)
        # Final pass: stamp the extension id everywhere (including dev-patch-inserted content).
        text = text.replace(EXTENSION_ID_PLACEHOLDER, cfg["extension_id"])
        if EXTENSION_ID_PLACEHOLDER in text:
            raise SystemExit(f"gen_skills: unresolved {EXTENSION_ID_PLACEHOLDER} in {variant_key}:{rel}")
        out[rel] = text
    return out


def write_variant(variant_key: str) -> None:
    cfg = VARIANTS[variant_key]
    for rel, text in render(variant_key).items():
        target = cfg["target_dir"] / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="")


def check() -> list[str]:
    diffs: list[str] = []
    for variant_key, cfg in VARIANTS.items():
        for rel, gen_text in render(variant_key).items():
            tracked = cfg["target_dir"] / rel
            if not tracked.is_file():
                diffs.append(f"{variant_key}:{rel} (missing)")
                continue
            if tracked.read_text(encoding="utf-8", newline="") != gen_text:
                diffs.append(f"{variant_key}:{rel}")
    return diffs


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate published Agent Skill dirs from template")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--variant", choices=list(VARIANTS))
    args = ap.parse_args()
    if args.check:
        diffs = check()
        if diffs:
            print("gen_skills: tracked skill dirs differ from generator output:")
            for d in diffs:
                print(f"  {d}")
            print("Run `python scripts/gen_skills.py` to regenerate, or fix skills/_template/.")
            return 1
        print("gen_skills: tracked skill dirs match generator output (in sync).")
        return 0
    for key in ([args.variant] if args.variant else list(VARIANTS)):
        write_variant(key)
        print(f"gen_skills: wrote {VARIANTS[key]['target_dir'].relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
