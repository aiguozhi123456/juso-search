"""Drift + correctness tests for the Agent Skill generator (scripts/gen_skills.py)."""
from __future__ import annotations

import importlib.util
import tempfile
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

    def _with_tmp_variant(self, name: str) -> Path:
        """Register a scratch variant rendered into a temp dir; restores VARIANTS on teardown."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        target = Path(tmp.name)
        orig = dict(self.gen.VARIANTS)
        self.gen.VARIANTS[name] = {"extension_id": "test-extension-id", "target_dir": target}
        self.addCleanup(lambda: (self.gen.VARIANTS.clear(), self.gen.VARIANTS.update(orig)))
        return target

    def test_generated_dirs_match_tracked(self):
        """The two published skill dirs must equal generator output (drift lock)."""
        diffs = self.gen.check()
        self.assertEqual(diffs, [], f"Tracked skill dirs drifted from generator output: {diffs}")

    def test_check_flags_stale_file_in_published_dir(self):
        """tracked ⊆ generated: a published file absent from the template must fail --check."""
        target = self._with_tmp_variant("test-variant")
        for rel, text in self.gen.render("test-variant").items():
            path = target / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="")
        (target / "SKILL.md.bak").write_text("stale", encoding="utf-8", newline="")
        self.assertIn("test-variant:SKILL.md.bak (stale)", self.gen.check())

    def test_write_variant_prunes_stale_files(self):
        """Regeneration must delete published files the template no longer produces."""
        target = self._with_tmp_variant("test-variant")
        self.gen.write_variant("test-variant")
        stale = target / "SKILL.md.bak"
        stale.write_text("stale", encoding="utf-8", newline="")
        self.gen.write_variant("test-variant")
        self.assertFalse(stale.exists())
        self.assertEqual(self.gen._stale_files("test-variant"), [])

    def test_no_placeholder_remains_in_rendered_output(self):
        for key in self.gen.VARIANTS:
            for rel, text in self.gen.render(key).items():
                self.assertNotIn(
                    self.gen.EXTENSION_ID_PLACEHOLDER, text,
                    f"{key}:{rel} still contains {self.gen.EXTENSION_ID_PLACEHOLDER}",
                )

    def test_juso_bridge_byte_identical_across_source_prod_dev(self):
        """juso_bridge.py is a single source vendored verbatim (byte-equal) into both skill dirs."""
        source = (self.gen.TEMPLATE_DIR / "scripts" / "juso_bridge.py").read_bytes()
        for key, cfg in self.gen.VARIANTS.items():
            tracked = cfg["target_dir"] / "scripts" / "juso_bridge.py"
            self.assertEqual(
                tracked.read_bytes(),
                source,
                f"{key} scripts/juso_bridge.py drifted from the single source",
            )

    def test_mcp_vendored_bridge_matches_source(self):
        """gen produces mcp-server/juso_search/juso_bridge.py == source; check() covers it."""
        source = (self.gen.TEMPLATE_DIR / "scripts" / "juso_bridge.py").read_bytes()
        mcp = self.gen.MCP_SERVER_DIR / "juso_search" / "juso_bridge.py"
        self.assertTrue(mcp.is_file(), "mcp-server/juso_search/juso_bridge.py is missing (run gen-skills)")
        self.assertEqual(mcp.read_bytes(), source, "MCP vendored juso_bridge.py drifted from the single source")

    def test_juso_bridge_never_patched(self):
        """juso_bridge.py is shared/unpatched: no DEV_PATCH_*, dev render == source."""
        self.assertNotIn(
            "scripts/juso_bridge.py",
            self.gen.DEV_PATCHES,
            "juso_bridge.py must not carry any DEV_PATCH_* prose diff",
        )
        source_text = (self.gen.TEMPLATE_DIR / "scripts" / "juso_bridge.py").read_text(
            encoding="utf-8", newline=""
        )
        prod = self.gen.render("prod")
        dev = self.gen.render("dev")
        self.assertEqual(prod["scripts/juso_bridge.py"], source_text)
        self.assertEqual(dev["scripts/juso_bridge.py"], source_text, "dev render must equal the source verbatim")

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
        self.assertIn("Auto-discovery finds common Chrome/Chromium and Firefox installs", prod["SKILL.md"])
        self.assertNotIn("Auto-discovery finds common Chrome/Chromium and Firefox installs", dev["SKILL.md"])
        # .py: dev docstring carries the (developer build) suffix; ids differ between variants.
        self.assertIn(
            '"""Local authenticated bridge to the Juso extension (developer build)."""',
            dev["scripts/juso_search.py"],
        )
        self.assertNotIn("(developer build)", prod["scripts/juso_search.py"])
        self.assertIn(self.gen.VARIANTS["prod"]["extension_id"], prod["scripts/juso_search.py"])
        self.assertIn(self.gen.VARIANTS["dev"]["extension_id"], dev["scripts/juso_search.py"])


if __name__ == "__main__":
    unittest.main()
