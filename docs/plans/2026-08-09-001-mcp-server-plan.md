---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: orchestrator
execution: code
title: "MCP Server (pip-distributed) — Plan"
type: feat
date: 2026-08-09
---

# MCP Server (pip-distributed) — Plan

## Goal Capsule

**目标**：为 Juso 搜索提供一个**标准 MCP server**，以 **pip 包**形式分发，让 MCP 原生客户端（Claude Desktop、Cursor、Cline、Claude Code 等）经各自 `mcp.json` 即可调用扩展的搜索能力——无需安装配套 Agent Skill。它与现有 CLI skill **互斥并存**（两套独立方案：用 skill 就不装 MCP，反之亦然）。所有配置经 `mcp.json` 的 `env`/`args` 注入；扩展侧 Agent Bridge 协议、信任检查、双层 opt-in 门控、BYOK 边界**一行不改**。

同时把现有 CLI skill 与新 MCP server 共享的 **bridge-client 核心**抽成单一源头模块 `juso_bridge`，经 **build-time 单源 + drift 锁**同时供给：skill（drop-in zip 内 vendor 为 sibling 文件）、prod/dev 发布目录、MCP pip 包——结构性根治"两套实现各自维护"导致的 drift（已被 prod/dev skill 双胞胎咬过 5 次）。

**权威层级**：本计划由 orchestrator 产生（无上游 brainstorm）。输入：决策对话、@explorer 侦查（`ses_01b8b7246ffeYsMhfEb1ejxoaQ` —— skill/bridge/gateway/drift 全量映射）、@librarian MCP 协议研究（`ses_01b82778bffe2wARHp3VmbjPuF` —— 2026-07-28 spec 现状）。

**停止条件**：`juso_bridge` 单源模块（含程序化 `run_bridge()` API）就绪；CLI skill 改造为 `import` sibling 后行为不变且 drop-in 仍可用；gen_skills 扩展产出 prod/dev + MCP 三处 vendor 副本；MCP pip 包（基于官方 `mcp` SDK v2）就绪并暴露 5 个工具；drift 锁断言四处 `juso_bridge.py` 字节相等；`npm run typecheck && npm run lint && npm test && npm run test:python && npm run test:mcp && npm run build` 全绿；手动 QA（AE1-AE6）通过——至少一个 legacy-era 客户端（Claude Desktop）与一个 MCP 工具调用端到端跑通搜索。

**执行画像**：Python 侧（`juso_bridge` 抽取 + MCP server + drift 锁，套现有 `test:python`/unittest 与 MCP 包内 pytest）；TS 侧（packager zip 多文件 + 可选 Options 复制 MCP 配置按钮，复用 `packageAgentSkill` / `triggerDownload` 先例）；文档（新 MCP 指南 + 扩展 bridge 架构 doc + README）。不引入新的持久 daemon；bridge 协议、worker 信任、key 隔离均不动。

**Product Contract 保全**：无上游产品契约。本计划同时定义 WHAT 和 HOW。两处对现有产品的**承袭而非变更**：(1) Agent Bridge 的能力面（5 action）、安全模型、门控完全不动——MCP server 只是 bridge 的又一个客户端；(2) CLI skill 的对外行为与分发模型（drop-in zip）不变，仅内部结构由单文件拆为"CLI wrapper + sibling `juso_bridge`"。

---

## Product Contract

### 问题与用户

- **问题**：今天只有"跑配套 Python skill"的 agent 能调 Juso 搜索。MCP 已是 AI 工具集成的**事实标准**，Claude Desktop / Cursor / Cline / Claude Code 原生说 MCP——它们无法直接用 CLI skill，缺一条标准接入路径。
- **用户**：
  1. 用 Claude Desktop / Cursor / Cline 等 MCP 原生客户端、想把 Juso 搜索当工具调的用户——不想 clone repo、不想拷 skill 文件、想要 `pip install` + 一段 `mcp.json` 就能用。
  2. 维护者——面对"skill 与 MCP server 若各自实现 bridge-client"必然 drift 的前景（与已记录的 prod/dev 双胞胎 5 缺陷同类）。
- **痛点**：MCP 原生客户端无标准接入；若新增独立 MCP 实现又会引入第二份 bridge 协议副本。
- **价值主张**：标准 MCP server（pip 分发）让一整类 MCP 客户端开箱即用；同时 `juso_bridge` 单源 + drift 锁把 bridge 协议契约收敛到**一处定义、多处消费、测试锁死**。

### 关键设计取舍（用户已拍板）

