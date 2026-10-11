import http.client
import importlib.util
import json
import socket
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[2] / "public" / "agent-skill" / "scripts" / "juso_bridge.py"
SPEC = importlib.util.spec_from_file_location("juso_bridge", SCRIPT)
assert SPEC and SPEC.loader
juso_bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(juso_bridge)


SEARCH_REPLY = {
    "ok": True,
    "response": {
        "query": "hello",
        "provider": "tavily",
        "results": [{"title": "T", "url": "https://example.com", "snippet": "S"}],
    },
    "cache": {"hit": False},
}

ENGINE_REPLY = {
    "engine": "google",
    "query": "hello",
    "results": [{"title": "T", "url": "https://example.com", "snippet": "S"}],
}

# bilibili/douyin/xiaohongshu 抽取器每张卡都带第四键 snippetKind:'metadata'（扩展侧
# isResult 守卫明确接受），engine-search 回复校验必须放行（曾严格三键导致 400 invalid_reply）。
ENGINE_METADATA_REPLY = {
    "engine": "bilibili",
    "query": "hello",
    "results": [{"title": "T", "url": "https://example.com", "snippet": "S", "snippetKind": "metadata"}],
}

PROVIDERS_REPLY = {"providers": [{"id": "tavily", "supportsAnswer": True, "configured": True}]}

INSTANCES_REPLY = {
    "instances": [
        {"id": "inst:exa:abc123", "providerId": "exa", "label": "AI research", "description": "category=publication", "configured": True},
    ]
}

EXTENSION_ID = "a" * 32
FAKE_CHROME = "/fake/chrome"


def _claim_and_complete(reply, capture=None):
    """Return a Popen side_effect that claims then completes the bridge request.

    ``capture`` (optional dict) receives the served claim for seam-level assertions.
    """
    def handler(command, **_kwargs):
        url = command[-1]
        fragment = url.split("#", 1)[1]
        parts = dict(item.split("=", 1) for item in fragment.split("&"))
        port, token = int(parts["p"]), parts["t"]
        connection = http.client.HTTPConnection("127.0.0.1", port)
        try:
            headers = {
                "Host": f"127.0.0.1:{port}",
                "Authorization": f"Bearer {token}",
            }
            connection.request("POST", "/v1/claim", headers=headers)
            response = connection.getresponse()
            assert response.status == 200
            claim = json.loads(response.read())
            if capture is not None:
                capture.update(claim)
            complete = {
                "protocol": claim["protocol"],
                "requestId": claim["requestId"],
                "reply": reply,
            }
            headers["Content-Type"] = "application/json"
            connection.request("POST", "/v1/complete", json.dumps(complete), headers)
            response = connection.getresponse()
            assert response.status == 204
            response.read()
        finally:
            connection.close()
        return None
    return handler


def _claim_only(command, **_kwargs):
    """Popen side_effect that claims the request but never completes it."""
    url = command[-1]
    fragment = url.split("#", 1)[1]
    parts = dict(item.split("=", 1) for item in fragment.split("&"))
    port, token = int(parts["p"]), parts["t"]
    connection = http.client.HTTPConnection("127.0.0.1", port)
    try:
        connection.request(
            "POST",
            "/v1/claim",
            headers={
                "Host": f"127.0.0.1:{port}",
                "Authorization": f"Bearer {token}",
            },
        )
        response = connection.getresponse()
        assert response.status == 200
        response.read()
    finally:
        connection.close()
    return None


