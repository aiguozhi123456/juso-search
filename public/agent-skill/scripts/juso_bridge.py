#!/usr/bin/env python3
"""Single-source bridge-client core for the Juso Chrome extension.

Shared by the CLI skill wrapper (``juso_search.py``) and, later, the MCP
server (``juso-search``). This module owns the loopback bridge server,
Chromium discovery and launch, the claim/complete/abort protocol, reply
validation, and the programmatic orchestration entry point
:func:`run_bridge`.

Programmatic API
----------------
``run_bridge(...)`` performs a full bridge cycle and returns the bridge
reply dict on success. On failure it raises :class:`BridgeError` with a
stable ``kind`` classifier (see the ``ERROR_*`` constants) and a
human-readable ``message``. ``BridgeError.exit_status`` mirrors the CLI
wrapper's exit code (2 for configuration errors, 1 for runtime/bridge
errors) so the CLI wrapper and the future MCP tool can map failures
consistently. Callers should ``except juso_bridge.BridgeError`` and
inspect ``error.kind``.

Stdlib-only by design: this file must stay drop-in for the Agent Skill
zip (no third-party imports).
"""

from __future__ import annotations

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
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

__all__ = [
    "PROTOCOL",
    "MAX_BODY_BYTES",
    "SOCKET_TIMEOUT_SECONDS",
    "EXTENSION_ID_RE",
    "RECOVERY_HINT",
    "ERROR_INVALID_EXTENSION_ID",
    "ERROR_CHROME_NOT_FOUND",
    "ERROR_WAIT_FAILED",
    "ERROR_EXTENSION_DID_NOT_CLAIM",
    "ERROR_EXTENSION_DID_NOT_COMPLETE",
    "ERROR_CHROME_LAUNCH_FAILED",
    "ERROR_CANCELLED",
    "BridgeError",
    "BridgeState",
    "BridgeHTTPServer",
    "chrome_candidates",
    "find_chrome",
    "is_search_reply",
    "is_provider_list_reply",
    "is_instance_list_reply",
    "is_engine_search_reply",
    "is_engine_list_reply",
    "is_valid_reply",
    "result_status",
    "wait_failure",
    "make_handler",
    "make_claim",
    "run_bridge",
]

PROTOCOL = 2
MAX_BODY_BYTES = 8 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 1.0
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")

# Stable failure classifiers raised by run_bridge() via BridgeError.
ERROR_INVALID_EXTENSION_ID = "invalid_extension_id"
ERROR_CHROME_NOT_FOUND = "chrome_not_found"
ERROR_WAIT_FAILED = "wait_failed"
ERROR_EXTENSION_DID_NOT_CLAIM = "extension_did_not_claim"
ERROR_EXTENSION_DID_NOT_COMPLETE = "extension_did_not_complete"
ERROR_CHROME_LAUNCH_FAILED = "chrome_launch_failed"
ERROR_CANCELLED = "cancelled"


class BridgeError(Exception):
    """Structured bridge failure raised by :func:`run_bridge`.

    Attributes:
        kind: stable classifier string, one of the ``ERROR_*`` constants.
        message: human-readable detail, identical to what the CLI prints.
        exit_status: CLI exit code the wrapper maps this failure to (2 for
            configuration errors, 1 for runtime/bridge errors).
    """

    def __init__(self, kind: str, message: str, exit_status: int) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.exit_status = exit_status


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
            and isinstance(response.get("provider"), str)
            and response.get("provider")
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
        and set(provider) >= {"id", "supportsAnswer", "configured"}  # subset, not equality
        and set(provider) <= {"id", "supportsAnswer", "configured", "hasInstances"}  # no unknown fields
        and isinstance(provider["id"], str)
        and provider["id"]
        and isinstance(provider["supportsAnswer"], bool)
        and isinstance(provider["configured"], bool)
        and ("hasInstances" not in provider or isinstance(provider["hasInstances"], bool))
        for provider in reply["providers"]
    )


def is_instance_list_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) != {"instances"} or not isinstance(reply["instances"], list):
        return False
    return all(
        isinstance(instance, dict)
        and set(instance) == {"id", "providerId", "label", "description", "configured"}
        and isinstance(instance["id"], str)
        and instance["id"].startswith("inst:")
        and isinstance(instance["providerId"], str)
        and instance["providerId"]
        and isinstance(instance["label"], str)
        and isinstance(instance["description"], str)
        and isinstance(instance["configured"], bool)
        for instance in reply["instances"]
    )


