---
title: "Splitting lib/storage into a domain directory while preserving queue identity and lock order"
date: 2026-08-14
category: architecture-patterns
module: lib/storage
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Splitting a large chrome.storage accessor module (one file, many storage domains) into a directory without changing any caller imports"
  - "Preserving module-level promise-chain mutation queues across a file-to-directory split (queue identity must stay singular)"
  - "Keeping a documented lock order intact when serialized queues move into separate files behind a barrel"
  - "Enforcing barrel-only imports for a lib/ directory via eslint no-restricted-imports"
  - "Locking a barrel's public export surface with an alphabetical snapshot test plus type-only export accounting"
related_components:
  - lib/config-io.ts
  - lib/schema.ts
  - lib/gateway.ts
  - eslint.config.mjs
  - tests/storage-surface.test.ts
  - tests/storage-lock-order.test.ts
tags: [module-split, barrel-exports, esm-single-instance, mutation-queues, lock-order, chrome-storage, no-restricted-imports, snapshot-test]
---

# lib/storage.ts → lib/storage/：域模块拆分中的 barrel 导出面保持与并发队列单一实例

## Context

`lib/storage.ts` 是这个 WXT + React + TypeScript Chrome MV3 扩展里最大的单文件：898 行、92 个导出（88 个运行时值 + 4 个纯类型）。它长期承载两类本质不同的东西：

- **6 个存储域的领域逻辑**：provider keys（BYOK 密钥）、prefs（theme/locale/style/barPosition 等 20 个只读偏好）、source graph（`sourceOrder` / `sourceHidden` / `groupConfig` / `activeSource`）、site-engines、custom-engines、provider-instances，外加 search-cache 的包装函数；
- **5 个模块级并发原语**：providerKeys / source graph / providerMaxResults / providerInstances / searchCache 各自的 promise 链读改写串行队列（`withSourceMutation`、`withProviderKeysMutation` 等），以及一条跨队列的文档化锁序——同时触碰 source graph 与 keys/instances 的操作必须先取 source 队列再取内层队列。

摩擦是具体的：任何一个域的小改动都要在一个近千行文件里定位；5 条队列散落在文件各处，锁序约束靠注释和约定维系，改错一处就是静默 lost update；92 个导出的公共面没有任何锁，`export` 关键字一加就永久公共。

在动手之前，先做了一轮全库扫描评估"哪些大文件值得拆"。结论是 `lib/storage.ts` 是**唯一**高价值拆分目标，判定标准三条同时满足：

1. **一个文件内有多个自然域边界**——6 个存储域各自有独立的 storage key、独立的读写函数族、独立的归一化入口，边界不是人为切的，是领域本来就有的；
2. **宽公共面**——92 个导出被约 30 个调用方消费，但全部经 `@/lib/storage` / `./storage` 路径导入，barrel 可以原样保面，做到零调用方改动；
3. **领域逻辑与基础设施混杂**——5 个 mutation 队列是实现细节，却和领域函数平铺在同一层，读者无法一眼看出"哪些函数共享哪条队列、锁序是什么"。

同样被扫描、判定为**不值得拆**的对照清单（这条对照清单和拆分本身一样是本次的可迁移知识）：

- **React 页面组件**（search / options 的大 tsx）：大是因为子组件多，正确拆法是按子组件提取，属于功能开发时的自然分解，不是机械文件拆分能受益的形态；
- **CSS**：低价值高风险，选择器全局作用域下拆文件几乎只有风险没有收益；
- **`lib/gateway.ts` 的薄委托包装**：大是因为 handler 多，但每个 handler 是几行委托，拆出去只增加一层间接，无域边界可循；
- **`lib/config-io.ts`**：导出数本来就少，校验逻辑是内聚的，拆了反而把"校验与被校验形状"分开。

一句话：**拆分的收益来自"把已有的域边界变成模块边界"，而不是把行数均分**。文件大只是症状，域边界 + 宽公共面 + 混入的并发基础设施才是这里的病因。

## Guidance

### 域映射：一个可变域一个 `-store.ts`，队列随域走

12 个文件的职责划分（`lib/storage.ts` → `lib/storage/`）：

