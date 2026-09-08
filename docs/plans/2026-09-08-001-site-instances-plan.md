---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "Site Instances — Plan"
type: feat
date: 2026-09-08
---

# Site Instances — Plan

## Goal Capsule

**目标**：把 Site Engine 强化为 Site Instance——同一站点可在快切栏拥有多个实例，每个实例选择构造模式（百度站内 zhannei / Bing q1 / 经典 `site:` 前缀）并携带 per-instance 参数（zhannei 时间范围/排序/仅标题）；`zhannei.baidu.com` 纳入 SERP Scope（结果页可注入快切栏）；存量配置无感迁移（baidu 默认迁向 zhannei）。

**权威层级**：本计划由 2026-09-08 调研 + 用户决策产生，产品行为与技术决策以本文件为准。

**停止条件**：模式模型 + URL 构造/识别 + zhannei SERP surface + UI 编辑器 + 迁移语义全部落地，`npm run typecheck && npm run lint && npm test` 全绿，zhannei 锚点完成真机复核。

**执行画像**：纯函数优先（构造/识别/归一化全部可单测）；组件测试 mock messaging/storage；zhannei 锚点需 dev 构建真机复核。

---

## 调研结论（已实测，实施时无需重查）

### 百度站内搜索 `https://zhannei.baidu.com/cse/site`

| 参数 | 含义 | 取值 |
|---|---|---|
| `q` | 关键词 | 任意（URL 编码） |
| `cc` | 站点域名 | **仅 host，不支持路径** |
| `p` | 页码 | 数字 |
| `sti` | 时间范围（分钟） | `60`（1小时）/`1440`（1天）/`10080`（1周）/`43200`（1月） |
| `sort` | 排序 | `lds` = 按时间（缺省相关性） |
| `stp` | 搜索字段 | `1` = 仅标题（缺省全文） |
| `ie` | 输入编码 | `utf-8`/`gbk`（现代浏览器可省） |
| `click`/`nsid`/`entry` | 跟踪尾巴 | 一律不生成 |

实测（2026-09-08）：`?q=python&cc=52pojie.cn` 返回 54 万条结果，全部来自目标域。`sti`/`sort`/`stp` 取值来自页面内 `cse.util.select(...)` 调用。

### Bing `q1` 参数

- `q1` = Bing 高级搜索页「高级关键字」字段：与 `q` 分离携带 `site:`、`-site:`、`filetype:`、`inurl:`、`intitle:` 等操作符。分页（`first=`）与筛选（`filters=`）链接均保留 `q1`——引擎认知的一等参数，非一次性尾巴。
- 形态：`https://www.bing.com/search?q=<query>&q1=site%3A<scope>`（www 形式；CN 用户重定向到 cn.bing.com 时参数保留。`BING_SERP_HOSTS` 已含双 host，`matches()` 无需改）。
- 附带可用参数（本期不用）：`filters`、`first`、`count`、`mkt`、`ensearch`。
- 注意：server 端无 cookie 抓取下 `q1` 不生效（bot 视图），浏览器真实会话生效（用户实例已验证）。测试断言只验 URL 构造，不做网络验证。

### Google

无专用站内参数（`sitesearch` 已废弃），唯一构造 `q=site:scope query`（现状）。

---

## Product Contract

### Requirements

- **R1. 实例模型**：Site Engine 更名升级为 Site Instance。`SiteInstanceDefinition` 增加 per-instance `options`：构造模式 + zhannei 筛选。同一站点可有多个实例（不同引擎/模式/筛选）。
- **R2. 构造模式**：
  - baidu：`zhannei`（默认，真站内）| `query`（`wd=site:host q` 前缀，兼容回退）；
  - bing：`q1`（新建默认）| `query`（存量默认，`q=site:scope q` 前缀）；
  - google：无模式（恒前缀）。
