---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: orchestrator
execution: code
title: "Bundle Agent Skill — Plan"
type: feat
date: 2026-08-05
---

# Bundle Agent Skill — Plan

## Goal Capsule

**目标**：用户在 Options 页（Agent Bridge 区块）一键下载与本机已装扩展精确匹配的 Agent Skill 压缩包（zip 内含顶层文件夹，解压即 `<skill-name>/SKILL.md` + `<skill-name>/scripts/juso_search.py`）；自定义 dev 构建（用户自带 key `build:dev`，得到 repo 未知的扩展 ID）也能导出正确盖章的 dev variant skill。同时把 `skills/juso-search/` 与 `skills/juso-search-dev/` 这对手工双胞胎改造为**从单一模板生成**的产物，从结构上根治已记录的 contract drift。

**权威层级**：本计划由 orchestrator 产生（无上游 brainstorm / ce-plan），产品行为与技术决策以本文件为准。决策对话与 @explorer 侦查（`ses_02de45438ffevmmlBODE4mg9W3`）为输入。

**停止条件**：模板源 + Python generator + drift 测试 + 构建钩子 + worker packager + Options 下载入口全部就绪；`npm run typecheck && npm run lint && npm test && npm run test:python && npm run build` 全绿；drift 测试断言两个发布目录 == 生成器输出；手动 QA（AE1-AE5）通过。

**执行画像**：TS 侧 packager / zip / messaging / worker（复用 `handleExportConfig` → `triggerDownload` 先例）；Python 侧 generator（套现有 `test:python` 模式）；UI 组件测试；zip 写入器需 round-trip 结构测试。

**Product Contract 保全**：无上游产品契约。本计划同时定义 WHAT 和 HOW。

---

## Product Contract

### 问题与用户

- **目标用户**：
  1. 想用 Agent Skill 但不想 clone repo、不想自己挑 `juso-search` vs `juso-search-dev`、不想手动拷到 `.agents/skills/` 的扩展用户。
  2. 自定义 dev 构建者（自带 key `build:dev`）——两个预置 ID（`illmhdnglkjfcenboepdgopaeejdgoji` / `pdklefhommhabbhkglgkgomeibeibmcl`）都不匹配他们的扩展，当前只能靠 `--extension-id`/`JUSO_EXTENSION_ID` 手动覆盖。
  3. 维护者——面对 `skills/juso-search/` 与 `skills/juso-search-dev/` 两份手工维护的镜像，已发生过 5 个独立 drift 缺陷（见 `docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md`）。
- **痛点**：安装门槛高（clone + 选 variant + 拷贝）；自定义 dev 几乎不可用（ID 不匹配）；维护者每次改 skill 必须同步两份，遗漏即 drift。
- **价值主张**：一键下载"装的是哪个扩展，导出的就是哪个 skill"；自定义 dev 自动正确；维护者只改一处模板，两个发布目录由生成器产出并被 drift 测试锁住。

### Requirements

- **R1. 单一模板源**：新增 `skills/_template/`，含 `SKILL.md` 与 `scripts/juso_search.py`，所有跨 variant 差异以占位符表达（`{{EXTENSION_ID}}`、`{{SKILL_NAME}}`、`{{SKILL_DESCRIPTION}}`、`{{SKILL_COMPATIBILITY}}`、`{{MODULE_DOCSTRING}}`、`{{ARGPARSE_DESCRIPTION}}`、`{{DEV_WARNING_BLOCK}}`）。两个发布目录的字节内容必须完全由"模板 + variant 配置"决定。
- **R2. Python 生成器**：`scripts/gen_skills.py` 读取模板 + variant 配置（`prod` / `dev`），渲染并写入 `skills/juso-search/` 与 `skills/juso-search-dev/`。`--check` 模式渲染到内存并与 git 跟踪目录逐一比对字节，发现差异 exit 1。幂等、排除 `__pycache__`。配套 `package.json` 脚本 `gen-skills`。
- **R3. Drift 锁**：`tests/scripts/test_gen_skills.py` 断言两个跟踪目录 == 生成器输出（套现有 `test:python` runner）。任何手工改动跟踪目录、或改模板未重新生成，CI 即红。
- **R4. 构建期分发**：WXT/Vite 构建钩子把 `skills/_template/` 拷进构建产物的 `agent-skill/` 路径，随扩展包分发（占位符原样保留，运行时再替换）。`bridge.html` 维持不入 WAR（现状），skill 资源由 worker 内部 fetch，不对外暴露。
- **R5. 运行时 packager**：worker 新增 `packageAgentSkill`，流程为 `fetch(browser.runtime.getURL('agent-skill/...'))` → 占位符替换（`{{EXTENSION_ID}}` ← `browser.runtime.id`；其余 variant 字段 ← 构建期 `define __SKILL_VARIANT__` 决定的配置）→ STORE-mode zip（顶层文件夹 = variant `name`，含目录 entry）→ `browser.downloads.download`（复用 `triggerDownload`）。整个过程 worker-side，不经手任何 BYOK key（模板无密钥）。
- **R6. 变体由构建模式决定**：`wxt.config.ts` 经 Vite `define` 注入 `__SKILL_VARIANT__`（`mode === 'development'` → `'dev'`，否则 `'prod'`）。CWS 发布版导出 `juso-search` skill；`build:dev` 及自定义 dev 导出 `juso-search-dev` skill。扩展 ID 一律来自 `browser.runtime.id`，与 variant 正交。
- **R7. 下载产物结构（与 repo 发布目录区分）**：
  - **下载 zip 内部 skill 恒为 `juso-search`**：解压得 `juso-search/SKILL.md` + `juso-search/scripts/juso_search.py`，frontmatter `name: juso-search`，内容统一 prod 风格（无 dev 警告块）。不论来自 CWS 版还是 dev 版——下载者已从对应扩展导出、skill 必匹配，dev 警告（"改用 juso-search-dev"）对下载场景无意义。
  - **repo 发布目录保持两个 distinct**：`skills/juso-search/` + `skills/juso-search-dev/`（generator 控制，名字/内容都区分，dev 含警告块），面向 GitHub 浏览者与双装 dogfood 的维护者。
  - **zip 文件名承载 variant + version**：`juso-search-<version>.zip`（CWS 版）/ `juso-search-dev-<version>.zip`（dev 版），`<version>` = `browser.runtime.getManifest().version`（当前 `1.3.0`）。顶层文件夹存在（不散落文件）。