class RunBridgeTests(unittest.TestCase):
    """Programmatic run_bridge() calls: full cycle returns the reply dict."""

    def test_run_bridge_search(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SEARCH_REPLY)),
        ):
            reply = juso_bridge.run_bridge(
                "search", "hello", provider_id="tavily",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, SEARCH_REPLY)
        self.assertEqual(juso_bridge.result_status(reply), 0)

    def test_run_bridge_forwards_timeout_ms_into_claim(self):
        """Seam regression lock: run_bridge must serialize timeout_ms into the served claim.

        Dropping the make_claim(..., timeout_ms=...) forwarding inside run_bridge would
        otherwise pass every suite green while the budget silently stops being carried
        (the original "fake custom timeout" bug class).
        """
        explicit, default = {}, {}
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SEARCH_REPLY, capture=explicit)),
        ):
            reply = juso_bridge.run_bridge(
                "search", "hello", provider_id="tavily",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0, timeout_ms=120000,
            )
        self.assertEqual(reply, SEARCH_REPLY)
        self.assertEqual(explicit["request"]["timeoutMs"], 120000)
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SEARCH_REPLY, capture=default)),
        ):
            juso_bridge.run_bridge(
                "search", "hello", provider_id="tavily",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertNotIn("timeoutMs", default["request"])

    def test_run_bridge_engine_search(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(ENGINE_REPLY)),
        ):
            reply = juso_bridge.run_bridge(
                "engine-search", "hello", engine_id="google", max_results=5,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, ENGINE_REPLY)
        self.assertEqual(juso_bridge.result_status(reply), 0)

    def test_run_bridge_engine_search_metadata_results_accepted(self):
        """4 键 snippetKind:'metadata' 结果的 engine-search 全周期成功（回归锁：曾 400 invalid_reply）。"""
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(ENGINE_METADATA_REPLY)),
        ):
            reply = juso_bridge.run_bridge(
                "engine-search", "hello", engine_id="bilibili",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, ENGINE_METADATA_REPLY)
        self.assertEqual(juso_bridge.result_status(reply), 0)

    def test_run_bridge_engine_search_error_reply_is_returned_not_raised(self):
        """An engine-search error reply is a valid completion; run_bridge returns it."""
        error_reply = {"engine": "google", "query": "hello", "error": "challenge"}
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(error_reply)),
        ):
            reply = juso_bridge.run_bridge(
                "engine-search", "hello", engine_id="google",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, error_reply)
        self.assertEqual(juso_bridge.result_status(reply), 1)

    def test_run_bridge_list_providers(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(PROVIDERS_REPLY)),
        ):
            reply = juso_bridge.run_bridge(
                "list-providers", None,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, PROVIDERS_REPLY)

    def test_run_bridge_list_instances(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(INSTANCES_REPLY)),
        ):
            reply = juso_bridge.run_bridge(
                "list-instances", None,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, INSTANCES_REPLY)

    def test_run_bridge_list_engines(self):
        engines_reply = {"engines": [{"id": "google"}, {"id": "bing"}]}
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(engines_reply)),
        ):
            reply = juso_bridge.run_bridge(
                "list-engines", None,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, engines_reply)

    def test_run_bridge_search_instance(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SEARCH_REPLY)),
        ):
            reply = juso_bridge.run_bridge(
                "search-instance", "hello", instance_id="inst:exa:abc123",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, SEARCH_REPLY)

    def test_invalid_extension_id_raises(self):
        with self.assertRaises(juso_bridge.BridgeError) as ctx:
            juso_bridge.run_bridge("list-providers", None, extension_id="not-a-valid-id")
        self.assertEqual(ctx.exception.kind, "invalid_extension_id")
        self.assertEqual(ctx.exception.exit_status, 2)
        self.assertIn("--extension-id", ctx.exception.message)

    def test_chrome_not_found_raises(self):
        with patch.object(juso_bridge, "find_chrome", return_value=None):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge("list-providers", None, extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME)
        self.assertEqual(ctx.exception.kind, "chrome_not_found")
        self.assertEqual(ctx.exception.exit_status, 2)
        self.assertIn("JUSO_BROWSER_PATH", ctx.exception.message)

    def test_claim_timeout_raises_did_not_claim(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", return_value=None),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=0.15,
                )
        self.assertEqual(ctx.exception.kind, "extension_did_not_claim")
        self.assertEqual(ctx.exception.exit_status, 1)
        self.assertIn("--profile", ctx.exception.message)

    def test_claim_without_complete_raises_did_not_complete(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_only),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=0.4,
                )
        self.assertEqual(ctx.exception.kind, "extension_did_not_complete")
        self.assertEqual(ctx.exception.exit_status, 1)
        self.assertIn("reload the extension", ctx.exception.message)

    def test_chrome_launch_failed_raises(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=OSError("permission denied")),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=0.4,
                )
        self.assertEqual(ctx.exception.kind, "chrome_launch_failed")
        self.assertEqual(ctx.exception.exit_status, 1)
        self.assertIn("permission denied", ctx.exception.message)

    def test_run_bridge_signature_accepts_cancel_event(self):
        """cancel_event is a keyword-only param of run_bridge, defaulting to None."""
        import inspect

        parameters = inspect.signature(juso_bridge.run_bridge).parameters
        self.assertIn("cancel_event", parameters)
        self.assertIsNone(parameters["cancel_event"].default)

    def test_cancel_event_already_set_raises_cancelled(self):
        """A pre-set cancel_event aborts the bridge with kind=cancelled."""
        cancel_event = threading.Event()
        cancel_event.set()
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", return_value=None),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=0.4,
                    cancel_event=cancel_event,
                )
        self.assertEqual(ctx.exception.kind, "cancelled")
        self.assertEqual(ctx.exception.exit_status, 1)
        self.assertIn("cancelled", ctx.exception.message)

    def test_cancel_mid_wait_raises_cancelled_and_cleans_up(self):
        """Cooperative cancel mid-wait raises cancelled and terminates the browser."""
        cancel_event = threading.Event()
        mock_procs = []

        def claim_only_keep_proc(command, **_kwargs):
            mock_proc = Mock()
            mock_proc.poll.return_value = None  # browser process still running
            url = command[-1]
            fragment = url.split("#", 1)[1]
            parts = dict(item.split("=", 1) for item in fragment.split("&"))
            port, token = int(parts["p"]), parts["t"]
            connection = http.client.HTTPConnection("127.0.0.1", port)
            try:
                connection.request(
                    "POST",
                    "/v1/claim",
                    headers={
                        "Host": f"127.0.0.1:{port}",
                        "Authorization": f"Bearer {token}",
                    },
                )
                response = connection.getresponse()
                assert response.status == 200
                response.read()
            finally:
                connection.close()
            mock_procs.append(mock_proc)
            return mock_proc

        threading.Timer(0.3, cancel_event.set).start()
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=claim_only_keep_proc),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=5.0,
                    cancel_event=cancel_event,
                )
        self.assertEqual(ctx.exception.kind, "cancelled")
        self.assertEqual(ctx.exception.exit_status, 1)
        self.assertEqual(len(mock_procs), 1)
        mock_procs[0].terminate.assert_called_once()