- **R3. zhannei 筛选**（仅 zhannei 模式）：`timeRange`（60/1440/10080/43200）、`sortByTime`（`sort=lds`）、`titleOnly`（`stp=1`）。
- **R4. 无感迁移**：id 仍为 `site:<uuid>`、存储键值仍为 `siteEngines`、导出文件字段仍为 `siteEngines`——Source Order / Visibility / Active Source / Group Layout 持久化数据零迁移。旧记录无 `options` → 读侧默认：baidu=`zhannei`（有意的行为变更，用户确认）、bing=`query`（行为不变）。**无 schema bump**（Default-by-Getter，见 CONCEPTS.md）。
- **R5. zhannei 纳入 SERP Scope**：快切栏可注入 `zhannei.baidu.com/cse/site` 结果页；backing engine 语义挂 `baidu`（隐藏裸 baidu 但有可见匹配实例时仍挂载，沿用 `shouldMountForEngine` 现有语义）。
- **R6. 跨模式识别**：SERP 上下文识别按 `(engineId, scope)` 匹配、与构造模式无关——用户手输 `site:x q`（任意引擎）或手拼 `q1=site:x` 都能正确高亮实例并还原干净 baseQuery。
- **R7. 词汇重命名**：Site Engine → Site Instance（类型/函数/组件/消息名/i18n/文档），存储键值与导出字段除外。

### Scope Boundaries

**范围内**：模式模型、URL 构造、URL 参数识别、zhannei SERP surface（含锚点）、UI 编辑器、重命名、迁移语义、全量测试、文档。

**非目标**：
- 百度主站 `si+ct` / `q6` 构造（与 zhannei 价值本质不同——主站是松散限定非真站内；若将来做，另行设计，不进构造模式枚举）；
- bing `filters`/`freshness`/`count`/`mkt` 等参数暴露；
- zhannei 的 agent engine-extraction（Engine Extractor 按 EngineId 注册，zhannei 无 EngineId，不适用）；
- `/cse/search?s=<sid>` 自定义搜索框形态；
- 雅虎/其他引擎。

### Acceptance Examples

- **AE1**：新建百度实例「吾爱破解」（`52pojie.cn`，zhannei，timeRange=10080）→ 快切栏 pill → 点击 → `https://zhannei.baidu.com/cse/site?q=<q>&cc=52pojie.cn&sti=10080`，页面顶部出现快切栏且高亮该实例。
- **AE2**：在 zhannei 结果页点 bing chip → 以 `q` 参数的干净值（无 `site:` 前缀）跳转 bing。
- **AE3**：新建 bing 实例（q1 模式）→ 导航 `www.bing.com/search?q=<q>&q1=site%3A52pojie.cn`；在结果页快切栏看到该实例高亮、baseQuery 干净。
- **AE4**：存量 baidu site engine（无 options）→ 导航目标变为 zhannei 端点（scope 本就 host-only，无损）；存量 bing → 仍走 `q=site:...` 前缀。
- **AE5**：同站「百度-zhannei-一周内」与「百度-zhannei-不限」共存；同站「百度-zhannei」与「必应-q1」共存；同 `(engine, mode, scope, 筛选)` 完全重复被拒。
- **AE6**：导出配置含 options 字段；旧备份（无 options）导入成功且读侧默认生效。
- **AE7**：zhannei 模式下 target 输入带路径 → 按 host-only 处理（与现有 baidu 裁剪一致）；bing 维持 ≤2 段路径、google 维持 host+path。

### 关键假设

- 上限常量值不变（`MAX_SITE_ENGINES = 50` 等，仅改名）。
- zhannei 端点为纯服务端渲染页，锚点候选需真机复核后修正。
- `q1` 在浏览器真实会话稳定（已验证）；URL 构造测试不做网络验证。

---

## Planning Contract

### Key Technical Decisions

**KTD1. 扩展现有定义，不建平行实体。**
沿用 `site:<uuid>` id、`siteEngines` 存储键与导出字段，`options` 为纯增量字段（Default-by-Getter，无 schema bump）。镜像 Provider Instance 的 options-bag 先例（`lib/provider-instances.ts`），但不引入新 id 空间——site 本就是动态 source，无「裸 pill vs 实例 pill」的对齐问题。