- **pip 分发**，标准 MCP（stdio），客户端用各自 `mcp.json` 接入。**与 skill 互斥并存**（二选一，不互相依赖）。
- **配置全部经 `mcp.json`**（`command`/`args`/`env`）：扩展 ID、chrome 路径、profile、timeout 均由 `env` 注入，**不做构建期 variant 盖章**（区别于 skill 的 prod/dev ID 烙印）。
- **共享机制 = build-time 单源 + drift 锁**（非 runtime import，非完全重复实现）：`juso_bridge` 为唯一源头，gen_skills 把它原样 vendor 进 skill 模板与 MCP 包；测试断言各副本字节相等。skill 的 drop-in zip 模型零改动。
- **模块名 `juso_bridge`**（从初拟的 `pybridge` 改名——`pybridge` 与无关的桥牌项目冲突）。实现期若发现更合适的命名可一并调整 generator 与 drift 测试。

### Requirements

- **R1. 标准合规的 MCP server（stdio）**：基于官方 `mcp` Python SDK v2（`mcp>=2.0,<3`），目标协议版本 `2026-07-28`、**dual-era** 服务（同时应答现代 `_meta`+`server/discover` 与 legacy `initialize`）。不手写 JSON-RPC。
- **R2. 工具面 = bridge 的 5 个 action**：`search`、`engine-search`、`search-instance`、`list-providers`、`list-instances`——与 CLI skill 子命令一一对应，参数/返回沿用 bridge 的归一化模型。每个 `tools/call` 内部仍是"启动 Chromium → `bridge.html` → claim/complete"短命循环，不引入常驻进程。
- **R3. 配置经 `mcp.json` env**：`JUSO_EXTENSION_ID`（必需）、`JUSO_CHROME_PATH` / `JUSO_CHROME_PROFILE` / `JUSO_TIMEOUT`（可选）。无 `mcp.json` 等价物的 CLI flag——MCP 路径只读 env。
- **R4. bridge 协议与安全模型不动**：`AGENT_BRIDGE_PROTOCOL`、claim/complete/abort、`isTrustedBridgeSender`、loopback-only、`agentBridgeEnabled` 总开关 + `engineSearchEnabled` 子开关（默认关）、BYOK key 仅 worker 读取——MCP server 是 bridge 的客户端，**不触碰 key、不绕过门控**。
- **R5. `juso_bridge` 单源 + drift 锁**：新建 `public/agent-skill/scripts/juso_bridge.py` 为 bridge-client 核心的**唯一源头**（含程序化 `run_bridge()` API）。gen_skills 把它原样渲染进 `skills/juso-search/scripts/`、`skills/juso-search-dev/scripts/`，并原样拷进 `mcp-server/juso_search/`。drift 测试断言四处字节相等。
- **R6. CLI skill 行为不变**：`public/agent-skill/scripts/juso_search.py` 改造为"薄 CLI wrapper（argparse/run/main/`DEFAULT_EXTENSION_ID`）+ `import` sibling `juso_bridge`"。对外子命令、参数、退出码、输出 JSON、drop-in zip 可用性均不变。
- **R7. MCP 包独立可装**：`mcp-server/` 含 `pyproject.toml`（console_script `juso-search`、依赖 `mcp>=2.0,<3`、Python ≥3.10）、`juso_search/` 包源、tests。`pip install` 后 `mcp.json` 指向 `juso-search` 即用。
- **R8. 安全不变 + 文档**：不因 MCP 是"新能力"放宽门控；文档说明 MCP 路径继承 bridge 的两层 opt-in（启用 bridge 仍是前置）。新 MCP 指南 + 扩展 bridge 架构 doc（含对"long-lived service"说明的 MCP 澄清）+ README Agent 章节补 MCP 备选。

### Actors / Key Flows

- **A1. MCP 客户端**（Claude Desktop / Cursor / Cline / Claude Code）：按 `mcp.json` spawn `juso-search` 进程（stdio），发 `initialize`（legacy）或直接 `server/discover`/`tools/call`（modern）。
- **A2. MCP server**（`juso-search` 进程）：读 env 配置 → 用官方 SDK 应答协议层 → 每个 `tools/call` 调 `juso_bridge.run_bridge(...)`。
- **A3. `juso_bridge`**：起 loopback HTTP server → 构造 claim → 启动 Chromium 打开 `chrome-extension://<id>/bridge.html#v=1&p=<port>&t=<token>` → 等 complete → 校验/分类返回。
- **A4. 扩展 worker**（不动）：`agentBridgeClaim` handler 经 `isTrustedBridgeSender` + 门控 → `runAgentBridge` POST claim → dispatch 到 gateway handler → POST complete。
- **F1. 搜索流（MCP）**：客户端 `tools/call {search}` → SDK → `bridge_call` → `run_bridge(action='search', query, provider_id, extension_id, ...)` → 启 Chromium → bridge claim/complete → 返回 `SearchReply` → 包成 `CallToolResult(content=[TextContent(...)], structuredContent=...)`。
- **F2. engine-search 流**：同上，action=`engine-search`，engine ∈ `ENGINES`；受 `engineSearchEnabled` 子门控（关则 worker 返回 `extract-failed`，server 透传为工具结果）。

