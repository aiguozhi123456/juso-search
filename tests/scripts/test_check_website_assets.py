"""Tests for the website asset drift-lock (scripts/check-website-assets.py)."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ASSETS_SCRIPT = REPO_ROOT / "scripts" / "check-website-assets.py"


def _load_assets():
    spec = importlib.util.spec_from_file_location("check_website_assets", ASSETS_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IconPairTests(unittest.TestCase):
    """Hermetic tests over patched icon dirs (module-level Path constants)."""

    def setUp(self):
        self.assets = _load_assets()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name)
        self.site = root / "site"
        self.ext = root / "ext"
        self.site.mkdir()
        self.ext.mkdir()
        self._orig = (self.assets.WEBSITE_ICONS, self.assets.EXT_ICONS)
        self.assets.WEBSITE_ICONS = self.site
        self.assets.EXT_ICONS = self.ext
        self.addCleanup(self._restore)

    def _restore(self):
        self.assets.WEBSITE_ICONS, self.assets.EXT_ICONS = self._orig

    def test_identical_pair_passes(self):
        (self.site / "google.svg").write_bytes(b"a")
        (self.ext / "google.svg").write_bytes(b"a")
        self.assertEqual(self.assets._check_icon_pairs(), [])

    def test_drifted_pair_fails(self):
        (self.site / "google.svg").write_bytes(b"a")
        (self.ext / "google.svg").write_bytes(b"b")
        self.assertEqual(
            self.assets._check_icon_pairs(),
            ["icons/google.svg: website/static/icons/ differs from public/icons/"],
        )

    def test_missing_website_copy_fails(self):
        (self.ext / "google.svg").write_bytes(b"a")
        self.assertEqual(
            self.assets._check_icon_pairs(),
            ["icons/google.svg: MISSING in website/static/icons/"],
        )

    def test_excluded_extension_only_icon_needs_no_website_copy(self):
        """aggregate.svg (ICON_EXCLUSIONS) is extension-only: no website copy expected."""
        self.assertIn("aggregate.svg", self.assets.ICON_EXCLUSIONS)
        (self.ext / "aggregate.svg").write_bytes(b"a")
        self.assertEqual(self.assets._check_icon_pairs(), [])

    def test_non_excluded_extension_only_icon_still_fails(self):
        """A new icon outside ICON_EXCLUSIONS keeps the strict 1:1 requirement."""
        (self.ext / "new-engine.svg").write_bytes(b"a")
        self.assertEqual(
            self.assets._check_icon_pairs(),
            ["icons/new-engine.svg: MISSING in website/static/icons/"],
        )

    def test_website_copy_of_excluded_icon_still_byte_locked(self):
        """The exemption is one-directional: once a website copy exists, it is locked."""
        (self.ext / "aggregate.svg").write_bytes(b"a")
        (self.site / "aggregate.svg").write_bytes(b"b")
        self.assertEqual(
            self.assets._check_icon_pairs(),
            ["icons/aggregate.svg: website/static/icons/ differs from public/icons/"],
        )


class RealTreeTests(unittest.TestCase):
    """The real tree must satisfy the lock in unit-test CI (pre-merge), not only in
    the post-merge website-pages workflow."""

    def test_real_repo_in_sync(self):
        self.assertEqual(_load_assets().check(), [], "website asset drift detected")


if __name__ == "__main__":
    unittest.main()