class ReplyValidatorTests(unittest.TestCase):
    """Reply validation parity with tests/scripts/test_juso_search.py."""

    def test_reply_validation_status_and_path_lookup(self):
        error_reply = {"ok": False, "error": {"kind": "unknown", "message": "safe"}}
        claim = juso_bridge.make_claim("search", "hello", "tavily", False, "request-1")
        self.assertTrue(juso_bridge.is_valid_reply(claim, error_reply))
        self.assertEqual(juso_bridge.result_status(error_reply), 1)
        self.assertEqual(juso_bridge.result_status({"providers": []}), 0)
        engine_claim = juso_bridge.make_claim("engine-search", "hello", None, False, "request-1", "google")
        self.assertTrue(juso_bridge.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "challenge"}))
        self.assertFalse(juso_bridge.is_valid_reply(engine_claim, {"engine": "bing", "query": "hello", "error": "challenge"}))
        self.assertFalse(juso_bridge.is_valid_reply(engine_claim, {"engine": "google", "query": "other", "error": "challenge"}))
        providers_claim = juso_bridge.make_claim("list-providers", None, None, False, "request-1")
        self.assertTrue(juso_bridge.is_valid_reply(providers_claim, {"providers": [{"id": "exa", "supportsAnswer": True, "configured": True, "hasInstances": True}]}))
        self.assertFalse(juso_bridge.is_valid_reply(providers_claim, {"providers": [{"id": "exa", "supportsAnswer": True, "configured": True, "extra": True}]}))
        instances_claim = juso_bridge.make_claim("list-instances", None, None, False, "request-1")
        instance_reply = {"instances": [{"id": "inst:exa:abc123", "providerId": "exa", "label": "AI research", "description": "category=publication", "configured": True}]}
        self.assertTrue(juso_bridge.is_valid_reply(instances_claim, instance_reply))
        search_instance_claim = juso_bridge.make_claim("search-instance", "hello", None, False, "request-1", instance_id="inst:exa:abc123")
        self.assertTrue(juso_bridge.is_valid_reply(search_instance_claim, error_reply))
        self.assertEqual(juso_bridge.result_status({"engine": "google", "query": "hello", "error": "challenge"}), 1)
        self.assertEqual(juso_bridge.result_status({"engine": "google", "query": "hello", "error": "no-results"}), 1)
        self.assertTrue(juso_bridge.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "tab-closed"}))
        self.assertEqual(juso_bridge.result_status({"engine": "google", "query": "hello", "error": "tab-closed"}), 1)
        self.assertTrue(juso_bridge.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "timeout"}))
        self.assertTrue(juso_bridge.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "aborted"}))
        self.assertTrue(juso_bridge.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "extract-failed"}))

    def test_search_success_reply_shapes(self):
        self.assertTrue(juso_bridge.is_search_reply(SEARCH_REPLY))
        # provider ids are open-ended (discovered at runtime), so any non-empty
        # string passes validation
        self.assertTrue(juso_bridge.is_search_reply({"ok": True, "response": {"query": "x", "provider": "nope", "results": []}, "cache": {"hit": False}}))
        self.assertFalse(juso_bridge.is_search_reply({"ok": True, "response": {"query": "x", "provider": "", "results": []}, "cache": {"hit": False}}))
        claim = juso_bridge.make_claim("search", "hello", "tavily", False, "request-1")
        self.assertTrue(juso_bridge.is_valid_reply(claim, SEARCH_REPLY))
        self.assertFalse(juso_bridge.is_valid_reply(claim, PROVIDERS_REPLY))

    def test_is_engine_list_reply_accepts_valid_reply(self):
        self.assertTrue(juso_bridge.is_engine_list_reply({"engines": [{"id": "google"}, {"id": "bing"}]}))
        self.assertTrue(juso_bridge.is_engine_list_reply({"engines": []}))

    def test_is_engine_search_reply_accepts_metadata_snippet_results(self):
        """与扩展侧 isResult 守卫对齐：3 键，或 4 键且第四键为 snippetKind:'metadata'。"""
        self.assertTrue(juso_bridge.is_engine_search_reply(ENGINE_REPLY))
        self.assertTrue(juso_bridge.is_engine_search_reply(ENGINE_METADATA_REPLY))
        claim = juso_bridge.make_claim("engine-search", "hello", None, False, "request-1", "bilibili")
        self.assertTrue(juso_bridge.is_valid_reply(claim, ENGINE_METADATA_REPLY))

    def test_is_engine_search_reply_rejects_invalid_result_shapes(self):
        base = {"title": "T", "url": "https://example.com", "snippet": "S"}
        bad_results = [
            {**base, "snippetKind": "semantic"},  # snippetKind 只接受 'metadata'
            {**base, "snippetKind": None},
            {**base, "extra": 1},  # 其他第四键
            {**base, "title": 42},  # title 非字符串
            {"title": "T", "url": "https://example.com"},  # 缺 snippet
            {**base, "snippetKind": "metadata", "extra": 1},  # 五键
        ]
        for result in bad_results:
            with self.subTest(result=result):
                self.assertFalse(
                    juso_bridge.is_engine_search_reply({"engine": "google", "query": "hello", "results": [result]}),
                )
        # 空结果列表仍合法
        self.assertTrue(juso_bridge.is_engine_search_reply({"engine": "google", "query": "hello", "results": []}))

    def test_is_engine_list_reply_rejects_invalid_reply(self):
        self.assertFalse(juso_bridge.is_engine_list_reply({}))  # missing engines key
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": None}))  # missing engines key
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": "google"}))  # non-list engines
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": {"id": "google"}}))  # non-list engines
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": [{"id": "google", "extra": True}]}))  # extra fields
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": [{"id": 42}]}))  # non-string id
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": [{"id": ""}]}))  # empty id
        self.assertFalse(juso_bridge.is_engine_list_reply({"engines": [{"id": "google"}], "extra": True}))  # extra top-level field

    def test_list_engines_valid_reply_dispatch(self):
        claim = juso_bridge.make_claim("list-engines", None, None, False, "request-1")
        self.assertTrue(juso_bridge.is_valid_reply(claim, {"engines": [{"id": "google"}, {"id": "bing"}]}))
        self.assertFalse(juso_bridge.is_valid_reply(claim, {"engines": [{"id": ""}]}))

    def test_make_claim_list_engines(self):
        claim = juso_bridge.make_claim("list-engines", None, None, False, "request-1")
        self.assertEqual(
            claim,
            {"protocol": juso_bridge.PROTOCOL, "requestId": "request-1", "request": {"action": "list-engines"}},
        )

    def test_wait_failure_classifies_claim_observation(self):
        unclaimed = juso_bridge.BridgeState("token", "request-1")
        payload = juso_bridge.wait_failure(unclaimed)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_claim")
        self.assertIn("--browser", payload["error"]["message"])
        self.assertIn("JUSO_BROWSER_PATH", payload["error"]["message"])
        self.assertIn("--profile", payload["error"]["message"])
        self.assertIn("--extension-id", payload["error"]["message"])

        claimed = juso_bridge.BridgeState("token", "request-1")
        claimed.claimed.set()
        payload = juso_bridge.wait_failure(claimed)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_complete")
        self.assertIn("reload the extension", payload["error"]["message"])

    def test_find_chrome_uses_discovery(self):
        with patch.object(juso_bridge.shutil, "which", side_effect=lambda name: "/bin/chromium" if name == "chromium" else None):
            self.assertEqual(juso_bridge.find_chrome(None), "/bin/chromium")
        with (
            patch.object(juso_bridge.shutil, "which", return_value=None),
            patch.object(juso_bridge, "chrome_candidates", return_value=[Path(__file__)]),
            patch.object(juso_bridge, "firefox_candidates", return_value=[]),
        ):
            self.assertEqual(juso_bridge.find_chrome(None), str(Path(__file__)))