- **R8. UI 入口**：`components/AgentBridgeSettings.tsx` 现有 bridge 开关下方加"下载配套 Agent Skill"按钮 + 简短说明。点击 → `sendMessage('packageAgentSkill')` → worker 下载 → 页面显示成功/失败状态。镜像 `ConfigExportImport` 的交互模式。
- **R9. 双发布目录保留**：`skills/juso-search/` 与 `skills/juso-search-dev/` 继续存在于 repo（供 GitHub 浏览、skill 市场、不愿先装扩展的用户），但从"手工维护"变为"生成产物"。README 补一句"或从 Options 一键下载"。
- **R10. 安全不变**：BYOK 边界、bridge 信任检查、双层 opt-in（`agentBridgeEnabled` / `engineSearchEnabled`）均不动。下载入口不依赖 bridge 是否启用（skill 文件本身无密钥、无能力；启用 bridge 是使用 skill 的前置条件，但下载 skill 不需要）。

### Scope Boundaries

**Phase 1 范围**：模板源 + generator + drift 测试 + 构建钩子 + worker packager + zip 写入器 + messaging/gateway + Options 下载按钮 + i18n + README/架构文档同步。

**Phase 1 非目标**：
- 生成器从 worker registry 注入 `PROVIDERS` / `ENGINES` 常量（需 Python 解析 TS 或读生成 artifact；属另一类 drift，由 `agent-bridge-skill-contract-drift.md` Prevention #2 的 equality-test 建议覆盖，Phase 2 再做）。
- 把 skill 推送到 skill 市场或 agent 注册中心（仅提供下载入口与 repo 路径）。
- 为 skill 增加 native messaging / 持久 daemon（与现有架构决策一致，见 `agent-skill-localhost-capability-bridge.md` When to Apply）。
- zip 压缩（STORE 足够，文件极小；DEFLATE 需更大实现或依赖，收益可忽略）。

### Acceptance Examples

- **AE1（CWS 发布版）**：用户从 Chrome Web Store 装扩展 → Options → 通用 → Agent Bridge → 点"下载配套 Agent Skill" → 得到 `juso-search-1.3.0.zip` → 解压得到 `juso-search/SKILL.md` + `juso-search/scripts/juso_search.py`（内部 skill 恒名 `juso-search`，统一 prod 风格内容）→ `DEFAULT_EXTENSION_ID` == `illmhdnglkjfcenboepdgopaeejdgoji`（== `browser.runtime.id`）→ 拷到 `.agents/skills/juso-search/` 可直接被 agent 加载。
- **AE2（build:dev 版）**：维护者 `npm run build:dev` 装载 → 同样操作 → 得到 `juso-search-dev-1.3.0.zip`（文件名带 `dev` + version）→ 解压仍得 `juso-search/`（内部 skill 恒名 `juso-search`，**下载内容统一 prod 风格、无 dev 警告块**——dev 警告只在 repo `skills/juso-search-dev/`）→ `DEFAULT_EXTENSION_ID` == `pdklefhommhabbhkglgkgomeibeibmcl`。维护者双装 dogfood 走 repo 两个 distinct 目录（`juso-search` + `juso-search-dev`），不撞。
- **AE3（自定义 dev 构建）**：用户改 `DEV_EXTENSION_KEY` 自行 `build:dev`，得到一个 repo 未知的扩展 ID → 下载 → 得到 `juso-search-dev-<version>.zip`，内部 `juso-search/`，`DEFAULT_EXTENSION_ID` == 该用户自己的 `browser.runtime.id`（既非两个预置 ID 之一）。这是运行时盖章的核心收益。
- **AE4（drift 锁）**：维护者手工编辑 `skills/juso-search/scripts/juso_search.py` 一行 → `npm run test:python` 红，指出哪份偏离。维护者改 `skills/_template/` 后 `npm run gen-skills` → 两份同步再生 → 测试绿。
- **AE5（生成器保真）**：IU2 完成时，生成器输出与当前 git 跟踪的两份目录**字节一致**（证明模板+config 忠实捕获了所有现存差异），即"去重提交"本身是 near-no-op diff，但从此单一源头已建立。

