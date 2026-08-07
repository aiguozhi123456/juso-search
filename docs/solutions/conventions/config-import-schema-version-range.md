---
title: "Accept a Contiguous Schema-Version Range on Config Import, Not a Hardcoded Version List"
date: 2026-08-02
category: conventions
module: "config-io / schema"
problem_type: convention
component: tooling
severity: low
applies_when:
  - "Validating the schema version of an untrusted import/backup payload"
  - "A versioned format where multiple older versions must remain importable"
related_components: [lib/config-io.ts, lib/schema.ts]
tags: [config-import, schema-versioning, backward-compatibility, convention, parse-import]
---

# Accept a Contiguous Schema-Version Range on Config Import, Not a Hardcoded Version List

## Context

`parseImportPayload`（`lib/config-io.ts`）最初用一个**硬编码版本列表**给导入做门控——`schemaVersion !== 3 && !== 4 && !== CURRENT_SCHEMA_VERSION`。在 `CURRENT_SCHEMA_VERSION = 8` 时，这等价于接受 `{3, 4, 8}` 而拒绝 `5/6/7`；其上方注释也已过期（声称「CURRENT (v5)」）。

结构性问题在于：这个列表写死了「两个遗留版本 + HEAD」，而且**永远不会增长**。下一次 bump（CURRENT → 9）时，它会静默拒绝**所有**当前 v8 的备份——也就是刚导出的每一份文件。这正是代码库在别处努力避免的「旧备份无法恢复」失败模式。

## Guidance

接受一个**连续的支持区间**。引入 `MIN_SUPPORTED_SCHEMA_VERSION`（= 3，即最旧的、带导出/导入能力的版本；不存在 v1/v2 的导出文件），只在以下情况拒绝：

```ts
typeof schemaVersion !== 'number'
  || schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION
  || schemaVersion > CURRENT_SCHEMA_VERSION
```

保持这道门控**仅仅作为入口检查**——字段处理是基于存在性（`hasOwnProperty`）的，所以接受一个更旧的版本**并不会**绕过逐字段的规范化/校验；`isLegacyV3` 特例（豁免 v3 对 `siteEngines` 的强制要求）依旧适用。

不要为此 bump schema 版本——这纯粹是导入门控的调整，与持久化格式无关。

## Why This Matters

硬编码列表必须在每次 bump 时手工扩展；一旦忘记，就会静默破坏**当前版本**备份的恢复能力——这是一种邻近数据丢失的失败，而且只有当用户真的去恢复时才会暴露。区间则**按构造**向前兼容：上限永远跟着 `CURRENT_SCHEMA_VERSION` 走，bump 时不需要记得改门控。

## When to Apply

- 任何带版本的导入门控；
- 任何把「当前版本」与遗留版本并列的允许列表（allowlist）。

只要允许列表里出现「current version」字样，就该警觉：它会不会在下一次 bump 后悄悄把刚导出的备份拒之门外？

## Examples

**之前**（硬编码列表，bump 即坏）：

```ts
// CURRENT_SCHEMA_VERSION = 8 时接受 {3,4,8}，拒绝 5/6/7；
// bump 到 9 后，所有 v8 备份被静默拒绝。
if (schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== CURRENT_SCHEMA_VERSION) {
  return { ok: false, error: 'schema_version_mismatch' };
}
```

**之后**（连续区间，向前兼容）：

```ts
const MIN_SUPPORTED_SCHEMA_VERSION = 3; // 最旧的带导出能力的版本

if (
  typeof schemaVersion !== 'number'
  || schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION
  || schemaVersion > CURRENT_SCHEMA_VERSION
) {
  return { ok: false, error: 'schema_version_mismatch' };
}
```

入口检查之后，字段处理仍按存在性逐项校验（`siteEngines` / `customEngines` / `sourceOrder` / `groupConfig` 等），`isLegacyV3` 继续豁免 v3 对 `siteEngines` 的要求——接受更旧版本不等于放松校验。

## Related

- [dual-domain-storage-schema-versioning](../architecture-patterns/dual-domain-storage-schema-versioning.md) — 版本化架构本身；`parseImportPayload` 所处的 config 域上下文
- [source-graph-new-type-threading-data-loss](../logic-errors/source-graph-new-type-threading-data-loss.md) — 同族「把新事物在所有地方注册/接受」教训（其中 L1 即 `CONFIG_KEYS` 登记）
- [custom-engine-arbitrary-url-source-type](../architecture-patterns/custom-engine-arbitrary-url-source-type.md) — 引入 `customEngines` 字段、令导入校验新增一支的来源类型
- [Project concepts](../../../CONCEPTS.md) — Schema Version、Config Import/Export 等领域词汇
