import http.client
import importlib.util
import json
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

PROVIDERS_REPLY = {"providers": [{"id": "tavily", "supportsAnswer": True, "configured": True}]}

INSTANCES_REPLY = {
    "instances": [
        {"id": "inst:exa:abc123", "providerId": "exa", "label": "AI research", "description": "category=publication", "configured": True},
    ]
}

EXTENSION_ID = "a" * 32
FAKE_CHROME = "/fake/chrome"


def _claim_and_complete(reply):
    """Return a Popen side_effect that claims then completes the bridge request."""
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
        self.assertIn("JUSO_CHROME_PATH", ctx.exception.message)

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
        self.assertFalse(juso_bridge.is_search_reply({"ok": True, "response": {"query": "x", "provider": "nope", "results": []}, "cache": {"hit": False}}))
        claim = juso_bridge.make_claim("search", "hello", "tavily", False, "request-1")
        self.assertTrue(juso_bridge.is_valid_reply(claim, SEARCH_REPLY))
        self.assertFalse(juso_bridge.is_valid_reply(claim, PROVIDERS_REPLY))

    def test_wait_failure_classifies_claim_observation(self):
        unclaimed = juso_bridge.BridgeState("token", "request-1")
        payload = juso_bridge.wait_failure(unclaimed)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_claim")
        self.assertIn("--chrome", payload["error"]["message"])
        self.assertIn("JUSO_CHROME_PATH", payload["error"]["message"])
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
        ):
            self.assertEqual(juso_bridge.find_chrome(None), str(Path(__file__)))


class ConstantsTests(unittest.TestCase):
    def test_constants_present(self):
        self.assertEqual(juso_bridge.PROTOCOL, 2)
        self.assertEqual(
            juso_bridge.PROVIDERS,
            ("tavily", "exa", "brave", "stepfun", "stepfun-plan", "jina", "doubao", "doubao-global"),
        )
        self.assertEqual(
            juso_bridge.ENGINES,
            ("google", "bing", "baidu", "yandex", "duckduckgo", "bilibili", "xiaohongshu", "douyin"),
        )
        self.assertTrue(juso_bridge.EXTENSION_ID_RE.fullmatch("a" * 32))
        self.assertFalse(juso_bridge.EXTENSION_ID_RE.fullmatch("a" * 31))

    def test_error_classifiers_exposed(self):
        self.assertEqual(juso_bridge.ERROR_INVALID_EXTENSION_ID, "invalid_extension_id")
        self.assertEqual(juso_bridge.ERROR_CHROME_NOT_FOUND, "chrome_not_found")
        self.assertEqual(juso_bridge.ERROR_EXTENSION_DID_NOT_CLAIM, "extension_did_not_claim")
        self.assertEqual(juso_bridge.ERROR_EXTENSION_DID_NOT_COMPLETE, "extension_did_not_complete")
        self.assertEqual(juso_bridge.ERROR_CHROME_LAUNCH_FAILED, "chrome_launch_failed")
        self.assertEqual(juso_bridge.ERROR_WAIT_FAILED, "wait_failed")
        self.assertEqual(juso_bridge.ERROR_CANCELLED, "cancelled")


if __name__ == "__main__":
    unittest.main()