```
lib/storage/
├── keys.ts                  # 20 个 KEY 常量 + 4 个 pref 类型 + BYOK 安全头注释
├── shared.ts                # 跨域私有 helper（DEFAULT_ENGINE_ID / isKnownProvider / ensureVisibleUsable），不进 barrel
├── provider-keys-store.ts   # providerKeys 域 + providerKeysMutationQueue
├── max-results-store.ts     # providerMaxResults 域 + 队列（内部函数 readMaxResultsMapFrom 不进 barrel）
├── source-graph-store.ts    # sourceOrder/hidden/group/active + sourceMutationQueue
├── site-engine-store.ts     # siteEngines 域 CRUD
├── custom-engine-store.ts   # customEngines 域 CRUD
├── provider-instance-store.ts # providerInstances 域 CRUD + providerInstancesMutationQueue
├── search-cache-store.ts    # searchCache 包装 + 缓存队列
├── prefs-store.ts           # 20 个只读 pref getter/setter
├── snapshot.ts              # getProviderConfigSnapshot（跨域精确键批量读）
└── index.ts                 # barrel
```

三条映射规则：

- **队列的所有权归"改写那个 key 的域模块"**。`providerKeysMutationQueue` 住在 `provider-keys-store.ts`，`sourceMutationQueue` 住在 `source-graph-store.ts`，`providerInstancesMutationQueue` 住在 `provider-instance-store.ts`——队列与它串行化的 key 在同一个文件里，读者不需要跨文件追踪并发边界。
- **跨域 helper 放 `shared.ts` 且不进 barrel**。`ensureVisibleUsable` 同时被 keys / source-graph / instance 三个 store 使用，是内部实现；不导出意味着它永远可以改签名。
- **只读域不需要队列**。`prefs-store.ts` 的 20 个 getter/setter 是单 key 直写，没有读改写循环，也就没有队列——不要为了对称给每个 store 都配一条。

### barrel 保导出面：`export *` 默认，内部实现用显式命名列表排除

这是本次拆分能做到零调用方改动的全部机制。约 30 个调用方原本就写 `import { setKey, getSourceOrder } from '@/lib/storage'` 或 `'./storage'`；`storage.ts` 变成 `storage/` 目录后，`./storage` 与 `@/lib/storage` 都解析到 `storage/index.ts`，TypeScript 与打包器把目录的 `index.ts` 当作原文件的等价物。barrel 的真实内容：

```ts
// lib/storage/index.ts
export * from './keys';
export * from './provider-keys-store';
export {
  MAX_RESULTS_MIN,
  MAX_RESULTS_MAX,
  clampMaxResults,
  withProviderMaxResultsMutation,
  getProviderMaxResults,
  setProviderMaxResults,
  clearProviderMaxResults,
  getAllProviderMaxResults,
} from './max-results-store';
export * from './source-graph-store';
export * from './prefs-store';
export * from './site-engine-store';
export * from './custom-engine-store';
export * from './provider-instance-store';
export * from './search-cache-store';
export * from './snapshot';
```

`export *` 与显式命名列表的选择规则：

- **模块所有导出都是公共 API 时用 `export *`**（9 个模块如此）；
- **模块含内部实现时用显式命名列表**。`max-results-store.ts` 的 `readMaxResultsMapFrom` 是给同目录兄弟模块用的内部读取函数，`export *` 会把它静默提升为公共 API——命名列表把它挡在 barrel 之外；
- **`shared.ts` 干脆不出现在 barrel 里**。它只被目录内相对路径导入，从源头就不公共。

### 队列必须保持模块级单一实例，锁序注释逐字迁移

拆分最危险的地方不在导出面，在并发。原文件的每条队列是**一个模块级 promise 链变量**，拆分后必须仍然恰好是一个实例：

```ts
// lib/storage/provider-keys-store.ts
// providerKeys 的读改写串行队列：setKey/clearKey/mergeImport 共用，避免并发写丢失。
let providerKeysMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 providerKeys 的读改写（setKey / clearKey / mergeImport），防止并发写覆盖。 */
export function withProviderKeysMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerKeysMutationQueue.then(mutation, mutation);
  providerKeysMutationQueue = run.catch(() => undefined);
  return run;
}
```

同一个 `let` 变量、同一个文件、被该域所有写函数闭包引用——这就是"单一实例"的全部含义。队列本体仍然导出（`withSourceMutation` 等四个 `with*Mutation` 在 92 导出面上），因为 `config-io.ts` 的 `mergeImport` 需要按既定锁序嵌套它们；导出队列函数 ≠ 允许第二份队列实现。