### 关键假设

- 模板占位符 `{{...}}` 形式在 SKILL.md 与 .py 正文中不会与合法内容冲突（当前 skill 内容无 `{{` 序列，已核实）。
- `browser.runtime.id` 在 MV3 worker 可用（标准 API，无需额外权限）。
- WXT/Vite `define` 可在 `wxt.config.ts` 按 `mode` 注入编译期常量（需 IU4 验证确切 API 形式）。
- STORE-mode zip（含目录 entry + CRC32）可在无依赖条件下手写实现并被主流解压工具识别（round-trip 测试守卫）。

---

## Planning Contract

### Key Technical Decisions

**KTD1. 模板置 `public/agent-skill/`，WXT 自动随包分发（零构建钩子）。**
模板作为分发资产直接放 `public/agent-skill/`，WXT 按标准 `public/` 行为原样拷进构建产物（`agent-skill/SKILL.md` + `agent-skill/scripts/juso_search.py`），packager 经 `browser.runtime.getURL('agent-skill/...')` 取用。*否决"build hook 拷贝"*：WXT/Vite 文件拷贝钩子 API 形式不确定，且为一次性小资产引入构建期动部件不划算；`public/` 路径零动部件、最可靠。generator 的 `TEMPLATE_DIR` 指向 `public/agent-skill/`（同一源头，repo 发布目录仍由此生成）。构建 smoke（手动收盘检查，已在最终验证中执行）：产物含 `agent-skill/SKILL.md` 且占位符 `__JUSO_EXTENSION_ID__` 未被替换；非自动化 post-build 断言（`public/` 原样拷贝由 WXT 标准行为保证，模板内容由 Python drift 测试守卫）。

> **实现注记（IU1/IU2 已落地）**：模板实际为 **prod 内容原样** + 仅 `scripts/juso_search.py` 的 `DEFAULT_EXTENSION_ID` 作 `__JUSO_EXTENSION_ID__` 占位符（SKILL.md 无占位符，因 prod 不含字面 ID）。dev variant 由 `scripts/gen_skills.py` 的 `DEV_PATCH_SKILL_MD` / `DEV_PATCH_PY` find/replace 对（把 prod→dev 的 diff 编码为变换）派生，最后统一替换扩展 ID。每个 find 必须精确匹配一次，漂移即 loud failure。比原计划的 7-占位符方案更干净——packager 只需一次 ID 替换，TS 侧零内容配置。AE5 已验证：`git diff --stat skills/` 为空（生成器输出 == 已提交字节）。
> **经验**：终端/工具在显示 32-char 扩展 ID 时会偶发吞字符（prod id 显示为 31-char），导致手打 id 字面量与 `.Replace`/edit 全部失配。最终用 regex 从 git HEAD 权威提取、绝不手打 id 解决。

**KTD2. Generator 用 Python，与 skill 工具链同语系。**
`scripts/gen_skills.py` 复用 repo 已有 Python 工具链（`test:python` runner、`tests/scripts/` 目录约定）。drift 测试 `tests/scripts/test_gen_skills.py` 套 `test_juso_search.py` 模式。*否决 `.mjs`*：会让 skill 生态横跨两语言，且 Python 测试基础设施已就绪。注意区分：generator（产出两个发布目录）是 Python；WXT 构建钩子（拷模板进产物）是 TS（必须是 JS/TS，它在 Vite 配置内）。二者是模板的两个独立消费者，语言不同但各自合理。

**KTD3. 双发布目录变为生成产物 + drift 测试锁，而非删除。**
用户要求"保留两份便于直接找 skill 也能找到"与"建模版根治 drift"看似冲突——唯一能同时满足的是：模板是唯一源头，两份发布目录由生成器产出，drift 测试断言"`git 跟踪目录 == 生成器输出`"。它们仍躺在 repo 供发现，但结构上不可能再与模板分叉。这正是 `agent-bridge-skill-contract-drift.md` Prevention 主题——"cross-end contracts must be tested across the ends"——在"模板↔发布目录"这一对上的应用。