### Acceptance Examples

- **AE1（pip 装载 + legacy 客户端）**：`pip install` 本地 `mcp-server/` → Claude Desktop `claude_desktop_config.json` 配 `juso-search` + `JUSO_EXTENSION_ID` → 扩展 Options 开启 Agent Bridge → 客户端调 `search` 工具 → 返回归一化结果。
- **AE2（现代客户端 / dual-era）**：对一个发 `server/discover` 的客户端（或 SDK 自测），server 返回 `supportedVersions` 含 `2026-07-28`；`tools/list` 返回 5 工具且含 `resultType`/`ttlMs`/`cacheScope`。
- **AE3（drop-in skill 不破坏）**：`npm run build` 产出的 skill zip 解压含 `juso_search.py` + `juso_bridge.py`；agent 加载后 `python scripts/juso_search.py search ...` 行为与改造前一致。
- **AE4（drift 锁）**：手工改任一处 `juso_bridge.py` 副本 → `npm run test:python` 红，指出偏离处；从源头 `public/agent-skill/scripts/juso_bridge.py` 重生成 → 绿。
- **AE5（配置经 env）**：`JUSO_EXTENSION_ID` 缺失 → server 启动即结构化失败（stderr + 非零退出），不静默用错误 ID；`JUSO_CHROME_PATH` 指向 Edge → 复用 skill 既有的非默认 Chromium 接受逻辑。
- **AE6（门控继承）**：扩展未开 Agent Bridge → `tools/call` 经 bridge claim 超时 → server 返回可读错误（复用 skill 的 `extension_did_not_claim`/`extension_did_not_complete` 分类）。

---

## Key Technical Decisions

### KTD1. 用官方 `mcp` Python SDK v2（`mcp>=2.0,<3`），不手写 JSON-RPC

MCP `2026-07-28` spec（2026-07-28 发布，本计划撰写日仅 12 天前）是"自发布以来最大修订"：**移除 `initialize` 握手**、新增**必需**的 `server/discover`、每请求 `_meta` 携带 protocolVersion、结果必需 `resultType`、list 类响应需 `ttlMs`/`cacheScope`、错误码重排（`UnsupportedProtocolVersion` `-32004`→`-32022`）。stdio 传输本身未变（仍是换行分隔 JSON-RPC 2.0），但应用层要求 server **dual-era**：现代客户端不发 `initialize`，而 Claude Desktop/Cursor/Cline 仍处 legacy-era 且**无公布切换日期**。

官方 SDK v2（`MCPServer`，原 `FastMCP` 改名）**开箱 dual-era**——同一 server 既答 2026-era 的 `_meta`+`server/discover`，又答 2025-era 的 `initialize`，零配置；并代管换行分帧、stdio 生命周期、`notifications/cancelled`、协议版本协商。手写在 2025 年尚可（协议约 1000 行）；2026-08 起意味着重实现一个**带版本、dual-era、且处于活跃迁移期**的协议。MCP 共同作者 David Soria Parra 原话："If you built your own implementation, it's going to be a lot of uplift to make this correct."

**否决"手写 stdlib JSON-RPC"**：仅在"必须零依赖"时才考虑；本 MCP 包是 pip 分发、本就允许依赖，故 SDK 是更稳选择。skill 仍保持 stdlib-only（drop-in zip 约束），SDK 依赖只出现在 MCP 包。

### KTD2. `juso_bridge` build-time 单源 + drift 锁（sibling-file vendor），非 runtime import

bridge-client 核心（loopback server + chromium launcher + claim/complete + reply 校验）今天全在 `public/agent-skill/scripts/juso_search.py`，且与 MCP server 所需**逐字节相同**。共享方式三选一：

