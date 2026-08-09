#!/usr/bin/env python3
"""Local authenticated bridge to the Juso Chrome extension."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import argparse
import json
import math
import shutil
import subprocess
from typing import Any

import juso_bridge
from juso_bridge import *  # re-export bridge core (single source) so the wrapper namespace mirrors the old single file

# Windows 控制台默认 GBK，ensure_ascii=False 的 JSON 输出遇到非 GBK 字符（如 €）会
# UnicodeEncodeError。强制 stdout/stderr 用 UTF-8，保证搜索结果总能输出给 Agent。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8')

DEFAULT_EXTENSION_ID = "illmhdnglkjfcenboepdgopaeejdgoji"


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


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description="Search through the local Juso extension")
    argument_parser.add_argument("--extension-id", type=extension_id, default=os.environ.get("JUSO_EXTENSION_ID") or DEFAULT_EXTENSION_ID)
    argument_parser.add_argument("--chrome", default=os.environ.get("JUSO_CHROME_PATH"))
    argument_parser.add_argument("--profile", default=os.environ.get("JUSO_CHROME_PROFILE"))
    argument_parser.add_argument("--timeout", type=positive_timeout, default=os.environ.get("JUSO_TIMEOUT") or "40.0")
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
    commands.add_parser("list-instances")

    search_instance = commands.add_parser("search-instance")
    search_instance.add_argument("query", type=search_query)
    search_instance.add_argument("--instance-id", required=True)
    search_instance.add_argument("--force-refresh", action="store_true")
    return argument_parser


def run(args: argparse.Namespace) -> tuple[int, Any]:
    try:
        reply = juso_bridge.run_bridge(
            args.command,
            getattr(args, "query", None),
            provider_id=getattr(args, "provider", None),
            engine_id=getattr(args, "engine", None),
            instance_id=getattr(args, "instance_id", None),
            force_refresh=getattr(args, "force_refresh", False),
            max_results=getattr(args, "max_results", None),
            extension_id=args.extension_id,
            chrome_path=args.chrome,
            profile=args.profile,
            timeout=args.timeout,
        )
    except juso_bridge.BridgeError as error:
        return error.exit_status, {"ok": False, "error": {"kind": error.kind, "message": error.message}}
    return result_status(reply), reply


def main() -> int:
    args = parser().parse_args()
    status, result = run(args)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