**锁序注释逐字迁移，一个字不改**。原文件里解释"为什么先取 source 队列"的注释是防回归知识，迁移时改写措辞就是在制造未来的漂移：

```ts
// lib/storage/provider-keys-store.ts — clearKey
export async function clearKey(id: ProviderId): Promise<void> {
  // Always acquire source before provider keys when an operation touches both;
  // mergeImport follows this same order.
  await withSourceMutation(() => withProviderKeysMutation(async () => {
    // ...一次性读出全部相关 key，读改写后单次 set 提交...
  }));
}
```

```ts
// lib/storage/provider-instance-store.ts — createProviderInstance
export async function createProviderInstance(baseProviderId: ProviderId, name: string, options: Record<string, unknown>): Promise<ProviderInstance> {
  // 同时改写实例集合与 sourceOrder：按 deleteProviderInstance/clearKey 的既定次序
  // 先取 source 队列、再取实例队列，避免与 mergeImport（持 source 队列整写实例数组）并发覆盖。
  return withSourceMutation(() => withProviderInstancesMutation(async () => {
    // ...
  }));
}
```

拆分前后的函数签名与嵌套结构完全一致，变的只是它在哪个文件里。这一点本身就该成为验收标准：**逐函数对照评审，签名、队列嵌套、注释三者均不得漂移**。

### 评审与加固闭环：独立 oracle 评审 + 三层机制化防回归

拆分完成后跑一轮独立评审（逐函数行为等价性核对），本轮它抓到三类真实问题，每类都是"拆分类重构"的通病，值得作为固定检查项：

- **git 流程缺口**：新目录未被 `git add`（untracked），若直接提交会静默丢掉一半模块；
- **6 处文档/注释仍引用 `lib/storage.ts`**：路径改名后引用漂移；
- **`readMaxResultsMapFrom` 的 async→sync 签名漂移**：搬运时"顺手简化"掉了 `async`，返回值从 `Promise<T>` 变 `T`，调用方在两种上下文里行为不同——已恢复 `async`。

加固产物是三层防回归机制（细节见 Examples 与 Prevention）：导出面快照测试、锁序并发回归测试、`no-restricted-imports` 深层导入禁令。最终验证：`npm run typecheck` ✓、`npm run lint` ✓、WXT prod build ✓、vitest 64 files / 1275 tests ✓（拆分前 62 / 1272，新增两个测试文件三个用例）。

## Why This Matters

### 队列分叉 = 串行化静默失效 = lost update

这 5 条队列是 `chrome.storage.local` 上读改写循环的唯一保护。`clearKey`、实例 CRUD、`mergeImport` 都是"get 一批 key → 归一化 → set 回去"的三步操作；没有串行化时，两个并发操作的 get 都发生在对方 set 之前，后写者用陈旧快照覆盖前写者——用户配置的 key 消失、刚创建的实例被导入覆盖。**队列的串行化能力完全来自"所有写方闭包引用同一个模块级变量"**。如果拆分让某个队列出现两份实例（模块被两份模块图各加载一次，或队列代码被复制进第二个文件），两份队列各自串行自己那批操作、彼此之间零互斥——串行化静默失效，且不会报任何错，只在并发窗口里偶发丢数据。这是拆分类重构里最恶劣的失败模式：类型检查过、单测过、构建过，不变量已经没了。

### ESM 按解析路径单实例：barrel 与内部直连共享同一模块实例

拆分后 `provider-instance-store.ts` 内部 `import { withSourceMutation } from './source-graph-store'`，而外部调用方经 barrel 间接触达同一批函数。ESM 的模块标识是**解析后的路径**：`./source-graph-store` 从 barrel 侧和从兄弟模块侧解析到同一个文件，就是同一个模块实例，`sourceMutationQueue` 只初始化一次——这正是"目录内部相对导入 + 外部统一 barrel"这个结构安全的规范基础。

深层导入（`@/lib/storage/provider-keys-store`、`../storage/source-graph-store`）的危险因此有三层：其一，它绕过 barrel 的显式命名列表，内部实现成为事实公共 API，未来任何收窄都被这些导入点锁死；其二，在测试 mock 边界（`vi.mock('@/lib/storage')` 只拦截 barrel，深层导入绕过 mock，测试直接打到真实模块）与 dev HMR / 双别名解析的某些形态下，两份模块图是真实会发生的故障模式，队列就此分叉；其三，它诱使下一个人"绕开 barrel 限制"再复制一份队列代码。规范保障（单实例）+ 机制化禁令（lint）合在一起，不变量才闭环。

