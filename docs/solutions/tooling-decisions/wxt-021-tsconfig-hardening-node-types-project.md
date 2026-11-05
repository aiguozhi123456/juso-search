---
title: WXT 0.21 Generated-tsconfig Hardening and Node Types via a Dedicated Test Project
date: 2026-11-05
category: tooling-decisions
module: build-tooling
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Upgrading wxt from 0.20.x to 0.21.x and hitting a wall of strict-mode typecheck errors"
  - "Tests or vitest.config.ts lose node globals (process, node:fs, node:url) after the upgrade"
  - "Deciding where @types/node should and should not be visible in a browser-extension repo"
symptoms:
  - "tsc --noEmit goes from 0 errors to ~270 errors after wxt prepare regenerates .wxt/tsconfig.json"
  - "TS2532/TS2345/TS18048 on array index and Map.get access across lib/components/tests"
  - "TS2591 'Cannot find name process / node:fs' in tests and vitest.config.ts"
root_cause: external_tooling_change
resolution_type: config_restructure
related_components:
  - tsconfig.json
  - tsconfig.node.json
  - package.json
tags:
  - wxt
  - typescript
  - tsconfig
  - vitest
  - noUncheckedIndexedAccess
---

# WXT 0.21 tsconfig 硬化与测试侧 node 类型的双 project 方案

## 问题

dependabot 升 wxt 0.20.27 → 0.21.5 后，`wxt prepare` 重新生成的
`.wxt/tsconfig.json` 新增三项严格开关：`noUncheckedIndexedAccess`、
`verbatimModuleSyntax`、`noImplicitOverride`（另有 `module: Preserve`、
`allowImportingTsExtensions`）。全库 typecheck 从 0 错误变为 274 个：

- **~243 个** TS2532/TS2345/TS18048/TS2322：`noUncheckedIndexedAccess`
  使数组索引 / `Map.get` / record 访问带上 `| undefined`，lib（41）、
  components（13）、tests（~190）三处集中。
- **31 个** TS2591：wxt 0.21 不再依赖 `@types/node`，生成配置也不含
  `types` 字段，tests 与 `vitest.config.ts` 里的 `process` / `node:fs` /
  `node:url` 失去解析。
- `verbatimModuleSyntax` 在本库**零错误**（issue #20 预估过 import type
  改写，实际无需）。

## 决策：node 类型放独立 project，不进浏览器代码

wxt 官方 0.21 升级指南未给 node types 方案（仅说 "fix the issues and
leave the new settings enabled"，回退走 `prepare:tsconfig` hook）。但维护者
方向明确（wxt-dev/wxt#1459、PR#1531，v1.1 里程碑）：**防止 node 类型泄漏
进浏览器代码**，认可 Nuxt 式多 tsconfig。据此：

- 根 `tsconfig.json` 保持 `types: []`（浏览器代码零 node 全局），新增
  `exclude: tests / vitest.config.ts`；
- 新增 `tsconfig.node.json`：extends 根配置，`types: ["node"]`，
  include `tests/**/*` + `vitest.config.ts` + `global.d.ts` +
  `.wxt/wxt.d.ts`（后两者缺一不可：`__SKILL_VARIANT__` 构建期常量声明在
  根 `global.d.ts`，tests 经 `lib/skill-variant.ts` 间接依赖；wxt 自动
  导入的 `browser` 等全局声明在 `.wxt/wxt.d.ts`）；
- `"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json"`；
- `@types/node@^22`（对齐 wxt 0.21 的 Node >=22 要求）。

注意 include 覆盖语义：extends 链中子配置的 `include`/`exclude` 整体替换
基类并以子配置自身路径解析；根配置只覆写 `exclude` 时需重述基类的
`**/node_modules`、`.output`。

## 守卫修复风格（noUncheckedIndexedAccess）

- **生产代码零 `!` 断言**（全库本就为零）：真实收窄（取值后真值守卫、
  早退、解构默认值）、重构消除索引回查（`findIndex`+回查 → `entries()`
  单次扫描；平行数组 → 记录数组；`allSettled`+回查 → 成员级闭包携带）、
  可证等价兜底（`??` 仅用于不可达分支）。
- **测试代码**：`expect()` 不做类型收窄，紧邻 `toBeDefined` 断言处允许
  少量 `!`；断言强度不变。
- 角落行为显式化一例：`lib/serp-bar-mount.ts` 的 `pickAnchor` 空数组输入
  由静默返回 `undefined` 改为显式 `throw`（契约外编程错误，严格索引访问
  下原路径类型不可达）。

## 验证

typecheck（双 project）、eslint、vitest（89 文件 / 1849 用例）、
`wxt build`（chrome-mv3）全绿。zip 字节级测试锁定 `lib/zip.ts` 重构
产出不变。

## 参考

- issue #20、PR #15（dependabot，升级暴露问题后关闭）
- https://wxt.dev/guide/resources/upgrading.html#v0-20-0-v0-21-0
- https://github.com/wxt-dev/wxt/issues/1459 · https://github.com/wxt-dev/wxt/pull/1531
