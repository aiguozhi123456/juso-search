#!/usr/bin/env python3
"""Local authenticated bridge to the Juso Chrome extension."""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import math
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

PROTOCOL = 1
MAX_BODY_BYTES = 8 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 1.0
PROVIDERS = ("tavily", "exa", "stepfun", "stepfun-plan")
ENGINES = ("google", "bing", "baidu")
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")


def extension_id(value: str) -> str:
    if not EXTENSION_ID_RE.fullmatch(value):
        raise argparse.ArgumentTypeError("extension ID must be 32 lowercase letters a-p")
    return value


def positive_timeout(value: str) -> float:
    try:
        timeout = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("timeout must be a number") from error
    if not math.isfinite(timeout) or timeout <= 0:
        raise argparse.ArgumentTypeError("timeout must be positive")
    return timeout


def search_query(value: str) -> str:
    query = value.strip()
    if not query or len(query) > 8192:
        raise argparse.ArgumentTypeError("query must be non-empty and at most 8192 characters")
    return query


def chrome_candidates() -> list[Path]:
    candidates: list[Path] = []
    if sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
            if base:
                candidates.append(Path(base) / "Google/Chrome/Application/chrome.exe")
        candidates.append(Path.home() / "AppData/Local/Chromium/Application/chrome.exe")
    elif sys.platform == "darwin":
        candidates.extend((Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), Path("/Applications/Chromium.app/Contents/MacOS/Chromium")))
    else:
        candidates.extend(Path(path) for path in ("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"))
    return candidates


def find_chrome(explicit_path: str | None) -> str | None:
    if explicit_path:
        path = Path(explicit_path).expanduser()
        return str(path) if path.is_file() else None
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        if found := shutil.which(name):
            return found
    return next((str(path) for path in chrome_candidates() if path.is_file()), None)


def is_search_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or not isinstance(reply.get("ok"), bool):
        return False
    if reply["ok"]:
        if set(reply) != {"ok", "response", "cache"}:
            return False
        response, cache = reply["response"], reply["cache"]
        return (
            isinstance(response, dict)
            and isinstance(response.get("query"), str)
            and response.get("provider") in PROVIDERS
            and isinstance(response.get("results"), list)
            and isinstance(cache, dict)
            and isinstance(cache.get("hit"), bool)
            and set(cache).issubset({"hit", "entryId", "createdAt"})
            and ("entryId" not in cache or isinstance(cache["entryId"], str))
            and ("createdAt" not in cache or isinstance(cache["createdAt"], (int, float)))
        )
    if set(reply) != {"ok", "error"} or not isinstance(reply["error"], dict):
        return False
    error = reply["error"]
    return (
        set(error).issubset({"kind", "message", "providerErrorKind"})
        and error.get("kind") in {"keyMissing", "providerError", "unknown"}
        and isinstance(error.get("message"), str)
        and ("providerErrorKind" not in error or isinstance(error["providerErrorKind"], str))
    )


def is_provider_list_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) != {"providers"} or not isinstance(reply["providers"], list):
        return False
    return all(
        isinstance(provider, dict)
        and set(provider) == {"id", "supportsAnswer", "configured"}
        and provider["id"] in PROVIDERS
        and isinstance(provider["supportsAnswer"], bool)
        and isinstance(provider["configured"], bool)
        for provider in reply["providers"]
    )


def is_engine_search_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) not in ({"engine", "query", "results"}, {"engine", "query", "error"}):
        return False
    if reply.get("engine") not in ENGINES or not isinstance(reply.get("query"), str):
        return False
    if "results" in reply:
        return isinstance(reply["results"], list) and all(
            isinstance(result, dict) and set(result) == {"title", "url", "snippet"}
            and all(isinstance(result[key], str) for key in result) for result in reply["results"]
        )
    return reply.get("error") in {"challenge", "consent", "unsupported-layout", "no-results"}


def is_valid_reply(claim: dict[str, Any] | None, reply: Any) -> bool:
    request = claim.get("request") if isinstance(claim, dict) else None
    if not isinstance(request, dict):
        return False
    if request.get("action") == "search":
        return is_search_reply(reply)
    if request.get("action") == "list-providers":
        return is_provider_list_reply(reply)
    if request.get("action") == "engine-search":
        return (
            is_engine_search_reply(reply)
            and reply["engine"] == request.get("engineId")
            and reply["query"] == request.get("query")
        )
    return False


def result_status(reply: Any) -> int:
    if isinstance(reply, dict) and reply.get("ok") is False:
        return 1
    return 1 if is_engine_search_reply(reply) and "error" in reply else 0


class BridgeState:
    def __init__(self, token: str, request_id: str) -> None:
        self.token = token
        self.request_id = request_id
        self.claim: dict[str, Any] | None = None
        self.reply: Any = None
        self.completed = threading.Event()
        self.lock = threading.Lock()

    def valid_token(self, value: str | None) -> bool:
        return value is not None and hmac.compare_digest(value, f"Bearer {self.token}")


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def get_request(self) -> tuple[socket.socket, tuple[str, int]]:
        connection, address = super().get_request()
        connection.settimeout(SOCKET_TIMEOUT_SECONDS)
        return connection, address