**KTD2. 构造与识别解耦：模式只管造 URL，识别按 (engineId, scope)。**
现状 `site:scope query` 前缀身兼构造与识别两职；zhannei/q1 把 scope 移入专用参数后，识别改为三路：① zhannei URL 读 `cc`；② bing URL 读 `q1` 的 `site:` 操作数；③ 前缀匹配（保留）。三路都落到 `(engineId, scope)` 键上跨模式匹配——这是 R6 与迁移自愈（旧 `site:` 书签仍高亮）的基础。

**KTD3. zhannei 以「合成 surface engine」进入 SERP Scope，不动 EngineId union。**
新建 `baiduZhanneiSurface: SearchEngine`（`id: 'baidu'`——合法 EngineId，满足类型；`matches()` 只认 `zhannei.baidu.com/cse/site`；`extractQuery()` 读 `q`；独立 anchors）。**不进 registry、不进 `allEngines()`、无裸 pill**。`matchEngineByUrl` 在主 registry 之后追加 surface 检查（host 无冲突，顺序无实际影响）。`scopes.ts` 加 `ZHANNEI_SERP_HOSTS` 并入 `SERP_HOSTS` + `SERP_CONTENT_MATCH_PATTERNS` 加 `/cse/site` 条目——favicon WAR（`wxt.config.ts` 引用 `SERP_HOST_MATCH_PATTERNS`）与 challenge 检测自动跟随，`wxt.config.ts` 本身零改动。

**KTD4. 读侧默认与建侧默认分离。**
读侧（legacy 无 options）：baidu=`zhannei`、bing=`query`——存量 bing 无感。建侧（UI 表单初值 + 提交）：baidu=`zhannei`、bing=`q1`（用户确认的新默认）。gateway create/update 总是写入显式 mode。用户编辑存量 bing 实例保存后，`query` 成为显式值。

**KTD5. options 严格白名单校验，非法值降级为默认（非整记录拒绝）。**
options 是增量偏好而非完整性关键字段：mode 不在 engine 允许集内 → 按 undefined 处理（落读侧默认）；`timeRange` 不在 4 枚举内 → 丢弃；`sortByTime`/`titleOnly` 仅 `true` 物化（false/缺省 = 不生成参数）；未知键忽略；google 带任何 options → 整体丢弃。**绝不把用户输入拼成任意 URL 参数——防注入**。

**KTD6. 去重键扩展为 `(engineId, mode, scope, zhannei筛选指纹)`。**
同 (engine, scope) 不同模式/筛选 = 合法多实例。三处同步更新：`normalizeSiteInstanceDefinitions`（**存储读**——跨模式记录不得被误丢，这是最关键的回归点）、`findDuplicateSiteInstanceScopes`（UI 校验）、gateway create/update 检查。

**KTD7. 词汇重命名先行的两段式落地。**
先做零行为变更的纯重命名提交（全部测试保持绿），再叠语义变更——评审与 bisect 友好。重命名边界：**改**类型/函数/组件/内部消息名/i18n 标签；**不改**`siteEngines` 存储键值、导出字段名、`site:` id 前缀（持久化兼容三锚点）。

**KTD8. `resolveSerpContext` 升签名为 `(engine, url, ...)`。**
现签名只收 query 串，URL 参数识别进不来。改为收 engine 对象 + 完整 URL，内部：`engine.extractQuery(url)` 得 raw query → 三路识别（KTD2）。唯一调用方是 `entrypoints/serp-bar.content.ts`（`loadBarState` L594-602 与 `applyConfigSnapshot` L154-162）；搜索页 App.tsx 不调用它。

### Alternatives Considered

- **独立 SiteInstance 实体 + id 迁移**：被否——Source Order/Visibility/Active Source/Group Layout 四轴持久化全要迁移，收益为零（KTD1）。
- **zhannei 注册为正式 EngineId（裸 pill）**：被否——无 cc 的 zhannei 搜索无意义，且污染 allEngines() 驱动的快切栏/右键菜单/agent 列表（KTD3）。
- **识别按模式精确匹配**：被否——手输 `site:` 或手拼 `q1` 的 SERP 无法高亮实例，迁移后旧书签行为退化（KTD2）。
- **`si+ct` 第三模式**：被否（用户决策）——主站松散限定非真站内，价值本质不同；留待独立设计。

