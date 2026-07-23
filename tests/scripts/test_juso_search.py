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
from unittest.mock import patch


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
        self.assertEqual(self.request("/v1/claim", content_type=False)[0], 200)
        self.assertEqual(self.request("/v1/claim", content_type=False)[0], 200)
        complete = {"protocol": 1, "requestId": "request-1", "reply": {"ok": False, "error": {"kind": "unknown", "message": "safe"}}}
        self.assertEqual(self.request("/v1/complete", complete)[0], 204)
        self.assertTrue(self.state.completed.is_set())
        self.assertEqual(self.request("/v1/complete", complete)[0], 409)

    def test_rejects_bad_token_host_request_id_and_path(self):
        self.assertEqual(self.request("/v1/claim", token="wrong", content_type=False)[0], 401)
        self.assertEqual(self.request("/v1/claim", host="localhost:1", content_type=False)[0], 400)
        self.assertEqual(self.request("/v1/complete", {"protocol": 1, "requestId": "wrong", "reply": {}})[0], 400)
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
        self.assertEqual(self.request("/v1/complete", {"protocol": 1, "requestId": "request-1", "reply": provider_reply})[0], 400)
        self.assertEqual(self.request("/v1/complete", {"protocol": 1, "requestId": "request-1", "reply": {"ok": True}})[0], 400)
        self.state.claim = juso_search.make_claim("list-providers", None, None, False, "request-1")
        self.assertEqual(self.request("/v1/complete", {"protocol": 1, "requestId": "request-1", "reply": {"providers": [{"id": "tavily", "supportsAnswer": True, "configured": False, "extra": True}]}})[0], 400)
        self.assertEqual(self.request("/v1/complete", {"protocol": 1, "requestId": "request-1", "reply": provider_reply})[0], 204)

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
        for value in ("nan", "inf", "-inf"):
            with self.assertRaises(Exception):
                juso_search.positive_timeout(value)
        self.assertEqual(juso_search.parser().parse_args(["--extension-id", "a" * 32, "search", " hello ", "--provider", "exa"]).query, "hello")
        for query in ("", " " * 2, "x" * 8193):
            with self.assertRaises(SystemExit):
                juso_search.parser().parse_args(["--extension-id", "a" * 32, "engine-search", query, "--engine", "google"])

    def test_default_extension_id_is_used_when_none_provided(self):
        """--extension-id 默认值回退到 DEFAULT_EXTENSION_ID，无需手动传参。"""
        self.assertEqual(juso_search.DEFAULT_EXTENSION_ID, "pdklefhommhabbhkglgkgomeibeibmcl")
        self.assertTrue(juso_search.EXTENSION_ID_RE.fullmatch(juso_search.DEFAULT_EXTENSION_ID))
        # 不传 --extension-id（且不设 JUSO_EXTENSION_ID 环境变量）时默认值应为 DEFAULT_EXTENSION_ID
        with patch.dict(os.environ, {}, clear=True):
            args = juso_search.parser().parse_args(["list-providers"])
            self.assertEqual(args.extension_id, "pdklefhommhabbhkglgkgomeibeibmcl")
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
        self.assertEqual(juso_search.result_status({"engine": "google", "query": "hello", "error": "challenge"}), 1)
        self.assertEqual(juso_search.result_status({"engine": "google", "query": "hello", "error": "no-results"}), 1)
        with patch.object(juso_search.shutil, "which", side_effect=lambda name: "/bin/chromium" if name == "chromium" else None):
            self.assertEqual(juso_search.find_chrome(None), "/bin/chromium")


if __name__ == "__main__":
    unittest.main()
