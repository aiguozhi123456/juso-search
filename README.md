# 聚搜 / Juso

聚合已付费的 AI 搜索 API（Tavily / Exa / Stepfun 按量 / Stepfun Step Plan），把多家 provider 归一成一个人类日常可用的干净搜索引擎——Chromium MV3 浏览器扩展，BYOK 自带 key，答案优先的结果页。

## 命令

```bash
npm install          # 安装依赖
npm run dev          # 开发（WXT HMR）
npm run build        # 产出 .output/chrome-mv3/，可在 chrome://extensions 以"已解包"加载
npm run typecheck    # 类型检查
npm test             # 运行 Vitest 单测
npm run test:python  # 运行 Agent Skill Python 单测
npm run lint         # ESLint
```

## 架构

详见 `docs/plans/2026-07-01-001-juso-search-plan.md`。

- `entrypoints/background.ts` — service worker：图标开页 + API 网关
- `entrypoints/search/` — 独立搜索页（答案优先结果页）
- `entrypoints/options/` — 设置页（BYOK key、激活 provider）
- `lib/providers/` — provider 适配器（Tavily / Exa / Stepfun 按量 / Stepfun Step Plan）+ 归一化模型
- `lib/mcp-client.ts` — 最小 MCP streamableHttp 客户端（Step Plan）
- `lib/storage.ts` — `chrome.storage.local` 封装（BYOK key 仅本地、仅 worker 读取）

## 安全

API key **仅存 `chrome.storage.local`**，仅由 background worker 读取并发往对应 provider；不进 git、不上传第三方、无遥测。

## Agent Skill

将 `skills/juso-search/` 安装或复制到项目的 `.agents/skills/juso-search/`，并设置 `JUSO_EXTENSION_ID` 为已安装扩展的 32 位 ID；随后可运行 `python scripts/juso_search.py list-providers` 或带显式 `--provider` 的搜索命令。详见该目录的 `SKILL.md`。