class ChromeCandidatesTests(unittest.TestCase):
    """chrome_candidates() sys.platform branches (parametrized via subTest).

    Every existing test mocks chrome_candidates() away, so the real darwin/
    linux path logic was never asserted. These tests patch sys.platform only
    (and os.environ for win32) and verify the hardcoded candidate paths;
    chrome_candidates() only reads paths, never launches anything.
    """

    def test_chrome_candidates_platform_branches(self):
        cases = [
            (
                "darwin",
                {},
                [
                    Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                    Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
                ],
            ),
            (
                "linux",
                {},
                [
                    Path("/usr/bin/google-chrome"),
                    Path("/usr/bin/google-chrome-stable"),
                    Path("/usr/bin/chromium"),
                    Path("/usr/bin/chromium-browser"),
                ],
            ),
            (
                "win32",
                {
                    "PROGRAMFILES": "C:\\Program Files",
                    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
                    "LOCALAPPDATA": "C:\\Users\\tester\\AppData\\Local",
                },
                [
                    Path("C:\\Program Files") / "Google/Chrome/Application/chrome.exe",
                    Path("C:\\Program Files (x86)") / "Google/Chrome/Application/chrome.exe",
                    Path("C:\\Users\\tester\\AppData\\Local") / "Google/Chrome/Application/chrome.exe",
                ],
            ),
        ]
        for platform, env, expected in cases:
            with self.subTest(platform=platform):
                with (
                    patch("sys.platform", platform),
                    patch.dict(juso_bridge.os.environ, env, clear=False),
                ):
                    candidates = juso_bridge.chrome_candidates()
                self.assertIsInstance(candidates, list)
                for path in expected:
                    self.assertIn(path, candidates)

    def test_chrome_candidates_else_branch_used_for_unknown_platform(self):
        """Any non-win32/non-darwin platform falls into the linux else branch."""
        with patch("sys.platform", "freebsd"):
            candidates = juso_bridge.chrome_candidates()
        self.assertIn(Path("/usr/bin/google-chrome"), candidates)