**KTD4. 扩展 ID 运行时盖章（`browser.runtime.id`），不预写常量。**
模板 `DEFAULT_EXTENSION_ID = "{{EXTENSION_ID}}"`；运行时 packager 用 `browser.runtime.id` 替换。这是覆盖自定义 dev 构建（repo 未知 ID）的唯一方式。预写常量只覆盖两个已知 ID；运行时盖章覆盖所有情况，包括自定义 dev。env/CLI 覆盖（`--extension-id` / `JUSO_EXTENSION_ID`）在生成的 .py 中保留，作为高级用户的二次覆盖。

**KTD5. 下载 skill 内容统一 prod 风格；variant 仅决定 zip 文件名 token。**
下载 zip 内的 skill 恒为 `juso-search`（文件夹名 + frontmatter `name` + prod 风格内容：无 dev 警告块、prod description）——下载者已从对应扩展导出、skill 必匹配，dev 警告（"改用 juso-search-dev"）对下载场景无意义。`__SKILL_VARIANT__`（仍由构建期 Vite `define` 按 `mode` 注入 `'prod'|'dev'`，因 `browser.runtime.getManifest()` 无法直接判定 dev/prod）**降级为仅影响 zip 文件名**：prod → 文件名不带 `dev`、dev → 带 `dev`；不再驱动 skill 内容。**repo 发布目录不受影响**：generator 仍产出两个 distinct 内容的 skill（prod `juso-search` / dev `juso-search-dev` 含警告块），面向需辨认的 GitHub 浏览者与双装维护者。variant 配置在 TS（仅文件名 token）与 Python generator（完整 variant 字段）两侧用途不同，不共享定义。

**KTD6. zip 手写 STORE-mode，不引入依赖。**
仅 2 个小文本文件 + 2 条目录 entry。手写 STORE + CRC32（~15 行表驱动）+ local file header + central directory + EOCD（~50 行）。*否决 `fflate` 等依赖*：repo 当前零 zip 工具，为一个一次性小 zip 引入依赖不划算；round-trip 结构测试（写回 → 自解析 → 断言 entry）守卫正确性。若实现期发现手写 bug 面过大，回退到 `fflate` 是 documented alternative（见 Alternatives）。

**KTD7. 下载走 worker-side `triggerDownload`，复用 ConfigExport 先例，不改页面下载模式。**
`handleExportConfig`（`lib/gateway.ts:327-351`）已是"worker 组装 → data URL → `browser.downloads.download`"先例，`downloads` 权限已声明（`wxt.config.ts:35`）。packager handler 同样在 worker 完成 zip → data URL → `triggerDownload`（`:401-403`）→ 返回 `{ ok: true }`。页面只发消息 + 显示状态，不经手 blob。一致性最高。

**KTD8. UI 入口挂在 `AgentBridgeSettings` 内，非新 nav group。**
skill 离 bridge 无意义（bridge 是 skill 的唯一能力来源）；`App.tsx:431-435` 已是 `<AgentBridgeSettings />` 挂载点。在现有 bridge 开关下方加下载按钮，物理与语义都最相邻。*否决新 nav group*：功能体量不值得一级导航入口。

### Alternatives Considered

- **模板直接放 `public/agent-skill/`（零构建钩子）**：被否——耦合作者源与分发资产、语义不符 `public/`。见 KTD1。（若实现期发现 WXT 构建钩子 API 不稳，此方案作为 documented fallback。）
- **Generator 用 `.mjs`**：被否——跨语系、浪费已有 Python 测试设施。见 KTD2。
- **删除双发布目录，只留模板**：被否——违背"便于直接找 skill"的可发现性要求。见 KTD3。
- **预写两个已知 ID 常量、不做运行时盖章**：被否——无法覆盖自定义 dev 构建（核心收益之一）。见 KTD4。
- **引入 `fflate` 做 zip**：备选——仅当手写 STORE 实现期 bug 面超预期时回退。见 KTD6。
- **页面侧 `URL.createObjectURL` 下载**：被否——不符现有 worker-side 下载先例，且 packager 在 worker 拿 `browser.runtime.id` 最自然。见 KTD7。

### Patterns to Follow