- **(选定) build-time 单源 + drift 锁**：`public/agent-skill/scripts/juso_bridge.py` 为唯一源头；gen_skills 原样渲染进 prod/dev skill 目录与 MCP 包。skill 的 `juso_search.py` `import` sibling（`sys.path` 插入同目录）。drift 测试断言四处副本字节相等。**skill drop-in zip 模型零改动**（zip 多一个 sibling 文件，agent 以文件夹加载，调用入口不变），匹配现有 `gen_skills` 哲学与"模板即源头"既定模式（见 bundle-plan KTD1）。
- *(否决) runtime import 真包*：`pybridge` 变 pip 包，skill 需先 `pip install`——破坏 drop-in zip，与"两套独立方案"相悖。
- *(否决) skill zip 内嵌子目录 + 运行期 import 子包*：保持 drop-in 但 zip 变复杂、gen 机制变重，收益不抵成本。
- *(否决) gen 期拼接合并成单文件*：skill 保持单文件最干净，但拼接 Python 模块（去重 import、避免名字冲突）脆弱，且 drift 锁从"整文件字节相等"退化为"片段相等"更难测。

`DEFAULT_EXTENSION_ID` 等 CLI/config 常量**留在** `juso_search.py`（wrapper），不进 `juso_bridge`——bridge 核心不关心默认 ID，ID 由调用方传入。

### KTD3. `juso_bridge` 暴露程序化 `run_bridge()` API；CLI 与 MCP 共用

当前 `juso_search.py` 的 `run(args)` 读 `argparse.Namespace`，与 CLI 耦合，MCP（无 argparse）无法复用。抽取时必须把**编排逻辑**解耦为程序化入口：

```python
# juso_bridge.py —— 伪代码示意（方向性，非实现规约）
def run_bridge(action, query, *, provider_id=None, engine_id=None,
               instance_id=None, force_refresh=False, max_results=None,
               extension_id, chrome_path=None, profile=None,
               timeout=40.0) -> dict: ...   # 返回 bridge reply dict（或抛结构化错误）
```

CLI 的 `run(args)` 退化为"解析 args → 调 `run_bridge(...)`"；MCP 的 `bridge_call` 同样调 `run_bridge(...)`。这是"真正共享"的前提——否则两边各写一遍编排，drift 锁只能护住协议常量，护不住编排逻辑。

### KTD4. 目标 `2026-07-28`、dual-era 服务（SDK 默认）

客户端切换无公布日期，用户主机是 era 混合。SDK v2 默认即此（同时服务 `2026-07-28` 与 `2025-11-25`）。**不**只盯 `2026-07-28`（对 legacy 客户端隐形——`initialize` 对 modern-only server 是未知方法），**不**只盯 legacy（数月内即过时）。

### KTD5. 模块名 `juso_bridge`；MCP 包名 `juso-search`

`pybridge` 撞名无关桥牌项目。`juso_bridge` 项目内命名空间清晰、在 skill zip 内与 MCP 包内均无冲突。MCP pip 包名 `juso-search`（console_script 同名）。两者均实现期可调（联动 generator/drift 测试）。

### KTD6. MCP server 继承 bridge 门控，不新增能力开关

MCP server 是 bridge 的**又一个客户端**，不引入独立能力开关。能否调用仍由扩展侧 `agentBridgeEnabled`（总开关）+ `engineSearchEnabled`（engine-search 子开关）决定——与 CLI skill 完全对等。门控默认关（上架合规），用户须在 Options 开启 bridge 才能用 MCP（AE6）。这保持 R10 安全不变（承袭 bundle-plan）。

---

## Alternatives Considered

- **把扩展本身做成 MCP server**：MV3 service worker 无法开监听 socket、会被回收——架构上不成立。MCP server 必须是独立进程（此处的 `juso-search`），经 bridge 调扩展。
- **runtime import `pybridge` 真包**：见 KTD2，破坏 skill drop-in。
- **手写 stdlib MCP（零依赖）**：见 KTD1，2026-08 起不划算；仅在"强制零依赖"时回退。
- **MCP server 内置 native messaging / 持久 daemon**：与既有架构决策一致地**排除**（见 `agent-skill-localhost-capability-bridge.md` When to Apply）。stdio server 由客户端按 session spawn/销毁，每次 `tools/call` 仍是短命 bridge 循环——**不是**多客户端常驻服务。
- **从扩展 Options 自动写 `mcp.json`**：各客户端配置路径/格式不一（Claude Desktop 无 `${VAR}` 插值、Cursor 用 `${env:}`、VS Code 用 `servers` 键、Codex 用 TOML），自动写易错且越权。本计划改为提供**可复制的配置片段 + 扩展 ID**，用户自行粘贴。（可选增强：Options 加"复制 MCP 配置"按钮，见 IU5 note。）

---

## Implementation Units

