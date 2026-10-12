"""Drift lock: errors.md kind table vs juso_bridge.py ERROR_* constants.

Asserts the agent-facing error-kind documentation stays in sync with the
code that emits it:

1. every ``ERROR_<NAME> = "<kind>"`` constant in juso_bridge.py has a row in
   ``public/agent-skill/reference/errors.md``;
2. every kind documented in errors.md exists as an ERROR_* constant.

Both sides are scanned from source text with regexes — no hardcoded kind
list — so adding a constant or a row without updating the other side fails
here.
"""
from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_SCRIPT = REPO_ROOT / "public" / "agent-skill" / "scripts" / "juso_bridge.py"
ERRORS_DOC = REPO_ROOT / "public" / "agent-skill" / "reference" / "errors.md"

ERROR_CONST_RE = re.compile(r'^(ERROR_[A-Z0-9_]+)\s*=\s*"([^"]+)"', re.MULTILINE)
TABLE_ROW_RE = re.compile(r"^\|\s*`([^`]+)`\s*\|")


def _load_module(name: str, script: Path):
    spec = importlib.util.spec_from_file_location(name, script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _documented_kinds(text: str) -> list[str]:
    """First-column kind words from errors.md table rows.

    Header (``| kind | Meaning |``) and separator rows have no backticked
    first cell, so the regex skips them by construction.
    """
    kinds = []
    for line in text.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        m = TABLE_ROW_RE.match(line)
        if m:
            kinds.append(m.group(1))
    return kinds


class ErrorsReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge = _load_module("juso_bridge", BRIDGE_SCRIPT)
        cls.error_constants = ERROR_CONST_RE.findall(
            BRIDGE_SCRIPT.read_text(encoding="utf-8")
        )
        cls.doc_kinds = _documented_kinds(ERRORS_DOC.read_text(encoding="utf-8"))

    def test_constants_scanned_and_match_module(self):
        """Sanity: the scan finds the ERROR_* block and agrees with the module."""
        self.assertTrue(
            self.error_constants,
            "no ERROR_* assignments found in juso_bridge.py — scan regex or file is broken",
        )
        for const_name, kind_value in self.error_constants:
            self.assertEqual(getattr(self.bridge, const_name), kind_value)

    def test_every_error_constant_is_documented(self):
        missing = sorted({kind for _, kind in self.error_constants} - set(self.doc_kinds))
        self.assertEqual(
            missing,
            [],
            f"ERROR_* kinds missing from errors.md: {', '.join(missing)}",
        )

    def test_every_documented_kind_exists_in_code(self):
        extra = sorted(set(self.doc_kinds) - {kind for _, kind in self.error_constants})
        self.assertEqual(
            extra,
            [],
            f"errors.md kinds with no ERROR_* constant in juso_bridge.py: {', '.join(extra)}",
        )


if __name__ == "__main__":
    unittest.main()