### 零调用方改动的价值

这次拆分没有改任何一个调用方文件：30 个消费点原本就统一走 `@/lib/storage` / `./storage`。这让拆分的 diff 是**纯结构性的**——review 只需对照两个结构，不需要在每个调用点验证"改导入路径时有没有顺手改行为"。反面是如果调用方本来就直接深路径导入单文件内部的具名导出，拆分前得先把它们收敛到 barrel；"统一从 barrel 导入"这个习惯在拆分之前就该养成，它是零成本拆分的前提而不是结果。

## When to Apply

适用——三条同时满足再动手：

- 文件内存在**多个自然域边界**（独立的 storage key / 数据形状 / 读写函数族），拆分是把已有边界变成模块边界，不是把行数均分；
- **宽公共面且消费方统一经模块根导入**，barrel 能原样保面、零调用方改动；
- 文件混有**模块级并发原语**（队列、缓存、单例状态），拆分能把"状态 + 使用它的函数"收进同一个模块，让并发边界变得可见。

不适用：

- React 页面组件——按子组件提取，不按域拆文件；
- CSS / 样式文件——低价值高风险；
- 薄委托层（如 `gateway.ts` 的 handler 表）——大而内聚，拆只是加间接；
- 导出数本来就少的内聚模块（如 `config-io.ts`）——拆开反而分离了校验与被校验形状。

## Examples

### Before / After

Before（单文件，问题所在）：

```
lib/storage.ts（898 行 / 92 exports）
├── 20 个 KEY 常量 + 4 个 pref 类型
├── 5 个模块级队列（providerKeys / source / maxResults / instances / searchCache）散布各处
├── 6 个域的全部读写函数 + search-cache 包装
└── getProviderConfigSnapshot
```

After：见 Guidance 第一节的 12 文件目录树。每个可变域一个 `-store.ts`，队列与 key 同文件；`keys.ts` 顶部保留 BYOK 安全头注释（`getKey` 仅 worker 调用、优先精确键读取、不 `get(null)`），安全约定随常量一起迁移。

### 回归测试 1：导出面快照（88 项运行时导出）

`tests/storage-surface.test.ts` 用字母序快照锁死 barrel 的运行时导出面，`Object.keys` 只反映运行时值，4 个纯类型导出由 typecheck 覆盖（88 + 4 = 92 与拆分前对账）：

```ts
// tests/storage-surface.test.ts
import * as storage from '@/lib/storage';

it('exposes exactly the 88 runtime exports (alphabetical snapshot)', () => {
  expect(Object.keys(storage).sort()).toEqual([
    // keys（20 常量）+ max-results 常量（2）
    'ACTIVE_KEY',
    // ...（87 项全列表）...
    'withSourceMutation',
  ]);
  expect(Object.keys(storage)).toHaveLength(88);
});
```

文件头注释写明设计意图：防止未来模块用 `export *` 静默泄漏内部实现（`readMaxResultsMapFrom` 即靠精确命名列表排除）。任何人给子模块加公共导出，这条测试会强制他显式更新快照——公共面的扩张从"静默"变成"显式审查点"。

### 回归测试 2：锁序并发回归（deferred gate + write-log）

`tests/storage-lock-order.test.ts` 用一个带受控钩子的内存 storage mock 回答"拆分后锁还灵不灵"。mock 提供三样东西：底层 `Map`（断言"尚未写入"）、`writeLog: string[][]`（每次 `set` 的 key 列表按序记录）、`blockNextSetOf(key)`（让指定 key 的下一次 `set` 挂起，直到测试放行）。

**用例 A（锁序）**：gate 挂住 A（`setSourceOrder`）的首次 `SOURCE_ORDER_KEY` set；并发发起 B（`createProviderInstance`）。断言三段：

```ts
const gate = mock.blockNextSetOf(SOURCE_ORDER_KEY);
const pA = setSourceOrder(['bing', 'google']);
const pB = createProviderInstance('tavily', 'Fast', {});

await new Promise((r) => setTimeout(r, 20));
// B 的 mutation 体尚未开始：既没有 set 日志，存储里也没有实例键。
expect(mock.writeLog.some((keys) => keys.includes(PROVIDER_INSTANCES_KEY))).toBe(false);
expect(mock.store.has(PROVIDER_INSTANCES_KEY)).toBe(false);

gate.resolve();
// ...最终态断言...
// 串行化：A 的唯一一次写完成后才开始 B 的写。
const aWrite = mock.writeLog.findIndex((keys) => keys.length === 1 && keys[0] === SOURCE_ORDER_KEY);
const bWrite = mock.writeLog.findIndex((keys) => keys.includes(PROVIDER_INSTANCES_KEY));
expect(bWrite).toBeGreaterThan(aWrite);
```