### Patterns to Follow

- `lib/provider-instances.ts` — options-bag + 白名单归一化的模板。
- `lib/site-engines.ts`（改造对象）— id guard / normalizer / byte-budget / 存储读去重的现有实现。
- `lib/engines/baidu.ts` — engine 模块结构（SERP_URL_TEMPLATE 私有、matches/extractQuery 契约）。
- `lib/storage/site-engine-store.ts` — CRUD + mutation queue 模式（改名不改语义；锁序：source-graph 队列先行，见 CONCEPTS.md Storage Mutation Queue）。
- `components/ProviderInstanceManager`（若存在 per-provider options form）与 `components/SiteEngineManager.tsx` — 编辑器表单模式。

### Risks

- **R-1（高）**：`resolveSerpContext` 签名变更 + 识别三路化，可能破坏既有 google/bing 前缀识别回归。缓解：先写齐现状行为快照测试（google 前缀 / bing 前缀 / raw `site:` 无匹配三态），重构后保持全绿。
- **R-2（高）**：存储读去重键变更若遗漏 `normalizeSiteInstanceDefinitions`，跨模式记录被静默丢弃（数据丢失）。缓解：混合存量+新式集合的归一化测试（AE5 场景）。
- **R-3（中）**：zhannei 锚点未真机复核。缓解：先落保守候选（body 兜底），QA 阶段真机复核替换；快切栏三档栏位（top/bottom 覆盖层）不依赖锚点，可先行可用。
- **R-4（中）**：重命名波及 ~15 文件，漏改导致类型/运行时不一致。缓解：KTD7 两段式；grep 清单见 IU0；`npm run typecheck && npm run lint && npm test` 每段全绿。
- **R-5（低）**：`q1` server 端抓取不生效可能让实施者误判。缓解：本计划已注明 bot 视图限制，测试只断言 URL 构造。

---

## Implementation Units

### IU0: 词汇重命名（零行为变更，先行提交）

**清单**（grep `site-engine|SiteEngine|siteEngines` 全量核对）：

| 现名 | 新名 |
|---|---|
| `lib/site-engines.ts` | `lib/site-instances.ts` |
| `SiteEngineDefinition` / `SiteEngineId` / `SiteEngineEngineId` | `SiteInstanceDefinition` / `SiteInstanceId` / `SiteInstanceEngineId` |
| `isSiteEngineId` / `isSiteEngineEngineId` | `isSiteInstanceId` / `isSiteInstanceEngineId` |
| `normalizeSiteEngineDefinition(s)` | `normalizeSiteInstanceDefinition(s)` |
| `isBoundedSiteEngineCollection` / `siteEnginesSerializedBytes` | `isBoundedSiteInstanceCollection` / `siteInstancesSerializedBytes` |
| `MAX_SITE_ENGINES` / `MAX_SITE_ENGINE_NAME_LENGTH` / `MAX_SITE_ENGINES_SERIALIZED_BYTES` | `MAX_SITE_INSTANCES` / `MAX_INSTANCE_NAME_LENGTH` / `MAX_INSTANCES_SERIALIZED_BYTES`（值不变） |
| `lib/storage/site-engine-store.ts` + `getSiteEngineDefinitions` 等 CRUD | `lib/storage/site-instance-store.ts` + `getSiteInstanceDefinitions` 等 |
| `SITE_ENGINES_KEY`（`lib/storage/keys.ts`） | `SITE_INSTANCES_KEY`，**值仍为 `'siteEngines'`**（注释说明） |
| 消息名 `createSiteEngine`/`updateSiteEngine`/`deleteSiteEngine`（`lib/messaging.ts`、`entrypoints/background.ts` L97-99、`lib/gateway.ts` L252-265） | `createSiteInstance`/`updateSiteInstance`/`deleteSiteInstance`（内部协议，无持久化兼容问题） |
| `handleCreateSiteEngine` 等 gateway 处理器 | `handleCreateSiteInstance` 等 |
| `ProviderConfigReply.siteEngines` 字段 | `siteInstances`（运行时字段，全调用点同步） |
| `SourceKind 'site-engine'`、`SearchSource.siteEngine`（`lib/sources.ts`） | `'site-instance'`、`siteInstance` |
| `components/SiteEngineManager.tsx` | `components/SiteInstanceManager.tsx` |
| `resolveCurrentSiteEngineHandoff` / `decidePostWriteSiteEngineNavigation`（`lib/serp-handoff.ts`） | `resolveCurrentSiteInstanceHandoff` / `decidePostWriteSiteInstanceNavigation` |
| i18n `public/_locales/{zh_CN,en}/messages.json` 中「站点引擎/site engine」标签 | 「站点实例/site instance」 |