class FirefoxCandidatesTests(unittest.TestCase):
    """firefox_candidates() sys.platform branches."""

    def test_firefox_candidates_platform_branches(self):
        cases = [
            ("darwin", {}, [Path("/Applications/Firefox.app/Contents/MacOS/firefox")]),
            ("linux", {}, [Path("/usr/bin/firefox"), Path("/usr/bin/firefox-esr"), Path("/snap/bin/firefox")]),
        ]
        for platform, env, expected in cases:
            with self.subTest(platform=platform):
                with (patch("sys.platform", platform), patch.dict(juso_bridge.os.environ, env, clear=False)):
                    candidates = juso_bridge.firefox_candidates()
                for path in expected:
                    self.assertIn(path, candidates)

    def test_detect_browser_type(self):
        self.assertEqual(juso_bridge.detect_browser_type("/usr/bin/firefox"), "firefox")
        self.assertEqual(juso_bridge.detect_browser_type("/usr/bin/google-chrome"), "chrome")
        self.assertEqual(juso_bridge.detect_browser_type("C:\\Program Files\\Mozilla Firefox\\firefox.exe"), "firefox")
        self.assertEqual(juso_bridge.detect_browser_type("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), "chrome")


class ConstantsTests(unittest.TestCase):
    def test_constants_present(self):
        self.assertEqual(juso_bridge.PROTOCOL, 2)
        self.assertTrue(juso_bridge.EXTENSION_ID_RE.fullmatch("a" * 32))
        self.assertFalse(juso_bridge.EXTENSION_ID_RE.fullmatch("a" * 31))
        # Firefox email-style and {GUID} IDs also accepted
        self.assertTrue(juso_bridge.EXTENSION_ID_RE.fullmatch("juso-search@extension"))
        self.assertTrue(juso_bridge.EXTENSION_ID_RE.fullmatch("{daf44bf7-a45e-4450-979c-91cf07434c3d}"))
        self.assertFalse(juso_bridge.EXTENSION_ID_RE.fullmatch("not-valid"))

    def test_error_classifiers_exposed(self):
        self.assertEqual(juso_bridge.ERROR_INVALID_EXTENSION_ID, "invalid_extension_id")
        self.assertEqual(juso_bridge.ERROR_CHROME_NOT_FOUND, "chrome_not_found")
        self.assertEqual(juso_bridge.ERROR_EXTENSION_DID_NOT_CLAIM, "extension_did_not_claim")
        self.assertEqual(juso_bridge.ERROR_EXTENSION_DID_NOT_COMPLETE, "extension_did_not_complete")
        self.assertEqual(juso_bridge.ERROR_CHROME_LAUNCH_FAILED, "chrome_launch_failed")
        self.assertEqual(juso_bridge.ERROR_WAIT_FAILED, "wait_failed")
        self.assertEqual(juso_bridge.ERROR_CANCELLED, "cancelled")


SITES_REPLY = {
    "sites": [
        {"id": "site:abc123", "label": "Example 站内", "engineId": "bing", "target": "example.com", "description": ""},
    ]
}

AGGREGATES_REPLY = {
    "aggregates": [
        {"id": "agg:abc123", "label": "研究聚合", "eligible": True, "topN": 20, "members": ["tavily", "google"]},
    ]
}

SITE_SEARCH_REPLY = {
    "ok": True,
    "response": {
        "query": "hello",
        "engine": "bing",
        "results": [{"title": "T", "url": "https://example.com", "snippet": "S", "snippetKind": "metadata"}],
    },
    "cache": {"hit": False},
}

AGGREGATE_SEARCH_REPLY = {
    "ok": True,
    "response": {
        "instanceId": "agg:abc123",
        "query": "hello",
        "kind": "aggregate",
        "answers": [],
        "results": [{"title": "T", "url": "https://example.com", "snippet": "S", "sources": ["tavily"]}],
        "members": [{"sourceId": "tavily", "ok": True, "resultCount": 1}],
        "dedupedCount": 0,
        "rerank": {"rerankedAt": 1_700_000_000_000},
    },
    "cache": {"hit": False},
}


class SiteAggregateTests(unittest.TestCase):
    """v2 additive validators and claims for the site-instance and aggregate-instance actions."""

    def test_is_site_list_reply_accepts_valid_and_rejects_invalid(self):
        self.assertTrue(juso_bridge.is_site_list_reply(SITES_REPLY))
        self.assertTrue(juso_bridge.is_valid_reply({"request": {"action": "list-sites"}}, SITES_REPLY))
        bad_shapes = [
            {"sites": "no"},
            {"sites": [{"id": "inst:exa:abc", "label": "L", "engineId": "bing", "target": "t", "description": ""}]},
            {"sites": [{"id": "site:abc", "label": "L", "engineId": "", "target": "t", "description": ""}]},
            {"sites": [{"id": "site:abc", "label": "L", "engineId": "bing", "target": "t", "extra": 1}]},
            {"engines": []},
        ]
        for reply in bad_shapes:
            self.assertFalse(juso_bridge.is_site_list_reply(reply), reply)

    def test_is_site_search_reply_accepts_envelope_and_rejects_invalid(self):
        self.assertTrue(juso_bridge.is_site_search_reply(SITE_SEARCH_REPLY))
        self.assertTrue(juso_bridge.is_valid_reply({"request": {"action": "search-site", "query": "hello"}}, SITE_SEARCH_REPLY))
        error_reply = {"ok": False, "error": {"kind": "unknown", "message": "site instance not found"}}
        self.assertTrue(juso_bridge.is_site_search_reply(error_reply))
        self.assertTrue(juso_bridge.is_valid_reply({"request": {"action": "search-site", "query": "hello"}}, error_reply))
        bad_shapes = [
            {**SITE_SEARCH_REPLY, "response": {**SITE_SEARCH_REPLY["response"], "engine": ""}},
            {**SITE_SEARCH_REPLY, "cache": "no"},
            {"ok": False, "error": {"kind": "notAKind", "message": "m"}},
            {"ok": True, "response": SITE_SEARCH_REPLY["response"]},
        ]
        for reply in bad_shapes:
            self.assertFalse(juso_bridge.is_site_search_reply(reply), reply)

    def test_is_aggregate_list_reply_accepts_valid_and_rejects_invalid(self):
        self.assertTrue(juso_bridge.is_aggregate_list_reply(AGGREGATES_REPLY))
        self.assertTrue(juso_bridge.is_valid_reply({"request": {"action": "list-aggregates"}}, AGGREGATES_REPLY))
        bad_shapes = [
            {"aggregates": [{"id": "site:abc", "label": "L", "eligible": True, "topN": 20, "members": []}]},
            {"aggregates": [{"id": "agg:abc", "label": "L", "eligible": "yes", "topN": 20, "members": []}]},
            {"aggregates": [{"id": "agg:abc", "label": "L", "eligible": True, "topN": 20, "members": [1]}]},
            {"aggregates": [{"id": "agg:abc", "label": "L", "eligible": True}]},
        ]
        for reply in bad_shapes:
            self.assertFalse(juso_bridge.is_aggregate_list_reply(reply), reply)

    def test_is_aggregate_search_reply_accepts_envelope_and_rejects_invalid(self):
        self.assertTrue(juso_bridge.is_aggregate_search_reply(AGGREGATE_SEARCH_REPLY))
        self.assertTrue(juso_bridge.is_valid_reply({"request": {"action": "search-aggregate", "query": "hello"}}, AGGREGATE_SEARCH_REPLY))
        error_reply = {"ok": False, "error": {"kind": "keyMissing", "message": "rerank not configured"}}
        self.assertTrue(juso_bridge.is_aggregate_search_reply(error_reply))
        bad_shapes = [
            {**AGGREGATE_SEARCH_REPLY, "response": {**AGGREGATE_SEARCH_REPLY["response"], "kind": "provider"}},
            {**AGGREGATE_SEARCH_REPLY, "response": {**AGGREGATE_SEARCH_REPLY["response"], "instanceId": "inst:exa:abc"}},
            {**AGGREGATE_SEARCH_REPLY, "response": {k: v for k, v in AGGREGATE_SEARCH_REPLY["response"].items() if k != "members"}},
        ]
        for reply in bad_shapes:
            self.assertFalse(juso_bridge.is_aggregate_search_reply(reply), reply)

    def test_make_claim_site_and_aggregate_actions(self):
        self.assertEqual(
            juso_bridge.make_claim("search-site", "hello", None, False, "id", max_results=5, site_id="site:abc")["request"],
            {"action": "search-site", "query": "hello", "siteId": "site:abc", "maxResults": 5},
        )
        self.assertEqual(
            juso_bridge.make_claim("search-aggregate", "hello", None, True, "id", aggregate_id="agg:abc")["request"],
            {"action": "search-aggregate", "query": "hello", "aggregateId": "agg:abc", "forceRefresh": True},
        )
        self.assertEqual(juso_bridge.make_claim("list-sites", None, None, False, "id")["request"], {"action": "list-sites"})
        self.assertEqual(juso_bridge.make_claim("list-aggregates", None, None, False, "id")["request"], {"action": "list-aggregates"})

    def test_run_bridge_site_and_aggregate_full_cycles(self):
        capture: dict = {}
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SITE_SEARCH_REPLY, capture)),
        ):
            reply = juso_bridge.run_bridge(
                "search-site", "hello", site_id="site:abc123",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, SITE_SEARCH_REPLY)
        self.assertEqual(capture["request"], {"action": "search-site", "query": "hello", "siteId": "site:abc123"})

        capture.clear()
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(AGGREGATE_SEARCH_REPLY, capture)),
        ):
            reply = juso_bridge.run_bridge(
                "search-aggregate", "hello", aggregate_id="agg:abc123", force_refresh=True,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, AGGREGATE_SEARCH_REPLY)
        self.assertEqual(capture["request"], {"action": "search-aggregate", "query": "hello", "aggregateId": "agg:abc123", "forceRefresh": True})

        capture.clear()
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SITES_REPLY, capture)),
        ):
            reply = juso_bridge.run_bridge(
                "list-sites", None,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, SITES_REPLY)
        self.assertEqual(capture["request"], {"action": "list-sites"})

        capture.clear()
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(AGGREGATES_REPLY, capture)),
        ):
            reply = juso_bridge.run_bridge(
                "list-aggregates", None,
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, AGGREGATES_REPLY)
        self.assertEqual(capture["request"], {"action": "list-aggregates"})


