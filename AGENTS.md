# AGENTS.md

## 命令

- `npm install` — 安装依赖
- `npm run typecheck` — `tsc --noEmit`（类型检查，必须通过）
- `npm run lint` — `eslint .`（必须通过）
- `npm test` — `vitest run`（单元 + 组件测试，必须通过）
- `npm run build` — `wxt build` → `.output/chrome-mv3/`（在 `chrome://extensions` 以"已解包"加载）
- `npm run build:dev` — `wxt build --mode development` → `.output/chrome-mv3-dev/`（内嵌签名 key、无 dev server 依赖，扩展 ID 稳定）
- `npm run dev` — WXT 开发（HMR）
- `npm run test:python` — Python 测试（skill CLI + `juso_bridge` 单源 + drift 锁）
- `npm run test:mcp` — MCP server 测试（pytest）
- `npm run gen-skills` — 重新生成 skill 发布目录（prod/dev）+ MCP vendor 副本；`--check` 校验偏离

## 技术栈

WXT + React + TypeScript，Chrome MV3。WXT 自动导入 `defineBackground`、`browser`、`defineContentScript` 与 React hooks（无需手写 import）。使用 `browser`（已类型化），不要用 `chrome`。

## 架构

详见 `docs/plans/2026-07-01-001-juso-search-plan.md`。

- `CONCEPTS.md` — 项目领域词汇（实体、命名流程、状态概念），阅读代码前可先查阅
- `docs/solutions/` — 已记录的问题解决方案，按类别组织，YAML frontmatter 含 module/tags/problem_type；在已记录领域实现、调试或决策时可检索
- `lib/providers/` — 八个适配器（tavily/exa/brave/stepfun/stepfun-plan/jina/doubao/doubao-global）归一化为统一模型；共享 `http.ts`（REST）+ `mcp-client.ts`（Step Plan MCP）
- `lib/provider-instances.ts` — 同一 provider 的多实例（调好参数的变体），实例是快切栏一等目标，不持有密钥；gateway 在边界解析 `ProviderInstanceId → { providerId, options }`
- `lib/engines/` — 传统搜索引擎（google/bing/baidu/douyin/xiaohongshu/bilibili/yandex/duckduckgo）
- `lib/ai-engines/` — AI 对话引擎（grok/chatgpt/deepseek/doubao/gemini），注入或 URL 预填
- `lib/site-engines.ts`、`lib/custom-engines.ts` — 站外搜索（`site:`）、自定义引擎（`%s` URL 模板）
- `lib/gateway.ts` — worker 处理器（key 仅 worker 读）；`lib/messaging.ts`（@webext-core/messaging，ok/error 判别联合）
- `lib/storage.ts`、`lib/config-io.ts`、`lib/schema.ts` — `chrome.storage.local` BYOK（key 读函数按约定仅 worker 调用）、配置导入导出、schema 迁移
- `entrypoints/search` + `entrypoints/options` — 两个 UI；`components/` 复用组件
- `public/agent-skill/` — Agent Skill 模板源（`SKILL.md` + `scripts/juso_search.py` + `scripts/juso_bridge.py`）；`scripts/gen_skills.py` 渲染 prod/dev 发布目录 + MCP vendor 副本，drift 测试锁四处 `juso_bridge.py` 字节相等
- `mcp-server/` — 独立 pip 包 `juso-search`（[PyPI](https://pypi.org/project/juso-search/)），把 Agent Bridge 的 6 个 action 暴露为 MCP 工具（stdio），供 MCP 原生客户端调用；与 CLI skill 共享 `juso_bridge` 单源模块
- `lib/agent-skill-packager.ts` — worker 端 skill zip 打包（多文件：`SKILL.md` + `scripts/` + `reference/`）

## 安全

API key 为 BYOK，仅存 `chrome.storage.local`，仅由 background worker 读取。绝不提交 key；页面代码绝不读已存明文 key，也不读取 `providerKeys` map；需要配置状态时通过 worker message 返回脱敏状态（如已配置 provider id 列表）。

## 测试

Vitest + jsdom。适配器 mock `fetch`（REST）/ MCP 端点（stepfun-plan），storage 用内存版 `browser.storage.local`。组件测试 mock `@/lib/messaging` 与 `@/lib/storage`。

Python 测试（`npm run test:python`）覆盖 skill CLI、`juso_bridge` 单源与 drift 锁；MCP server 测试（`npm run test:mcp`，pytest）覆盖配置解析/退出码、工具 schema、dual-era 握手（真实子进程）与 stdout 纯净性。
