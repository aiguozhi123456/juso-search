# AGENTS.md

## 命令

- `npm install` — 安装依赖
- `npm run typecheck` — `tsc --noEmit`（类型检查，必须通过）
- `npm run lint` — `eslint .`（必须通过）
- `npm test` — `vitest run`（单元 + 组件测试，必须通过）
- `npm run build` — `wxt build` → `.output/chrome-mv3/`（在 `chrome://extensions` 以"已解包"加载）
- `npm run dev` — WXT 开发（HMR）

## 技术栈

WXT + React + TypeScript，Chrome MV3。WXT 自动导入 `defineBackground`、`browser`、`defineContentScript` 与 React hooks（无需手写 import）。使用 `browser`（已类型化），不要用 `chrome`。

## 架构

详见 `docs/plans/2026-07-01-001-product-ai-search-for-humans-plan.md`。

- `CONCEPTS.md` — 项目领域词汇（实体、命名流程、状态概念），阅读代码前可先查阅
- `docs/solutions/` — 已记录的问题解决方案，按类别组织，YAML frontmatter 含 module/tags/problem_type
- `lib/providers/` — 四个适配器（tavily/exa/stepfun/stepfun-plan）归一化为统一模型；共享 `http.ts`（REST）+ `mcp-client.ts`（Step Plan MCP）
- `lib/gateway.ts` — worker 处理器（key 仅 worker 读）；`lib/messaging.ts`（@webext-core/messaging，ok/error 判别联合）
- `lib/storage.ts` — `chrome.storage.local` BYOK（key 读函数按约定仅 worker 调用）
- `entrypoints/search` + `entrypoints/options` — 两个 UI；`components/` 复用组件

## 安全

API key 为 BYOK，仅存 `chrome.storage.local`，仅由 background worker 读取。绝不提交 key；页面代码绝不读明文 key（用 `hasKey` 做指示）。

## 测试

Vitest + jsdom。适配器 mock `fetch`（REST）/ MCP 端点（stepfun-plan），storage 用内存版 `browser.storage.local`。组件测试 mock `@/lib/messaging` 与 `@/lib/storage`。