class BridgeUrlValidationTests(unittest.TestCase):
    """run_bridge 对 bridge_url 的信任边界：与 bearer token 拼进 fragment 前，格式必须过闸。

    扩展侧只接受 chrome-extension://<id>/bridge.html 或 moz-extension://<uuid>/bridge.html
    （lib/agent-bridge.ts isTrustedBridgeSender）；被控/写错的 URL 会把 token 带去任意页面，
    query/fragment 还会遮蔽 claim 参数。
    """

    def test_is_valid_bridge_url_accepts_trusted_shapes(self):
        self.assertTrue(juso_bridge.is_valid_bridge_url(f"chrome-extension://{EXTENSION_ID}/bridge.html"))
        self.assertTrue(juso_bridge.is_valid_bridge_url("moz-extension://daf44bf7-a45e-4450-979c-91cf07434c3d/bridge.html"))

    def test_is_valid_bridge_url_rejects_untrusted_shapes(self):
        bad_urls = [
            "https://evil.example/bridge.html",  # 非 extension scheme：token 会泄漏给普通页面
            "file:///C:/bridge.html",
            "chrome-extension://id/other.html",  # path 不符
            "chrome-extension://id",  # 缺 path
            "chrome-extension://id/bridge.html/extra",  # path 前缀匹配但非精确
            "moz-extension:///bridge.html",  # 缺 host
            "chrome-extension://id/bridge.html?x=1",  # query
            "chrome-extension://id/bridge.html#v=1",  # fragment（会遮蔽 claim 参数）
            "chrome-extension://id/bridge.html;x=1",  # params
            "chrome-extension://user@id/bridge.html",  # userinfo
            "chrome-extension://id:8123/bridge.html",  # port
            "not-a-url",
        ]
        for url in bad_urls:
            with self.subTest(url=url):
                self.assertFalse(juso_bridge.is_valid_bridge_url(url), url)

    def test_invalid_bridge_url_fails_fast_before_browser_lookup(self):
        for url in ("https://evil.example/bridge.html", "chrome-extension://id/bridge.html?x=1"):
            with self.subTest(url=url):
                with self.assertRaises(juso_bridge.BridgeError) as ctx:
                    juso_bridge.run_bridge("list-providers", None, bridge_url=url)
                self.assertEqual(ctx.exception.kind, "invalid_extension_id")
                self.assertEqual(ctx.exception.exit_status, 2)
                self.assertIn("--bridge-url", ctx.exception.message)

    def test_valid_bridge_url_skips_extension_id_and_opens(self):
        """合法 bridge_url 在未提供 extension_id 时照样可用（Firefox per-install UUID 路径）。"""
        commands = []

        def popen_capture(command, **_kwargs):
            commands.append(command)
            return _claim_and_complete(SEARCH_REPLY)(command, **_kwargs)

        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=popen_capture),
        ):
            reply = juso_bridge.run_bridge(
                "search", "hello", provider_id="tavily",
                bridge_url="moz-extension://daf44bf7-a45e-4450-979c-91cf07434c3d/bridge.html",
                chrome_path=FAKE_CHROME, timeout=2.0,
            )
        self.assertEqual(reply, SEARCH_REPLY)
        self.assertTrue(commands[0][-1].startswith("moz-extension://daf44bf7-a45e-4450-979c-91cf07434c3d/bridge.html#"))


