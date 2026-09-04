---
title: "One primary forward path per page: navigation hierarchy for two-door marketing sites"
date: 2026-09-04
category: design-patterns
module: website
problem_type: design_pattern
component: documentation
severity: medium
applies_when:
  - A multi-level site (landing pages, a shared docs hub, per-audience guides) lets sibling pages link to each other with equal visual weight, producing mutually-reachable loops
  - A hero and a bottom CTA band both surface the same two competing destinations (direct path plus hub detour) on one page
  - A page's only outbound links are external (store/release), or a guide ends with no install CTA, next steps, or cross-link — dead ends
  - A hub page must stay reachable (header/footer) for undecided visitors without being inserted as a mandatory detour beside the direct path
tags:
  - navigation
  - information-architecture
  - ux
  - hugo
  - i18n
  - link-graph
---

# 静态站页间导航：单一主前路原则（以 Juso 双面官网为例）

## Context

Juso（双面搜）官网是 Hugo extended 双语静态站（zh 根 / `en/` 镜像），手写 layout、零第三方 JS，文案集中在 `website/i18n/zh.yaml` + `en.yaml`，由 GitHub Pages CI 在 push 时从源码构建（`website/public/` 不入库）。页面拓扑（×2 语言）共 7 页：`/` 概览（双门论点）、`/human/` 与 `/agents/` 两张面落地页、`/docs/` 共享文档中枢、`/human/docs/` 与 `/agents/docs/` 两份五节指南，外加 404。全局 header（含面切换器与"文档"链接）和 footer 在所有页面常驻。

用户反馈的问题是**页间引导出现环与死路**。逐页排查后确认了四类病灶：

1. **双门环**：每张面页（`/human/`、`/agents/`）的 hero 和底部 CTA 各并排放两个文档链接——一个直达自己的指南（`docs_hub_human_link` / `docs_hub_agents_link`），一个去共享中枢 `/docs/`（`hero_shared_docs_link`，当时文案"共同安装与使用"）。而中枢对这位访客的唯一增量是把TA再链去指南：这就是一扇并排的"绕路门"。加上 header 面切换器和 footer 入口链接，三个节点两两互达、没有层级，用户的感受是"在原地转圈"。
2. **中枢偏侧**：`/docs/` 的 hero 次按钮只推人类指南（"进入人类使用文档"），智能体侧访客拿到的是一个不对称的枢纽。
3. **死路**：概览 `/` 底部 CTA 只有外链（CWS 安装 / GitHub Release），hero 也没有任何文档链接——站内去向为零；两份指南戛然而止（没有安装按钮、没有"下一步"、没有跨面链接）；i18n 键 `cta_next_steps`（"读完后下一步"）早已存在却只被用作 aria-label；指南 hero 的主按钮是个**假按钮**——样式像页面导航，`href` 实为页内锚（`#start` / `#requirements`）。
4. **漂移**：doors-section 的注释写着 "three entries (incl. docs)" 实际只渲染两扇门；孤儿 i18n 块 `sec_bridge`（"还有另一面：Agent Bridge" / `sec_bridge_link`）没有任何 layout 引用。手写 layout 站点没有框架兜底，这类文案/结构漂移只能靠机械检查拦截。

**失败与被拒绝的尝试（session）**：

- **带引号 grep 构建产物（无效，浪费了周期）**：`grep -oE 'href="[^"]*"'` 在 `hugo --minify` 的产物上返回空——minify 会剥掉属性引号，模式看似正确实则匹配不到任何东西，一度像"提取坏了"。
- **顶层 IA 重写（考虑后拒绝）**：曾考虑把 `/` 直接改成人类面落地页、重定向 `/human/`。拒绝理由：用户抱怨的是**页与页之间的引导**，不是顶层"概览+双门"架构本身；用 IA 手术去治导航病是过度治疗。
- **为"可发现性"在面页保留中枢门（考虑后拒绝）**：担心删掉后中枢曝光不足。拒绝理由：这扇门正是绕路环的成因；中枢经由全局 header 的"文档"始终可达，想要它的人不会找不到。

## Guidance

核心设计原则一句话：**每一页恰好携带一条主前路；层级 = 概览 → 面 → 指南 → 安装 / 跨面；文档中枢只服务未决者。**

落到实现上是五条可复用的实践：