def make_handler(state: BridgeState):
    class BridgeHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self) -> None:
            self.request.settimeout(SOCKET_TIMEOUT_SECONDS)
            super().setup()

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def do_GET(self) -> None:
            self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

        def do_POST(self) -> None:
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self._error(HTTPStatus.BAD_REQUEST, "invalid_host")
                return
            if not state.valid_token(self.headers.get("Authorization")):
                self._error(HTTPStatus.UNAUTHORIZED, "unauthorized")
                return
            if self.path == "/v1/claim":
                self._claim()
            elif self.path == "/v1/complete":
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_content_type")
                    return
                body = self._body()
                if body is None:
                    return
                self._complete(body)
            else:
                self._error(HTTPStatus.NOT_FOUND, "not_found")

        def _body(self) -> dict[str, Any] | None:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None or not raw_length.isdecimal() or int(raw_length) > MAX_BODY_BYTES:
                self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "invalid_body_size")
                return None
            try:
                payload = json.loads(self.rfile.read(int(raw_length)).decode("utf-8"))
            except socket.timeout:
                self.close_connection = True
                self._error(HTTPStatus.REQUEST_TIMEOUT, "request_timeout")
                return None
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._error(HTTPStatus.BAD_REQUEST, "invalid_json")
                return None
            if not isinstance(payload, dict):
                self._error(HTTPStatus.BAD_REQUEST, "invalid_body")
                return None
            return payload

        def _claim(self) -> None:
            if state.claim is None:
                self._error(HTTPStatus.CONFLICT, "claim_not_ready")
                return
            self._json(HTTPStatus.OK, state.claim)

        def _complete(self, payload: dict[str, Any]) -> None:
            if payload.get("protocol") != PROTOCOL or payload.get("requestId") != state.request_id or set(payload) != {"protocol", "requestId", "reply"}:
                self._error(HTTPStatus.BAD_REQUEST, "invalid_complete")
                return
            if not is_valid_reply(state.claim, payload["reply"]):
                self._error(HTTPStatus.BAD_REQUEST, "invalid_reply")
                return
            with state.lock:
                if state.completed.is_set():
                    self._error(HTTPStatus.CONFLICT, "already_completed")
                    return
                state.reply = payload["reply"]
                state.completed.set()
            self._empty(HTTPStatus.NO_CONTENT)

        def _json(self, status: HTTPStatus, payload: Any) -> None:
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _empty(self, status: HTTPStatus) -> None:
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def _error(self, status: HTTPStatus, code: str) -> None:
            self._json(status, {"ok": False, "error": {"kind": code}})

    return BridgeHandler


def make_claim(action: str, query: str | None, provider: str | None, force_refresh: bool, request_id: str, engine: str | None = None, max_results: int | None = None) -> dict[str, Any]:
    request: dict[str, Any] = {"action": action}
    if action == "search":
        request.update(query=query, providerId=provider)
        if force_refresh:
            request["forceRefresh"] = True
    if action == "engine-search":
        request.update(query=query, engineId=engine)
        if max_results is not None:
            request["maxResults"] = max_results
    return {"protocol": PROTOCOL, "requestId": request_id, "request": request}


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description="Search through the local Juso extension")
    argument_parser.add_argument("--extension-id", type=extension_id, default=os.environ.get("JUSO_EXTENSION_ID"))
    argument_parser.add_argument("--chrome", default=os.environ.get("JUSO_CHROME_PATH"))
    argument_parser.add_argument("--profile", default=os.environ.get("JUSO_CHROME_PROFILE"))
    argument_parser.add_argument("--timeout", type=positive_timeout, default=40.0)
    commands = argument_parser.add_subparsers(dest="command", required=True)
    search = commands.add_parser("search")
    search.add_argument("query", type=search_query)
    search.add_argument("--provider", required=True, choices=PROVIDERS)
    search.add_argument("--force-refresh", action="store_true")
    engine_search = commands.add_parser("engine-search")
    engine_search.add_argument("query", type=search_query)
    engine_search.add_argument("--engine", required=True, choices=ENGINES)
    engine_search.add_argument("--max-results", type=int, choices=range(1, 21))
    commands.add_parser("list-providers")
    return argument_parser


def run(args: argparse.Namespace) -> tuple[int, Any]:
    if not args.extension_id or not EXTENSION_ID_RE.fullmatch(args.extension_id):
        return 2, {"ok": False, "error": {"kind": "invalid_extension_id", "message": "set --extension-id or JUSO_EXTENSION_ID"}}
    chrome = find_chrome(args.chrome)
    if not chrome:
        return 2, {"ok": False, "error": {"kind": "chrome_not_found", "message": "set --chrome or JUSO_CHROME_PATH"}}
    token, request_id = secrets.token_urlsafe(32), str(uuid.uuid4())
    state = BridgeState(token, request_id)
    state.claim = make_claim(args.command, getattr(args, "query", None), getattr(args, "provider", None), getattr(args, "force_refresh", False), request_id, getattr(args, "engine", None), getattr(args, "max_results", None))
    server = BridgeHTTPServer(("127.0.0.1", 0), make_handler(state))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        url = f"chrome-extension://{args.extension_id}/bridge.html#v=1&p={server.server_port}&t={token}"
        command = [chrome, url]
        if args.profile:
            command.insert(1, f"--profile-directory={args.profile}")
        subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            completed = state.completed.wait(args.timeout)
        except Exception as error:
            return 1, {"ok": False, "error": {"kind": "wait_failed", "message": str(error)}}
        if not completed:
            return 1, {"ok": False, "error": {"kind": "timeout", "message": "extension did not complete the request"}}
        return result_status(state.reply), state.reply
    except OSError as error:
        return 1, {"ok": False, "error": {"kind": "chrome_launch_failed", "message": str(error)}}
    finally:
        server.shutdown()
        server.server_close()


def main() -> int:
    args = parser().parse_args()
    status, result = run(args)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