> **并行派工边界**：IU1（`juso_bridge` 单源）是地基，必须先成。IU2（skill+gen 改造）与 IU3（MCP 包）写作用域不重叠（`public/agent-skill/`+`scripts/`+`skills/`+`lib/agent-skill-packager.ts`+`tests/scripts/` vs `mcp-server/`），可于 IU1 后并行。IU4（drift 锁）依赖 IU1/IU2/IU3 全在。IU5（文档）依赖 IU3。

### IU1: 抽取 `juso_bridge` 单源模块（含程序化 API）

**Goal**：把 bridge-client 核心从 `public/agent-skill/scripts/juso_search.py` 抽出为 `public/agent-skill/scripts/juso_bridge.py`，作为唯一源头；CLI 与 MCP 均可程序化调用。

**Files**：
- 新建 `public/agent-skill/scripts/juso_bridge.py`
- 改 `public/agent-skill/scripts/juso_search.py`（瘦身为 CLI wrapper，见 IU2）

**Approach**：
- 迁入 `juso_bridge.py`：`PROTOCOL`、`MAX_BODY_BYTES`、`SOCKET_TIMEOUT_SECONDS`、`PROVIDERS`、`ENGINES`、`EXTENSION_ID_RE`、`RECOVERY_HINT`；reply 校验器 `is_search_reply`/`is_provider_list_reply`/`is_instance_list_reply`/`is_engine_search_reply`/`is_valid_reply`/`result_status`；`BridgeState`、`wait_failure`、`BridgeHTTPServer`、`make_handler`、`make_claim`；浏览器发现 `chrome_candidates`/`find_chrome`。
- **新增程序化编排入口 `run_bridge(...)`**（KTD3 伪代码）：把现 `run()` 的"校验 ID → find chrome → 起 server → 构 claim → 启 Chromium → 等 complete → 分类 → cleanup"流程参数化，返回 reply dict 或抛结构化错误（复用现有 `chrome_not_found`/`invalid_extension_id`/`extension_did_not_claim`/`extension_did_not_complete` 分类）。
- **不迁** `DEFAULT_EXTENSION_ID`（留 CLI wrapper）、argparse 类型校验器（`extension_id`/`positive_timeout`/`search_query`，属 CLI 层）、`parser()`/`main()`。
- stdlib-only，无新依赖。

**Test scenarios**（`tests/scripts/test_juso_bridge.py`，新建，套 `test:python` unittest 模式，直接 import `public/agent-skill/scripts/juso_bridge.py`）：
- `run_bridge` 程序化调用：mock loopback server + chromium 启动 → 返回正确 reply dict（search/engine-search/list-providers/list-instances/search-instance 各一）。
- `run_bridge` 错误分类：无效 extension_id → `invalid_extension_id`；chrome 不存在 → `chrome_not_found`；claim 超时 → `extension_did_not_claim`；claim 成功但 complete 超时 → `extension_did_not_complete`。
- reply 校验器：与现有 `test_juso_search.py` 同覆盖（确保抽取行为不变）。
- `PROVIDERS`/`ENGINES`/`PROTOCOL` 常量就位（drift 锁的前置）。

---

### IU2: CLI skill 改造为 `import` sibling + gen_skills 扩展 + packager 多文件

**Goal**：skill 的 `juso_search.py` 改为薄 CLI wrapper（`import` sibling `juso_bridge`）；gen_skills 把 `juso_bridge.py` 作为**共享/不 patch 文件**渲染进 prod/dev 并拷进 MCP 包；packager zip 含两文件。对外行为不变。

**Files**：
- 改 `public/agent-skill/scripts/juso_search.py`（瘦身 wrapper：argparse 校验器 + `parser()` + `run(args)` 调 `juso_bridge.run_bridge(...)` + `main()` + `DEFAULT_EXTENSION_ID` + sibling import 引导）
- 改 `scripts/gen_skills.py`：`juso_bridge.py` 入 `shared/unpatched` 集合（与 `reference/` 同类）；新增"拷贝 `juso_bridge.py` → `mcp-server/juso_search/juso_bridge.py`"步骤（`--check` 同样比对）
- 改 `lib/agent-skill-packager.ts`：`fetch` 增加 `agent-skill/scripts/juso_bridge.py`，zip 内同 `scripts/` 子结构（`agent-skill-packager.ts:62-70` 现仅取 SKILL.md + juso_search.py）
- 改 `tests/scripts/test_juso_search.py`：import 路径适配（SCRIPT 旁的 sibling）；确保 CLI 行为用例全绿（行为不变证明）
- 改 `skills/juso-search/SKILL.md` + `skills/juso-search-dev/SKILL.md`：安装说明补"含 `juso_bridge.py`"（frontmatter 不变）
- 再生 `skills/juso-search/` + `skills/juso-search-dev/`（`npm run gen-skills`）