**不改**：`siteEngines` 存储键值、`ConfigExportFile.siteEngines` 导出字段名（`lib/config-io.ts` L74，旧备份兼容）、`site:` id 前缀、`ConfigExportImport.tsx` 的 `prefLabel('siteEngines')` 标签键。

**波及文件**（已知）：`lib/{site-engines→site-instances,serp-handoff,sources,source-groups,context-menu,config-io,gateway,messaging}.ts`、`lib/storage/{site-engine-store→site-instance-store,keys,custom-engine-store,provider-instance-store,index}.ts`、`entrypoints/{background,search/App,serp-bar.content,selection-search.content,options/App}.tsx|.ts`、`components/SiteEngineManager→SiteInstanceManager.tsx`、`tests/{site-engines→site-instances,serp-bar,serp-handoff,gateway,options-page}.test.*`。

**完成标准**：重命名后全量测试绿，无任何行为 diff（`git diff` 仅语义等价改名）。

### IU1: `lib/site-instances.ts` — 模式模型 + URL 构造 + 识别

**类型**：

```ts
export type BaiduSiteConstruction = 'zhannei' | 'query';
export type BingSiteConstruction = 'query' | 'q1';
export interface ZhanneiFilters {
  timeRange?: 60 | 1440 | 10080 | 43200;
  sortByTime?: boolean;
  titleOnly?: boolean;
}
export interface SiteInstanceOptions {
  mode?: BaiduSiteConstruction | BingSiteConstruction;
  zhannei?: ZhanneiFilters;
}
export interface SiteInstanceDefinition {
  id: SiteInstanceId; name: string; target: string;
  engineId: SiteInstanceEngineId;
  options?: SiteInstanceOptions;
}
```

**函数**：
- `legacyDefaultConstruction(engineId)`：baidu→`'zhannei'`、bing→`'query'`（读侧默认，KTD4）。
- `constructionFor(definition)`：`options.mode` 合法则用之，否则读侧默认；google 恒 `'query'`。
- `normalizeSiteInstanceDefinition`：现有逻辑 + options 白名单降级（KTD5）。
- `normalizeSiteInstanceDefinitions`：去重键改 `${engineId}\u0000${mode}\u0000${scope}\u0000${zhanneiFingerprint}`（KTD6）；`scope` 仍由 `siteScopeForTarget(engineId, target)` 按引擎裁剪（baidu host-only / bing ≤2 段 / google host+path，即现有实现不改——zhannei 复用 baidu 的 host-only 规则）。
- `buildSiteScopeQuery(scope, baseQuery)`：原 `buildSiteEngineQuery` 的前缀形式（供 query 模式构造与前缀识别共用）。
- `buildSiteInstanceUrl(definition, baseQuery): string | null`：
  - zhannei：`https://zhannei.baidu.com/cse/site?q=${encodeURIComponent(baseQuery)}&cc=${hostname}` + `timeRange→&sti=` + `sortByTime→&sort=lds` + `titleOnly→&stp=1`；
  - bing/q1：`https://www.bing.com/search?q=${encodeURIComponent(baseQuery)}&q1=${encodeURIComponent('site:' + scope)}`；
  - query 模式 + google：`getEngine(engineId).buildSerpUrl(buildSiteScopeQuery(scope, baseQuery))`（现状路径）。
  - 空 baseQuery 语义与现状对齐（site:scope 单独成查；zhannei 空 q 合法、bing 空 q 由引擎处理）。
