"""__all__ contract for the juso_bridge single-source module (N1).

Asserts that ``public/agent-skill/scripts/juso_bridge.py`` exposes an explicit,
complete ``__all__``:

1. every name listed in ``__all__`` is a real module attribute;
2. every public reference in the repo (a ``juso_bridge.<attr>`` access or a
   ``from juso_bridge import ...``) resolves to a member of ``__all__``;
3. the wrapper (``juso_search.py``) delivers the names it uses directly via
   ``from juso_bridge import *`` (EXTENSION_ID_RE, result_status, run_bridge).

Stdlib modules that the bridge imports and that tests patch on the wrapper
namespace (``juso_bridge.subprocess``, ``juso_bridge.shutil``, ...) are
internal targets, not public API, so they are filtered out here.
"""
from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_SCRIPT = REPO_ROOT / "public" / "agent-skill" / "scripts" / "juso_bridge.py"
WRAPPER_SCRIPT = REPO_ROOT / "public" / "agent-skill" / "scripts" / "juso_search.py"

# Stdlib names juso_bridge.py imports; tests patch these on the wrapper
# namespace and they are deliberately NOT part of the public contract.
STDLIB_INTERNALS = {
    "hmac", "json", "os", "re", "secrets", "shutil", "socket", "subprocess",
    "sys", "threading", "time", "uuid",
    "HTTPStatus", "BaseHTTPRequestHandler", "ThreadingHTTPServer", "Path", "Any",
    # "juso_bridge.py" as a file path string (test_gen_skills drift assertions).
    "py",
}

# Names the wrapper (juso_search.py) uses directly via `from juso_bridge import *`.
WRAPPER_CONTRACT = {"EXTENSION_ID_RE", "result_status", "run_bridge"}

SCAN_DIRS = (
    REPO_ROOT / "tests" / "scripts",
    REPO_ROOT / "public" / "agent-skill",
    REPO_ROOT / "skills" / "juso-search",
    REPO_ROOT / "skills" / "juso-search-dev",
    REPO_ROOT / "mcp-server",
)

ATTR_RE = re.compile(r"juso_bridge\.([A-Za-z_][A-Za-z0-9_]*)")
FROM_IMPORT_RE = re.compile(r"from\s+juso_bridge\s+import\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)")


def _load_module(name: str, script: Path):
    spec = importlib.util.spec_from_file_location(name, script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AllExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge = _load_module("juso_bridge", BRIDGE_SCRIPT)

    def test_all_names_are_real_module_attributes(self):
        self.assertTrue(hasattr(self.bridge, "__all__"), "juso_bridge.py must define __all__")
        for name in self.bridge.__all__:
            self.assertTrue(
                hasattr(self.bridge, name),
                f"__all__ lists {name!r} but the module has no such attribute",
            )

    def test_public_references_resolve_to_all(self):
        """Every juso_bridge.<attr> / `from juso_bridge import ...` consumer is covered."""
        referenced: set[str] = set()
        for base in SCAN_DIRS:
            for path in sorted(base.rglob("*.py")):
                if ".venv" in path.parts or "__pycache__" in path.parts:
                    continue
                if path.resolve() == Path(__file__).resolve():
                    continue  # this file's own probes must not define the contract
                text = path.read_text(encoding="utf-8")
                referenced.update(ATTR_RE.findall(text))
                for froms in FROM_IMPORT_RE.findall(text):
                    referenced.update(name.strip() for name in froms.split(","))
        public = referenced - STDLIB_INTERNALS
        missing = public - set(self.bridge.__all__)
        self.assertEqual(
            missing,
            set(),
            "public juso_bridge references missing from __all__",
        )

    def test_wrapper_star_import_delivers_contract(self):
        """juso_search.py's `from juso_bridge import *` resolves the names it uses."""
        self.assertTrue(WRAPPER_CONTRACT <= set(self.bridge.__all__))
        wrapper = _load_module("juso_search", WRAPPER_SCRIPT)
        for name in sorted(WRAPPER_CONTRACT):
            self.assertTrue(hasattr(wrapper, name), f"wrapper lacks {name!r} after star import")


if __name__ == "__main__":
    unittest.main()
