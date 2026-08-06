import argparse
import http.client
import importlib.util
import json
import os
import socket
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock


SCRIPT = Path(__file__).parents[2] / "skills" / "juso-search" / "scripts" / "juso_search.py"
SPEC = importlib.util.spec_from_file_location("juso_search", SCRIPT)
assert SPEC and SPEC.loader
juso_search = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(juso_search)


class BridgeServerTests(unittest.TestCase):
    def setUp(self):
        self.state = juso_search.BridgeState("a" * 43, "request-1")
        self.state.claim = juso_search.make_claim("search", "hello", "tavily", False, "request-1")
        self.server = juso_search.BridgeHTTPServer(("127.0.0.1", 0), juso_search.make_handler(self.state))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def request(self, path, body=None, token="a" * 43, host=None, content_type=True):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        try:
            headers = {"Host": host or f"127.0.0.1:{self.server.server_port}", "Authorization": f"Bearer {token}"}
            if content_type:
                headers["Content-Type"] = "application/json"
            connection.request("POST", path, None if body is None else json.dumps(body), headers)
            response = connection.getresponse()
            data = response.read()
            return response.status, json.loads(data) if data else None
        finally:
            connection.close()

    def test_claim_is_idempotent_and_complete_once(self):
        self.assertFalse(self.state.claimed.is_set())
        self.assertEqual(self.request("/v1/claim", content_type=False)[0], 200)
        self.assertTrue(self.state.claimed.is_set())
        self.assertEqual(self.request("/v1/claim", content_type=False)[0], 200)
        self.assertTrue(self.state.claimed.is_set())
        complete = {"protocol": 2, "requestId": "request-1", "reply": {"ok": False, "error": {"kind": "unknown", "message": "safe"}}}
        self.assertEqual(self.request("/v1/complete", complete)[0], 204)
        self.assertTrue(self.state.completed.is_set())
        self.assertEqual(self.request("/v1/complete", complete)[0], 409)

    def test_failed_auth_does_not_mark_claimed(self):
        self.assertEqual(self.request("/v1/claim", token="wrong", content_type=False)[0], 401)
        self.assertFalse(self.state.claimed.is_set())
        self.assertEqual(self.request("/v1/claim", host="localhost:1", content_type=False)[0], 400)
        self.assertFalse(self.state.claimed.is_set())

    def test_claim_not_ready_does_not_mark_claimed(self):
        self.state.claim = None
        status, payload = self.request("/v1/claim", content_type=False)
        self.assertEqual(status, 409)
        self.assertEqual(payload["error"]["kind"], "claim_not_ready")
        self.assertFalse(self.state.claimed.is_set())

    def test_rejects_bad_token_host_request_id_and_path(self):
        self.assertEqual(self.request("/v1/claim", token="wrong", content_type=False)[0], 401)
        self.assertEqual(self.request("/v1/claim", host="localhost:1", content_type=False)[0], 400)
        self.assertEqual(self.request("/v1/complete", {"protocol": 2, "requestId": "wrong", "reply": {}})[0], 400)
        self.assertEqual(self.request("/nope", self.state.claim)[0], 404)
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        try:
            connection.request("GET", "/v1/claim")
            response = connection.getresponse()
            self.assertEqual(response.status, 405)
            response.read()
        finally:
            connection.close()

    def test_rejects_reply_for_the_wrong_claim_action_or_shape(self):
        provider_reply = {"providers": [{"id": "tavily", "supportsAnswer": True, "configured": False}]}
        self.assertEqual(self.request("/v1/complete", {"protocol": 2, "requestId": "request-1", "reply": provider_reply})[0], 400)
        self.assertEqual(self.request("/v1/complete", {"protocol": 2, "requestId": "request-1", "reply": {"ok": True}})[0], 400)
        self.state.claim = juso_search.make_claim("list-providers", None, None, False, "request-1")
        self.assertEqual(self.request("/v1/complete", {"protocol": 2, "requestId": "request-1", "reply": {"providers": [{"id": "tavily", "supportsAnswer": True, "configured": False, "extra": True}]}})[0], 400)
        self.assertEqual(self.request("/v1/complete", {"protocol": 2, "requestId": "request-1", "reply": provider_reply})[0], 204)

    def test_abort_signals_fast_failure(self):
        """/v1/abort lets the bridge notify the skill to fail fast instead of waiting for timeout."""
        self.assertFalse(self.state.aborted)
        self.assertFalse(self.state.completed.is_set())
        status, _ = self.request("/v1/abort", {"reason": "invalid_fragment"})
        self.assertEqual(status, 204)
        self.assertTrue(self.state.aborted)
        self.assertEqual(self.state.abort_reason, "invalid_fragment")
        self.assertTrue(self.state.completed.is_set())
        # A second abort after completion is a conflict
        self.assertEqual(self.request("/v1/abort", {"reason": "again"})[0], 409)

    def test_abort_requires_auth_and_host(self):
        self.assertEqual(self.request("/v1/abort", {"reason": "x"}, token="wrong")[0], 401)
        self.assertEqual(self.request("/v1/abort", {"reason": "x"}, host="localhost:1")[0], 400)
        self.assertFalse(self.state.aborted)

    def test_abort_without_reason_defaults_to_unknown(self):
        status, _ = self.request("/v1/abort", {})
        self.assertEqual(status, 204)
        self.assertEqual(self.state.abort_reason, "unknown")

    def test_incomplete_body_times_out_and_does_not_block_shutdown(self):
        token = "a" * 43
        request = (
            "POST /v1/complete HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.server.server_port}\r\n"
            f"Authorization: Bearer {token}\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: 20\r\n\r\n"
            "{}"
        ).encode()
        connection = socket.create_connection(("127.0.0.1", self.server.server_port))
        connection.settimeout(juso_search.SOCKET_TIMEOUT_SECONDS * 3)
        try:
            connection.sendall(request)
            response = b""
            while True:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                response += chunk
            self.assertIn(b"408 Request Timeout", response)
            self.assertIn(b'"kind":"request_timeout"', response)
        finally:
            connection.close()

        for _ in range(3):
            state = juso_search.BridgeState(token, "request-1")
            server = juso_search.BridgeHTTPServer(("127.0.0.1", 0), juso_search.make_handler(state))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            connection = socket.create_connection(("127.0.0.1", server.server_port))
            try:
                connection.sendall(request.replace(str(self.server.server_port).encode(), str(server.server_port).encode()))
                time.sleep(0.05)
                started = time.monotonic()
                server.shutdown()
                server.server_close()
                self.assertLess(time.monotonic() - started, juso_search.SOCKET_TIMEOUT_SECONDS)
                connection.settimeout(juso_search.SOCKET_TIMEOUT_SECONDS * 3)
                while connection.recv(4096):
                    pass
            finally:
                connection.close()