def is_engine_search_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) not in ({"engine", "query", "results"}, {"engine", "query", "error"}):
        return False
    engine = reply.get("engine")
    if not isinstance(engine, str) or not engine or not isinstance(reply.get("query"), str):
        return False
    if "results" in reply:
        return isinstance(reply["results"], list) and all(
            isinstance(result, dict) and set(result) == {"title", "url", "snippet"}
            and all(isinstance(result[key], str) for key in result) for result in reply["results"]
        )
    return reply.get("error") in {
        "challenge",
        "consent",
        "unsupported-layout",
        "no-results",
        "tab-closed",
        "timeout",
        "aborted",
        "extract-failed",
    }


def is_engine_list_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) != {"engines"} or not isinstance(reply["engines"], list):
        return False
    return all(
        isinstance(engine, dict)
        and set(engine) == {"id"}
        and isinstance(engine["id"], str)
        and engine["id"]
        for engine in reply["engines"]
    )


def is_valid_reply(claim: dict[str, Any] | None, reply: Any) -> bool:
    request = claim.get("request") if isinstance(claim, dict) else None
    if not isinstance(request, dict):
        return False
    if request.get("action") == "search":
        return is_search_reply(reply)
    if request.get("action") == "list-providers":
        return is_provider_list_reply(reply)
    if request.get("action") == "list-instances":
        return is_instance_list_reply(reply)
    if request.get("action") == "list-engines":
        return is_engine_list_reply(reply)
    if request.get("action") == "search-instance":
        return is_search_reply(reply)  # same reply shape as search
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
        self.claimed = threading.Event()
        self.completed = threading.Event()
        self.aborted = False
        self.abort_reason = ""
        self.lock = threading.Lock()

    def valid_token(self, value: str | None) -> bool:
        return value is not None and hmac.compare_digest(value, f"Bearer {self.token}")


RECOVERY_HINT = (
    "confirm Juso is installed and enabled in the opened browser profile; "
    "override with --chrome or JUSO_CHROME_PATH, --profile or JUSO_CHROME_PROFILE, "
    "and --extension-id or JUSO_EXTENSION_ID"
)


def wait_failure(state: BridgeState) -> dict[str, Any]:
    """Classify a failed completed.wait using skill-local claim observation only."""
    if state.claimed.is_set():
        return {
            "ok": False,
            "error": {
                "kind": "extension_did_not_complete",
                "message": (
                    "extension claimed the request but did not complete it; "
                    f"{RECOVERY_HINT}; if path/profile/id are correct, reload the extension"
                ),
            },
        }
    return {
        "ok": False,
        "error": {
            "kind": "extension_did_not_claim",
            "message": (
                "extension did not claim the request; "
                f"{RECOVERY_HINT}"
            ),
        },
    }