class TimeoutInvariantTests(unittest.TestCase):
    """run_bridge 强制 timeout*1000 >= clamp(timeout_ms) + 1000：本地等待不得早于扩展侧预算到期。

    CLI/MCP 把过小的显式 timeout 钳成 7s 下限的 claim 预算；不变式若只在 docstring 里，
    扩展会先行中止、调用方误报 extension_did_not_complete。
    """

    def _run_capture_wait(self, **kwargs):
        waits = []

        def fake_wait(state, timeout, cancel_event):
            waits.append(timeout)
            return False

        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", return_value=None),
            patch.object(juso_bridge, "_wait_for_completion", new=fake_wait),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge("list-providers", None, extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, **kwargs)
        self.assertEqual(ctx.exception.kind, "extension_did_not_claim")
        return waits

    def test_small_timeout_raised_to_outlive_clamped_budget(self):
        # clamp(5000) = 7000 → 本地等待 = 7 + 1
        self.assertEqual(self._run_capture_wait(timeout=1.0, timeout_ms=5000), [8.0])

    def test_large_timeout_untouched(self):
        self.assertEqual(self._run_capture_wait(timeout=200.0, timeout_ms=120000), [200.0])

    def test_no_timeout_ms_keeps_wait_untouched(self):
        self.assertEqual(self._run_capture_wait(timeout=0.5), [0.5])

    def test_claim_still_carries_clamped_budget(self):
        capture: dict = {}
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=_claim_and_complete(SEARCH_REPLY, capture=capture)),
        ):
            juso_bridge.run_bridge(
                "search", "hello", provider_id="tavily",
                extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=1.0, timeout_ms=5000,
            )
        self.assertEqual(capture["request"]["timeoutMs"], 7000)


