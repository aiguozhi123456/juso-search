#!/usr/bin/env python3
"""Local authenticated bridge to the Juso extension."""

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
        raise argparse.ArgumentTypeError("extension ID must be Chrome [a-p]{32}, Firefox email-style, or {GUID}")
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
    argument_parser.add_argument("--browser", default=os.environ.get("JUSO_BROWSER_PATH") or os.environ.get("JUSO_CHROME_PATH"))
    argument_parser.add_argument("--profile", default=os.environ.get("JUSO_BROWSER_PROFILE") or os.environ.get("JUSO_CHROME_PROFILE"))
    # None 哨兵 = 未显式传参；JUSO_BRIDGE_URL 在 run() 里单独解析（非空才算显式）。
    # 显式性判定必须留在 argparse 层而非字符串特征（"://"）：内建默认值经 gen_skills
    # 戳印后本身是 chrome-extension://<id>/bridge.html，字符串判定对默认值永真，
    # 曾令 --extension-id / JUSO_EXTENSION_ID 被权威的 bridge_url 静默忽略。
    argument_parser.add_argument("--bridge-url", default=None)
    # None 哨兵 = 未显式配置（无 --timeout 且 JUSO_TIMEOUT 未设/为空）：run() 回退
    # juso_bridge 默认等待并省略 timeoutMs（claim 字节不变）；非空 env 值仍经
    # positive_timeout 在 parse 阶段校验。
    argument_parser.add_argument("--timeout", type=positive_timeout, default=os.environ.get("JUSO_TIMEOUT") or None)
    commands = argument_parser.add_subparsers(dest="command", required=True)
    search = commands.add_parser("search")
    search.add_argument("query", type=search_query)
    search.add_argument("--provider", required=True)
    search.add_argument("--force-refresh", action="store_true")
    engine_search = commands.add_parser("engine-search")
    engine_search.add_argument("query", type=search_query)
    engine_search.add_argument("--engine", required=True)
    engine_search.add_argument("--max-results", type=int, choices=range(1, 21))
    commands.add_parser("list-providers")
    commands.add_parser("list-instances")
    commands.add_parser("list-engines")
    commands.add_parser("list-sites")
    commands.add_parser("list-aggregates")

    search_instance = commands.add_parser("search-instance")
    search_instance.add_argument("query", type=search_query)
    search_instance.add_argument("--instance-id", required=True)
    search_instance.add_argument("--force-refresh", action="store_true")

    search_site = commands.add_parser("search-site")
    search_site.add_argument("query", type=search_query)
    search_site.add_argument("--site-id", required=True)
    search_site.add_argument("--max-results", type=int, choices=range(1, 21))

    search_aggregate = commands.add_parser("search-aggregate")
    search_aggregate.add_argument("query", type=search_query)
    search_aggregate.add_argument("--aggregate-id", required=True)
    search_aggregate.add_argument("--force-refresh", action="store_true")
    return argument_parser


def run(args: argparse.Namespace) -> tuple[int, Any]:
    # bridge_url 仅在显式提供（--bridge-url flag 或非空 JUSO_BRIDGE_URL env）时透传；默认路径
    # 传 None，由 run_bridge 从 extension_id 构造 chrome-extension://<id>/bridge.html ——
    # 显式覆盖的 --extension-id（自定义构建）因此保持有效。格式校验统一在 run_bridge 入口。
    raw_bridge_url = args.bridge_url if args.bridge_url is not None else os.environ.get("JUSO_BRIDGE_URL")
    bridge_url = (raw_bridge_url.strip() or None) if raw_bridge_url else None
    # An explicit timeout (flag or non-empty JUSO_TIMEOUT) doubles as the
    # extension-side budget; the None sentinel keeps the default-path claim
    # free of timeoutMs (byte-identical to before). Values below the
    # extension's 7s floor are reconciled inside run_bridge (the local wait is
    # raised to outlive the clamped claim budget), so both sides share one
    # consistent budget.
    timeout = args.timeout if args.timeout is not None else juso_bridge.DEFAULT_TIMEOUT_SECONDS
    timeout_ms = juso_bridge.clamp_timeout_ms(args.timeout * 1000) if args.timeout is not None else None
    try:
        reply = juso_bridge.run_bridge(
            args.command,
            getattr(args, "query", None),
            provider_id=getattr(args, "provider", None),
            engine_id=getattr(args, "engine", None),
            instance_id=getattr(args, "instance_id", None),
            site_id=getattr(args, "site_id", None),
            aggregate_id=getattr(args, "aggregate_id", None),
            force_refresh=getattr(args, "force_refresh", False),
            max_results=getattr(args, "max_results", None),
            extension_id=args.extension_id,
            chrome_path=args.browser,
            profile=args.profile,
            timeout=timeout,
            timeout_ms=timeout_ms,
            bridge_url=bridge_url,
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
