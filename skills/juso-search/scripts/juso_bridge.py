#!/usr/bin/env python3
"""Single-source bridge-client core for the Juso extension (Chrome and Firefox).

Shared by the CLI skill wrapper (``juso_search.py``) and, later, the MCP
server (``juso-search``). This module owns the loopback bridge server,
browser discovery and launch (Chrome/Chromium and Firefox), the
claim/complete/abort protocol, reply validation, and the programmatic
orchestration entry point :func:`run_bridge`.

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
import urllib.parse
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

__all__ = [
    "PROTOCOL",
    "MAX_BODY_BYTES",
    "SOCKET_TIMEOUT_SECONDS",
    "DEFAULT_TIMEOUT_SECONDS",
    "EXTENSION_ID_RE",
    "RECOVERY_HINT",
    "is_valid_bridge_url",
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
    "firefox_candidates",
    "find_chrome",
    "detect_browser_type",
    "is_search_reply",
    "is_provider_list_reply",
    "is_instance_list_reply",
    "is_engine_search_reply",
    "is_engine_list_reply",
    "is_site_list_reply",
    "is_site_search_reply",
    "is_aggregate_list_reply",
    "is_aggregate_search_reply",
    "is_valid_reply",
    "result_status",
    "wait_failure",
    "make_handler",
    "clamp_timeout_ms",
    "make_claim",
    "run_bridge",
]

PROTOCOL = 2
MAX_BODY_BYTES = 8 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 1.0
# Default Python-side total wait (seconds) for one full bridge cycle. The CLI
# wrapper and the MCP server fall back to this instead of keeping their own
# copy of the number.
DEFAULT_TIMEOUT_SECONDS = 40.0
EXTENSION_ID_RE = re.compile(r"^(?:[a-p]{32}|[a-zA-Z0-9._-]*@[a-zA-Z0-9._-]+|\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\})$")


def is_valid_bridge_url(bridge_url: str) -> bool:
    """Whether ``bridge_url`` is a trusted extension bridge-page URL.

    Mirrors the extension-side trusted-sender check (lib/agent-bridge.ts
    ``isTrustedBridgeSender``): only ``chrome-extension://<id>/bridge.html`` or
    ``moz-extension://<uuid>/bridge.html``, with no query, fragment, params,
    userinfo, or port. run_bridge appends the bearer token as the URL fragment
    (``#v=1&p=...&t=token``), so any other URL shape would leak that token to a
    non-extension page, and a query/fragment on the input itself would shadow
    the claim parameters the bridge page needs.
    """
    try:
        parsed = urllib.parse.urlparse(bridge_url)
    except ValueError:
        return False
    return (
        parsed.scheme in ("chrome-extension", "moz-extension")
        and bool(parsed.hostname)
        and parsed.path == "/bridge.html"
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
        and "@" not in parsed.netloc  # userinfo（username/password）与扩展侧一致拒绝
        and ":" not in parsed.netloc  # port 同上
    )

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


def firefox_candidates() -> list[Path]:
    candidates: list[Path] = []
    if sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
            if base:
                candidates.append(Path(base) / "Mozilla Firefox/firefox.exe")
        candidates.append(Path.home() / "AppData/Local/Mozilla Firefox/firefox.exe")
    elif sys.platform == "darwin":
        candidates.append(Path("/Applications/Firefox.app/Contents/MacOS/firefox"))
    else:
        candidates.extend(Path(path) for path in ("/usr/bin/firefox", "/usr/bin/firefox-esr", "/snap/bin/firefox"))
    return candidates


def find_chrome(explicit_path: str | None) -> str | None:
    if explicit_path:
        path = Path(explicit_path).expanduser()
        return str(path) if path.is_file() else None
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "firefox", "firefox-esr"):
        if found := shutil.which(name):
            return found
    return next((str(path) for path in (chrome_candidates() + firefox_candidates()) if path.is_file()), None)


def detect_browser_type(browser_path: str) -> str:
    """Return 'firefox' or 'chrome' based on the executable name."""
    name = Path(browser_path).name.lower()
    return "firefox" if "firefox" in name else "chrome"


def _is_error_envelope(reply: dict[str, Any]) -> bool:
    """Shared ok:false branch of the SearchReply-style envelopes (search / search-site / search-aggregate)."""
    if set(reply) != {"ok", "error"} or not isinstance(reply["error"], dict):
        return False
    error = reply["error"]
    return (
        set(error).issubset({"kind", "message", "providerErrorKind"})
        and error.get("kind") in {"keyMissing", "providerError", "unknown"}
        and isinstance(error.get("message"), str)
        and ("providerErrorKind" not in error or isinstance(error["providerErrorKind"], str))
    )


def _is_reply_cache_shape(cache: Any) -> bool:
    return (
        isinstance(cache, dict)
        and isinstance(cache.get("hit"), bool)
        and set(cache).issubset({"hit", "entryId", "createdAt"})
        and ("entryId" not in cache or isinstance(cache["entryId"], str))
        and ("createdAt" not in cache or isinstance(cache["createdAt"], (int, float)))
    )


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
            and _is_reply_cache_shape(cache)
        )
    return _is_error_envelope(reply)


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


def _is_engine_result(result: Any) -> bool:
    """Mirror the extension-side result guard (lib/engine-search.ts ``isResult``).

    Each result is 3 keys {title,url,snippet}（snippet 为语义正文）或 4 键且第四键为
    snippetKind:'metadata'（纯展示元数据标记，bilibili/douyin/xiaohongshu 抽取器每张卡都置位，
    扩展侧反序列化守卫明确接受该形态）；其余键数或非法 snippetKind 值仍严格拒绝。
    """
    if not isinstance(result, dict):
        return False
    if set(result) not in ({"title", "url", "snippet"}, {"title", "url", "snippet", "snippetKind"}):
        return False
    if not all(isinstance(result[key], str) for key in ("title", "url", "snippet")):
        return False
    return "snippetKind" not in result or result["snippetKind"] == "metadata"


def is_engine_search_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) not in ({"engine", "query", "results"}, {"engine", "query", "error"}):
        return False
    engine = reply.get("engine")
    if not isinstance(engine, str) or not engine or not isinstance(reply.get("query"), str):
        return False
    if "results" in reply:
        return isinstance(reply["results"], list) and all(_is_engine_result(result) for result in reply["results"])
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


def is_site_list_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) != {"sites"} or not isinstance(reply["sites"], list):
        return False
    return all(
        isinstance(site, dict)
        and set(site) == {"id", "label", "engineId", "target", "description"}
        and isinstance(site["id"], str)
        and site["id"].startswith("site:")
        and isinstance(site["label"], str)
        and isinstance(site["engineId"], str)
        and site["engineId"]
        and isinstance(site["target"], str)
        and isinstance(site["description"], str)
        for site in reply["sites"]
    )


def is_site_search_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or not isinstance(reply.get("ok"), bool):
        return False
    if reply["ok"]:
        if set(reply) != {"ok", "response", "cache"}:
            return False
        response, cache = reply["response"], reply["cache"]
        return (
            isinstance(response, dict)
            and isinstance(response.get("query"), str)
            and isinstance(response.get("engine"), str)
            and response.get("engine")
            and isinstance(response.get("results"), list)
            and _is_reply_cache_shape(cache)
        )
    return _is_error_envelope(reply)


def is_aggregate_list_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or set(reply) != {"aggregates"} or not isinstance(reply["aggregates"], list):
        return False
    return all(
        isinstance(aggregate, dict)
        and set(aggregate) == {"id", "label", "eligible", "topN", "members"}
        and isinstance(aggregate["id"], str)
        and aggregate["id"].startswith("agg:")
        and isinstance(aggregate["label"], str)
        and isinstance(aggregate["eligible"], bool)
        and isinstance(aggregate["topN"], int)
        and isinstance(aggregate["members"], list)
        and all(isinstance(member, str) and member for member in aggregate["members"])
        for aggregate in reply["aggregates"]
    )


def is_aggregate_search_reply(reply: Any) -> bool:
    if not isinstance(reply, dict) or not isinstance(reply.get("ok"), bool):
        return False
    if reply["ok"]:
        if set(reply) != {"ok", "response", "cache"}:
            return False
        response, cache = reply["response"], reply["cache"]
        return (
            isinstance(response, dict)
            and isinstance(response.get("query"), str)
            and isinstance(response.get("instanceId"), str)
            and response.get("instanceId").startswith("agg:")
            and response.get("kind") == "aggregate"
            and isinstance(response.get("results"), list)
            and isinstance(response.get("members"), list)
            and _is_reply_cache_shape(cache)
        )
    return _is_error_envelope(reply)


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
    if request.get("action") == "list-sites":
        return is_site_list_reply(reply)
    if request.get("action") == "search-site":
        return is_site_search_reply(reply)
    if request.get("action") == "list-aggregates":
        return is_aggregate_list_reply(reply)
    if request.get("action") == "search-aggregate":
        return is_aggregate_search_reply(reply)
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
    "override with --browser or JUSO_BROWSER_PATH, --profile or JUSO_BROWSER_PROFILE, "
    "and --extension-id or JUSO_EXTENSION_ID (or --bridge-url for Firefox)"
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
            self._reject(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

        def do_POST(self) -> None:
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self._reject(HTTPStatus.BAD_REQUEST, "invalid_host")
                return
            if not state.valid_token(self.headers.get("Authorization")):
                self._reject(HTTPStatus.UNAUTHORIZED, "unauthorized")
                return
            if self.path == "/v1/claim":
                self._claim()
            elif self.path == "/v1/complete":
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    self._reject(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_content_type")
                    return
                body = self._body()
                if body is None:
                    return
                self._complete(body)
            elif self.path == "/v1/abort":
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    self._reject(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_content_type")
                    return
                body = self._body()
                if body is None:
                    return
                self._abort(body)
            else:
                self._reject(HTTPStatus.NOT_FOUND, "not_found")

        def _reject(self, status: HTTPStatus, code: str) -> None:
            """Respond with an error and drop the connection.

            These rejections happen before the request body is read; on an
            HTTP/1.1 keep-alive connection the residual body bytes would
            otherwise be parsed as the next request. Closing (announced to the
            client via the Connection: close header in _json/_empty) is always
            safe, and draining cannot be trusted when Content-Length itself is
            the thing being rejected.
            """
            self.close_connection = True
            self._error(status, code)

        def _body(self) -> dict[str, Any] | None:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None or not raw_length.isdecimal() or int(raw_length) > MAX_BODY_BYTES:
                self._reject(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "invalid_body_size")
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
            if self.close_connection:
                # 关闭意图必须通告（keep-alive 客户端否则会复用一条即将被关闭的连接）。
                self.send_header("Connection", "close")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _empty(self, status: HTTPStatus) -> None:
            self.send_response(status)
            if self.close_connection:
                self.send_header("Connection", "close")
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def _error(self, status: HTTPStatus, code: str) -> None:
            self._json(status, {"ok": False, "error": {"kind": code}})

    return BridgeHandler


def clamp_timeout_ms(value: float) -> int:
    """Clamp a millisecond budget into the extension's accepted [7000, 300000] range."""
    return min(300000, max(7000, int(round(value))))


def make_claim(action: str, query: str | None, provider: str | None, force_refresh: bool, request_id: str, engine: str | None = None, max_results: int | None = None, instance_id: str | None = None, site_id: str | None = None, aggregate_id: str | None = None, timeout_ms: float | None = None) -> dict[str, Any]:
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
    if action == "search-site":
        request.update(query=query, siteId=site_id)
        if max_results is not None:
            request["maxResults"] = max_results
    if action == "search-aggregate":
        request.update(query=query, aggregateId=aggregate_id)
        if force_refresh:
            request["forceRefresh"] = True
    # list-providers, list-instances, list-engines, list-sites, and
    # list-aggregates have no extra fields
    # Optional extension-side action budget: omitted entirely (claim stays
    # byte-identical to a default run) unless the caller customized the
    # timeout. Any explicit value, however small, is emitted clamped.
    if timeout_ms is not None:
        request["timeoutMs"] = clamp_timeout_ms(timeout_ms)
    return {"protocol": PROTOCOL, "requestId": request_id, "request": request}


def run_bridge(action: str, query: str | None, *, provider_id: str | None = None, engine_id: str | None = None,
               instance_id: str | None = None, site_id: str | None = None, aggregate_id: str | None = None,
               force_refresh: bool = False, max_results: int | None = None,
               extension_id: str | None = None, chrome_path: str | None = None, profile: str | None = None,
               timeout: float = DEFAULT_TIMEOUT_SECONDS, timeout_ms: float | None = None,
               cancel_event: threading.Event | None = None,
               bridge_url: str | None = None, browser_type: str | None = None) -> dict[str, Any]:
    """Run one full bridge cycle and return the extension's reply dict.

    Orchestrates: validate bridge URL / extension id → find browser → start
    loopback server → build claim → launch browser → wait for complete →
    classify.

    Args:
        action: one of "search", "engine-search", "search-instance",
            "search-site", "search-aggregate", "list-providers",
            "list-instances", "list-engines", "list-sites", "list-aggregates".
        query: search query for search-like actions; None for list actions.
        provider_id: provider for "search" (any non-empty provider id string).
        engine_id: engine for "engine-search" (any non-empty engine id string).
        instance_id: instance id for "search-instance".
        site_id: site-instance id for "search-site" (``site:<token>``).
        aggregate_id: aggregate-instance id for "search-aggregate" (``agg:<token>``).
        force_refresh: bypass cache for "search"/"search-instance"/"search-aggregate".
        max_results: optional result cap for "engine-search"/"search-site".
        extension_id: extension id (Chrome [a-p]{32} or Firefox email-style/{GUID}).
            Optional when bridge_url is set.
        chrome_path: explicit browser executable (auto-discovery otherwise).
        profile: optional profile name (--profile-directory for Chrome, -p for Firefox).
        timeout: Python-side total wait in seconds for the extension to
            complete the request (includes browser launch); bounds the
            local wait loop only. When timeout_ms is set, the wait is
            raised to ``max(timeout, clamped timeoutMs / 1000 + 1)`` so the
            local wait always outlives the extension-side budget.
        timeout_ms: optional extension-side action budget carried in the
            claim as ``timeoutMs`` (milliseconds, defensively clamped to
            [7000, 300000]). None omits the field and keeps the claim
            byte-identical to a default run. The
            ``timeout * 1000 >= timeout_ms + 1000`` invariant is enforced
            here (the local wait is raised as needed), so callers no longer
            have to maintain it themselves.
        cancel_event: optional threading.Event; when set before the
            extension completes, run_bridge stops waiting and raises
            BridgeError(kind=cancelled). Cleanup (loopback server shutdown,
            browser teardown) still runs before the error propagates.
        bridge_url: full bridge page URL base — only
            chrome-extension://{id}/bridge.html or moz-extension://{uuid}/bridge.html
            is accepted (no query/fragment/userinfo/port; format is validated
            here because the URL is combined with the bearer token fragment).
            When set, overrides URL construction from extension_id (needed
            for Firefox where the host is a per-install random UUID, not
            derivable from the gecko ID).
        browser_type: 'firefox' or 'chrome'; auto-detected from chrome_path if None.

    Returns:
        The validated bridge reply dict.

    Raises:
        BridgeError: on any structured failure. ``error.kind`` is one of
            the ERROR_* constants; ``error.message`` matches what the CLI
            prints; ``error.exit_status`` is the CLI exit code.
    """
    if timeout_ms is not None:
        # Enforce the documented wait/budget invariant here instead of trusting
        # every caller: when a small explicit budget is clamped up to the
        # extension's 7s floor, the local wait must be raised to match, or the
        # extension aborts the action first and the caller misreads a
        # slow-but-successful run as extension_did_not_complete.
        timeout = max(timeout, clamp_timeout_ms(timeout_ms) / 1000.0 + 1.0)
    if bridge_url:
        # bridge_url is authoritative (Firefox: host is a per-install random UUID),
        # but it is combined with the bearer token fragment (#v=1&p=...&t=token), so
        # its shape must be gated first: a mistyped or caller-controlled URL would
        # otherwise hand the token to an arbitrary page.
        if not is_valid_bridge_url(bridge_url):
            raise BridgeError(
                ERROR_INVALID_EXTENSION_ID,
                "bridge URL must be a chrome-extension://<id>/bridge.html or "
                "moz-extension://<uuid>/bridge.html URL without query, fragment, "
                "userinfo, or port; override with --bridge-url or JUSO_BRIDGE_URL",
                exit_status=2,
            )
    elif not extension_id or not EXTENSION_ID_RE.fullmatch(extension_id):
        raise BridgeError(
            ERROR_INVALID_EXTENSION_ID,
            "extension ID must be Chrome [a-p]{32}, Firefox email-style, or {GUID}; "
            "override with --extension-id or JUSO_EXTENSION_ID, or use --bridge-url",
            exit_status=2,
        )
    chrome = find_chrome(chrome_path)
    if not chrome:
        raise BridgeError(
            ERROR_CHROME_NOT_FOUND,
            (
                "no browser found; set --browser or JUSO_BROWSER_PATH "
                "to the executable that has Juso installed "
                f"(also check --profile or JUSO_BROWSER_PROFILE and --extension-id or JUSO_EXTENSION_ID)"
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
        site_id,
        aggregate_id,
        timeout_ms,
    )
    server: BridgeHTTPServer | None = None
    process: subprocess.Popen | None = None
    try:
        try:
            server = BridgeHTTPServer(("127.0.0.1", 0), make_handler(state))
        except OSError as error:
            # Loopback bind failure (sandboxed hosts may block socket binds) is not a
            # browser-launch failure: classify it separately instead of the misleading
            # chrome_launch_failed, and keep the original cause diagnosable.
            raise BridgeError(
                ERROR_WAIT_FAILED,
                f"loopback bridge server failed to start: {error}",
                exit_status=1,
            ) from error
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base_url = bridge_url or f"chrome-extension://{extension_id}/bridge.html"
        url = f"{base_url}#v=1&p={server.server_port}&t={token}"
        bt = browser_type or detect_browser_type(chrome)
        command = [chrome, url]
        if profile:
            if bt == "firefox":
                command.insert(1, "-p")
                command.insert(2, profile)
            else:
                command.insert(1, f"--profile-directory={profile}")
        try:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as error:
            # Only the browser launch raises browser-start OSError here; scoping the
            # handler to this call keeps every other OSError out of the
            # chrome_launch_failed classifier (and preserves the original traceback).
            raise BridgeError(
                ERROR_CHROME_LAUNCH_FAILED,
                f"{error}; {RECOVERY_HINT}",
                exit_status=1,
            ) from error
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