class PureFunctionTests(unittest.TestCase):
    def test_cli_and_claim_helpers(self):
        args = juso_search.parser().parse_args(["--extension-id", "a" * 32, "search", "hello", "--provider", "exa", "--force-refresh"])
        self.assertEqual(args.provider, "exa")
        self.assertTrue(args.force_refresh)
        self.assertEqual(juso_search.make_claim("list-providers", None, None, False, "id")["request"], {"action": "list-providers"})
        self.assertEqual(juso_search.extension_id("a" * 32), "a" * 32)
        with self.assertRaises(Exception):
            juso_search.extension_id("invalid")
        self.assertEqual(juso_search.parser().parse_args(["--extension-id", "a" * 32, "list-providers"]).timeout, 40.0)
        engine_args = juso_search.parser().parse_args(["--extension-id", "a" * 32, "engine-search", "hello", "--engine", "google", "--max-results", "2"])
        self.assertEqual((engine_args.engine, engine_args.max_results), ("google", 2))
        self.assertEqual(juso_search.make_claim("engine-search", "hello", None, False, "id", "google", 2)["request"], {"action": "engine-search", "query": "hello", "engineId": "google", "maxResults": 2})
        instance_args = juso_search.parser().parse_args(["--extension-id", "a" * 32, "search-instance", "hello", "--instance-id", "inst:exa:abc123"])
        self.assertEqual(instance_args.instance_id, "inst:exa:abc123")
        self.assertEqual(juso_search.make_claim("search-instance", "hello", None, False, "id", instance_id="inst:exa:abc123")["request"], {"action": "search-instance", "query": "hello", "instanceId": "inst:exa:abc123"})
        self.assertEqual(juso_search.make_claim("list-instances", None, None, False, "id")["request"], {"action": "list-instances"})
        for value in ("nan", "inf", "-inf"):
            with self.assertRaises(Exception):
                juso_search.positive_timeout(value)
        self.assertEqual(juso_search.parser().parse_args(["--extension-id", "a" * 32, "search", " hello ", "--provider", "exa"]).query, "hello")
        for query in ("", " " * 2, "x" * 8193):
            with self.assertRaises(SystemExit):
                juso_search.parser().parse_args(["--extension-id", "a" * 32, "engine-search", query, "--engine", "google"])

    def test_default_extension_id_is_used_when_none_provided(self):
        """--extension-id 默认值回退到 DEFAULT_EXTENSION_ID（Chrome Web Store 发布版），无需手动传参。"""
        self.assertEqual(juso_search.DEFAULT_EXTENSION_ID, "illmhdnglkjfcenboepdgopaeejdgoji")
        self.assertTrue(juso_search.EXTENSION_ID_RE.fullmatch(juso_search.DEFAULT_EXTENSION_ID))
        # 不传 --extension-id（且不设 JUSO_EXTENSION_ID 环境变量）时默认值应为 DEFAULT_EXTENSION_ID
        with patch.dict(os.environ, {}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.extension_id, "illmhdnglkjfcenboepdgopaeejdgoji")
        # 显式传 --extension-id 时仍以其为准
        args = juso_search.parser().parse_args(["--extension-id", "a" * 32, "list-providers"])
        self.assertEqual(args.extension_id, "a" * 32)

    def test_extension_id_env_and_cli_precedence(self):
        """JUSO_EXTENSION_ID 覆盖默认值；CLI --extension-id 优先于环境变量。"""
        env_id = "b" * 32
        cli_id = "c" * 32
        with patch.dict(os.environ, {"JUSO_EXTENSION_ID": env_id}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.extension_id, env_id)
            args = juso_search.parser().parse_args(["--extension-id", cli_id, "list-providers"])
            self.assertEqual(args.extension_id, cli_id)
        # 空字符串环境变量经 `or` 回退到 DEFAULT_EXTENSION_ID
        with patch.dict(os.environ, {"JUSO_EXTENSION_ID": ""}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.extension_id, juso_search.DEFAULT_EXTENSION_ID)
        # argparse 会对 default 跑 type=extension_id，非法 env 在 parse 阶段失败
        with patch.dict(os.environ, {"JUSO_EXTENSION_ID": "not-a-valid-id"}, clear=True):
            with self.assertRaises(SystemExit):
                juso_search.parser().parse_args(["list-providers"])
        # run() 仍校验非法 ID（Namespace 直传等旁路）
        bad = argparse.Namespace(
            extension_id="not-a-valid-id",
            command="list-providers",
            chrome=None,
            profile=None,
            timeout=1.0,
        )
        status, payload = juso_search.run(bad)
        self.assertEqual(status, 2)
        self.assertEqual(payload["error"]["kind"], "invalid_extension_id")

    def test_timeout_env_and_cli_precedence(self):
        """JUSO_TIMEOUT 覆盖默认 40s；CLI --timeout 优先于环境变量。"""
        # 合法 env 值覆盖默认
        with patch.dict(os.environ, {"JUSO_TIMEOUT": "90"}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.timeout, 90.0)
            # CLI 优先于 env
            args = juso_search.parser().parse_args(["--timeout", "12", "list-providers"])
            self.assertEqual(args.timeout, 12.0)
        # 空字符串 env 回退默认 40.0
        with patch.dict(os.environ, {"JUSO_TIMEOUT": ""}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.timeout, 40.0)
        # env 未设 → 默认 40.0
        with patch.dict(os.environ, {}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.timeout, 40.0)
        # 非法 env 值在 parse 阶段 SystemExit（与 extension_id 既有约定一致）
        for bad in ("bad", "0", "-1", "nan", "inf"):
            with patch.dict(os.environ, {"JUSO_TIMEOUT": bad}, clear=True):
                with self.assertRaises(SystemExit):
                    juso_search.parser().parse_args(["list-providers"])

    def test_reply_validation_status_and_path_lookup(self):
        error_reply = {"ok": False, "error": {"kind": "unknown", "message": "safe"}}
        claim = juso_search.make_claim("search", "hello", "tavily", False, "request-1")
        self.assertTrue(juso_search.is_valid_reply(claim, error_reply))
        self.assertEqual(juso_search.result_status(error_reply), 1)
        self.assertEqual(juso_search.result_status({"providers": []}), 0)
        engine_claim = juso_search.make_claim("engine-search", "hello", None, False, "request-1", "google")
        self.assertTrue(juso_search.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "challenge"}))
        self.assertFalse(juso_search.is_valid_reply(engine_claim, {"engine": "bing", "query": "hello", "error": "challenge"}))
        self.assertFalse(juso_search.is_valid_reply(engine_claim, {"engine": "google", "query": "other", "error": "challenge"}))
        providers_claim = juso_search.make_claim("list-providers", None, None, False, "request-1")
        self.assertTrue(juso_search.is_valid_reply(providers_claim, {"providers": [{"id": "exa", "supportsAnswer": True, "configured": True, "hasInstances": True}]}))
        self.assertFalse(juso_search.is_valid_reply(providers_claim, {"providers": [{"id": "exa", "supportsAnswer": True, "configured": True, "extra": True}]}))
        instances_claim = juso_search.make_claim("list-instances", None, None, False, "request-1")
        instance_reply = {"instances": [{"id": "inst:exa:abc123", "providerId": "exa", "label": "AI research", "description": "category=publication", "configured": True}]}
        self.assertTrue(juso_search.is_valid_reply(instances_claim, instance_reply))
        search_instance_claim = juso_search.make_claim("search-instance", "hello", None, False, "request-1", instance_id="inst:exa:abc123")
        self.assertTrue(juso_search.is_valid_reply(search_instance_claim, error_reply))
        self.assertEqual(juso_search.result_status({"engine": "google", "query": "hello", "error": "challenge"}), 1)
        self.assertEqual(juso_search.result_status({"engine": "google", "query": "hello", "error": "no-results"}), 1)
        self.assertTrue(juso_search.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "tab-closed"}))
        self.assertEqual(juso_search.result_status({"engine": "google", "query": "hello", "error": "tab-closed"}), 1)
        self.assertTrue(juso_search.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "timeout"}))
        self.assertTrue(juso_search.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "aborted"}))
        self.assertTrue(juso_search.is_valid_reply(engine_claim, {"engine": "google", "query": "hello", "error": "extract-failed"}))
        with patch.object(juso_search.shutil, "which", side_effect=lambda name: "/bin/chromium" if name == "chromium" else None):
            self.assertEqual(juso_search.find_chrome(None), "/bin/chromium")

    def test_wait_failure_classifies_claim_observation(self):
        unclaimed = juso_search.BridgeState("token", "request-1")
        payload = juso_search.wait_failure(unclaimed)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_claim")
        self.assertIn("--chrome", payload["error"]["message"])
        self.assertIn("JUSO_CHROME_PATH", payload["error"]["message"])
        self.assertIn("--profile", payload["error"]["message"])
        self.assertIn("--extension-id", payload["error"]["message"])

        claimed = juso_search.BridgeState("token", "request-1")
        claimed.claimed.set()
        payload = juso_search.wait_failure(claimed)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_complete")
        self.assertIn("reload the extension", payload["error"]["message"])