**Approach**：
- sibling import 引导（wrapper 顶部）：
  ```python
  import os, sys
  sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
  import juso_bridge
  ```
- `gen_skills.py` 现已按 `reference/` 为共享文件处理；把 `scripts/juso_bridge.py` 纳入同一"shared/unpatched"通路（无 `DEV_PATCH_*`）。新增 MCP 包拷贝目标与对应 `--check` 比对。
- packager zip 顶层文件夹仍统一 `juso-search/`，内含 `SKILL.md` + `scripts/juso_search.py` + `scripts/juso_bridge.py` + `reference/`。

**Test scenarios**：
- `test_juso_search.py` 全绿（行为不变）：5 子命令、claim/complete/abort HTTP、reply 校验、CLI 优先级、`run()` 生命周期。
- `test_gen_skills.py` 扩展：`juso_bridge.py` 在 prod/dev 字节相等；`mcp-server/juso_search/juso_bridge.py` == 源头；无占位符残留；dev 与 prod 仅在既定维度差。
- packager round-trip（`tests/agent-skill-packager.test.ts` 扩展）：生成的 zip 解压含两 `.py`；结构/顶层文件夹/盖章 ID 不变。

---

### IU3: MCP server pip 包（官方 SDK v2）

**Goal**：`mcp-server/` 独立可装，基于 `mcp>=2.0,<3`，stdio，暴露 5 工具，每个 `tools/call` 经 `juso_bridge.run_bridge(...)` 跑一次 bridge 循环。

**Files**：
- 新建 `mcp-server/pyproject.toml`（name `juso-search`，console_script `juso-search = "juso_search.__main__:main"`，dep `mcp>=2.0,<3`，`requires-python = ">=3.10"`，build-system setuptools）
- 新建 `mcp-server/juso_search/__init__.py`、`__main__.py`、`server.py`、`bridge_call.py`、`config.py`
- `mcp-server/juso_search/juso_bridge.py`（gen_skills 产出的 vendor 副本；**勿手改**——drift 锁守卫）
- 新建 `mcp-server/tests/`（pytest）
- 新建 `mcp-server/README.md`（安装、`mcp.json` 片段、env 表、排错）

**Approach**：
- `config.py`：从 env 读 `JUSO_EXTENSION_ID`（缺则启动失败、stderr + 非零退出）、`JUSO_CHROME_PATH`/`JUSO_CHROME_PROFILE`/`JUSO_TIMEOUT`（可选，默认沿用 `juso_bridge` 既有默认）。
- `server.py`：`from mcp.server import MCPServer`；注册 5 工具，`inputSchema` 对齐 bridge 参数（provider_id ∈ `PROVIDERS`、engine_id ∈ `ENGINES`、instance_id 形如 `inst:<providerId>:<uuid>`、max_results 1–20）；annotations 全 `readOnlyHint=true`（搜索不改状态）、`openWorldHint=true`（触网）；`MCPServer("Juso Search").run()` 默认 stdio。
- `bridge_call.py`：把 MCP 工具参数映射到 `juso_bridge.run_bridge(...)`；把返回的 reply dict 包成 `CallToolResult`：成功 → `content=[TextContent(json)]` + `structuredContent=<reply>`（满足 `2026-07-28` 的"structured + TextContent 序列化"向后兼容）；bridge 失败 → `is_error=True` 且可读 message（复用 `juso_bridge` 错误分类）。
- **stdout 纪律**（2026-07-28 关键 gotcha）：server 进程内**严禁**任何 `print` 到 stdout——所有日志/诊断走 stderr（SDK 已遵循，自查 `bridge_call`/`config` 无 stray 输出）。
- 生命周期：stdin EOF 即退出（SDK 默认）；处理 `notifications/cancelled` 中止在途 `run_bridge`（透传 abort 给 `juso_bridge` 的 signal/deadline）。

**Test scenarios**（`mcp-server/tests/`，pytest，mock `juso_bridge.run_bridge`）：
- `test_tools_list`：返回 5 工具；名称/`inputSchema`/annotations 正确；含 `resultType`/`ttlMs`/`cacheScope`（2026-07-28 wire）。
- `test_call_dispatch`：每个工具 `tools/call` → `run_bridge` 被以正确 `action`/参数调用一次；返回 `CallToolResult` 结构正确（成功/`is_error`）。
- `test_config_env`：`JUSO_EXTENSION_ID` 缺失 → 启动结构化失败；各 env 正确解析并传入 `run_bridge`。
- `test_stdout_clean`：跑一轮 `tools/list`+`tools/call`，捕获 stdout 仅含合法 JSON-RPC 换行消息（无 stray）。
- `test_dualera_handshake`（集成，可标 slow）：用 SDK client 分别以 legacy `initialize` 与 modern `server/discover` 连接 → 均成功；`supportedVersions` 含 `2026-07-28`。
- *手动*（AE1/AE2）：`pip install -e mcp-server/` + Claude Desktop 真实调用 `search` 端到端；一个 modern 客户端走 `server/discover`。