- `matchSiteInstanceFromUrl(engine, url, definitions, activeSourceId?, sourceOrder?): { siteId; baseQuery } | null`（KTD2 三路）：
  - surface 为 zhannei：读 `cc`（去尾点/小写）匹配 `engineId==='baidu'` 且 scope 相等的定义（跨模式）；baseQuery=`q`；
  - bing SERP 且有 `q1`：解码后取首个 `site:(\S+)` 操作数，匹配 `engineId==='bing'` 定义（跨模式）；baseQuery=`q`；
  - 前缀路径：重构 `matchSiteEngineQuery` 为 scope 驱动（前缀由 scope 生成，不再耦合构造模式），保留 active-source-first / 完整前缀 + 单空格边界语义。
- `findDuplicateSiteInstanceScopes`：去重键同步（KTD6）。

**测试**（`tests/site-instances.test.ts` 扩展）：读侧/建侧默认矩阵、options 降级矩阵（非法 mode/枚举外 timeRange/非 boolean/google 带 options）、URL 构造（含 `q1=site%3A` 编码、sti/sort/stp 生成与缺省）、三路识别（zhannei cc / bing q1 编码 / 前缀回退 / 跨模式高亮）、混合存量+新式集合归一化不丢记录、去重三态。

### IU2: zhannei SERP surface

**文件**：`lib/engines/baidu-zhannei.ts`（新建）+ `lib/engines/scopes.ts` + `lib/engines/registry.ts`。

- `scopes.ts`：`ZHANNEI_SERP_HOSTS = ['zhannei.baidu.com'] as const` 并入 `SERP_HOSTS`；`SERP_CONTENT_MATCH_PATTERNS` 追加 `serpContentMatchPattern('zhannei.baidu.com', '/cse/site')`；新增 `isZhanneiSerpHostname`。`isBaiduSerpHostname` 不变。
- `baidu-zhannei.ts`：`baiduZhanneiSurface: SearchEngine`——`id: 'baidu'`、`matches()` 用 `isSerpUrl(url, isZhanneiSerpHostname, '/cse/site')`（exact）、`extractQuery()` 读 `q`、anchors 先落保守候选（`{ selector: 'body', append: 'first' }` 兜底 + 待复核占位注释）、`buildSerpUrl`/`buildHomeUrl` 给最小实现（bar 从不调用；surface 不进 registry 所以无其他调用方）。
- `registry.ts` `matchEngineByUrl`：主循环后追加 `if (baiduZhanneiSurface.matches(url)) return baiduZhanneiSurface;`。

**测试**：`tests/engines/baidu-zhannei.test.ts`——canonical URL 判定（`/cse/site` exact、`/cse/search` 不匹配、http/带端口拒绝）、extractQuery。

### IU3: handoff 与上下文解析

**文件**：`lib/serp-handoff.ts` + `entrypoints/serp-bar.content.ts` + `entrypoints/search/App.tsx`。

- `resolveSerpContext(engine, url, definitions, activeSourceId?, sourceOrder?, hiddenSourceIds?)`（KTD8）：内部走 `matchSiteInstanceFromUrl`；`nextQueryAfterSerpContext` 的 raw `site:` 兜底分支保留（zhannei/q1 页 raw query 本就干净，不受影响）。
- `resolveSerpHandoff` site-instance 分支：改用 `buildSiteInstanceUrl(source.siteInstance, trimmed)`（替换 `buildSiteEngineQuery` + `engine.buildSerpUrl` 组合）；`resolveCurrentSiteInstanceHandoff` / `decidePostWriteSiteInstanceNavigation` 同步（post-write 重解析语义不变）。
- `serp-bar.content.ts`：`loadBarState` / `applyConfigSnapshot` 传 `engine + window.location.href`；`onSelect` site-instance 分支（L689-737）流程不变，仅改名与 URL 构造切换。`shouldMountForEngine('baidu', ...)` 对 zhannei surface 沿用现有语义。
- `entrypoints/search/App.tsx`：site-instance 分支（L137-141 手动提交判定、L228-310 导航流、L545-559 投影）改名适配，导航统一走 `resolveSerpHandoff`。
- `entrypoints/selection-search.content.ts` L147、`lib/context-menu.ts` L36/96/202：字段改名适配。