- **`lib/gateway.ts:327-351`（`handleExportConfig`）+ `:401-403`（`triggerDownload`）** — worker 组装 → data URL → `browser.downloads.download` 先例，packager handler 直接镜像。
- **`components/ConfigExportImport.tsx:20-32`（`handleExport`）** — 页面只发消息 + 显示状态、不经手 blob 的交互模式。
- **`entrypoints/background.ts:114`（`onMessage('exportConfig', ...)`）** — message handler 注册模式。
- **`skills/juso-search-dev/`（提交 `563ef30` copy+edit 而来）** — 现存 variant 差异的权威清单：`.py` 差 3 行（docstring `:2`、`DEFAULT_EXTENSION_ID` `:32`、argparse description `:389`）；`SKILL.md` 差 ~19 行（`name`/`description`/`compatibility` frontmatter、dev-only 警告块 `:14`、ID-default 注记 `:20`、CLI 示例 `:28`、flag 表 `:64`）。模板占位符必须覆盖全部这些维度。
- **`tests/scripts/test_juso_search.py`** — Python 测试在 repo 中的既定形态，drift 测试照此组织。
- **`docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md` Prevention** — "cross-end contracts must be tested across the ends" 原则，应用于"模板↔发布目录"漂移锁。

### Risks

- **R-1（中）**：手写 STORE zip 损坏（offset/CRC/EOCD 签名错误）→ 用户拿到打不开的压缩包，整个特性价值归零。缓解：round-trip 结构测试（写 → 自解析 → 断言 entry 与内容）；并在 IU5 完成后用系统 `unzip`/PowerShell `Expand-Archive` 做一次真实解压 smoke。若失败即回退 `fflate`（KTD6）。
- **R-2（中）**：WXT/Vite 构建钩子 API 形式不确定（`build:before` vs Vite `buildStart` plugin vs `publicAssets`）。缓解：IU4 起手即用最小实验验证钩子能拷文件到产物，再定型；记录采用的 API。
- **R-3（低）**：模板占位符 `{{...}}` 与未来 skill 内容冲突。缓解：IU1 用不常见 token（如 `__JUSO_SKILL_NAME__` 双下划线样式）替代 `{{}}`，降低碰撞概率；drift 测试间接守护（占位符若进正文，生成器输出会变）。
- **R-4（低）**：`__SKILL_VARIANT__` 的 TS 声明遗漏导致 typecheck 红。缓解：在 `global.d.ts`（或等价 `.d.ts`）加 `declare const __SKILL_VARIANT__: 'prod' | 'dev';`。
- **R-5（低）**：生成器保真（AE5）若当前两份目录有未捕获的细微差异，去重提交会带 diff。缓解：可接受——diff 即暴露此前未发现的 drift，反而验证了 drift 锁的价值；只需人工确认 diff 内容合理。

---

## Implementation Units

### IU1: 模板源 `skills/_template/`

**文件**：`skills/_template/SKILL.md`、`skills/_template/scripts/juso_search.py`（新建）

**内容**：把现有两份目录去重为单一模板。所有 variant 差异以占位符表达：
- `SKILL.md`：frontmatter 的 `name`/`description`/`compatibility`、dev-only 警告块（prod 时为空）、ID-default 注记行、CLI 示例、flag 表相关行 → 占位符 `__JUSO_SKILL_NAME__` / `__JUSO_SKILL_DESCRIPTION__` / `__JUSO_SKILL_COMPATIBILITY__` / `__JUSO_DEV_WARNING_BLOCK__` / `__JUSO_EXTENSION_ID__`。
- `juso_search.py`：module docstring（`:2`）、`DEFAULT_EXTENSION_ID`（`:32`）、argparse description（`:389`）→ 占位符 `__JUSO_MODULE_DOCSTRING__` / `__JUSO_EXTENSION_ID__` / `__JUSO_ARGPARSE_DESCRIPTION__`。
- 共享部分（`PROTOCOL`、`PROVIDERS`、`ENGINES`、`EXTENSION_ID_RE`、协议逻辑、`run()` 等）原样保留一份。

**测试**：无独立测试（保真由 IU3 drift 测试守卫）。

**依赖**：无（纯文本资产）。

---

### IU2: Python 生成器 `scripts/gen_skills.py`

**文件**：`scripts/gen_skills.py`（新建）、`package.json`（加 `gen-skills` 脚本）、`skills/juso-search/` 与 `skills/juso-search-dev/`（被生成器重写）

**内容**：
- 内嵌 `VARIANTS` 配置（两 entry：`prod`、`dev`），每 entry 含：`name`、`description`、`compatibility`、`default_extension_id`、`module_docstring`、`argparse_description`、`dev_warning_block`（prod 为 `""`）、`target_dir`。
- `render(template_text, variant_config) -> str`：纯字符串替换所有 `__JUSO_*__` 占位符。
- `write_variant(variant)`：渲染 `SKILL.md` + `juso_search.py`，写入 `target_dir`，保留 `scripts/` 子结构；不写 `__pycache__`。
- `check()`：渲染到内存，与 git 跟踪的 `target_dir` 文件逐一比对字节，返回差异列表。
- CLI：`python scripts/gen_skills.py`（写两份）、`--check`（仅比对，差异 exit 1）、`--variant {prod,dev}`（单份）。
- `package.json`：`"gen-skills": "python scripts/gen_skills.py"`。
- 运行 `gen-skills` 重写两份发布目录（目标：与当前字节一致，见 AE5）。