若某条队列出现第二份实例，B 不会等 A，20ms 后 `PROVIDER_INSTANCES_KEY` 已落盘、`bWrite < aWrite`——两处断言都会炸。

**用例 B（lost-update 检测）**：不挂 gate，`Promise.all([setSourceOrder, createProviderInstance])` 并发。断言两笔写都存活且无覆盖：实例存在（B 未被 A 覆盖）、order 同时保留 A 的移动结果（`bing`、`google` 在前）与 B 追加的实例 id（在尾），且实例 id 恰好出现一次（`order.filter((id) => id === created.id)` 长度为 1）。文件头注释明确写出这个测试防的是什么：模块重复加载/分叉导致的队列双实例。

### 深层导入禁令（lint 机制化）

```ts
// eslint.config.mjs
rules: {
  'no-restricted-imports': ['error', {
    patterns: [
      {
        group: ['@/lib/storage/*', '../storage/*', './storage/*'],
        message: '深层导入 lib/storage/ 子模块被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例与稳定公共 API 面。',
      },
    ],
  }],
},
```

注意 pattern 的收敛性已验证零误报：`lib/storage/` 内部的 `./keys`、`./source-graph-store` 不匹配 `./storage/*`（它们不叫 `storage/...`），目录外对 `../site-engines` 这类相邻模块的导入同样不匹配——规则只打击真正绕 barrel 的路径形态，`npm run lint` 保持全绿。

## Prevention

- **导出面快照测试**（`tests/storage-surface.test.ts`）：字母序锁定全部运行时导出 + `toHaveLength(88)`；类型导出与运行时导出分账（4 + 88 = 92 与拆分前对账），注释写明计数口径。任何新增公共导出必须显式改快照。
- **锁序并发回归测试**（`tests/storage-lock-order.test.ts`）：用 write-log + deferred gate 的 storage mock 同时锁"锁序"（A 完成前 B 不得写）与"无 lost update"（并发后两笔写都存活、实例 id 恰好追加一次）。队列分叉是这个测试的直接靶子。
- **`no-restricted-imports` 深层导入禁令**（`eslint.config.mjs`）：`@/lib/storage/*`、`../storage/*`、`./storage/*` 三种路径形态全部报 error，message 写明"mutation 队列单一实例"理由——机制约束必须自带解释，否则下一个人只会想办法绕开它。
- **拆分类重构的固定检查项**：逐函数对照评审（签名 / 队列嵌套 / 注释三者零漂移，警惕 async→sync 这类"顺手简化"）；grep 旧路径 `lib/storage.ts` 清理文档与注释引用；确认新目录已被 git 跟踪；跑全量 `npm run typecheck` + `npm run lint` + `npm run build` + `npm test` 对账（本次 62 files / 1272 tests → 64 / 1275，增量恰好是新增的防回归测试）。

## Related

- `docs/solutions/logic-errors/instance-crud-cross-queue-lock-order.md` — source→instances 锁序的由来（mergeImport 跨队列 lost update 修复），本拆分逐字迁移的锁序注释正是那个修复留下的契约。
- `docs/solutions/architecture-patterns/dual-domain-storage-schema-versioning.md` — `withSourceMutation` / 每域队列模式的原始设计。
- `docs/solutions/architecture-patterns/config-preference-pipeline.md` — `mergeImport` 的队列嵌套（`withSourceMutation(withProviderKeysMutation(...))`），拆分后它经 barrel 导出的队列 helper 保持同一锁序。
- `docs/solutions/architecture-patterns/provider-instance-multi-config-model.md` — 实例模型的存储 CRUD 契约（含锁序），其引用的 `lib/storage.ts` 路径已随本次拆分更新为 `lib/storage/`。
- `docs/solutions/architecture-patterns/testable-content-script-helpers-via-lib-extraction.md` — 同一主题的另一面：为可测试性把代码抽进 `lib/`；本次拆分延续"lib 模块经统一入口消费"的约定。