---

### IU4: drift 锁（四处 `juso_bridge.py` 字节相等）

**Goal**：结构性根治"bridge 协议多副本 drift"——任一副本偏离源头即测试红。

**Files**：
- 新建 `tests/scripts/test_juso_bridge_drift.py`（套现有 `test_gen_skills.py` importlib 模式）
- 改 `package.json`：`test:python` 增含新测试；新增 `"test:mcp": "pytest mcp-server/tests"`（或 `python -m pytest`）；`gen-skills` 不变

**Approach**：
- 断言四处字节相等：`public/agent-skill/scripts/juso_bridge.py`（源）== `skills/juso-search/scripts/juso_bridge.py` == `skills/juso-search-dev/scripts/juso_bridge.py` == `mcp-server/juso_search/juso_bridge.py`。
- 复用 `gen_skills.check()` 既有能力，扩展至含 MCP 目标；失败信息指明偏离文件。
- MCP 包测试与 python unittest 并列，统一由 npm 入口暴露（`test:python` + `test:mcp`）。

**Test scenarios**：
- `test_juso_bridge_single_source`：四处字节相等。
- `test_gen_skills_check_includes_mcp_target`：`gen_skills.check()` 覆盖 MCP 拷贝目标。
- 回归：手工改任一副本 → 红；`npm run gen-skills` 再生 → 绿（AE4）。

---

### IU5: 文档

**Goal**：MCP server 可发现、可装、可排错；bridge 架构 doc 收录 MCP 变体并澄清"非常驻服务"。

**Files**：
- 新建 `docs/mcp-server.md`（或 `docs/mcp-server/index.md`）：是什么、`pip install juso-search`、各客户端 `mcp.json` 片段（Claude Desktop / Cursor / Cline / Claude Code）、env 表、如何找扩展 ID（`chrome://extensions`）、前置（Options 开 Agent Bridge）、排错（chrome 路径、claim 超时、dual-era）。
- 改 `docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md`：新增"MCP server 变体"小节；**澄清 When to Apply（现 line 152）**——stdio MCP server 由客户端按 session spawn/销毁、每次 `tools/call` 仍是短命 bridge 循环，**不属**"long-lived multi-client local service"，故与该 pattern 兼容；记录 `juso_bridge` 单源 + drift 锁为本 pattern 的延伸。
- 改 `README.md` + `README.en.md`：`### 本地 AI 智能体`/`### Local AI Agents` 章节补"MCP server（pip）备选"，与 skill 并列；`## 智能体接口与边界` 补一句 MCP 复用同一 bridge 边界。

**Note（可选增强，非本计划必做）**：Options 的 Agent Bridge 区块加"复制 MCP 配置"按钮（输出含当前 `browser.runtime.id` 的 `mcp.json` 片段到剪贴板）——降低用户找扩展 ID 的门槛。若做，复用 `AgentBridgeSettings.tsx` 挂载点（`App.tsx:452`）。

---

## Risks

- **R-1（高）MCP `2026-07-28` spec 仅 12 天、生态 mid-migration**：客户端 era 混合，dual-era 必需。**缓解**：用 SDK v2（开箱 dual-era）；AE1 验证至少一个 legacy 客户端；README 注明 era 差异与排错；pin `mcp>=2.0,<3` 跟踪 spec。
- **R-2（中）skill 分发结构变更（1→2 文件）**：可能令现有 skill 用户/工具意外。**缓解**：drift 锁 + packager round-trip 测试 + SKILL.md 说明；调用入口（`python scripts/juso_search.py ...`）不变。
- **R-3（中）每个 `tools/call` 启 Chromium 的延迟/重量**：bridge 模型固有（与 CLI skill 同）。**缓解**：文档设预期；不在本计划引入常驻 daemon（违架构决策）。
- **R-4（中）扩展 ID 发现负担**：MCP 用户须在 `mcp.json` 填正确扩展 ID（prod CWS id vs dev build id）。**缓解**：文档给 `chrome://extensions` 查法；可选"复制 MCP 配置"按钮（IU5 note）。
- **R-5（中）MCP server 经 bridge 的失败语义**：bridge claim 超时、worker 门控关、engine-search 子开关关等需透传为模型可读的工具结果。**缓解**：`bridge_call` 复用 `juso_bridge` 错误分类映射到 `CallToolResult(is_error=True)`；AE6 覆盖。
- **R-6（低）无 CI 跑 python 测试**：drift 锁今日仅本地。**缓解**：本计划不引入 CI（范围外），但 README/CONTRIBUTING 注明 `npm run test:python && npm run test:mcp` 为必跑。
- **R-7（低）Python 版本**：MCP 包需 ≥3.10（SDK v2），skill 仍 stdlib（兼容更老）。**缓解**：`pyproject.toml` 声明 `requires-python`；README 注明。

