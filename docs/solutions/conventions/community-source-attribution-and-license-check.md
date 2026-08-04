---
title: "Community-source attribution: credit scripts/articles a feature draws on and check their licenses"
date: 2026-08-05
category: conventions
module: "README / options About / docs/solutions"
problem_type: convention
component: documentation
severity: low
applies_when:
  - "A feature's selectors, techniques, or approach are drawn from community userscripts, articles, or forum posts"
  - "Before shipping a feature whose know-how came from external community sources"
related_components: [README.md, README.en.md, entrypoints/options/App.tsx]
tags: [attribution, licensing, community-scripts, userscripts, acknowledgements, compliance]
---

# Community-source attribution: credit scripts/articles a feature draws on and check their licenses

## Context

本扩展多次站在社区知识之上构建。迄今已有两次实现直接借鉴了社区油猴脚本与技术文章：SERP 切换栏的注入锚点思路参考自 searchEngineJump 脚本；AI 对话引擎注入器的各站选择器 / 填充 / 提交技巧，参考自一批 Greasy Fork 脚本、gist 与技术文章（DeepSeek / ChatGPT / Gemini / 豆包）。每一次，团队都欠社区两件事：**可见的致谢**与**协议核查**。第一次（searchEngineJump）处理得较随意，第二次（AI 引擎）更刻意；本约定把刻意的版本固定下来，使其不因人员更替而丢失。

## Guidance

当一个功能的选择器、技巧或方案借鉴自社区脚本 / 文章时：

1. **三处致谢，三种深度。**
   - `README.md` + `README.en.md` 的「鸣谢 / Acknowledgements」节——一段简洁文字，点名来源（脚本名、作者、链接、许可），并声明实现为独立编写、不共享代码。
   - 设置页 **About** 的致谢节——同样的简洁致谢进 UI（双语），匹配既有 `about-ack` 样式。
   - 该功能的 `docs/solutions/` 文档——完整的按站来源清单 + 协议注记（持久记录）。
2. **每个来源记录：名称、作者、URL、许可。** 许可标注为「已确认」（来自 `@license` 头、Greasy Fork 许可字段或仓库 LICENSE）或「未确认」（字段不可读）。不要断言无法核实的许可。
3. **查协议，但正确界定义务边界。** 义务取决于**是否复制了代码**，而非是否受启发：
   - 选择器是站点 DOM 事实——不受版权保护。
   - 标准 Web API 技巧（React native value setter、`execCommand('insertText')`、contenteditable 同步、`PerformanceNavigationTiming`）——不受版权保护。
   - 只有逐字 / 近逐字复制代码才产生许可义务（copyleft 传染条款、署名条款、NonCommercial 条款）。
   因此，若实现独立编写、仅复用 DOM 事实 + 标准 API，许可除礼貌性致谢外不产生义务——但仍要记录许可，且**绝不**复制无许可或 NonCommercial 来源的代码。

## Why This Matters

项目站在社区知识之上；致谢既是伦理回馈，也是合规保障。协议核查之所以重要，不是因为「受启发」有风险——通常没有——而是因为那条线是「我们是否复制了代码」，这条线必须有意识地核查并记录，而不是想当然。把「已确认 / 未确认」许可记录下来、把持久清单放在 docs/solutions，意味着未来维护者一次阅读就能回答「我们欠什么、我们合规吗」。

## When to Apply

- 功能的选择器 / 填充 / 提交 / 方案来自社区油猴脚本、文章或论坛帖。
- 你在改造一个已知社区技巧，而非自己发明。
- 发布前，确认致谢已存在、许可已记录。

## Examples

- **searchEngineJump**（第一例）：SERP 切换栏锚点 + CSS shim 思路致谢于 README / About，「MIT 许可、独立编写、不共享代码」。
- **AI 引擎注入器**（第二例）：完整按站清单见 `architecture-patterns/ai-engine-conversation-navigation-source-type.md`「社区来源与协议」。协议状态：smilingpoplar 550940 与 CathyElla 541111 已确认 MIT（`@license MIT` 头）；orca131 与 boommanpro 未标注许可；528300 未确认（Greasy Fork 屏蔽许可字段）。实现独立编写、未复制代码 → 合规，致谢为礼貌性质。

## Related

- ./bilingual-visual-assets-per-readme-language.md — 同一双语文档家族（README.md / README.en.md 都须承载致谢）。
- ../architecture-patterns/ai-engine-conversation-navigation-source-type.md — 第二例的完整来源 + 协议记录。
