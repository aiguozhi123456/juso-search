"""Drift + correctness tests for the Agent Skill generator (scripts/gen_skills.py)."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GEN_SCRIPT = REPO_ROOT / "scripts" / "gen_skills.py"


def _load_gen():
    spec = importlib.util.spec_from_file_location("gen_skills", GEN_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GenSkillsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = _load_gen()

    def test_generated_dirs_match_tracked(self):
        """The two published skill dirs must equal generator output (drift lock)."""
        diffs = self.gen.check()
        self.assertEqual(diffs, [], f"Tracked skill dirs drifted from generator output: {diffs}")

    def test_no_placeholder_remains_in_rendered_output(self):
        for key in self.gen.VARIANTS:
            for rel, text in self.gen.render(key).items():
                self.assertNotIn(
                    self.gen.EXTENSION_ID_PLACEHOLDER, text,
                    f"{key}:{rel} still contains {self.gen.EXTENSION_ID_PLACEHOLDER}",
                )

    def test_dev_differs_from_prod_only_in_expected_dimensions(self):
        prod = self.gen.render("prod")
        dev = self.gen.render("dev")
        # SKILL.md: dev-only signals present in dev, absent in prod.
        for needle in (
            "# Juso Search (Developer Build)",
            "name: juso-search-dev",
            "本技能仅适用于自行构建的 Juso 开发版",
            "(developer build, uses dev extension ID)",
        ):
            self.assertIn(needle, dev["SKILL.md"], f"dev SKILL.md missing {needle!r}")
            self.assertNotIn(needle, prod["SKILL.md"], f"prod SKILL.md unexpectedly has {needle!r}")
        # auto-discovery line present in prod, removed in dev.
        self.assertIn("Auto-discovery may only find", prod["SKILL.md"])
        self.assertNotIn("Auto-discovery may only find", dev["SKILL.md"])
        # .py: dev docstring carries the (developer build) suffix; ids differ between variants.
        self.assertIn(
            '"""Local authenticated bridge to the Juso Chrome extension (developer build)."""',
            dev["scripts/juso_search.py"],
        )
        self.assertNotIn("(developer build)", prod["scripts/juso_search.py"])
        self.assertIn(self.gen.VARIANTS["prod"]["extension_id"], prod["scripts/juso_search.py"])
        self.assertIn(self.gen.VARIANTS["dev"]["extension_id"], dev["scripts/juso_search.py"])


if __name__ == "__main__":
    unittest.main()