1. **单门前路（single forward path）**：内容页的 hero 与底部 CTA 各只保留一个站内去向，指向层级中的"下一层"。面页删掉 `shared_href`/`shared_key`（中枢门），只留 `doc_href` → 自己的指南；概览页作为层级顶点则反向补齐——hero 与 CTA 都加上 `shared_href` → `/docs/`（标签改为中性的"使用文档"）。判据：任何页面正文里出现两个并排的站内去向时，问"哪一个是下一层？"，另一个降级到全局导航或删掉。
2. **中枢对称双出口**：`/docs/` 是站点里唯一同时服务两面的页面，它的 hero 次按钮区必须放**两个对称的 ghost 按钮**（人类指南 / 智能体指南），不偏向任何一面。偏侧的中枢会把另一面的访客系统性引向错误路径。
3. **指南页三件套收尾**：真按钮 + 返回行 + next-band。hero 主按钮从页内锚换成真实的 Chrome Web Store 安装外链（`target="_blank" rel="noopener"`；页内导航的职责交还给已有的 TOC）；顶部返回行改成 `<nav class="guide-back">` 双链（← 自己的面页 · 全部文档）；最后一个指南 section 之后用共享的 `cta-band` partial 追加 next-band：主按钮安装、ghost 外链（release / github）、shared 链接回自己的面页、guide 链接**跨面**指向另一面的指南。
4. **共享 partial 的语义参数化**：`cta-band` 的链接行 aria-label 原先硬编码 `i18n "cta_next_steps"`——这对指南页成立（确实"读完了"手册），但 partial 同时被概览/面页/中枢复用，那些页面没有手册可读完，aria 文案就成了谎言。改成 `{{ i18n (default "cta_links_label" .aria_key) }}`：指南传 `aria_key=cta_next_steps`，其余页面不传、落到中性键 `cta_links_label`（"下一步"）。经验法则：partial 里每一句引用 i18n 的文案，如果语义依赖"调用方是什么页面"，都必须变成参数并给 default。
5. **链接图审计配方（机械验证）**：
   - `hugo --source website --minify` 构建 zh+en；
   - 用 `grep -o 'href=[^ >]*'` 提取每页 href（**无引号模式**，见下文 gotcha）；
   - 逐页断言三条：面页正文中不含中枢链接（只允许 header/footer 全局导航）；每页 ≥1 个站内前向去向；全局导航之外无强制 A→B→A 环；
   - 用"新眼睛"做访客走查：人类线、智能体线、文档线、en 镜像、404，每条线确认"下一站"始终明确；
   - CI drift 锁（`scripts/check-website-tokens.py`、`scripts/check-website-assets.py`）保持绿，防止文案/资产漂移回潮。

## Why This Matters

- **导航可用性的根因是"互达无层级"**。页面数少的站点尤其容易每对页面互相链接，图论上处处可达意味着信息架构上处处迷失。单一主前路让用户在任何页面都能回答"我的下一站是什么"，环自然消失——不是靠删链接，而是靠给链接分层。
- **双面/多线产品对偏侧极其敏感**。共享中枢如果只推一条线，等于用页面位置表达产品偏好，另一面的用户每一步都被带偏；对称双出口是唯一既公平又低成本的形态。
- **假按钮侵蚀控件语义信任**。样式像"去别处"、行为是"看本页"的按钮会让用户不再相信按钮的视觉语言。该外链的（安装）给外链，该页内的（章节导航）交给 TOC 和锚点，各归其位。
- **零依赖手写站没有框架兜底**。React/Next 这类框架下孤儿组件和死文案会在构建或 lint 期暴露；手写 Hugo layout 里注释与实现、i18n 键与引用之间的漂移只能靠 drift 锁脚本和链接图审计这类机械防线拦截，验证步骤本身就是方案的一部分。
- **partial 复用会放大语义 bug**。aria-label 这类不可见文案最容易在复用中被忽略，但屏幕阅读器用户拿到的是确定的错误信息。参数化 + default 是一次性成本，换来 partial 可以安全地长出新的调用方。

## When to Apply