class RunLifecycleTests(unittest.TestCase):
    def _namespace(self, **overrides):
        args = argparse.Namespace(
            extension_id="a" * 32,
            command="list-providers",
            chrome="/fake/chrome",
            profile=None,
            timeout=0.3,
            query=None,
            provider=None,
            force_refresh=False,
            engine=None,
            max_results=None,
        )
        for key, value in overrides.items():
            setattr(args, key, value)
        return args

    def test_chrome_not_found_names_custom_path(self):
        with patch.object(juso_search, "find_chrome", return_value=None):
            status, payload = juso_search.run(self._namespace(chrome=None))
        self.assertEqual(status, 2)
        self.assertEqual(payload["error"]["kind"], "chrome_not_found")
        self.assertIn("--chrome", payload["error"]["message"])
        self.assertIn("JUSO_CHROME_PATH", payload["error"]["message"])

    def test_chrome_launch_failed_includes_os_reason(self):
        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", side_effect=OSError("permission denied")),
        ):
            status, payload = juso_search.run(self._namespace())
        self.assertEqual(status, 1)
        self.assertEqual(payload["error"]["kind"], "chrome_launch_failed")
        self.assertIn("permission denied", payload["error"]["message"])
        self.assertIn("JUSO_CHROME_PATH", payload["error"]["message"])

    def test_run_timeout_without_claim(self):
        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", return_value=None),
        ):
            status, payload = juso_search.run(self._namespace(timeout=0.15))
        self.assertEqual(status, 1)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_claim")
        self.assertIn("--profile", payload["error"]["message"])
        self.assertIn("--extension-id", payload["error"]["message"])

    def test_run_timeout_after_claim_without_complete(self):
        def claim_only(command, **_kwargs):
            # Popen receives [chrome, optional --profile-directory, url]
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
                self.assertEqual(response.status, 200)
                response.read()
            finally:
                connection.close()
            return None

        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", side_effect=claim_only),
        ):
            status, payload = juso_search.run(self._namespace(timeout=0.4))
        self.assertEqual(status, 1)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_complete")

    def test_run_success_after_claim_and_complete(self):
        reply = {
            "providers": [
                {"id": "tavily", "supportsAnswer": True, "configured": True},
            ]
        }

        def claim_and_complete(command, **_kwargs):
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
                self.assertEqual(response.status, 200)
                claim = json.loads(response.read())
                complete = {
                    "protocol": claim["protocol"],
                    "requestId": claim["requestId"],
                    "reply": reply,
                }
                headers["Content-Type"] = "application/json"
                connection.request("POST", "/v1/complete", json.dumps(complete), headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 204)
                response.read()
            finally:
                connection.close()
            return None

        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", side_effect=claim_and_complete),
        ):
            status, payload = juso_search.run(self._namespace(timeout=2.0))
        self.assertEqual(status, 0)
        self.assertEqual(payload, reply)

    def test_run_aborts_fast_on_bridge_abort_signal(self):
        """When the bridge sends /v1/abort, run() returns immediately with a classified error."""
        abort_event = threading.Event()
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # process still running
        mock_proc.wait.side_effect = juso_search.subprocess.TimeoutExpired(cmd="chrome", timeout=2)

        def abort_and_return_proc(command, **_kwargs):
            url = command[-1]
            fragment = url.split("#", 1)[1]
            parts = dict(item.split("=", 1) for item in fragment.split("&"))
            port, token = int(parts["p"]), parts["t"]
            connection = http.client.HTTPConnection("127.0.0.1", port)
            try:
                headers = {
                    "Host": f"127.0.0.1:{port}",
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                }
                connection.request("POST", "/v1/abort", json.dumps({"reason": "invalid_fragment"}), headers)
                response = connection.getresponse()
                self.assertEqual(response.status, 204)
                response.read()
                abort_event.set()
            finally:
                connection.close()
            return mock_proc

        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", side_effect=abort_and_return_proc),
        ):
            status, payload = juso_search.run(self._namespace(timeout=5.0))
        self.assertTrue(abort_event.is_set())
        self.assertEqual(status, 1)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_claim")
        self.assertIn("bridge aborted", payload["error"]["message"])
        self.assertIn("invalid_fragment", payload["error"]["message"])
        # Process cleanup: terminate then kill (wait timed out)
        mock_proc.terminate.assert_called_once()
        mock_proc.kill.assert_called_once()

    def test_run_terminates_browser_on_timeout(self):
        """On timeout, run() terminates the lingering browser process."""
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # still running
        mock_proc.wait.return_value = 0  # terminate succeeds
        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", return_value=mock_proc),
        ):
            status, payload = juso_search.run(self._namespace(timeout=0.15))
        self.assertEqual(status, 1)
        self.assertEqual(payload["error"]["kind"], "extension_did_not_claim")
        mock_proc.terminate.assert_called_once()
        mock_proc.kill.assert_not_called()

    def test_run_does_not_terminate_already_exited_browser(self):
        """If the browser process already exited (e.g. forwarded to running instance), don't terminate."""
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 0  # already exited
        with (
            patch.object(juso_search, "find_chrome", return_value="/fake/chrome"),
            patch.object(juso_search.subprocess, "Popen", return_value=mock_proc),
        ):
            status, _ = juso_search.run(self._namespace(timeout=0.15))
        self.assertEqual(status, 1)
        mock_proc.terminate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