**测试**：`tests/serp-handoff.test.ts`（各模式 handoff URL、post-write 决策）、`tests/serp-bar.test.ts`（zhannei cc 上下文、bing q1 上下文、前缀回归、raw site: 兜底回归）。

### IU4: UI 编辑器

**文件**：`components/SiteInstanceManager.tsx` + `entrypoints/options/App.tsx` + i18n。

- 引擎选择后出现模式单选：baidu「站内搜索（默认）/ 主站前缀」；bing「q1 参数（默认）/ 前缀」；google 无单选。
- zhannei 模式下展开筛选区：时间范围下拉（不限/1小时/1天/1周/1月 → 60/1440/10080/43200）、「按时间排序」「仅标题」复选。
- 提交时 gateway 总是携带显式 mode + zhannei 筛选（KTD4 建侧默认）。
- `validate` 去重检查换新键；zhannei 模式 target 输入按 host-only 提示/裁剪（复用现有 per-engine 行为）。
- i18n：`public/_locales/{zh_CN,en}/messages.json` 新增模式/筛选项文案。

**测试**：`tests/options-page.test.tsx` 扩展——模式单选随引擎切换、zhannei 筛选区显隐、提交 payload 含显式 options、重复检测用例更新。

### IU5: gateway / messaging / config-io

- `lib/gateway.ts`：`handleCreateSiteInstance` / `handleUpdateSiteInstance` 接收并透传 `options`（白名单在 IU1 normalizer 兜底）；create/update 的重复检查用新键。
- `lib/messaging.ts`：消息类型加 `options` 字段。
- `lib/config-io.ts`：导出项含 options（字段名 `siteEngines` 不变）；导入旧文件（无 options）自然走读侧默认；`sameSiteEngines` 对比含 options 深比较；preview diff summary 显示模式变更。

**测试**：`tests/gateway.test.ts`（带 options 的 create/update/拒绝重复）、`tests/config-io.test.ts`（options 往返、旧备份导入、预览 diff）。

### IU6: 文档 + QA

- `CONCEPTS.md`：Site Engine 节重写为 Site Instance（模式、参数、构造/识别解耦、跨模式匹配、读侧/建侧默认、zhannei surface）；Site Graph 条目内名称同步。
- `AGENTS.md`：`lib/site-engines.ts` 路径引用更新为 `lib/site-instances.ts`，一句话提及 site instance。
- **QA（必做）**：`npm run build:dev` → `chrome://extensions` 加载 → 在 zhannei.baidu.com/cse/site 真机复核锚点候选，替换保守兜底；核验快切栏三档栏位（inline/top/bottom）与 chip 高亮、切源 baseQuery 干净。

---

## 实施顺序与依赖

```
IU0 重命名（先行，全绿）
  → IU1 纯函数层（模式/构造/识别/去重）      [IU0 后]
  → IU2 zhannei surface + scopes            [与 IU1 并行可行，仅依赖 IU0]
  → IU3 handoff/上下文/entrypoints           [依赖 IU1+IU2]
  → IU4 UI 编辑器 + i18n                     [依赖 IU1；可与 IU3 并行]
  → IU5 gateway/messaging/config-io          [依赖 IU1]
  → IU6 文档 + 真机 QA                       [最后]
```

## 验证

- 每阶段：`npm run typecheck && npm run lint && npm test`。
- 回归重点：现有 google/bing 前缀识别行为快照（IU3 前先补齐）、存储归一化混合集合测试（R-2）。
- 最终：IU6 QA 清单 + 全量命令 + `npm run build`（manifest 自动含 zhannei 匹配模式，人工抽查 `.output/chrome-mv3/manifest.json` 的 content_scripts 与 web_accessible_resources）。