- 页面拓扑呈"概览 → 分面/分线落地页 → 详情/指南"的多入口静态站点（营销站、文档站），尤其当存在全局导航 + 页内 CTA 双重链接系统时。
- 同一目的地同时存在"中枢页绕行"和"直达页"两条等价路径时——删正文里的绕行门，把中枢保留给全局导航和层级顶点页出口。
- 共享 partial 被多种上下文复用、内嵌了上下文相关文案（标题、正文、aria-label）时——全部参数化并提供中性 default。
- Hugo/静态构建产物上做链接审计时——用无引号 grep 模式，或不加 `--minify` 构建后再用常规模式。
- **不适用**：当用户抱怨的其实是顶层 IA（双门/多门模型该不该存在、某个面该不该独立成页）时，先修结构再修导航——不要用链接分层去粉饰一个错误的信息架构（session 中正是靠这条判断否掉了 IA 重写方案）。页面数极少的单层站点（无层级可言）也套不上这套"下一层"规则。

## Examples

### 1. 双门 → 单门：面页 partial 调用 diff（session，commit 0673ccf）

Before（`layouts/agents/single.html`，hero 与 cta-band 两处同型；`layouts/human/single.html` 同理）：

```diff
   "cta_ghost_key" "cta_github"
   "cta_ghost_href" .Site.Params.githubURL
-  "shared_href" ("docs/" | relLangURL)
-  "shared_key" "hero_shared_docs_link"
   "doc_href" ("agents/docs/" | relLangURL)
   "doc_key" "docs_hub_agents_link"
```

After（`layouts/human/single.html` 现状，hero 只留直达指南的门）：

```go-html-template
{{ partial "hero.html" (dict
  "Page" .
  "positioning_key" "hero_positioning_human"
  "cta_primary_key" "cta_cws"
  "cta_primary_href" .Site.Params.cwsURL
  "cta_ghost_key" "cta_release"
  "cta_ghost_href" .Site.Params.releaseURL
  "doc_href" ("human/docs/" | relLangURL)
  "doc_key" "docs_hub_human_link"
  "visual" "hero-visual-home"
) }}
```

层级顶点反向取等——概览 `/`（`layouts/index.html`）hero 与 cta-band 都带中枢门：

```go-html-template
"shared_href" ("docs/" | relLangURL)
"shared_key" "hero_shared_docs_link"
```

### 2. 中枢对称双出口（`layouts/docs/list.html`）

```go-html-template
<div class="hero__cta">
  <a class="btn btn--primary" href="{{ .Site.Params.cwsURL }}" target="_blank" rel="noopener">{{ partial "icon/chrome.svg" . }}{{ i18n "docs_jump_install" }}</a>
  <a class="btn btn--ghost" href="{{ "human/docs/" | relLangURL }}">{{ i18n "docs_hub_human_link" }}</a>
  <a class="btn btn--ghost" href="{{ "agents/docs/" | relLangURL }}">{{ i18n "docs_hub_agents_link" }}</a>
</div>
```

### 3. 指南页：假按钮 → 真按钮 + 双链返回行 + next-band（`layouts/human-docs/single.html`）

```diff
-    <a class="guide-back" href="{{ "docs/" | relLangURL }}">← {{ i18n "guide_back" }}</a>
-    <a class="btn btn--primary" href="#start">{{ i18n "human_doc_open_app" }}</a>
+    <nav class="guide-back" aria-label="{{ i18n "docs_jump_label" }}">
+      <a href="{{ "human/" | relLangURL }}">← {{ i18n "guide_back_human" }}</a>
+      <span class="guide-back__sep" aria-hidden="true">·</span>
+      <a href="{{ "docs/" | relLangURL }}">{{ i18n "guide_back" }}</a>
+    </nav>
+    <a class="btn btn--primary" href="{{ .Site.Params.cwsURL }}" target="_blank" rel="noopener">{{ partial "icon/chrome.svg" . }}{{ i18n "docs_jump_install" }}</a>
```

最后一个指南 section 之后的 next-band（复用 `cta-band`，跨面链接指向另一面的指南）：

```go-html-template
{{ partial "cta-band.html" (dict
  "Page" .
  "h2_key" "guide_next_h2"
  "p_key" "guide_next_human_p"
  "primary_key" "docs_jump_install"
  "primary_href" .Site.Params.cwsURL
  "ghost_key" "cta_release"
  "ghost_href" .Site.Params.releaseURL
  "shared_href" ("human/" | relLangURL)
  "shared_key" "guide_back_human"
  "guide_href" ("agents/docs/" | relLangURL)
  "guide_key" "guide_cross_agents"
  "aria_key" "cta_next_steps"
) }}
```

### 4. aria-label 参数化（`layouts/partials/cta-band.html`）

```diff
-<nav class="ctaband__links" aria-label="{{ i18n "cta_next_steps" }}">
+<nav class="ctaband__links" aria-label="{{ i18n (default "cta_links_label" .aria_key) }}">
```

