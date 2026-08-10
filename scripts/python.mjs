#!/usr/bin/env node
/* global console, process */
// Cross-platform Python 3 launcher for npm scripts.
//
// No single command name works on all 3 OSes: on Windows `python3` is the
// Microsoft Store stub (prints nothing for `--version`) while `python` /
// `py -3` are real; on macOS/Linux `python3` is real and `python` often
// missing. Each candidate is probed with `--version` and accepted only if
// the output matches /^Python 3\.\d+/m, filtering out the Store stub.

import { spawn } from "node:child_process";

const CANDIDATES = [["python3"], ["py", "-3"], ["python"]];
const PY3 = /^Python 3\.\d+/m;

const probe = (cmd) =>
  new Promise((resolve) => {
    const child = spawn(cmd[0], [...cmd.slice(1), "--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", () => resolve(false)); // ENOENT → next candidate
    child.on("close", () => resolve(PY3.test(out)));
  });

let interpreter = null;
const tried = [];
for (const cmd of CANDIDATES) {
  if (await probe(cmd)) {
    interpreter = cmd;
    break;
  }
  tried.push(cmd.join(" "));
}

if (!interpreter) {
  console.error(
    `error: no usable Python 3 interpreter found (tried: ${tried.join(", ")})`,
  );
  process.exitCode = 127;
} else {
  const child = spawn(
    interpreter[0],
    [...interpreter.slice(1), ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env },
  );
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
  child.on("error", (err) => {
    console.error(
      `error: failed to launch ${interpreter.join(" ")}: ${err.message}`,
    );
    process.exitCode = 127;
  });
}