**测试**：见 IU3。

**依赖**：IU1。

---

### IU3: Drift 锁 `tests/scripts/test_gen_skills.py`

**文件**：`tests/scripts/test_gen_skills.py`（新建）

**内容**（套 `test_juso_search.py` 模式）：
- `test_generated_dirs_match_tracked`：调 `gen_skills.check()`，断言返回差异列表为空。
- `test_render_replaces_all_placeholders`：渲染后输出不含任何 `__JUSO_*__` 残留。
- `test_prod_dev_differ_only_in_expected_fields`：两 variant 输出 diff 恰好落在已知维度（name/description/compatibility/id/docstring/argparse/warning block），无意外差异。

**依赖**：IU2。

---

### IU4: 模板分发（public/）+ variant define

**文件**：`wxt.config.ts`、`global.d.ts`（新建/扩展）、`public/agent-skill/`（模板新位置）、`scripts/gen_skills.py`（TEMPLATE_DIR 更新）

**内容**：
- 模板迁移：把 `skills/_template/` 整体移到 `public/agent-skill/`（保 `SKILL.md` + `scripts/juso_search.py` 子结构）。WXT 按标准 `public/` 行为原样拷进产物，packager 经 `browser.runtime.getURL('agent-skill/...')` 取用——零构建钩子。
- `scripts/gen_skills.py`：`TEMPLATE_DIR` 改指 `REPO_ROOT / "public" / "agent-skill"`。重跑 `python scripts/gen_skills.py` 确认仍从新位置读取、两发布目录再生、drift 测试绿。
- `wxt.config.ts`：Vite `define` 注入 `__SKILL_VARIANT__: JSON.stringify(env.mode === 'development' ? 'dev' : 'prod')`（确切 `defineConfig((env) => ...)` 形式实现期验证；镜像现有 `manifest: ({ mode }) => ...` 模式）。
- `global.d.ts`：`declare const __SKILL_VARIANT__: 'prod' | 'dev';`。

**测试**：`npm run build` 后断言产物含 `agent-skill/SKILL.md` 且其 `__JUSO_EXTENSION_ID__` 占位符未被替换；`npm run build:dev` 同样含 `agent-skill/`；`npm run typecheck` 绿；`npm run test:python` 绿（drift 锁从新 TEMPLATE_DIR 读取）。

**依赖**：IU1。

---

### IU5: STORE-mode zip 写入器 `lib/zip.ts`

**文件**：`lib/zip.ts`（新建）、`tests/zip.test.ts`（新建）

**内容**：
- `createStoreZip(entries: ZipEntry[]): Uint8Array`，其中 `ZipEntry = { path: string; data: Uint8Array }`。
- 自动为中间目录插 dir entry（如 `juso-search/`、`juso-search/scripts/`，路径以 `/` 结尾，data 空）。
- 实现：CRC32（表驱动，~15 行）+ local file header + central directory record + EOCD；STORE only（compression method 0）。
- 纯函数，无 DOM/worker 依赖，便于测试。

**测试**：`tests/zip.test.ts`：
- round-trip：写入 `[{path:'a/SKILL.md', data:...}, {path:'a/scripts/x.py', data:...}]` → 自实现一个极简 reader（或解析 central directory）断言 entry 数、路径、data 字节、目录 entry 存在。
- 真实解压 smoke：用 PowerShell `Expand-Archive` 或 Node `unzip` 解压产物，断言结构（在 IU 验证步骤手动/脚本执行，非 vitest 单元）。

**依赖**：无。

---

### IU6: Packager `lib/agent-skill-packager.ts`

**文件**：`lib/agent-skill-packager.ts`（新建）、`lib/agent-skill-variants.ts`（新建，variant 配置表）

