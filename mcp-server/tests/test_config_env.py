"""Environment configuration: required id, env parsing, stderr discipline."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from juso_search.config import DEFAULT_TIMEOUT, EXIT_CONFIG_ERROR, load_config

EXTENSION_ID = "a" * 32


def test_missing_extension_id_fails(capsys):
    with pytest.raises(SystemExit) as excinfo:
        load_config({})
    assert excinfo.value.code == EXIT_CONFIG_ERROR
    captured = capsys.readouterr()
    assert "JUSO_EXTENSION_ID" in captured.err
    assert captured.out == ""  # nothing on stdout


def test_blank_extension_id_fails(capsys):
    with pytest.raises(SystemExit) as excinfo:
        load_config({"JUSO_EXTENSION_ID": "   "})
    assert excinfo.value.code == EXIT_CONFIG_ERROR
    assert "JUSO_EXTENSION_ID" in capsys.readouterr().err


def test_defaults():
    config = load_config({"JUSO_EXTENSION_ID": EXTENSION_ID})
    assert config.extension_id == EXTENSION_ID
    assert config.chrome_path is None
    assert config.profile is None
    assert config.timeout == DEFAULT_TIMEOUT


def test_env_parsing_and_passthrough():
    config = load_config(
        {
            "JUSO_EXTENSION_ID": EXTENSION_ID,
            "JUSO_CHROME_PATH": r"C:\Chrome\Application\chrome.exe",
            "JUSO_CHROME_PROFILE": "Profile 1",
            "JUSO_TIMEOUT": "15.5",
        }
    )
    assert config.extension_id == EXTENSION_ID
    assert config.chrome_path == r"C:\Chrome\Application\chrome.exe"
    assert config.profile == "Profile 1"
    assert config.timeout == 15.5


def test_blank_optionals_become_none():
    config = load_config({"JUSO_EXTENSION_ID": EXTENSION_ID, "JUSO_CHROME_PATH": "", "JUSO_CHROME_PROFILE": "  "})
    assert config.chrome_path is None
    assert config.profile is None


def test_invalid_timeout_fails(capsys):
    with pytest.raises(SystemExit) as excinfo:
        load_config({"JUSO_EXTENSION_ID": EXTENSION_ID, "JUSO_TIMEOUT": "abc"})
    assert excinfo.value.code == EXIT_CONFIG_ERROR
    assert "JUSO_TIMEOUT" in capsys.readouterr().err


def test_nonpositive_timeout_fails(capsys):
    for raw in ("0", "-5"):
        with pytest.raises(SystemExit) as excinfo:
            load_config({"JUSO_EXTENSION_ID": EXTENSION_ID, "JUSO_TIMEOUT": raw})
        assert excinfo.value.code == EXIT_CONFIG_ERROR
        assert "JUSO_TIMEOUT" in capsys.readouterr().err


def test_non_finite_timeout_fails(capsys):
    for raw in ("inf", "nan", "infinity"):
        with pytest.raises(SystemExit) as excinfo:
            load_config({"JUSO_EXTENSION_ID": EXTENSION_ID, "JUSO_TIMEOUT": raw})
        assert excinfo.value.code == EXIT_CONFIG_ERROR
        assert "JUSO_TIMEOUT" in capsys.readouterr().err


def test_invalid_extension_id_fails(capsys):
    with pytest.raises(SystemExit) as excinfo:
        load_config({"JUSO_EXTENSION_ID": "garbage"})
    assert excinfo.value.code == EXIT_CONFIG_ERROR
    assert "JUSO_EXTENSION_ID" in capsys.readouterr().err


def test_config_passed_to_run_bridge(server, config, monkeypatch):
    """The resolved config flows into run_bridge exactly (extension_id etc.)."""
    with patch("juso_search.bridge_call.juso_bridge.run_bridge") as run_bridge:
        run_bridge.return_value = {"ok": True, "response": {"query": "q", "provider": "tavily", "results": []}, "cache": {"hit": False}}
        asyncio.run(server.call_tool("search", {"query": "q", "provider": "tavily"}))
    kwargs = run_bridge.call_args.kwargs
    assert kwargs["extension_id"] == EXTENSION_ID
    assert kwargs["chrome_path"] is None
    assert kwargs["profile"] is None
    assert kwargs["timeout"] == DEFAULT_TIMEOUT


def test_main_missing_env_exits_nonzero(capsys, monkeypatch):
    monkeypatch.delenv("JUSO_EXTENSION_ID", raising=False)
    from juso_search.__main__ import main

    with pytest.raises(SystemExit) as excinfo:
        main([])
    assert excinfo.value.code == EXIT_CONFIG_ERROR
    captured = capsys.readouterr()
    assert "JUSO_EXTENSION_ID" in captured.err
    assert captured.out == ""


def test_main_version_flag(capsys):
    from juso_search.__main__ import main

    with pytest.raises(SystemExit) as excinfo:
        main(["--version"])
    assert excinfo.value.code == 0
    assert "juso-search" in capsys.readouterr().out