指南页传 `aria_key=cta_next_steps`（"读完后下一步"）；概览/面页/中枢不传，落中性键 `cta_links_label`（"下一步"）。

### 5. i18n 键增删（zh.yaml / en.yaml 双语同步）

新增 8 键（zh 值示例 / en 值）：

```yaml
guide_back_human:    { other: "人类面" }            # People face
guide_back_agents:   { other: "智能体面" }           # Agents face
guide_cross_human:   { other: "查看人类使用文档" }    # Read the people guide
guide_cross_agents:  { other: "查看智能体接入文档" }  # Read the agents guide
guide_next_h2:       { other: "读完手册，装上试试" }  # Done reading? Install and try it
guide_next_human_p:  # 安装扩展，从无需密钥的传统引擎开始第一次搜索
guide_next_agents_p: # 安装扩展后开启 Agent Bridge、下载配套技能
cta_links_label:     { other: "下一步" }            # Next steps
```

改词 1 键、删死键 2 个：

```diff
 hero_shared_docs_link:
-  other: "共同安装与使用"
+  other: "使用文档"          # Documentation
-human_doc_open_app:   { other: "进入开始使用" }      # 假按钮标签，随假按钮一起删除
-agents_doc_open_app:  { other: "进入接入前置条件" }
```

删除死键与清理孤儿键（如 `sec_bridge`）同样重要：留着只会诱惑未来的人把它重新接回去。

### 6. CSS：`.guide-back` 单链 → 双链容器（`assets/css/style.css`）

```css
.guide-back { display: inline-flex; align-items: center; gap: 12px; color: var(--muted); font-size: .89rem; font-weight: 600; margin-bottom: clamp(36px, 6vw, 70px); }
.guide-back a:hover { color: var(--brand); }
.guide-back__sep { color: var(--faint); font-weight: 400; }
```

### 7. grep gotcha：minify 剥属性引号（session）

```bash
# 坏：hugo --minify 产物上恒为空，看起来像提取坏了
grep -oE 'href="[^"]*"' website/public/**/*.html

# 好：无引号模式，匹配到下一个空白或 '>'
grep -o 'href=[^ >]*' website/public/index.html
```

### 8. eyebrow 死 span 统一（session，复查发现）

6 处 eyebrow 存在死的空 `<span></span>`（不可见、无样式；其余页面用 `<span class="dot"></span>`，由 `.eyebrow .dot` 着色）→ 统一改为 `span.dot`（`human-docs/single.html`、`agents-docs/single.html`、`docs/list.html` ×4）。**注意例外**：`.guide-command` 命令行窗口里三个裸 `<span>` 是有意为之——`.guide-command > div span` 专门画 CLI 窗口的三个圆点，不要顺手"统一"掉。

### 9. 验证清单（全绿标准）

```bash
hugo --source website --minify                    # zh + en 双语构建通过
npm run lint && npm test                          # 仓库基础检查不受影响
python scripts/check-website-tokens.py            # CI drift 锁 1
python scripts/check-website-assets.py            # CI drift 锁 2
# 链接图审计：对 12 个页面逐页 grep href=[^ >]*，
# 断言：面页正文无 /docs/ 链接；每页 ≥1 站内前向去向；无全局导航外的 A→B→A 环
```

`website/public/` 不提交（CI 的 `website-pages.yml` 在 push 时从源码构建），审计产物只留在本地。

## Related

- [Symmetric dual-face site structure](../architecture-patterns/juso-marketing-site-symmetric-dual-face-ia.md) — 本学习的父模型：该文档确立"中立概览根 + 对称面路由"的结构对称性，本文把对称性延伸到**前向链路接线**（门页只指向自己的指南、中枢只服务未决者、跨面交叉链）。
- [Website Hugo template maintainability](../architecture-patterns/website-hugo-template-maintainability.md) — 六大页面共用 hero/CTA band 的模板卫生模式；本文补充了 CTA href 正确性与注释保鲜两个实践点。
- [Website drift-lock enforcement](../architecture-patterns/website-drift-lock-enforcement.md) — 本文验证清单所依赖的 CI 锁基础设施（tokens / assets）；i18n 键一致性目前是规则 + 人工核对，尚未 CI 锁定。
- 实施 commit：`0673ccf`（fix(website): untangle page-to-page guidance flow）。