**内容**：
- `lib/agent-skill-variants.ts`：`SKILL_VARIANTS: Record<'prod'|'dev', VariantConfig>`，字段与 Python `VARIANTS` 对齐（name/description/compatibility/module_docstring/argparse_description/dev_warning_block）。导出 `getVariantConfig(__SKILL_VARIANT__)`。
- `lib/agent-skill-packager.ts`：
  - `packageAgentSkill(): Promise<{ dataUrl: string; filename: string }>`
  - `const extId = browser.runtime.id`（校验匹配 `EXTENSION_ID_RE` 形态 `^[a-p]{32}$`，否则抛错）。
  - `fetch(browser.runtime.getURL('agent-skill/SKILL.md'))` 与 `.../agent-skill/scripts/juso_search.py` 取模板文本。
  - **下载 skill 恒为 prod 风格**：模板本身已是 prod 内容（IU1 实际实现：`skills/_template/` = prod 原样，仅 `.py` 的 `DEFAULT_EXTENSION_ID` 是 `__JUSO_EXTENSION_ID__` 占位符；dev variant 由 generator 的 `DEV_PATCH_*` 变换派生，不在模板里）。故 packager **只需**替换 `__JUSO_EXTENSION_ID__` ← `browser.runtime.id`，无需任何 variant 内容配置。`__SKILL_VARIANT__` 仅用于文件名 token。
  - 构造 `ZipEntry[]`：`juso-search/SKILL.md`、`juso-search/scripts/juso_search.py`（文件夹恒为 `juso-search`）。
  - `createStoreZip(entries)` → base64 → `data:application/zip;base64,...`。
  - `filename`：prod → `juso-search-<version>.zip`；dev → `juso-search-dev-<version>.zip`。`<version>` = `browser.runtime.getManifest().version`。

**测试**：`tests/agent-skill-packager.test.ts`（新建）：
- mock `browser.runtime.getURL`/`fetch`（返回带占位符的模板文本）+ `browser.runtime.id`。
- 断言：prod variant → 文件夹名 `juso-search`、`DEFAULT_EXTENSION_ID` == mock id、占位符全替换、zip data URL 可被 `createStoreZip` reader 解回两 entry。
- 断言：dev variant → 文件夹名 `juso-search-dev`、含 dev 警告块文本。
- 断言：自定义 id（非两预置之一）也被正确盖章。

**依赖**：IU4（模板资源随包）、IU5（zip）。

---

### IU7: Messaging + Gateway handler

**文件**：`lib/messaging.ts`、`lib/gateway.ts`、`entrypoints/background.ts`

**内容**：
- `lib/messaging.ts`：新增 `packageAgentSkill(): Promise<{ ok: true } | { ok: false; error: string }>`（镜像现有 ok/error 判别联合）。
- `lib/gateway.ts`：`handlePackageAgentSkill()`：调 `packageAgentSkill()` 取 `{ dataUrl, filename }` → `await triggerDownload(dataUrl, filename)`（复用 `:401-403`）→ 返回 `{ ok: true }`；失败返回 `{ ok: false, error }`。
- `entrypoints/background.ts`：`onMessage('packageAgentSkill', () => handlePackageAgentSkill());`（镜像 `:114`）。

**测试**：`tests/gateway.test.ts`（扩展）：
- `handlePackageAgentSkill` 成功 → `triggerDownload` 被调（mock）+ 返回 `{ ok: true }`。
- packager 抛错 → 返回 `{ ok: false, error }`，不调 download。

**依赖**：IU6。

---

### IU8: UI 入口

**文件**：`components/AgentBridgeSettings.tsx`、`entrypoints/options/styles.css`

**内容**：
- `components/AgentBridgeSettings.tsx`：现有 bridge 开关（`:25-33`）下方加 `<section data-section="agent-skill-download">`：标题 + 一句说明（"装的是哪个扩展，下载的就是哪个 skill；含已盖章的扩展 ID，解压后拷到 .agents/skills/ 即可"）+ 按钮。`handleDownload()`：`sendMessage('packageAgentSkill')` → 据返回更新状态文案（成功/"已下载"/失败原因）。
- `styles.css`：复用现有 button/section 样式，仅必要时补几行间距。

**测试**：`tests/options-page.test.tsx`（扩展，mock `@/lib/messaging`）：
- 按钮渲染。
- 点击 → `sendMessage('packageAgentSkill')` 被调。
- 成功回复 → 状态文案更新。
- 失败回复 → 错误文案更新。

**依赖**：IU7。

---

### IU9: i18n

**文件**：`lib/i18n.ts`、`public/_locales/en/messages.json`、`public/_locales/zh_CN/messages.json`

**内容**：新增 key（双语）：
- `opts_agent_skill_heading`（"配套 Agent Skill" / "Companion Agent Skill"）
- `opts_agent_skill_hint`（说明文字）
- `opts_agent_skill_download`（"下载 Agent Skill" / "Download Agent Skill"）
- `opts_agent_skill_done`（"已开始下载" / "Download started"）
- `opts_agent_skill_failed`（"下载失败：$1" / "Download failed: $1"）

**测试**：覆盖在 IU8 组件测试中。

**依赖**：IU8。

---

### IU10: 文档同步

**文件**：`README.md`、`README.en.md`、`docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md`