---

## Final Verification

1. `npm run typecheck` 绿（packager TS 改动）。
2. `npm run lint` 绿。
3. `npm test` 绿（现有 + packager round-trip 扩展）。
4. `npm run test:python` 绿（`test_juso_search` 行为不变 + `test_gen_skills` + **新** `test_juso_bridge` + **新** `test_juso_bridge_drift`）。
5. `npm run test:mcp` 绿（pytest：tools/list、call dispatch、config env、stdout clean、dual-era 集成）。
6. `npm run build` 绿，产物 skill zip 解压含 `juso_search.py` + `juso_bridge.py`（占位符/盖章不变）。
7. 手动 QA（AE1-AE6）：pip 本地装 + Claude Desktop 端到端 search；modern 客户端 `server/discover`；drop-in skill 不破坏；drift 锁红/绿；env 配置/缺失行为；门控继承。

**关键审计点**：MCP server 不读/不经手任何 BYOK key（仅经 bridge，key 仍在 worker）；不绕过 `isTrustedBridgeSender`/门控；`juso_bridge` 为 bridge 协议唯一源头，四处副本 drift 锁守卫；stdout 仅 JSON-RPC（2026-07-28 纪律）。

---

## Dependencies & Origin

- **决策对话** — 用户拍板：pip 分发；标准 MCP；配置经 `mcp.json`；与 skill 互斥并存；build-time 单源 + drift 锁（非 runtime import）；模块更名 `juso_bridge`；并提示"MCP 协议近期有破坏性变更"→触发协议研究。
- **@explorer 侦查 `ses_01b8b7246ffeYsMhfEb1ejxoaQ`** — skill 源布局（`juso_search.py` 488 行逐函数映射、bridge-client 核心与 CLI 入口的分界、`DEFAULT_EXTENSION_ID`/`PROVIDERS`/`ENGINES`/`PROTOCOL` 常量位）、gen_skills 机制（`TEMPLATE_DIR`/`DEV_PATCH_*`/loud-match）、TS bridge 契约（`lib/agent-bridge.ts` 全 action/reply 形状、`agent-bridge.ts:220` 内联 engine allowlist）、gateway handlers（`handleSearch`/`handleListAgentProviders`/`handleSearchInstance`/`handleListAgentInstances`）、drift 锁先例（`test_gen_skills.py` + `test:python`）、分发三通道、Python 工具链现状（无 pyproject、stdlib unittest）。
- **@librarian 研究 `ses_01b82778bffe2wARHp3VmbjPuF`** — MCP `2026-07-28` spec 现状（最大修订、移除 initialize、新增必需 `server/discover`、`resultType`/`ttlMs`/`cacheScope`、错误码 `-32022`、stdio 仍 canonical 且无 framing 变化、dual-era 必需）、官方 Python SDK v2（`MCPServer`、dual-era、`mcp>=2.0,<3`、Python ≥3.10）、`mcp.json` 各客户端格式与差异、stdio gotchas（stdout 仅 JSON-RPC、stdin EOF 退出、`notifications/cancelled`）、应避免采用的 deprecated（Roots/Sampling/Logging/SSE）。URL：spec (`modelcontextprotocol.io/specification/2026-07-28/*`)、SDK (`py.sdk.modelcontextprotocol.io`、`github.com/modelcontextprotocol/python-sdk`)、客户端 (`code.claude.com/docs/mcp`、`docs.cursor.com`)。
- **`docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md`** — bridge 架构与安全模型（BYOK 边界、loopback-only、默认关、When to Apply 的"long-lived service"边界），本计划 R4/KTD6 的参照与 IU5 待澄清点。
- **`docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md`**（经 bundle-plan 引用） — "cross-end contracts must be tested across the ends" 原则，本计划 KTD2/IU4 drift 锁的直接依据。
- **`docs/plans/2026-08-05-001-bundle-agent-skill-plan.md`** — 单一模板源（`public/agent-skill/`）+ drift 锁 + packager 先例，本计划 IU2 直接复用并扩展。