def _wait_for_completion(
    state: BridgeState,
    timeout: float,
    cancel_event: threading.Event | None,
) -> bool:
    """Wait for the extension to complete, polling so a cancel can abort early.

    Returns True when the request completed, False on timeout. When
    ``cancel_event`` is set before completion this raises
    ``BridgeError(kind=cancelled)`` so the caller's cleanup (loopback server
    shutdown, Chromium teardown) runs promptly instead of holding the browser
    open for the full ``timeout``.
    """
    deadline = time.monotonic() + timeout
    while True:
        if cancel_event is not None and cancel_event.is_set():
            raise BridgeError(
                ERROR_CANCELLED,
                "bridge request cancelled by the caller before the extension completed it",
                exit_status=1,
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        if state.completed.wait(min(remaining, 0.2)):
            return True


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
            elif self.path == "/v1/abort":
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_content_type")
                    return
                body = self._body()
                if body is None:
                    return
                self._abort(body)
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
            with state.lock:
                state.claimed.set()
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

        def _abort(self, payload: dict[str, Any]) -> None:
            reason = payload.get("reason")
            with state.lock:
                if state.completed.is_set():
                    self._error(HTTPStatus.CONFLICT, "already_completed")
                    return
                state.aborted = True
                state.abort_reason = reason if isinstance(reason, str) and reason else "unknown"
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


def make_claim(action: str, query: str | None, provider: str | None, force_refresh: bool, request_id: str, engine: str | None = None, max_results: int | None = None, instance_id: str | None = None) -> dict[str, Any]:
    request: dict[str, Any] = {"action": action}
    if action == "search":
        request.update(query=query, providerId=provider)
        if force_refresh:
            request["forceRefresh"] = True
    if action == "engine-search":
        request.update(query=query, engineId=engine)
        if max_results is not None:
            request["maxResults"] = max_results
    if action == "search-instance":
        request.update(query=query, instanceId=instance_id)
        if force_refresh:
            request["forceRefresh"] = True
    # list-providers, list-instances, and list-engines have no extra fields
    return {"protocol": PROTOCOL, "requestId": request_id, "request": request}


def run_bridge(action: str, query: str | None, *, provider_id: str | None = None, engine_id: str | None = None,
               instance_id: str | None = None, force_refresh: bool = False, max_results: int | None = None,
               extension_id: str, chrome_path: str | None = None, profile: str | None = None,
               timeout: float = 40.0, cancel_event: threading.Event | None = None) -> dict[str, Any]:
    """Run one full bridge cycle and return the extension's reply dict.

    Orchestrates: validate extension id → find chrome → start loopback
    server → build claim → launch Chromium → wait for complete → classify.

    Args:
        action: one of "search", "engine-search", "search-instance",
            "list-providers", "list-instances", "list-engines".
        query: search query for search-like actions; None for list actions.
        provider_id: provider for "search" (any non-empty provider id string).
        engine_id: engine for "engine-search" (any non-empty engine id string).
        instance_id: instance id for "search-instance".
        force_refresh: bypass cache for "search"/"search-instance".
        max_results: optional result cap for "engine-search".
        extension_id: Chrome extension id (32 lowercase letters a-p).
        chrome_path: explicit browser executable (auto-discovery otherwise).
        profile: optional --profile-directory for the launched browser.
        timeout: seconds to wait for the extension to complete the request.
        cancel_event: optional threading.Event; when set before the
            extension completes, run_bridge stops waiting and raises
            BridgeError(kind=cancelled). Cleanup (loopback server shutdown,
            Chromium teardown) still runs before the error propagates.

    Returns:
        The validated bridge reply dict.

    Raises:
        BridgeError: on any structured failure. ``error.kind`` is one of
            the ERROR_* constants; ``error.message`` matches what the CLI
            prints; ``error.exit_status`` is the CLI exit code.
    """
    if not extension_id or not EXTENSION_ID_RE.fullmatch(extension_id):
        raise BridgeError(
            ERROR_INVALID_EXTENSION_ID,
            "extension ID must be 32 lowercase letters a-p; override with --extension-id or JUSO_EXTENSION_ID",
            exit_status=2,
        )
    chrome = find_chrome(chrome_path)
    if not chrome:
        raise BridgeError(
            ERROR_CHROME_NOT_FOUND,
            (
                "no Chromium-family browser found; set --chrome or JUSO_CHROME_PATH "
                "to the executable that has Juso installed "
                f"(also check --profile or JUSO_CHROME_PROFILE and --extension-id or JUSO_EXTENSION_ID)"
            ),
            exit_status=2,
        )
    token, request_id = secrets.token_urlsafe(32), str(uuid.uuid4())
    state = BridgeState(token, request_id)
    state.claim = make_claim(
        action,
        query,
        provider_id,
        force_refresh,
        request_id,
        engine_id,
        max_results,
        instance_id,
    )
    server: BridgeHTTPServer | None = None
    process: subprocess.Popen | None = None
    try:
        server = BridgeHTTPServer(("127.0.0.1", 0), make_handler(state))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f"chrome-extension://{extension_id}/bridge.html#v=1&p={server.server_port}&t={token}"
        command = [chrome, url]
        if profile:
            command.insert(1, f"--profile-directory={profile}")
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            completed = _wait_for_completion(state, timeout, cancel_event)
        except BridgeError:
            raise  # caller-initiated cancel: propagate untouched, cleanup still runs
        except Exception as error:
            raise BridgeError(ERROR_WAIT_FAILED, str(error), exit_status=1)
        if not completed:
            failure = wait_failure(state)
            raise BridgeError(failure["error"]["kind"], failure["error"]["message"], exit_status=1)
        if state.aborted:
            kind = ERROR_EXTENSION_DID_NOT_COMPLETE if state.claimed.is_set() else ERROR_EXTENSION_DID_NOT_CLAIM
            raise BridgeError(kind, f"bridge aborted: {state.abort_reason}; {RECOVERY_HINT}", exit_status=1)
        return state.reply
    except OSError as error:
        raise BridgeError(
            ERROR_CHROME_LAUNCH_FAILED,
            f"{error}; {RECOVERY_HINT}",
            exit_status=1,
        )
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