**内容**：
- `README.md` / `README.en.md`：Agent Skill 安装段补一句"或从扩展 Options → 通用 → Agent Bridge 一键下载（自动按本机扩展 ID 盖章，自定义 dev 构建亦可）"。
- `agent-skill-localhost-capability-bridge.md`：在 "Skill 包位置" 段补"模板源 `skills/_template/` 为唯一源头；两发布目录由 `scripts/gen_skills.py` 生成并被 drift 测试锁；扩展内 Options 提供运行时盖章下载入口"。更新 last_updated。

**测试**：无（文档审阅）。

**依赖**：IU7、IU8。

---

## Sequencing

```
IU1 (模板) ──┬─→ IU2 (generator) ──→ IU3 (drift 测试)        [Python 链]
             └─→ IU4 (构建钩子 + define) ──┐
IU5 (zip) ──────────────────────────────┼─→ IU6 (packager) ──→ IU7 (messaging/gateway) ──→ IU8 (UI) ──→ IU9 (i18n)
                                        │                                                        └─→ IU10 (docs)
```

**可并行**：IU1 完成后，Python 链（IU2→IU3）与 TS 链（IU4 / IU5）完全独立，可派两个 @fixer 并行。IU5 无依赖可最先起。IU6 需 IU4+IU5。IU8 需 IU7。IU10 最后。

**建议执行顺序**：IU1 → (IU2+IU4+IU5 三并行) → IU3 + IU6 → IU7 → (IU8+IU9) → IU10 → 全量验证。

**并行派工边界**：Python 链（IU1/IU2/IU3）与 TS 链（IU5/IU6/IU7/IU8）写作用域不重叠（`skills/`+`scripts/`+`tests/scripts/` vs `lib/`+`entrypoints/`+`components/`+`tests/`），IU4（`wxt.config.ts`+`global.d.ts`）是 TS 链但触及构建配置，单独归属不与 IU6 冲突。

---

## Verification Strategy

**单元/组件测试**（每个 IU 自带测试，见上）。

**集成验证**（Phase 1 完成后）：
1. `npm run typecheck` — 类型安全（`__SKILL_VARIANT__` 声明就位、packager/zip 类型正确）。
2. `npm run lint` — 代码规范。
3. `npm test` — TS 全量绿（含 zip round-trip、packager 盖章、messaging、UI、构建钩子 smoke）。
4. `npm run test:python` — Python 全量绿（含 generator 保真 + drift 锁）。
5. `npm run build` — MV3 构建产出，且产物含 `agent-skill/SKILL.md`（占位符未被替换）。
6. 手动 QA（AE1-AE5）：CWS 版下载 → 结构 + ID 正确；build:dev 版 → dev variant；改 `DEV_EXTENSION_KEY` 自建 → 自定义 ID 盖章；手工改发布目录 → drift 测试红；`gen-skills` 再生 → 绿。
7. 真实解压 smoke：下载得到的 zip 用系统工具（`Expand-Archive` / `unzip`）解压，确认顶层文件夹 + 两文件结构正确、`.py` 可被 `python -c "import ast; ast.parse(open(...).read())"` 解析（语法完好）。

**关键审计点**：packager 不经手任何 BYOK key（模板无密钥，纯文本资源）；`browser.runtime.getURL` 仅取自有扩展资源；下载入口不绕过 bridge 信任检查（skill 文件本身无能力，启用 bridge 仍是使用前置）。

---

## Sources & Research

- **@explorer 侦查 `ses_02de45438ffevmmlBODE4mg9W3`** — skill 源布局、扩展 ID 烙印位置（`juso_search.py:32` 硬编码 + `:390` env/CLI 覆盖）、两 ID 产生机制（`wxt.config.ts:7-13` key gating + `wxt-self-contained-dev-build.md`）、构建管线（`public/` 语义、`bridge.html` 不入 WAR）、Options 结构（`App.tsx:130-135` nav、`:431-435` AgentBridgeSettings 挂载点）、ConfigExport 下载先例（`gateway.ts:327-351` + `:401-403`）。
- **`docs/solutions/integration-issues/agent-bridge-skill-contract-drift.md`** — 手工双胞胎 drift 的真实缺陷记录（5 个独立 bug）与 Prevention 原则（"cross-end contracts must be tested across the ends"），本计划 KTD3/drift 锁的直接依据。
- **`docs/solutions/architecture-patterns/agent-skill-localhost-capability-bridge.md`** — bridge 架构与安全模型（BYOK 边界、loopback-only、默认关闭），本计划 R10 安全不变的参照。
- **`docs/plans/2026-08-02-001-provider-instances-plan.md`** — 本仓库计划文档的 house style（frontmatter / Goal Capsule / R-AE-KTD-IU-Sequencing-Verification 结构）。
- **决策对话** — 用户拍板：A（内置分发，非外部 skill）；压缩包内含顶层文件夹；generator 用 Python；保留双发布目录供可发现性；自定义 dev 也要有配套 skill（→ 运行时盖章）。