class LaunchFailureClassificationTests(unittest.TestCase):
    """OSError 分类收窄：只有浏览器启动归 chrome_launch_failed；bind 失败独立归类并保留原始栈。"""

    def test_loopback_bind_failure_is_not_chrome_launch_failed(self):
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge, "BridgeHTTPServer", side_effect=OSError("bind refused")),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=2.0,
                )
        self.assertEqual(ctx.exception.kind, "wait_failed")
        self.assertIn("bind refused", ctx.exception.message)
        self.assertNotIn("JUSO_BROWSER_PATH", ctx.exception.message)
        self.assertIsInstance(ctx.exception.__cause__, OSError)

    def test_chrome_launch_failure_keeps_kind_and_cause(self):
        launch_error = OSError("permission denied")
        with (
            patch.object(juso_bridge, "find_chrome", return_value=FAKE_CHROME),
            patch.object(juso_bridge.subprocess, "Popen", side_effect=launch_error),
        ):
            with self.assertRaises(juso_bridge.BridgeError) as ctx:
                juso_bridge.run_bridge(
                    "list-providers", None,
                    extension_id=EXTENSION_ID, chrome_path=FAKE_CHROME, timeout=0.4,
                )
        self.assertEqual(ctx.exception.kind, "chrome_launch_failed")
        self.assertEqual(ctx.exception.exit_status, 1)
        self.assertIn("permission denied", ctx.exception.message)
        self.assertIs(ctx.exception.__cause__, launch_error)


class HandlerRejectTests(unittest.TestCase):
    """读 body 之前的拒绝路径必须关闭连接：HTTP/1.1 keep-alive 下残留 body 字节
    会被解析为下一请求（通告 Connection: close，客户端自动重连）。"""

    def setUp(self):
        self.state = juso_bridge.BridgeState("a" * 43, "request-1")
        self.state.claim = juso_bridge.make_claim("search", "hello", "tavily", False, "request-1")
        self.server = juso_bridge.BridgeHTTPServer(("127.0.0.1", 0), juso_bridge.make_handler(self.state))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def _send_and_read_all(self, raw_request: bytes) -> bytes:
        connection = socket.create_connection(("127.0.0.1", self.server.server_port))
        try:
            connection.settimeout(5)
            connection.sendall(raw_request)
            response = b""
            while True:
                chunk = connection.recv(4096)
                if not chunk:
                    break  # 服务器关闭连接
                response += chunk
            return response
        finally:
            connection.close()

    def _raw_post(self, path: str, content_length: str, body: str, token: str = "a" * 43, content_type: str = "application/json") -> bytes:
        return (
            f"POST {path} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.server.server_port}\r\n"
            f"Authorization: Bearer {token}\r\n"
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {content_length}\r\n\r\n"
            f"{body}"
        ).encode()

    def test_invalid_body_size_responds_then_closes(self):
        response = self._send_and_read_all(self._raw_post("/v1/complete", "abc", "{}"))
        self.assertIn(b"413", response)
        self.assertIn(b"invalid_body_size", response)
        self.assertIn(b"Connection: close", response)

    def test_oversized_body_size_responds_then_closes(self):
        response = self._send_and_read_all(self._raw_post("/v1/complete", str(juso_bridge.MAX_BODY_BYTES + 1), "{}"))
        self.assertIn(b"413", response)
        self.assertIn(b"invalid_body_size", response)
        self.assertIn(b"Connection: close", response)

    def test_unauthorized_with_body_responds_then_closes(self):
        response = self._send_and_read_all(self._raw_post("/v1/claim", "2", "{}", token="wrong"))
        self.assertIn(b"401", response)
        self.assertIn(b"Connection: close", response)

    def test_invalid_content_type_with_body_responds_then_closes(self):
        response = self._send_and_read_all(self._raw_post("/v1/complete", "2", "{}", content_type="text/plain"))
        self.assertIn(b"415", response)
        self.assertIn(b"invalid_content_type", response)
        self.assertIn(b"Connection: close", response)

    def test_unknown_path_with_body_responds_then_closes(self):
        response = self._send_and_read_all(self._raw_post("/nope", "2", "{}"))
        self.assertIn(b"404", response)
        self.assertIn(b"Connection: close", response)

    def test_success_paths_stay_keep_alive(self):
        """claim/complete 成功路径不携带 Connection: close（连接保持复用）。"""
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        try:
            headers = {
                "Host": f"127.0.0.1:{self.server.server_port}",
                "Authorization": "Bearer " + "a" * 43,
            }
            connection.request("POST", "/v1/claim", headers=headers)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIsNone(response.getheader("Connection"))
            response.read()
            claim = self.state.claim
            complete = {"protocol": claim["protocol"], "requestId": claim["requestId"], "reply": SEARCH_REPLY}
            headers["Content-Type"] = "application/json"
            connection.request("POST", "/v1/complete", json.dumps(complete), headers)
            response = connection.getresponse()
            self.assertEqual(response.status, 204)
            self.assertIsNone(response.getheader("Connection"))
            response.read()
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
